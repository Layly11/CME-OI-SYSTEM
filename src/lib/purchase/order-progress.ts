import type { OrderStatus } from "./order-rules";

/**
 * ขั้นที่ลูกค้าอยู่ของคำสั่งซื้อ — คำนวณจากข้อมูล ไม่ได้เก็บในฐานข้อมูล (orders.status หยุดที่ paid)
 *
 *   pay → choose_broker → submit_account → activating → active
 *                                          └→ blocked (ชำระแล้ว มีบัญชีแล้ว แต่ระบบเปิด license เองไม่ได้ — ต้องให้ทีมงานช่วย)
 *
 * ลำดับบนหน้าเว็บคือ ชำระ → เลือกโบรกเกอร์ → กรอกเลข MT5 แต่การต่ออายุ (คำสั่งซื้อมีบัญชีมาตั้งแต่แรก)
 * ข้ามจาก pay ไป activating เลย — license เปิดเมื่อ "ชำระแล้ว" และ "มีบัญชี" ครบทั้งคู่ ไม่ว่าอย่างไหนเกิดทีหลัง
 */
export type OrderStep =
  | "pay"
  | "legacy_review"
  | "choose_broker"
  | "submit_account"
  | "activating"
  | "blocked"
  | "active"
  | "closed";

/**
 * @param activation null = ยังไม่มีแถว license_activations ของคำสั่งซื้อนี้;
 *   published = รายการ id<เลขบัญชี>.<วันหมดอายุ> อยู่ในรายชื่อ license ที่เผยแพร่ล่าสุดแล้ว
 * @param blocked คำสั่งซื้อนี้ถูกกันไม่ให้เปิด license (getActivationBlock ใน src/lib/license/activation-block.ts คืนเหตุผล)
 *   มีผลเฉพาะเมื่อชำระแล้ว มีบัญชีแล้ว และยังไม่มีแถว activation — "กำลังเปิดใช้งาน" จะเป็นคำสัญญาที่ไม่จริงสำหรับรายการแบบนี้
 */
export function orderStep(
  o: { status: OrderStatus; mt5AccountId: string | null; partnerBrokerCode: string | null },
  activation: { published: boolean } | null,
  blocked = false,
): OrderStep {
  switch (o.status) {
    case "pending_payment":
    case "rejected":
      return "pay";
    case "awaiting_review":
      return "legacy_review";
    case "cancelled":
    case "refunded":
      return "closed";
    case "paid":
      if (o.mt5AccountId === null) return o.partnerBrokerCode === null ? "choose_broker" : "submit_account";
      if (activation === null && blocked) return "blocked";
      return activation?.published ? "active" : "activating";
  }
}

const labels: Record<OrderStep, string> = {
  pay: "รอชำระ",
  legacy_review: "รอตรวจสลิป",
  choose_broker: "ชำระแล้ว · รอเลือกโบรกเกอร์",
  submit_account: "ชำระแล้ว · รอเลขบัญชี MT5",
  activating: "กำลังเปิดใช้งาน",
  blocked: "ชำระแล้ว · รอทีมงานตรวจสอบ",
  active: "เปิดใช้งานแล้ว",
  closed: "ปิดรายการ",
};

export function orderStepLabel(step: OrderStep): string {
  return labels[step];
}
