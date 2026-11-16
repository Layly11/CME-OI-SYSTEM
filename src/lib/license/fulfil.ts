import "server-only";
import { getDb, schema } from "@/db";
import { safeErrorSummary } from "@/lib/db-errors";
import { activateOrderIfReady, type ActivateResult } from "./activation";
import { publishLicensesSerialized, type PublishOutcome } from "./publish-sync";

/**
 * ขั้น "ส่งมอบ" ของคำสั่งซื้อ: เปิด/ต่อ license ในฐานข้อมูล (commit ก่อน) แล้วเผยแพร่รายชื่อทั้งก้อนที่บอทอ่าน
 *
 * เรียกจาก 3 จุด — อย่างไหนเกิดทีหลังก็เปิด license ได้:
 * - markOrderPaid (ชำระเงิน — รวม webhook ของ gateway จริงในอนาคต และการส่งซ้ำของ webhook)
 * - ลูกค้ากรอกเลขบัญชี MT5 / เลือกบัญชีเดิมให้คำสั่งซื้อที่ชำระแล้ว
 * - ปุ่ม "ตรวจสอบสถานะอีกครั้ง" ในหน้าคำสั่งซื้อ
 *
 * ไม่ throw: การชำระเงิน/การผูกบัญชีที่บันทึกไปแล้วต้องไม่ล้มตามขั้นนี้
 * - เปิด license ไม่ได้ (ฐานข้อมูลมีปัญหา) → audit license.activate_failed, คำสั่งซื้อค้างที่ "กำลังเปิดใช้งาน"
 * - เปิดได้แต่เผยแพร่ไม่ได้ → license ยัง active ในฐานข้อมูล, audit license_file.publish_failed, ลูกค้าเห็น "กำลังเปิดใช้งาน"
 * ทั้งสองกรณีแก้ด้วยการเรียกซ้ำ (ทุกขั้น idempotent) หรือ `npm run license:publish`
 *
 * ห้ามเรียกภายใน db.transaction ของผู้เรียก — ต้องหลัง commit เท่านั้น (ดูเหตุผลใน publish-sync.ts)
 */
export type FulfilResult = { activation: ActivateResult | { status: "error" }; publish: PublishOutcome | null };

export async function fulfilOrder(
  orderId: string,
  opts: { trigger: "payment" | "account" | "retry" | "script"; today?: string },
): Promise<FulfilResult> {
  let activation: ActivateResult;
  try {
    activation = await activateOrderIfReady(orderId, { today: opts.today });
  } catch (err) {
    const error = safeErrorSummary(err);
    console.error("[license] เปิด license ไม่สำเร็จ:", error);
    try {
      await getDb().insert(schema.auditLogs).values({
        actorUserId: null,
        action: "license.activate_failed",
        entity: "order",
        entityId: orderId,
        data: { orderId, trigger: opts.trigger, error },
      });
    } catch (auditErr) {
      console.error("[license] บันทึก audit license.activate_failed ไม่ได้:", safeErrorSummary(auditErr));
    }
    return { activation: { status: "error" }, publish: null };
  }

  // เผยแพร่เฉพาะเมื่อคำสั่งซื้อนี้มี license แล้ว — already_activated ก็เผยแพร่ (ทางลองใหม่ของการเผยแพร่ที่เคยล้ม; ไม่มีอะไรเปลี่ยนก็ได้ unchanged)
  if (activation.status !== "activated" && activation.status !== "already_activated") {
    return { activation, publish: null };
  }
  let publish: PublishOutcome;
  try {
    publish = await publishLicensesSerialized({ trigger: opts.trigger, orderId });
  } catch (err) {
    // publishLicensesSerialized ไม่ throw อยู่แล้ว — กันไว้อีกชั้นเพื่อรักษาสัญญา "fulfilOrder ไม่ throw"
    console.error("[license] เผยแพร่รายชื่อไม่สำเร็จ:", safeErrorSummary(err));
    publish = { status: "failed", error: safeErrorSummary(err) };
  }
  return { activation, publish };
}
