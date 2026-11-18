import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { Tx } from "@/lib/purchase/mt5-release";
import { isFreeReferralPackage } from "@/lib/purchase/packages";
import { assertMockPaymentAllowed, PAID_VIA_IDS, REFERRAL_PAYMENT_PROVIDER, type PaidVia } from "./config";

/**
 * แกนของ markOrderPaid ที่ทำงาน "ภายใน transaction ของผู้เรียก" — โค้ดเดียวในระบบที่เขียน orders.status = 'paid'
 *
 * ผู้เรียกมี 2 ราย:
 * - markOrderPaid (./mark-paid.ts): เปิด transaction เอง แล้วทำขั้นเปิด license ต่อหลัง commit — ทางของการชำระเงินทุกแบบ
 * - createOrder (src/lib/purchase/repo.ts) สำหรับแพ็กเกจฟรีจากการชวนเพื่อน: สร้างคำสั่งซื้อ + จองสิทธิ์ + บันทึก "ชำระแล้ว"
 *   ใน transaction เดียว (ไม่มีช่วงที่คำสั่งซื้อฟรีค้าง "รอชำระ") ผู้เรียกต้องเรียก fulfilOrder เองหลัง commit
 *
 * ด่านของแพ็กเกจฟรี (ตรวจที่นี่ ไม่ว่าใครเรียก):
 * - provider "referral" ใช้ได้กับคำสั่งซื้อแพ็กเกจฟรีที่ยอด 0 บาทและมีแถว referral_claims ของคำสั่งซื้อนั้นเท่านั้น
 *   (เรียกผิดกับแพ็กเกจที่ต้องจ่ายเงิน = ได้ของฟรี → ปฏิเสธ + audit order.payment_unexpected)
 * - คำสั่งซื้อแพ็กเกจฟรีรับการ "ชำระ" จาก provider อื่น (mock / gateway) ไม่ได้ — แพ็กเกจฟรีไม่ผ่านขั้นชำระเงิน
 */
export type MarkPaidTxResult =
  | { ok: true; orderId: string; alreadyPaid: boolean }
  | { ok: false; reason: "order_not_found" | "order_not_payable" };

const PAYABLE = ["pending_payment", "awaiting_review", "rejected"] as const;
const MAX_PROVIDER_REF_LENGTH = 200;

/** ตรวจพารามิเตอร์และค่าตั้งก่อนแตะฐานข้อมูล — throw เมื่อเรียกผิด (ไม่ใช่กรณีที่ผู้ใช้ทำให้เกิดได้) คืนเลขอ้างอิงที่ตัดช่องว่างแล้ว */
export function assertMarkPaidInput(provider: PaidVia, providerRef: string): string {
  if (!(PAID_VIA_IDS as readonly string[]).includes(provider)) {
    throw new Error("markOrderPaid: ไม่รู้จัก provider");
  }
  const ref = typeof providerRef === "string" ? providerRef.trim() : "";
  if (ref.length < 1 || ref.length > MAX_PROVIDER_REF_LENGTH) {
    throw new Error("markOrderPaid: providerRef ต้องยาว 1–200 ตัวอักษร");
  }
  // ด่านสุดท้ายของโหมดจำลอง: ค่าตั้งไม่อนุญาต → throw ก่อนแตะฐานข้อมูล
  if (provider === "mock") assertMockPaymentAllowed(process.env);
  return ref;
}

/**
 * unique violation ของ orders_payment_ref_idx (เลขอ้างอิงนี้ถูกใช้กับคำสั่งซื้ออื่นแล้ว) จะ throw ออกไป
 * และทำให้ transaction ของผู้เรียกถูกยกเลิก — ผู้เรียกแปลงเป็น payment_ref_conflict เอง
 */
export async function markOrderPaidInTx(
  tx: Tx,
  orderId: string,
  provider: PaidVia,
  providerRef: string,
): Promise<MarkPaidTxResult> {
  const ref = assertMarkPaidInput(provider, providerRef);

  const [order] = await tx
    .select({
      id: schema.orders.id,
      status: schema.orders.status,
      amountThb: schema.orders.amountThb,
      packageId: schema.orders.packageId,
      paymentProvider: schema.orders.paymentProvider,
      paymentRef: schema.orders.paymentRef,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .for("update");
  if (!order) return { ok: false, reason: "order_not_found" };

  const audit = (action: string, data: object) =>
    tx.insert(schema.auditLogs).values({ actorUserId: null, action, entity: "order", entityId: order.id, data });

  const [pkg] = await tx
    .select({ code: schema.packages.code })
    .from(schema.packages)
    .where(eq(schema.packages.id, order.packageId))
    .limit(1);
  const freePackage = pkg !== undefined && isFreeReferralPackage(pkg);
  const viaReferral = provider === REFERRAL_PAYMENT_PROVIDER;
  if (viaReferral) {
    const [claim] = await tx
      .select({ id: schema.referralClaims.id })
      .from(schema.referralClaims)
      .where(eq(schema.referralClaims.orderId, order.id))
      .limit(1);
    if (!freePackage || order.amountThb !== 0 || !claim) {
      await audit("order.payment_unexpected", { provider, providerRef: ref, status: order.status, reason: "not_a_free_claim" });
      return { ok: false, reason: "order_not_payable" };
    }
  } else if (freePackage) {
    await audit("order.payment_unexpected", { provider, providerRef: ref, status: order.status, reason: "free_package" });
    return { ok: false, reason: "order_not_payable" };
  }

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
      // สิทธิ์ฟรีไม่มีวิธีชำระ (payment_method คงเป็น null) — ผู้ให้บริการรับชำระทุกรายตอนนี้เป็นบัตร
      ...(viaReferral ? {} : { paymentMethod: "card" as const }),
      paymentProvider: provider,
      paymentRef: ref,
    })
    .where(and(eq(schema.orders.id, order.id), inArray(schema.orders.status, [...PAYABLE])))
    .returning({ id: schema.orders.id });
  if (!updated[0]) return { ok: false, reason: "order_not_payable" };

  await audit("order.paid", { provider, providerRef: ref, amountThb: order.amountThb });
  return { ok: true, orderId: order.id, alreadyPaid: false };
}
