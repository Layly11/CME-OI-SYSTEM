import "server-only";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isUniqueViolation, safeErrorSummary } from "@/lib/db-errors";
import { isMockPaymentBlocked } from "@/lib/payment/config";
import { todayInBangkok } from "@/lib/purchase/format";
import type { Tx } from "@/lib/purchase/mt5-release";
import { planActivation } from "./activation-rules";

/**
 * เปิด/ต่อ license ของคำสั่งซื้อโดยอัตโนมัติ — ไม่มีขั้นแอดมินอนุมัติ
 *
 * เงื่อนไข: คำสั่งซื้อ "ชำระแล้ว" และ "มีบัญชี MT5" ครบทั้งคู่ เรียกได้จากทั้งสองทาง (ชำระทีหลัง / ผูกบัญชีทีหลัง)
 * และเรียกซ้ำกี่ครั้งก็ได้: 1 คำสั่งซื้อเปิดได้ครั้งเดียว บังคับโดยฐานข้อมูล
 * (license_activations.order_id unique + ล็อกแถวคำสั่งซื้อ) กดซ้ำ ลองใหม่ หรือสองคำขอพร้อมกันจึงไม่ได้ license สองใบหรือต่ออายุสองรอบ
 *
 * ฟังก์ชันนี้แก้เฉพาะ PostgreSQL — การเขียนรายชื่อที่บอทอ่านเป็นขั้นถัดไป (publishLicensesSerialized) หลัง transaction นี้ commit
 * ดู fulfilOrder ใน ./fulfil.ts ห้ามเรียกฟังก์ชันนี้ภายใน db.transaction ของผู้เรียก
 *
 * ข้อจำกัดที่รับทราบแล้ว (ยังไม่แก้):
 * - เลขบัญชีของลูกค้าเดิมที่มีอยู่แต่ใน Firebase ยังไม่ถูก import — ระบบจึงมองเป็น license ใหม่ ไม่ได้ต่อจากวันหมดอายุเดิมใน Firebase
 * - เปลี่ยนเลขบัญชีหลังเปิด license แล้วยังไม่รองรับ
 * - ไม่มีการส่งอีเมลแจ้งลูกค้า
 * - อายุแพ็กเกจอ่านตอนเปิด license (ไม่ได้เก็บไว้ที่คำสั่งซื้อ) — ค่าที่ใช้จริงบันทึกใน license_activations
 * - คำสั่งซื้อที่ชำระแล้วแต่ถูกกัน (blocked) ต้องให้ทีมงานจัดการเอง ดู audit license.activate_blocked
 *
 * ด่านของการชำระเงินจำลอง: คำสั่งซื้อที่ "ชำระ" ด้วย provider mock เปิด license ได้เฉพาะเมื่อค่าตั้งปัจจุบันยังอนุญาต mock
 * (ตรวจตอนเปิด ไม่ใช่แค่ตอนชำระ) — คำสั่งซื้อจำลองที่ค้างไว้จึงเอามาแลกเป็น license จริงหลังเปิดระบบจริงไม่ได้ (blocked: mock_payment)
 * การกันนี้ไม่ถาวร: ตรวจใหม่ทุกครั้งที่เรียก ถ้ารันในค่าตั้งที่อนุญาต mock ก็เปิดได้ตามปกติ
 */
export type ActivationBlockReason = "license_suspended" | "lifetime_active" | "mock_payment";

export type ActivateResult =
  | { status: "activated"; licenseId: string; expiresAt: string; kind: "new" | "extended" | "reactivated" }
  | { status: "already_activated"; licenseId: string; expiresAt: string }
  | { status: "not_ready"; reason: "order_not_found" | "not_paid" | "no_account" }
  | { status: "blocked"; reason: ActivationBlockReason };

const ORDER_UNIQUE = "license_activations_order_id_unique";
const ACTIVE_UNIQUE = "licenses_active_per_account_idx";

async function findActivation(db: ReturnType<typeof getDb> | Tx, orderId: string) {
  const [row] = await db
    .select({ licenseId: schema.licenseActivations.licenseId, newExpiresAt: schema.licenseActivations.newExpiresAt })
    .from(schema.licenseActivations)
    .where(eq(schema.licenseActivations.orderId, orderId))
    .limit(1);
  return row ?? null;
}

