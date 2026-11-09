import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { buildLicenseFile, dateToIso, type LicenseEntry } from "./license-file";
import { getLicenseStorage } from "./license-storage";

/**
 * รวบรวม license ที่ยังใช้ได้ทั้งหมดจากฐานข้อมูลเป็นรายการสำหรับสร้างไฟล์
 * เงื่อนไข: status = active และ expires_at >= วันนี้
 */
export async function collectActiveEntries(today = dateToIso(new Date())): Promise<LicenseEntry[]> {
  const db = getDb();
  const rows = await db
    .select({
      accountNumber: schema.mt5Accounts.accountNumber,
      expiresAt: schema.licenses.expiresAt,
    })
    .from(schema.licenses)
    .innerJoin(schema.mt5Accounts, eq(schema.licenses.mt5AccountId, schema.mt5Accounts.id))
    .where(and(eq(schema.licenses.status, "active"), gte(schema.licenses.expiresAt, today)));

  return rows.map((r) => ({ accountNumber: r.accountNumber, expiresAt: r.expiresAt }));
}

export function checksumOf(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * สร้างไฟล์ license จากฐานข้อมูล อัปโหลดไปยัง storage ที่ indicator อ่าน
 * และเก็บสำเนาไว้ในตาราง license_file_publications
 *
 * ลำดับสำคัญ: เขียน storage สำเร็จก่อน แล้วค่อยบันทึกประวัติ
 * ถ้าเนื้อหาเหมือนครั้งล่าสุดทุกตัวอักษรจะไม่เผยแพร่ซ้ำ (คืน skipped: true)
 */
export async function publishLicenseFile(opts: { publishedBy?: string | null; force?: boolean } = {}) {
  const db = getDb();
  const entries = await collectActiveEntries();
  const content = buildLicenseFile(entries);
  const checksum = checksumOf(content);

  const [last] = await db
    .select()
    .from(schema.licenseFilePublications)
    .orderBy(desc(schema.licenseFilePublications.publishedAt))
    .limit(1);

  if (!opts.force && last && last.checksum === checksum) {
    return { skipped: true as const, checksum, entryCount: entries.length, storageUrl: last.storageUrl };
  }

  const storage = getLicenseStorage();
  const storageUrl = await storage.put(content);

  const [row] = await db
    .insert(schema.licenseFilePublications)
    .values({
      content,
      entryCount: entries.length,
      checksum,
      storageUrl,
      publishedBy: opts.publishedBy ?? null,
    })
    .returning();

  await db.insert(schema.auditLogs).values({
    actorUserId: opts.publishedBy ?? null,
    action: "license_file.publish",
    entity: "license_file_publication",
    entityId: row.id,
    data: { entryCount: entries.length, checksum, storageUrl },
  });

  return { skipped: false as const, checksum, entryCount: entries.length, storageUrl, publicationId: row.id };
}

/** ย้อนกลับไปใช้ไฟล์เวอร์ชันก่อนหน้า (กรณีไฟล์ใหม่ทำให้บอทลูกค้ามีปัญหา) */
export async function rollbackLicenseFile(publicationId: string, actorUserId?: string | null) {
  const db = getDb();
  const [pub] = await db
    .select()
    .from(schema.licenseFilePublications)
    .where(eq(schema.licenseFilePublications.id, publicationId))
    .limit(1);
  if (!pub) throw new Error("ไม่พบประวัติการเผยแพร่ที่ระบุ");

  const storage = getLicenseStorage();
  const storageUrl = await storage.put(pub.content);

  const [row] = await db
    .insert(schema.licenseFilePublications)
    .values({
      content: pub.content,
      entryCount: pub.entryCount,
      checksum: pub.checksum,
      storageUrl,
      publishedBy: actorUserId ?? null,
    })
    .returning();

  await db.insert(schema.auditLogs).values({
    actorUserId: actorUserId ?? null,
    action: "license_file.rollback",
    entity: "license_file_publication",
    entityId: row.id,
    data: { rolledBackTo: publicationId },
  });

  return row;
}
