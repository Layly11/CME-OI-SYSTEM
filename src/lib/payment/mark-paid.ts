import "server-only";
import { getDb } from "@/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { fulfilOrder, type FulfilResult } from "@/lib/license/fulfil";
import type { PaidVia } from "./config";
import { assertMarkPaidInput, markOrderPaidInTx, type MarkPaidTxResult } from "./mark-paid-tx";

/**
 * จุดเดียวที่เปลี่ยนคำสั่งซื้อเป็น "ชำระแล้ว" — การชำระจำลองเรียกวันนี้ และ webhook ของ gateway จริงจะเรียกตัวเดียวกัน
 * (ตัวเขียนจริงคือ markOrderPaidInTx ใน ./mark-paid-tx.ts — แพ็กเกจฟรีจากการชวนเพื่อนเรียกตัวนั้นใน transaction ที่สร้างคำสั่งซื้อ
 * ด้วย provider "referral" ดู createOrder ใน src/lib/purchase/repo.ts)
 *
 * - ไม่มีพารามิเตอร์ยอดเงินโดยตั้งใจ: ยอดคือ orders.amount_thb เท่านั้น
 * - idempotent: เรียกซ้ำด้วย (provider, providerRef) เดิม ไม่เขียนอะไรเพิ่ม (webhook ส่งซ้ำ / ลูกค้ากดซ้ำ / สองคำขอพร้อมกัน)
 * - หลังบันทึก (commit แล้ว) เรียกขั้นเปิด license ต่อทันที: คำสั่งซื้อที่มีบัญชี MT5 อยู่แล้ว (ต่ออายุ) ได้ license ตรงนี้
 *   เรียกซ้ำกับคำสั่งซื้อที่ชำระแล้วก็เรียกขั้นนี้ซ้ำ = การส่งซ้ำของ webhook เป็นทางลองเผยแพร่รายชื่อใหม่ไปในตัว
 *   ขั้นนั้นล้มไม่ทำให้การชำระเงินที่บันทึกแล้วล้ม (fulfilOrder ไม่ throw ผลอยู่ใน field fulfilment)
 * - ไม่ตรวจว่าใครเป็นเจ้าของคำสั่งซื้อ — ผู้เรียกต้องตรวจเอง (Server Action ตรวจ session + ความเป็นเจ้าของ, webhook ตรวจลายเซ็น)
 *
 * สำหรับ gateway จริง (ยังไม่ได้ทำ):
 * - webhook ต้องตรวจลายเซ็น และตรวจว่ายอด/สกุลเงินที่ตัดจริงตรงกับ orders.amount_thb ก่อนเรียกฟังก์ชันนี้
 * - ลูกค้ายกเลิกคำสั่งซื้อระหว่างอยู่หน้าชำระของ gateway แล้วเงินถูกตัด → ที่นี่คืน order_not_payable
 *   และบันทึก audit order.payment_unexpected ต้องมีขั้นตอนคืนเงิน/ติดตามเอง
 */

export type MarkPaidResult =
  | {
      ok: true;
      orderId: string;
      alreadyPaid: boolean;
      /** ผลของขั้นเปิด license + เผยแพร่รายชื่อที่ทำต่อจากการบันทึกชำระเงิน (ไม่มีบัญชี MT5 = not_ready/no_account) */
      fulfilment?: FulfilResult;
    }
  | { ok: false; reason: "order_not_found" | "order_not_payable" | "payment_ref_conflict" };

export async function markOrderPaid(orderId: string, provider: PaidVia, providerRef: string): Promise<MarkPaidResult> {
  // ตรวจพารามิเตอร์/ค่าตั้ง mock ก่อนเปิด transaction — เรียกผิดต้อง throw โดยไม่แตะฐานข้อมูล
  assertMarkPaidInput(provider, providerRef);

  let result: MarkPaidTxResult;
  try {
    result = await getDb().transaction((tx) => markOrderPaidInTx(tx, orderId, provider, providerRef));
  } catch (err) {
    // เลขอ้างอิงรายการนี้ถูกใช้กับคำสั่งซื้ออื่นไปแล้ว (transaction ถูกยกเลิก คำสั่งซื้อนี้ไม่เปลี่ยน)
    if (isUniqueViolation(err, "orders_payment_ref_idx")) return { ok: false, reason: "payment_ref_conflict" };
    throw err;
  }

  if (!result.ok) return result;
  // transaction ด้านบน commit แล้ว — ห้ามย้ายบรรทัดนี้เข้าไปใน db.transaction:
  // การเปิด license ที่ล้มต้องไม่ย้อนการบันทึกว่าชำระแล้ว และการเผยแพร่ใช้ connection อื่นของ pool (กัน pool ค้าง)
  const fulfilment = await fulfilOrder(result.orderId, { trigger: "payment" });
  return { ...result, fulfilment };
}
