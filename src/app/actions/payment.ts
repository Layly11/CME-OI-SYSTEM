"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/dal";
import { safeErrorSummary } from "@/lib/db-errors";
import type { FormState } from "@/lib/form-state";
import { getPaymentBlock } from "@/lib/license/activation-block";
import { resolvePaymentConfig } from "@/lib/payment/config";
import { markOrderPaid } from "@/lib/payment/mark-paid";
import { getPaymentProvider, mockPaymentRef } from "@/lib/payment/provider";
import { purchaseMessages, purchaseSystemError } from "@/lib/purchase/messages";
import { canPayByCard } from "@/lib/purchase/order-rules";
import { getOrder } from "@/lib/purchase/repo";

/**
 * Server Actions ของการชำระเงินด้วยบัตร
 * - ทุก action ตรวจ session และความเป็นเจ้าของคำสั่งซื้อเองทุกครั้ง
 * - ไม่มี action ใดอ่านข้อมูลบัตรหรือยอดเงินจากฟอร์ม: ยอดมาจากแถวคำสั่งซื้อ ข้อมูลบัตรกรอกที่ผู้ให้บริการเท่านั้น
 */

type PaymentActionState = FormState<never>;

const uuid = z.uuid();

/** ผู้ใช้จาก session — ไม่ได้ล็อกอินจะถูกพาไปหน้าเข้าสู่ระบบ, ฐานข้อมูลมีปัญหาคืน null (ผู้เรียกตอบ systemError) */
async function sessionUser(): Promise<SessionUser | null> {
  let user: SessionUser | null;
  try {
    user = await getSessionUser();
  } catch (err) {
    unstable_rethrow(err);
    console.error("[payment] session lookup failed:", safeErrorSummary(err));
    return null;
  }
  if (!user) redirect("/login");
  return user;
}

/** เริ่มชำระเงิน: พาลูกค้าไปหน้าชำระของผู้ให้บริการ (โหมดทดสอบ = หน้าจำลองในเว็บ) — ไม่อ่าน state เดิมและข้อมูลฟอร์ม */
export async function startCheckoutAction(orderId: string): Promise<PaymentActionState> {
  const user = await sessionUser();
  if (!user) return { ok: false, formError: purchaseSystemError };

  if (!uuid.safeParse(orderId).success) return { ok: false, formError: purchaseMessages.order_not_found };

  let redirectUrl: string;
  try {
    const order = await getOrder(user.id, orderId);
    if (!order) return { ok: false, formError: purchaseMessages.order_not_found };
    const orderPath = `/account/orders/${order.id}`;
    if (!canPayByCard(order.status)) {
      // แท็บค้าง/กดย้อนกลับ: คำสั่งซื้อชำระไปแล้ว (หรือถูกยกเลิก/รอตรวจสลิป) จากอีกแท็บ
      // คืนแค่ข้อความ หน้าจะไม่ถูก render ใหม่และยังโชว์ "รอชำระ" + ปุ่มชำระค้างอยู่ → redirect ให้หน้าคำสั่งซื้อแสดงสถานะจริง
      redirectUrl = orderPath;
    } else if ((await getPaymentBlock(order)) !== null) {
      // บัญชี MT5 ของคำสั่งซื้อนี้กลายเป็นตลอดชีพ/ถูกระงับหลังสร้างคำสั่งซื้อ → ไม่รับเงิน หน้าคำสั่งซื้อบอกเหตุผลแทนปุ่มชำระ
      redirectUrl = orderPath;
    } else {
      const provider = getPaymentProvider(process.env);
      if (!provider) return { ok: false, formError: purchaseMessages.payment_unavailable };

      ({ redirectUrl } = await provider.createCheckout(
        { id: order.id, orderNo: order.orderNo, amountThb: order.amountThb, packageName: order.packageName },
        { returnPath: orderPath },
      ));
    }
  } catch (err) {
    console.error("[payment] start checkout failed:", safeErrorSummary(err));
    return { ok: false, formError: purchaseSystemError };
  }
  redirect(redirectUrl);
}

/**
 * ยืนยันการชำระเงินจำลอง (โหมดทดสอบ) — ทำงานเฉพาะเมื่อค่าตั้งอนุญาต mock (ดู src/lib/payment/config.ts)
 * ไม่อ่านข้อมูลฟอร์มเลย: ไม่มีข้อมูลบัตร ไม่มียอดเงินจาก client
 */
export async function confirmMockPaymentAction(orderId: string): Promise<PaymentActionState> {
  const user = await sessionUser();
  if (!user) return { ok: false, formError: purchaseSystemError };

  if (!uuid.safeParse(orderId).success) return { ok: false, formError: purchaseMessages.order_not_found };

  const config = resolvePaymentConfig(process.env);
  if (!config.ok || config.provider !== "mock") return { ok: false, formError: purchaseMessages.payment_unavailable };

  const orderPath = `/account/orders/${orderId}`;
  try {
    const order = await getOrder(user.id, orderId);
    if (!order) return { ok: false, formError: purchaseMessages.order_not_found };
    if (order.status !== "paid") {
      if (!canPayByCard(order.status)) return { ok: false, formError: purchaseMessages.order_not_payable };
      // ตรวจบัญชี MT5 ซ้ำก่อน "รับเงิน" (เหตุผลเดียวกับ startCheckoutAction — หน้าจำลองอาจถูกเปิดค้างไว้)
      const block = await getPaymentBlock(order);
      if (block !== null) return { ok: false, formError: purchaseMessages[block] };

      // markOrderPaid ตรวจค่าตั้ง mock ซ้ำอีกชั้น และทำขั้นเปิด license ต่อเองหลังบันทึก (คำสั่งซื้อที่มีบัญชี MT5 อยู่แล้ว = ต่ออายุ)
      // ผลของขั้นนั้น (result.fulfilment) ไม่กระทบคำตอบ: ชำระแล้วคือชำระแล้ว หน้าคำสั่งซื้อแสดงสถานะการเปิดใช้งานตามจริง
      const result = await markOrderPaid(orderId, "mock", mockPaymentRef(orderId));
      if (!result.ok) {
        if (result.reason === "payment_ref_conflict") return { ok: false, formError: purchaseSystemError };
        return { ok: false, formError: purchaseMessages[result.reason] };
      }
    }
  } catch (err) {
    console.error("[payment] confirm mock payment failed:", safeErrorSummary(err));
    return { ok: false, formError: purchaseSystemError };
  }
  redirect(orderPath);
}
