import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";

/**
 * ล้างผลของ "การชำระเงินจำลอง" (orders.payment_provider = 'mock') ออกจากฐานข้อมูล ก่อนชี้ระบบไปรายชื่อ license จริง
 * ใช้เมื่อจำเป็นต้องใช้ฐานข้อมูลเดิมต่อ — ทางที่ง่ายและปลอดภัยกว่าคือเริ่มระบบจริงด้วยฐานข้อมูลใหม่
 *
 * ทำอะไร (ใน transaction เดียว; ไม่มีการลบคำสั่งซื้อ/บัญชี/license — แถวที่ลบมีแต่สมุดบันทึก license_activations ของคำสั่งซื้อจำลอง
 * ซึ่งเนื้อหาถูกคัดลอกลง audit_logs ก่อน):
 * - license ที่ถูก "สร้าง" โดยคำสั่งซื้อจำลอง → สถานะ expired (หลุดจากรายชื่อในการเผยแพร่ครั้งถัดไป)
 * - license ที่มีอยู่ก่อนแล้วถูกคำสั่งซื้อจำลอง "ต่ออายุ" (เช่นรายชื่อเดิมที่ import มา) → คืนวันหมดอายุเป็นค่าก่อนการต่ออายุจำลองครั้งแรก
 *   (คืนได้เฉพาะวันหมดอายุ — แพ็กเกจ/วันเริ่มของแถวไม่ได้ถูกเก็บไว้ตอนต่ออายุ)
 * - คำสั่งซื้อจำลองที่สถานะ paid → cancelled (รวมรายการที่ยังไม่ได้ระบุบัญชี MT5 — เอาไปแลก license ภายหลังไม่ได้อีก)
 * - audit: order.mock_purged / license.mock_purged
 * ข้าม (ไม่แตะ และรายงานให้จัดการเอง): license ที่มีการต่ออายุจากการชำระ "จริง" เกิดขึ้นหลังการต่ออายุจำลอง — คำนวณย้อนเองไม่ได้
 *   แพ็กเกจฟรีจากการชวนเพื่อน (provider "referral") นับเป็นรายการจริง: license ที่สร้างด้วยการชำระจำลองแล้วมีคนรับแพ็กเกจฟรีต่ออายุทีหลัง
 *   จึงถูกข้าม คำสั่งซื้อจำลองของมันยังเป็น paid และด่านเผยแพร่ไปรายชื่อจริง (countActiveMockPaidLicenses) จะยังปฏิเสธต่อไป
 *   — ตั้งใจให้ล้มไปทางปลอดภัย: ฐานข้อมูลแบบนั้นขึ้นระบบจริงด้วยสคริปต์นี้อย่างเดียวไม่ได้ ให้เริ่มด้วยฐานข้อมูลใหม่ (README "ก่อนเปิดระบบจริง" ข้อ 2)
 *
 * หลังรันแบบ apply ต้องเผยแพร่รายชื่อใหม่ (`npm run license:publish`) — ฟังก์ชันนี้ไม่เขียนรายชื่อเอง
 * บัญชี MT5 ที่สร้างระหว่างทดสอบยังอยู่ (เลขยังถูกจองโดยผู้ใช้ทดสอบ) — ปล่อยเลขด้วย `npm run admin:release-mt5` ไม่ได้ถ้ายังมีแถว license
 */
export type MockPurgeReport = {
  applied: boolean;
  /** คำสั่งซื้อจำลองที่เปลี่ยนจาก paid เป็น cancelled */
  ordersCancelled: number;
  /** แถวสมุดบันทึกการเปิด license ของคำสั่งซื้อจำลองที่ถูกลบ */
  activationsRemoved: number;
  licensesExpired: number;
  licensesRestored: number;
  /** license ที่ต้องจัดการเอง — คำสั่งซื้อจำลองของ license เหล่านี้ไม่ถูกแตะ และการเผยแพร่ไปรายชื่อจริงจะยังถูกปฏิเสธ */
  skippedLicenseIds: string[];
};

class DryRunRollback extends Error {}

const SOURCE = "scripts/purge-mock-data.ts";

