import { resolvePaymentConfig, type PaymentProviderId } from "./config";

/**
 * ผู้ให้บริการรับชำระเงินด้วยบัตร — ระบบเราไม่เคยรับ ส่งผ่าน หรือเก็บข้อมูลบัตร
 * (เลขบัตร/วันหมดอายุ/CVV กรอกที่หน้าของผู้ให้บริการเท่านั้น)
 *
 * วิธีเปลี่ยนเป็น gateway จริง (hosted checkout + webhook) โดยไม่แก้ flow:
 * 1) เพิ่ม id ใน PAYMENT_PROVIDER_IDS และ implement PaymentProvider.createCheckout ให้คืน URL หน้าชำระของ gateway
 * 2) เพิ่ม route webhook ที่ตรวจลายเซ็น + ยอดเงิน แล้วเรียก markOrderPaid(orderId, provider, providerRef)
 *    (src/lib/payment/mark-paid.ts) — ฟังก์ชันเดียวกับที่การชำระจำลองเรียก
 */

/** ยอดเงินมาจากแถวคำสั่งซื้อในฐานข้อมูลเท่านั้น ไม่รับจากฝั่ง client */
export type CheckoutOrder = { id: string; orderNo: number; amountThb: number; packageName: string };

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  /** true = ไม่มีการตัดเงินจริง หน้าเว็บต้องบอกลูกค้าชัดเจน */
  readonly testMode: boolean;
  /** เริ่มการชำระ: คืน URL ที่จะพาลูกค้าไป (หน้าของ gateway หรือหน้าจำลองในเว็บ) */
  createCheckout(order: CheckoutOrder, opts: { returnPath: string }): Promise<{ redirectUrl: string }>;
}

/** การชำระเงินจำลอง: พาไปหน้ายืนยันในเว็บเอง ไม่มีช่องกรอกข้อมูลบัตร และ URL ไม่มียอดเงิน */
const mockProvider: PaymentProvider = {
  id: "mock",
  testMode: true,
  async createCheckout(order) {
    return { redirectUrl: `/account/orders/${order.id}/mock-pay` };
  },
};

/** null เมื่อยังไม่ได้ตั้งค่า หรือค่าตั้งไม่ผ่าน (ไม่รู้จัก / mock ถูกปฏิเสธ) — ผู้เรียกแสดง "ระบบชำระเงินยังไม่เปิดให้บริการ" */
export function getPaymentProvider(env: Record<string, string | undefined>): PaymentProvider | null {
  const config = resolvePaymentConfig(env);
  if (!config.ok || config.provider === null) return null;
  return mockProvider;
}

/** เลขอ้างอิงของการชำระจำลอง — คงที่ต่อคำสั่งซื้อ กดซ้ำ/ลองใหม่จึงเป็นรายการเดิม (idempotent) */
export function mockPaymentRef(orderId: string): string {
  return `mock-${orderId}`;
}

/**
 * เลขอ้างอิงของการรับแพ็กเกจฟรีจากการชวนเพื่อน — คงที่ต่อคำสั่งซื้อ บันทึกซ้ำจึงเป็นรายการเดิม (idempotent)
 * (ครั้งเดียวต่อผู้ใช้บังคับด้วย referral_claims.user_id unique ไม่ใช่ด้วยเลขอ้างอิงนี้ — ยกเลิกแล้วรับใหม่ได้เลขใหม่)
 */
export function referralPaymentRef(orderId: string): string {
  return `referral-${orderId}`;
}