/** บันทึกว่าคำสั่งซื้อที่ชำระแล้วเปิด license ไม่ได้ — ครั้งเดียวต่อเหตุผล (การลองใหม่ไม่เขียนซ้ำ) */
async function auditBlocked(tx: Tx, orderId: string, userId: string, reason: ActivationBlockReason) {
  const existing = await tx
    .select({ data: schema.auditLogs.data })
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.action, "license.activate_blocked"), eq(schema.auditLogs.entityId, orderId)));
  if (existing.some((r) => (r.data as { reason?: unknown } | null)?.reason === reason)) return;
  await tx.insert(schema.auditLogs).values({
    actorUserId: null,
    action: "license.activate_blocked",
    entity: "order",
    entityId: orderId,
    data: { orderId, userId, reason },
  });
}

type Env = Record<string, string | undefined>;

async function activateInTx(tx: Tx, orderId: string, today: string, env: Env): Promise<ActivateResult> {
  // ลำดับล็อก: คำสั่งซื้อ → บัญชี MT5 → license (โค้ดอื่นล็อก user → คำสั่งซื้อ / user → บัญชี จึงไม่เป็นวง)
  const [order] = await tx
    .select({
      id: schema.orders.id,
      userId: schema.orders.userId,
      status: schema.orders.status,
      mt5AccountId: schema.orders.mt5AccountId,
      packageId: schema.orders.packageId,
      paymentProvider: schema.orders.paymentProvider,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .for("update");
  if (!order) return { status: "not_ready", reason: "order_not_found" };
  if (order.status !== "paid") return { status: "not_ready", reason: "not_paid" };
  if (order.mt5AccountId === null) return { status: "not_ready", reason: "no_account" };

  const done = await findActivation(tx, order.id);
  if (done) return { status: "already_activated", licenseId: done.licenseId, expiresAt: done.newExpiresAt };

  // ชำระด้วย mock แต่ค่าตั้งตอนนี้ไม่อนุญาต mock (ปิดไปแล้ว / ชี้รายชื่อจริง / NODE_ENV ที่ต้องมี flag) → ไม่เปิด license
  if (isMockPaymentBlocked(order.paymentProvider, env)) {
    await auditBlocked(tx, order.id, order.userId, "mock_payment");
    return { status: "blocked", reason: "mock_payment" };
  }

  // ล็อกแถวบัญชี: คำสั่งซื้อต่างรายการของบัญชีเดียวกันจึงเปิดทีละรายการ (ต่ออายุสองรายการพร้อมกัน = บวกอายุครบทั้งคู่)
  const [account] = await tx
    .select({ id: schema.mt5Accounts.id })
    .from(schema.mt5Accounts)
    .where(eq(schema.mt5Accounts.id, order.mt5AccountId))
    .for("update");
  if (!account) return { status: "not_ready", reason: "no_account" };

  const licenses = await tx
    .select({
      id: schema.licenses.id,
      status: schema.licenses.status,
      expiresAt: schema.licenses.expiresAt,
    })
    .from(schema.licenses)
    .where(eq(schema.licenses.mt5AccountId, account.id))
    .for("update");

  // การชำระเงินต้องไม่ปลดการระงับเอง (createOrder/attach กันไว้ชั้นแรกแล้ว — ที่นี่คือด่านสุดท้าย)
  if (licenses.some((l) => l.status === "suspended")) {
    await auditBlocked(tx, order.id, order.userId, "license_suspended");
    return { status: "blocked", reason: "license_suspended" };
  }

  const [pkg] = await tx
    .select({ id: schema.packages.id, durationDays: schema.packages.durationDays })
    .from(schema.packages)
    .where(eq(schema.packages.id, order.packageId))
    .limit(1);
  if (!pkg) throw new Error("activateOrderIfReady: ไม่พบแพ็กเกจของคำสั่งซื้อ");

  const current = licenses.find((l) => l.status === "active") ?? null;
  const plan = planActivation({ durationDays: pkg.durationDays, current, today });
  if (!plan.ok) {
    await auditBlocked(tx, order.id, order.userId, plan.reason);
    return { status: "blocked", reason: plan.reason };
  }

  let licenseId: string;
  if (current) {
    // ต่ออายุ = แก้แถว active เดิม (1 บัญชีมีแถว active ได้แถวเดียว) — source ของแถวเดิมไม่เปลี่ยน
    await tx
      .update(schema.licenses)
      .set({
        expiresAt: plan.expiresAt,
        packageId: pkg.id,
        orderId: order.id,
        updatedAt: new Date(),
        ...(plan.startsAt !== null ? { startsAt: plan.startsAt } : {}),
      })
      .where(eq(schema.licenses.id, current.id));
    licenseId = current.id;
  } else {
    const [created] = await tx
      .insert(schema.licenses)
      .values({
        userId: order.userId,
        mt5AccountId: account.id,
        packageId: pkg.id,
        orderId: order.id,
        startsAt: plan.startsAt ?? today,
        expiresAt: plan.expiresAt,
        status: "active",
        source: "web",
      })
      .returning({ id: schema.licenses.id });
    licenseId = created.id;
  }

  await tx.insert(schema.licenseActivations).values({
    orderId: order.id,
    licenseId,
    mt5AccountId: account.id,
    packageId: pkg.id,
    durationDays: pkg.durationDays,
    previousExpiresAt: plan.previousExpiresAt,
    newExpiresAt: plan.expiresAt,
  });

  // audit เก็บเฉพาะ id และวันที่ — ไม่มีเลขบัญชี MT5 (actor = null: ระบบทำเอง ไม่ใช่แอดมิน)
  await tx.insert(schema.auditLogs).values({
    actorUserId: null,
    action: "license.activate",
    entity: "license",
    entityId: licenseId,
    data: {
      orderId: order.id,
      userId: order.userId,
      kind: plan.kind,
      previousExpiresAt: plan.previousExpiresAt,
      newExpiresAt: plan.expiresAt,
    },
  });

  return { status: "activated", licenseId, expiresAt: plan.expiresAt, kind: plan.kind };
}

/**
 * เปิด license ของคำสั่งซื้อถ้าพร้อม (ชำระแล้ว + มีบัญชี) — idempotent
 * throw เฉพาะเมื่อฐานข้อมูลมีปัญหา (fulfilOrder จับและบันทึก audit ให้)
 */
export async function activateOrderIfReady(orderId: string, opts: { today?: string } = {}): Promise<ActivateResult> {
  const today = opts.today ?? todayInBangkok(new Date());
  const db = getDb();
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction((tx) => activateInTx(tx, orderId, today, process.env));
    } catch (err) {
      // ชนกับ unique ของสมุดบันทึก: อีกคำขอเปิดคำสั่งซื้อนี้ไปแล้ว (transaction นี้ถูกยกเลิกทั้งก้อน ไม่มีอะไรค้าง)
      if (isUniqueViolation(err, ORDER_UNIQUE)) {
        const done = await findActivation(db, orderId);
        if (done) return { status: "already_activated", licenseId: done.licenseId, expiresAt: done.newExpiresAt };
      }
      // มีแถว active ของบัญชีนี้โผล่มาระหว่างทาง (ทางเขียนอื่นที่ไม่ได้ล็อกแถวบัญชี) → ลองใหม่ 1 ครั้งเพื่อต่ออายุแถวนั้นแทน
      if (isUniqueViolation(err, ACTIVE_UNIQUE) && attempt === 0) continue;
      throw err;
    }
  }
}