export async function purgeMockData(opts: { apply: boolean }): Promise<MockPurgeReport> {
  const report: MockPurgeReport = {
    applied: opts.apply,
    ordersCancelled: 0,
    activationsRemoved: 0,
    licensesExpired: 0,
    licensesRestored: 0,
    skippedLicenseIds: [],
  };

  try {
    await getDb().transaction(async (tx) => {
      // ลำดับล็อกเดียวกับขั้นเปิด license: คำสั่งซื้อ → license
      const mockOrders = await tx
        .select({ id: schema.orders.id, status: schema.orders.status })
        .from(schema.orders)
        .where(eq(schema.orders.paymentProvider, "mock"))
        .for("update");
      if (mockOrders.length === 0) return;
      const mockOrderIds = new Set(mockOrders.map((o) => o.id));

      const mockActivations = await tx
        .select({ licenseId: schema.licenseActivations.licenseId })
        .from(schema.licenseActivations)
        .where(inArray(schema.licenseActivations.orderId, [...mockOrderIds]));
      const licenseIds = [...new Set(mockActivations.map((a) => a.licenseId))];

      /** คำสั่งซื้อจำลองที่ห้ามแตะ เพราะ license ของมันต้องจัดการเอง */
      const keepOrderIds = new Set<string>();

      for (const licenseId of licenseIds) {
        const [license] = await tx
          .select({ id: schema.licenses.id, status: schema.licenses.status, expiresAt: schema.licenses.expiresAt, orderId: schema.licenses.orderId })
          .from(schema.licenses)
          .where(eq(schema.licenses.id, licenseId))
          .for("update");
        if (!license) continue;

        // ประวัติการเปิด/ต่ออายุทั้งหมดของ license นี้ ตามลำดับเวลา
        const chain = await tx
          .select({
            id: schema.licenseActivations.id,
            orderId: schema.licenseActivations.orderId,
            durationDays: schema.licenseActivations.durationDays,
            previousExpiresAt: schema.licenseActivations.previousExpiresAt,
            newExpiresAt: schema.licenseActivations.newExpiresAt,
          })
          .from(schema.licenseActivations)
          .where(eq(schema.licenseActivations.licenseId, licenseId))
          .orderBy(asc(schema.licenseActivations.createdAt), asc(schema.licenseActivations.id));
        const firstMock = chain.findIndex((a) => mockOrderIds.has(a.orderId));
        const tail = chain.slice(firstMock);
        // มีการต่ออายุจากการชำระจริงหลังการต่ออายุจำลอง → วันหมดอายุปัจจุบันปนกัน คำนวณย้อนเองไม่ได้
        if (tail.some((a) => !mockOrderIds.has(a.orderId))) {
          report.skippedLicenseIds.push(licenseId);
          for (const a of tail) if (mockOrderIds.has(a.orderId)) keepOrderIds.add(a.orderId);
          continue;
        }

        const first = tail[0];
        const createdByMock = first.previousExpiresAt === null;
        if (createdByMock) {
          if (license.status === "active" || license.status === "pending") {
            await tx
              .update(schema.licenses)
              .set({ status: "expired", updatedAt: new Date() })
              .where(eq(schema.licenses.id, licenseId));
          }
          report.licensesExpired++;
        } else {
          await tx
            .update(schema.licenses)
            .set({
              expiresAt: first.previousExpiresAt!,
              updatedAt: new Date(),
              // แถวชี้คำสั่งซื้อจำลองเป็น "คำสั่งซื้อล่าสุด" → ถอดออก (คำสั่งซื้อเดิมก่อนหน้านั้นไม่ได้ถูกเก็บไว้)
              ...(license.orderId !== null && mockOrderIds.has(license.orderId) ? { orderId: null } : {}),
            })
            .where(eq(schema.licenses.id, licenseId));
          report.licensesRestored++;
        }
        // audit เก็บสำเนาแถวสมุดบันทึกที่จะลบ (id และวันที่เท่านั้น — ไม่มีเลขบัญชี MT5)
        await tx.insert(schema.auditLogs).values({
          actorUserId: null,
          action: "license.mock_purged",
          entity: "license",
          entityId: licenseId,
          data: {
            by: SOURCE,
            result: createdByMock ? "expired" : "expiry_restored",
            previousStatus: license.status,
            expiresAtBefore: license.expiresAt,
            expiresAtAfter: createdByMock ? license.expiresAt : first.previousExpiresAt,
            removedActivations: tail.map((a) => ({
              orderId: a.orderId,
              durationDays: a.durationDays,
              previousExpiresAt: a.previousExpiresAt,
              newExpiresAt: a.newExpiresAt,
            })),
          },
        });
      }

      const purgeOrderIds = mockOrders.filter((o) => !keepOrderIds.has(o.id)).map((o) => o.id);
      if (purgeOrderIds.length > 0) {
        const removed = await tx
          .delete(schema.licenseActivations)
          .where(inArray(schema.licenseActivations.orderId, purgeOrderIds))
          .returning({ id: schema.licenseActivations.id });
        report.activationsRemoved = removed.length;

        const cancelled = await tx
          .update(schema.orders)
          .set({ status: "cancelled" })
          .where(and(inArray(schema.orders.id, purgeOrderIds), eq(schema.orders.status, "paid")))
          .returning({ id: schema.orders.id });
        report.ordersCancelled = cancelled.length;
        if (cancelled.length > 0) {
          await tx.insert(schema.auditLogs).values(
            cancelled.map((o) => ({
              actorUserId: null,
              action: "order.mock_purged",
              entity: "order",
              entityId: o.id,
              data: { by: SOURCE, previousStatus: "paid", status: "cancelled" },
            })),
          );
        }
      }

      if (!opts.apply) throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }
  return report;
}
