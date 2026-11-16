import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { fulfilOrder, type FulfilResult } from "@/lib/license/fulfil";
import { assertMockPaymentAllowed, PAYMENT_PROVIDER_IDS, type PaymentProviderId } from "./config";

/**
 * จุดเดียวที่เปลี่ยนคำสั่งซื้อเป็น "ชำระแล้ว" — การชำระจำลองเรียกวันนี้ และ webhook ของ gateway จริงจะเรียกตัวเดียวกัน
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

const PAYABLE = ["pending_payment", "awaiting_review", "rejected"] as const;
const MAX_PROVIDER_REF_LENGTH = 200;

export async function markOrderPaid(
  orderId: string,
  provider: PaymentProviderId,
  providerRef: string,
): Promise<MarkPaidResult> {
  if (!(PAYMENT_PROVIDER_IDS as readonly string[]).includes(provider)) {
    throw new Error("markOrderPaid: ไม่รู้จัก provider");
  }
  const ref = typeof providerRef === "string" ? providerRef.trim() : "";
  if (ref.length < 1 || ref.length > MAX_PROVIDER_REF_LENGTH) {
    throw new Error("markOrderPaid: providerRef ต้องยาว 1–200 ตัวอักษร");
  }
  // ด่านสุดท้ายของโหมดจำลอง: ค่าตั้งไม่อนุญาต → throw ก่อนแตะฐานข้อมูล
  if (provider === "mock") assertMockPaymentAllowed(process.env);

  const db = getDb();
  type TxResult = { ok: true; orderId: string; alreadyPaid: boolean } | Extract<MarkPaidResult, { ok: false }>;
  let result: TxResult;
  try {
    result = await db.transaction(async (tx): Promise<TxResult> => {
      const [order] = await tx
        .select({
          id: schema.orders.id,
          status: schema.orders.status,
          amountThb: schema.orders.amountThb,
          paymentProvider: schema.orders.paymentProvider,
          paymentRef: schema.orders.paymentRef,
        })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .for("update");
      if (!order) return { ok: false, reason: "order_not_found" };

      const audit = (action: string, data: object) =>
        tx.insert(schema.auditLogs).values({ actorUserId: null, action, entity: "order", entityId: order.id, data });

      if (order.status === "paid") {
        // ชำระแล้ว: รายการเดิมซ้ำ → ไม่เขียนอะไร, รายการอื่น → เก็บไว้ให้ตรวจ (อาจถูกตัดเงินสองครั้ง) แต่ไม่แก้คำสั่งซื้อ
        if (order.paymentProvider !== provider || order.paymentRef !== ref) {
          await audit("order.payment_duplicate", { provider, providerRef: ref });
        }
        return { ok: true, orderId: order.id, alreadyPaid: true };
      }
      if (order.status === "cancelled" || order.status === "refunded") {
        await audit("order.payment_unexpected", { provider, providerRef: ref, status: order.status });
        return { ok: false, reason: "order_not_payable" };
      }

      const updated = await tx
        .update(schema.orders)
        .set({
          status: "paid",
          paidAt: sql`now()`,
          paymentMethod: "card",
          paymentProvider: provider,
          paymentRef: ref,
        })
        .where(and(eq(schema.orders.id, order.id), inArray(schema.orders.status, [...PAYABLE])))
        .returning({ id: schema.orders.id });
      if (!updated[0]) return { ok: false, reason: "order_not_payable" };

      await audit("order.paid", { provider, providerRef: ref, amountThb: order.amountThb });
      return { ok: true, orderId: order.id, alreadyPaid: false };
    });
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
