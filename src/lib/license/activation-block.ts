import "server-only";
import { isMockPaymentBlocked, REFERRAL_PAYMENT_PROVIDER } from "@/lib/payment/config";
import { isFreeReferralPackage } from "@/lib/purchase/packages";
import { getAccountLicenseBlock, getFreeClaimBlock } from "@/lib/purchase/repo";
import type { ActivationBlockReason } from "./activation";

/**
 * "คำสั่งซื้อนี้เปิด license อัตโนมัติไม่ได้เพราะอะไร" สำหรับหน้าเว็บและขั้นก่อนชำระเงิน — กติกาเดียวกับ activateInTx
 * (ที่นั่นคือด่านจริงใน transaction ที่นี่คือการอ่านเพื่อแสดงผล/ปฏิเสธล่วงหน้า จึงไม่ล็อกแถว)
 * ผู้เรียกต้องส่งคำสั่งซื้อที่ตรวจความเป็นเจ้าของแล้ว (getOrder / listOrders)
 */
type OrderForBlock = {
  id: string;
  status: string;
  mt5AccountId: string | null;
  packageCode: string;
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
  const accountBlock = await getAccountLicenseBlock(order.mt5AccountId);
  if (accountBlock === "license_suspended") return accountBlock;
  // แพ็กเกจฟรีจากการชวนเพื่อน: กติกาเดียวกับ activateInTx (สิทธิ์ของคำสั่งซื้อนี้ + เพื่อนที่สมัครแล้ว + บัญชีนี้ยังไม่เคยได้ฟรี)
  const freePackage = isFreeReferralPackage({ code: order.packageCode });
  const viaReferral = order.paymentProvider === REFERRAL_PAYMENT_PROVIDER;
  if (freePackage || viaReferral) {
    if (!(freePackage && viaReferral)) return "free_claim_invalid";
    const freeBlock = await getFreeClaimBlock({ id: order.id, mt5AccountId: order.mt5AccountId });
    if (freeBlock !== null) return freeBlock;
  }
  return accountBlock;
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
