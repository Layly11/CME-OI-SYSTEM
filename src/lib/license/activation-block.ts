import "server-only";
import { isMockPaymentBlocked } from "@/lib/payment/config";
import { getAccountLicenseBlock } from "@/lib/purchase/repo";
import type { ActivationBlockReason } from "./activation";

/**
 * "คำสั่งซื้อนี้เปิด license อัตโนมัติไม่ได้เพราะอะไร" สำหรับหน้าเว็บและขั้นก่อนชำระเงิน — กติกาเดียวกับ activateInTx
 * (ที่นั่นคือด่านจริงใน transaction ที่นี่คือการอ่านเพื่อแสดงผล/ปฏิเสธล่วงหน้า จึงไม่ล็อกแถว)
 * ผู้เรียกต้องส่งคำสั่งซื้อที่ตรวจความเป็นเจ้าของแล้ว (getOrder / listOrders)
 */
type OrderForBlock = {
  status: string;
  mt5AccountId: string | null;
  paymentProvider: string | null;
  activatedLicense: unknown | null;
};

/**
 * คำสั่งซื้อที่ชำระแล้ว มีบัญชีแล้ว แต่ยังไม่มี license: ถูกกันอยู่หรือแค่รอ (null = ไม่ได้ถูกกัน)
 * ผลไม่ถาวร — ทีมงานปลดการระงับแล้วเรียกใหม่จะได้ null และปุ่ม "ตรวจสอบสถานะอีกครั้ง" กลับมาใช้ได้
 */
export async function getActivationBlock(order: OrderForBlock): Promise<ActivationBlockReason | null> {
  if (order.status !== "paid" || order.mt5AccountId === null || order.activatedLicense !== null) return null;
  if (isMockPaymentBlocked(order.paymentProvider, process.env)) return "mock_payment";
  return getAccountLicenseBlock(order.mt5AccountId);
}

/**
 * ก่อนรับเงิน: บัญชี MT5 ที่ผูกกับคำสั่งซื้อยังรับการเปิด/ต่ออายุได้หรือไม่ (null = ได้ หรือยังไม่ผูกบัญชี)
 * createOrder/attach ตรวจแค่ตอนสร้าง/ผูก — บัญชีอาจกลายเป็นตลอดชีพหรือถูกระงับระหว่างที่คำสั่งซื้อยังรอชำระ
 * ถ้ารับเงินไป ขั้นเปิด license จะถูกกันและลูกค้าเสียเงินโดยไม่ได้อะไร
 */
export async function getPaymentBlock(order: { mt5AccountId: string | null }): Promise<"license_suspended" | "lifetime_active" | null> {
  if (order.mt5AccountId === null) return null;
  return getAccountLicenseBlock(order.mt5AccountId);
}