/**
 * เก็บตก: คำสั่งซื้อที่ชำระแล้วและมีบัญชีแต่ยังไม่มีแถวใน license_activations (เช่นเซิร์ฟเวอร์ดับหลังบันทึกชำระเงิน)
 * ใช้โดย `npm run license:publish` — ไม่เผยแพร่รายชื่อเอง ผู้เรียกเผยแพร่ต่อ
 */
export async function sweepPendingActivations(
  opts: { today?: string } = {},
): Promise<{ activated: number; blocked: number; failed: number }> {
  const rows = await getDb()
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .leftJoin(schema.licenseActivations, eq(schema.licenseActivations.orderId, schema.orders.id))
    .where(and(eq(schema.orders.status, "paid"), isNotNull(schema.orders.mt5AccountId), isNull(schema.licenseActivations.id)))
    // เรียงตามเวลาชำระ: ต่ออายุหลายรายการของบัญชีเดียวกันได้ผลเหมือนลำดับที่ลูกค้าจ่าย
    .orderBy(asc(schema.orders.paidAt), asc(schema.orders.createdAt));

  const result = { activated: 0, blocked: 0, failed: 0 };
  for (const row of rows) {
    try {
      const r = await activateOrderIfReady(row.id, opts);
      if (r.status === "activated") result.activated++;
      else if (r.status === "blocked") result.blocked++;
    } catch (err) {
      result.failed++;
      console.error("[license] sweep activation failed:", safeErrorSummary(err));
    }
  }
  return result;
}
