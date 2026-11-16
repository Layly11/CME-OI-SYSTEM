import "server-only";
import { and, countDistinct, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { safeErrorSummary } from "@/lib/db-errors";
import { publishLicenseFile } from "@/lib/license-publish";
import { currentLicenseDestination } from "@/lib/license-storage";
import { targetsLiveLicenseList } from "@/lib/license-storage-config";
import { publishedEntryMap } from "./published-state";

/**
 * เผยแพร่รายชื่อ license ทีละรายการทั้งระบบ (ข้าม process/instance) ด้วย advisory lock ของ PostgreSQL
 *
 * ทำไมต้องเรียงคิว: publishLicenseFile() อ่านฐานข้อมูล → สร้างรายชื่อทั้งก้อน → เขียนทับ storage
 * ถ้าสองคำขอทำพร้อมกัน คำขอที่อ่านก่อน (รายชื่อเก่ากว่า) อาจเขียนทีหลังและทับรายชื่อที่ใหม่กว่า = ลูกค้าที่เพิ่งจ่ายหายจากรายชื่อ
 * ที่นี่จึงถือ lock ก่อน แล้วค่อยให้ publishLicenseFile อ่านฐานข้อมูล "ภายใน lock" — คนที่ได้ lock ทีหลังเห็นข้อมูลใหม่กว่าเสมอ
 * (ข้อยกเว้นเดียว: connection ที่ถือ lock ตายกลางคัน — ดูวิธีซ่อมที่ publishLicensesSerialized)
 *
 * ด่านเพิ่มของระบบนี้ก่อนเรียก publishLicenseFile (ไม่ได้แทนด่านเดิม):
 * - ปลายทางเป็นรายชื่อจริงใน Firebase → ปฏิเสธถ้ามี license ที่ active มาจากคำสั่งซื้อที่ชำระด้วยการชำระเงินจำลอง (mock)
 * - ปลายทางเปลี่ยนจากครั้งล่าสุดในประวัติ → บังคับเขียน แม้รายชื่อเหมือนเดิม
 *
 * ทำไมใช้ pg_try_advisory_xact_lock + วนถาม แทน pg_advisory_lock ที่รอเอง:
 * pool มี 5 connection และ publishLicenseFile ใช้ pool เดียวกัน — ถ้าคนรอ lock ถือ connection ค้างไว้
 * คนที่ถือ lock จะหา connection ที่สองมาอ่าน/เขียนไม่ได้ = ค้างทั้งระบบ แบบวนถาม คนรอคืน connection ทุกรอบ
 * (xact lock ปลดเองเมื่อ transaction จบ จึงใช้กับ pooler แบบ transaction mode ได้ และไม่มี lock ค้างถ้า process ตาย)
 *
 * ห้ามเรียกภายใน db.transaction ของผู้เรียก (เหตุผลเดียวกัน) — เรียกหลัง commit เท่านั้น
 * ไม่ได้แก้ขั้นตรวจ/ประวัติ/rollback ใดๆ: ทั้งหมดยังอยู่ใน license-publish.ts และ firebase-rtdb.ts ตามเดิม
 */
export type PublishOutcome =
  | { status: "published"; publicationId: string; entryCount: number }
  | { status: "unchanged"; entryCount: number }
  | { status: "busy" }
  | { status: "failed"; error: string };

/** เลขคงที่ของ lock "เผยแพร่รายชื่อ license" (ค่าใดก็ได้ที่ไม่ชนกับ lock อื่นของแอป — ตอนนี้มีตัวเดียว) */
export const LICENSE_PUBLISH_LOCK_KEY = "7203114020261116";

const DEFAULT_WAIT_MS = 15_000;
const POLL_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ข้อความ error ที่เก็บลง audit/log ได้: error ของฐานข้อมูลใช้สรุปสั้น (ข้อความเต็มของ drizzle มีค่าพารามิเตอร์)
 * error อื่น (storage, ด่านกันพลาดของ Firebase) เก็บข้อความ ตัดที่ 200 ตัวอักษร และบังตัวเลขยาว 5 หลักขึ้นไป (อาจเป็นเลขบัญชี MT5)
 */
export function publishErrorSummary(err: unknown): string {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    const e = cur as { name?: unknown; code?: unknown; query?: unknown; cause?: unknown };
    const pgCode = typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) && /\d/.test(e.code);
    if (pgCode || e.name === "DrizzleQueryError" || e.name === "PostgresError" || typeof e.query === "string") {
      return safeErrorSummary(err);
    }
    cur = e.cause;
  }
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "unknown error";
  return message.replace(/\d{5,}/g, "#####").slice(0, 200);
}

async function auditPublish(action: string, data: Record<string, unknown>) {
  try {
    await getDb().insert(schema.auditLogs).values({
      actorUserId: null,
      action,
      entity: "license_file_publication",
      entityId: null,
      data,
    });
  } catch (err) {
    console.error(`[license] บันทึก audit ${action} ไม่ได้:`, safeErrorSummary(err));
  }
}

