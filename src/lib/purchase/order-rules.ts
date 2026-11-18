import { z } from "zod";
import { purchaseMessages } from "./messages";

export type OrderStatus = "pending_payment" | "awaiting_review" | "paid" | "rejected" | "cancelled" | "refunded";

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "pending_payment",
  "awaiting_review",
  "paid",
  "rejected",
  "cancelled",
  "refunded",
];

/** สถานะที่ถือว่า "ยังค้างอยู่" — ตรงกับ partial unique index orders_open_per_account_idx */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ["pending_payment", "awaiting_review"];

export const MAX_MT5_ACCOUNTS_PER_USER = 10;
export const MAX_OPEN_ORDERS_PER_USER = 5;

/** สั่งซื้อออนไลน์ได้หรือไม่ — กติกาอยู่ใน ./packages (แพ็กเกจทั่วไปต้องมีราคามากกว่า 0, แพ็กเกจฟรีจากการชวนเพื่อนต้องราคา 0) */
export { canOrderOnline } from "./packages";

/** แนบสลิปได้ตอนรอชำระ หรือถูกปฏิเสธ (แนบใหม่) — ใช้เฉพาะเมื่อเปิดช่องทางโอนเงิน (PAYMENT_BANK_TRANSFER_ENABLED) */
export function canUploadSlip(status: OrderStatus): boolean {
  return status === "pending_payment" || status === "rejected";
}

/**
 * ชำระด้วยบัตรได้ตอนรอชำระ หรือรายการเดิมที่สลิปไม่ผ่าน
 * (รอตรวจสลิปไม่มีปุ่มบัตร — อาจมีเงินโอนมาแล้ว กันจ่ายซ้ำ)
 */
export function canPayByCard(status: OrderStatus): boolean {
  return status === "pending_payment" || status === "rejected";
}

/** เลือก/เปลี่ยนโบรกเกอร์พาร์ตเนอร์ได้หลังชำระเงิน ตราบที่ยังไม่ได้ระบุบัญชี MT5 */
export function canChooseBroker(o: { status: OrderStatus; mt5AccountId: string | null }): boolean {
  return o.status === "paid" && o.mt5AccountId === null;
}

/** กรอกเลขบัญชี MT5 ใหม่ให้คำสั่งซื้อได้เมื่อชำระแล้ว เลือกโบรกเกอร์แล้ว และยังไม่มีบัญชี */
export function canSubmitAccount(o: {
  status: OrderStatus;
  mt5AccountId: string | null;
  partnerBrokerCode: string | null;
}): boolean {
  return o.status === "paid" && o.mt5AccountId === null && o.partnerBrokerCode !== null;
}

/**
 * ผูกบัญชี MT5 ที่มีอยู่แล้ว (ต่ออายุ) ได้ถ้ายังไม่มีบัญชี และคำสั่งซื้อยังไม่ถูกยกเลิก/คืนเงิน
 * หน้าเว็บเสนอเฉพาะหลังชำระเงิน แต่ฝั่งเซิร์ฟเวอร์ยังรับการผูกก่อนชำระ (license เปิดเมื่อครบทั้งสองอย่าง)
 */
export function canAttachAccount(order: { mt5AccountId: string | null; status: OrderStatus }): boolean {
  return (
    order.mt5AccountId === null &&
    (order.status === "pending_payment" ||
      order.status === "awaiting_review" ||
      order.status === "rejected" ||
      order.status === "paid")
  );
}

/**
 * คำสั่งซื้อแพ็กเกจฟรีจากการชวนเพื่อนที่ "รับสิทธิ์แล้วแต่ยังไม่ได้เปิด license" — ไม่มีเงินเกี่ยวข้อง ลูกค้ายกเลิกเองได้
 * (ยกเลิก = คืนสิทธิ์ให้รับใหม่ได้) เปิด license แล้วยกเลิกไม่ได้: สิทธิ์ถูกใช้ไปแล้ว
 * ค่า "referral" ตรงกับ REFERRAL_PAYMENT_PROVIDER ใน src/lib/payment/config.ts
 */
export function isUnactivatedFreeClaim(o: {
  status: OrderStatus;
  paymentProvider: string | null;
  activatedLicense: unknown | null;
}): boolean {
  return o.status === "paid" && o.paymentProvider === "referral" && o.activatedLicense === null;
}
/**
 * ลูกค้ายกเลิกเองได้ตอนยังรอชำระ — ชำระแล้ว (หรือแนบสลิปแล้ว) มีเงินเกี่ยวข้อง ต้องผ่านทีมงาน
 * ข้อยกเว้นเดียว: แพ็กเกจฟรีที่ยังไม่ได้เปิด license (isUnactivatedFreeClaim)
 */
export function canCancelOrder(o: {
  status: OrderStatus;
  paymentProvider: string | null;
  activatedLicense: unknown | null;
}): boolean {
  return o.status === "pending_payment" || isUnactivatedFreeClaim(o);
}

/**
 * คำสั่งซื้อสถานะเหล่านี้ทำให้ "ลบ/ปล่อยเลขบัญชี MT5" ไม่ได้ — มีเงินเกี่ยวข้องหรือกำลังตรวจอยู่
 * สถานะอื่น (รอชำระ ไม่ผ่าน ยกเลิก) แค่ถูกถอดบัญชีออกจากคำสั่งซื้อ
 */
export const ACCOUNT_LOCKING_ORDER_STATUSES: readonly OrderStatus[] = ["awaiting_review", "paid", "refunded"];

export const PAYMENT_METHODS = ["bank_transfer", "promptpay"] as const;
export type SlipPaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isSlipPaymentMethod(v: unknown): v is SlipPaymentMethod {
  return typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);
}

export const createOrderSchema = z.object({
  packageId: z.uuid({ error: purchaseMessages.package_required }),
  mt5AccountId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v ?? undefined),
    z.uuid({ error: purchaseMessages.account_not_found }).optional(),
  ),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