type Attempt = { locked: false } | { locked: true; outcome: PublishOutcome };

/** จำนวน license ที่ active และผูก (ผ่าน license_activations) กับคำสั่งซื้อที่ชำระด้วยการชำระเงินจำลอง */
export async function countActiveMockPaidLicenses(): Promise<number> {
  const [row] = await getDb()
    .select({ n: countDistinct(schema.licenses.id) })
    .from(schema.licenses)
    .innerJoin(schema.licenseActivations, eq(schema.licenseActivations.licenseId, schema.licenses.id))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.licenseActivations.orderId))
    .where(and(eq(schema.licenses.status, "active"), eq(schema.orders.paymentProvider, "mock")));
  return row?.n ?? 0;
}

/**
 * งานที่ทำ "ภายใน lock": ด่านของระบบนี้ → publishLicenseFile() (ตรวจรูปแบบ/ประวัติ/ด่านของ Firebase อยู่ในนั้นตามเดิม)
 * ไม่ throw — error ทุกชนิดกลายเป็นผล failed (ผู้เรียกใช้ promise นี้รอให้งานจบจริงเมื่อ connection ที่ถือ lock ตาย)
 */
async function publishUnderLock(opts: { actorUserId?: string | null; force: boolean }): Promise<PublishOutcome> {
  try {
    // ด่านแยกระบบทดสอบ/ระบบจริง: รายชื่อจริงต้องไม่มี license ที่มาจากการชำระเงินจำลอง
    // (ฐานข้อมูลที่เคยใช้กับ mock แล้วถูกชี้ไปรายชื่อจริง หรือระบบ mock ที่ใช้ฐานข้อมูลร่วมกับระบบจริง)
    if (targetsLiveLicenseList(process.env)) {
      const mockLicenses = await countActiveMockPaidLicenses();
      if (mockLicenses > 0) {
        return {
          status: "failed",
          error:
            `ปฏิเสธการเผยแพร่ไปรายชื่อจริง: มี license ที่ active ${mockLicenses} ใบมาจากการชำระเงินจำลอง (mock) ` +
            "— ล้างข้อมูลทดสอบด้วย npm run license:purge-mock หรือใช้ฐานข้อมูลใหม่ก่อนเปิดระบบจริง",
        };
      }
    }

    // ปลายทางเปลี่ยนจากครั้งล่าสุด (เช่น Data_test → Data ตอนเปิดระบบจริง) → ต้องเขียนแม้รายชื่อเหมือนเดิมทุกตัวอักษร
    // (publishLicenseFile ข้ามการเขียนโดยดูแค่ checksum ในประวัติ ไม่ได้ดูว่าเขียนไปที่ไหน)
    let force = opts.force;
    if (!force) {
      const destination = currentLicenseDestination();
      const [last] = await getDb()
        .select({ storageUrl: schema.licenseFilePublications.storageUrl })
        .from(schema.licenseFilePublications)
        .orderBy(desc(schema.licenseFilePublications.publishedAt))
        .limit(1);
      if (destination !== null && last && last.storageUrl !== destination) force = true;
    }

    // อ่านฐานข้อมูลภายใน lock (publishLicenseFile ใช้ connection อื่นของ pool — transaction ของผู้เรียกมีไว้ถือ lock เท่านั้น)
    const r = await publishLicenseFile({ publishedBy: opts.actorUserId ?? null, force });
    return r.skipped
      ? { status: "unchanged", entryCount: r.entryCount }
      : { status: "published", publicationId: r.publicationId, entryCount: r.entryCount };
  } catch (err) {
    return { status: "failed", error: publishErrorSummary(err) };
  }
}

/**
 * เผยแพร่รายชื่อ license จากฐานข้อมูล — ไม่ throw ไม่ว่ากรณีใด
 * - published  เขียน storage สำเร็จและบันทึกประวัติแล้ว
 * - unchanged  รายชื่อเหมือนที่เผยแพร่ล่าสุดทุกตัวอักษร และปลายทางเดิม (เรียกซ้ำได้เสมอ ไม่มีผลข้างเคียง)
 *              หมายเหตุ: ตัดสินจากประวัติในฐานข้อมูล ไม่ได้อ่านปลายทางจริง — ปลายทางถูกแก้มือ/ไฟล์หาย ต้องใช้ force
 * - failed     storage เขียนไม่ได้ / ด่านกันพลาดปฏิเสธ — license ในฐานข้อมูลไม่ถูกแตะ บันทึก audit license_file.publish_failed
 * - busy       รอคิวเกิน waitMs — บันทึก audit license_file.publish_deferred
 * กรณี failed/busy: เรียกใหม่ได้ทุกเมื่อ (การเปิด license ครั้งถัดไป, ปุ่ม "ตรวจสอบสถานะอีกครั้ง", `npm run license:publish`)
 *
 * connection ที่ถือ lock ตายระหว่างเผยแพร่ (ฐานข้อมูล failover, pooler รีสตาร์ต, idle-in-transaction timeout):
 * lock ถูกปลดทันทีแต่ publishLicenseFile() รอบนั้นยังวิ่งต่อ "นอก lock" และอาจเขียนรายชื่อเก่าทับรายชื่อที่คำขออื่นเพิ่งเขียน
 * ที่นี่จึงรอให้รอบนั้นจบจริงก่อน แล้วขอ lock ใหม่และเขียนซ้ำจากฐานข้อมูลแบบ force 1 รอบ (audit license_file.publish_lock_lost)
 * — การเขียนครั้งสุดท้ายจึงเป็นการเขียนภายใน lock เสมอ ถ้ารอบซ่อมนี้ทำไม่ได้ (ฐานข้อมูลยังล่ม/คิวไม่ว่าง) คืน failed
 * และต้องรัน `npm run license:publish` เมื่อฐานข้อมูลกลับมา
 */
export async function publishLicensesSerialized(opts: {
  trigger: string;
  orderId?: string;
  actorUserId?: string | null;
  waitMs?: number;
  force?: boolean;
}): Promise<PublishOutcome> {
  const trigger = opts.trigger.slice(0, 40);
  const context = { trigger, orderId: opts.orderId ?? null };
  const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS;
  let deadline = Date.now() + waitMs;
  let force = opts.force === true;
  let recovering = false;

  const fail = async (error: string): Promise<PublishOutcome> => {
    console.error("[license] เผยแพร่รายชื่อไม่สำเร็จ:", error);
    await auditPublish("license_file.publish_failed", { ...context, error, ...(recovering ? { afterLockLost: true } : {}) });
    return { status: "failed", error };
  };

  for (;;) {
    // งานเผยแพร่ของรอบนี้ (ถ้าได้ lock) — เก็บไว้นอก transaction เพื่อรอให้จบได้แม้ transaction ที่ถือ lock ล้มไปก่อน
    const running: { publish: Promise<PublishOutcome> | null } = { publish: null };
    let attempt: Attempt;
    try {
      attempt = await getDb().transaction(async (tx): Promise<Attempt> => {
        const rows = await tx.execute<{ locked: boolean }>(
          sql`select pg_try_advisory_xact_lock(${sql.raw(LICENSE_PUBLISH_LOCK_KEY)}) as locked`,
        );
        if (rows[0]?.locked !== true) return { locked: false };
        running.publish = publishUnderLock({ actorUserId: opts.actorUserId, force });
        return { locked: true, outcome: await running.publish };
      });
    } catch (err) {
      const error = publishErrorSummary(err);
      // ฐานข้อมูลใช้ไม่ได้ตั้งแต่ขั้นขอ lock หรือรอบซ่อมล้มซ้ำ → รายงานว่าล้ม (ลองใหม่ได้ภายหลัง)
      if (running.publish === null || recovering) return fail(error);

      // ได้ lock และเริ่มเผยแพร่แล้ว แต่ connection ที่ถือ lock ตาย: รอให้งานที่หลุด lock จบก่อน แล้ววนไปเขียนซ้ำภายใน lock
      await running.publish;
      console.error("[license] connection ที่ถือ lock เผยแพร่หลุดระหว่างทำงาน — จะเผยแพร่ซ้ำภายใน lock:", error);
      await auditPublish("license_file.publish_lock_lost", { ...context, error });
      recovering = true;
      force = true;
      deadline = Date.now() + Math.max(waitMs, DEFAULT_WAIT_MS);
      continue;
    }

    if (attempt.locked) {
      if (attempt.outcome.status === "failed") return fail(attempt.outcome.error);
      return attempt.outcome;
    }
    if (Date.now() + POLL_MS > deadline) {
      if (recovering) return fail("เผยแพร่ซ้ำหลัง lock หลุดไม่ได้เพราะคิวไม่ว่าง — รัน npm run license:publish เพื่อเขียนรายชื่อจากฐานข้อมูลอีกครั้ง");
      await auditPublish("license_file.publish_deferred", context);
      return { status: "busy" };
    }
    await sleep(POLL_MS);
  }
}

/** เลขบัญชี → วันหมดอายุ ของรายชื่อที่เผยแพร่ล่าสุด (ยังไม่เคยเผยแพร่ = Map ว่าง) */
export async function getLatestPublishedEntries(): Promise<Map<string, string>> {
  const [last] = await getDb()
    .select({ content: schema.licenseFilePublications.content })
    .from(schema.licenseFilePublications)
    .orderBy(desc(schema.licenseFilePublications.publishedAt))
    .limit(1);
  return publishedEntryMap(last?.content ?? null);
}
