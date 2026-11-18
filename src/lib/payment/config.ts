/**
 * ค่าตั้งของการรับชำระเงิน (env PAYMENT_PROVIDER) — pure ไม่แตะฐานข้อมูล/ไฟล์ จึงเรียกได้ตั้งแต่ตอนเซิร์ฟเวอร์เริ่ม
 *
 * - เว้นว่าง  ยังไม่เปิดรับชำระ: หน้าคำสั่งซื้อแสดง "ระบบชำระเงินยังไม่เปิดให้บริการ" แทนปุ่มชำระ
 * - mock      จำลองการชำระเงิน (โหมดทดสอบ) ไม่มีการตัดเงินจริง — ใช้จนกว่าจะเลือก payment gateway
 * - ค่าอื่น    ตั้งค่าผิด → ถือว่าปิด (fail closed)
 *
 * mock ต้องใช้ในระบบจริงโดยไม่ตั้งใจไม่ได้ (ชำระจำลอง = ได้ license ฟรี):
 * - ใช้ได้โดยไม่ต้องตั้งอะไรเพิ่มเฉพาะ NODE_ENV=development หรือ test (ตรงตัวอักษร)
 *   NODE_ENV อื่นทั้งหมด — production, ไม่ตั้ง, "staging", "Production" — ต้องตั้ง PAYMENT_MOCK_ALLOW_IN_PRODUCTION=true (ตรงตัวอักษร)
 *   (`next start` ใช้ NODE_ENV ที่ผู้รันส่งมา จึงห้ามถือว่า "ไม่ใช่ production = ปลอดภัย")
 * - ทุก NODE_ENV: ปฏิเสธเมื่อรายชื่อ license ชี้ไปรายชื่อจริงใน Firebase
 *   (LICENSE_STORAGE=firebase และ FIREBASE_LICENSE_PATH = LIVE_FIREBASE_LICENSE_PATH หรือ path ใต้มัน)
 *
 * ด่านเดียวกันถูกตรวจซ้ำตอนเปิด license (src/lib/license/activation.ts) และตอนเผยแพร่รายชื่อ (src/lib/license/publish-sync.ts):
 * คำสั่งซื้อที่ "ชำระ" ด้วย mock ต้องไม่กลายเป็น license จริงเมื่อฐานข้อมูลเดียวกันถูกใช้กับระบบจริงภายหลัง
 */
import { isDevOrTestEnv, LIVE_FIREBASE_LICENSE_PATH, targetsLiveLicenseList } from "@/lib/license-storage-config";

export { LIVE_FIREBASE_LICENSE_PATH, targetsLiveLicenseList };

export const PAYMENT_PROVIDER_IDS = ["mock"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDER_IDS)[number];

/**
 * ค่าของ orders.payment_provider สำหรับแพ็กเกจฟรีจากการชวนเพื่อน (ยอด 0 บาท ไม่มีขั้นชำระเงิน)
 * ไม่ใช่ผู้ให้บริการรับชำระ จึงไม่อยู่ใน PAYMENT_PROVIDER_IDS และตั้งผ่าน env PAYMENT_PROVIDER ไม่ได้
 * และ "ไม่ใช่การชำระเงินจำลอง": ด่านของ mock ทุกด่าน (isMockPaymentBlocked, การเผยแพร่ไปรายชื่อจริง, license:purge-mock)
 * เทียบกับคำว่า "mock" ตรงตัว คำสั่งซื้อแบบนี้จึงเป็นคำสั่งซื้อจริงในทุกค่าตั้ง — สิทธิ์ถูกตรวจด้วยกติกาของมันเอง
 * (src/lib/purchase/referral.ts: มีเพื่อนสมัครแล้ว + ครั้งเดียวต่อผู้ใช้ + ครั้งเดียวต่อบัญชี MT5)
 */
export const REFERRAL_PAYMENT_PROVIDER = "referral";
/** ทุกค่าที่ markOrderPaid รับ: ผู้ให้บริการรับชำระ หรือสิทธิ์ฟรีจากการชวนเพื่อน */
export type PaidVia = PaymentProviderId | typeof REFERRAL_PAYMENT_PROVIDER;
export const PAID_VIA_IDS: readonly PaidVia[] = [...PAYMENT_PROVIDER_IDS, REFERRAL_PAYMENT_PROVIDER];

export type PaymentConfig =
  | { ok: true; provider: PaymentProviderId | null } // null = ยังไม่ได้ตั้งค่า
  | { ok: false; provider: null; error: string }; // ค่าที่ไม่รู้จัก หรือ mock ถูกปฏิเสธ

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined) => (v ?? "").trim();

export function resolvePaymentConfig(env: Env): PaymentConfig {
  const provider = clean(env.PAYMENT_PROVIDER);
  if (provider === "") return { ok: true, provider: null };
  if (provider !== "mock") {
    return {
      ok: false,
      provider: null,
      error: `ไม่รู้จักค่า PAYMENT_PROVIDER="${provider.slice(0, 40)}" — ตอนนี้รองรับเฉพาะ mock (โหมดทดสอบ) หรือเว้นว่างเพื่อปิดการชำระเงิน`,
    };
  }
  if (targetsLiveLicenseList(env)) {
    return {
      ok: false,
      provider: null,
      error:
        "PAYMENT_PROVIDER=mock ใช้ไม่ได้เมื่อ LICENSE_STORAGE=firebase ชี้ไปรายชื่อ license จริง " +
        `(FIREBASE_LICENSE_PATH="${LIVE_FIREBASE_LICENSE_PATH}" หรือ path ใต้มัน) — การชำระเงินจำลองจะเปิด license จริงให้ฟรี`,
    };
  }
  // ค่าเริ่มต้นคือ "ปิด": ผ่อนปรนให้เฉพาะ development/test ตรงตัว — NODE_ENV อื่นทุกค่า (รวมไม่ตั้ง) ต้องมี flag
  if (!isDevOrTestEnv(env) && env.PAYMENT_MOCK_ALLOW_IN_PRODUCTION !== "true") {
    return {
      ok: false,
      provider: null,
      error:
        "PAYMENT_PROVIDER=mock (จำลองการชำระเงิน) ใช้ได้เองเฉพาะ NODE_ENV=development หรือ test — " +
        `ตอนนี้ NODE_ENV=${JSON.stringify(env.NODE_ENV ?? null).slice(0, 40)} ` +
        "ถ้าตั้งใจใช้กับระบบทดสอบจริงๆ ให้ตั้ง PAYMENT_MOCK_ALLOW_IN_PRODUCTION=true หรือเว้น PAYMENT_PROVIDER ว่างเพื่อปิดการชำระเงิน",
    };
  }
  return { ok: true, provider: "mock" };
}

/** throw ถ้า env นี้ไม่อนุญาตการชำระเงินจำลอง — ด่านสุดท้ายก่อนบันทึกว่า "ชำระแล้ว" ด้วย provider mock */
export function assertMockPaymentAllowed(env: Env): void {
  const config = resolvePaymentConfig(env);
  if (!config.ok) throw new Error(config.error);
  if (config.provider !== "mock") {
    throw new Error("การชำระเงินจำลองไม่ได้เปิดใช้ (PAYMENT_PROVIDER ไม่ใช่ mock)");
  }
}

/**
 * คำสั่งซื้อที่บันทึกว่าชำระด้วย provider นี้ ต้องถูกกันไม่ให้เปิด license ใน env นี้หรือไม่
 * true เมื่อชำระด้วย mock แต่ค่าตั้งปัจจุบันไม่อนุญาต mock (ปิดไปแล้ว / ชี้รายชื่อจริง / NODE_ENV ที่ต้องมี flag)
 * ใช้ตอนเปิด license และตอนแสดงสถานะ — ด่านตอนชำระอย่างเดียวไม่พอ เพราะค่าตั้งเปลี่ยนได้หลังคำสั่งซื้อถูกชำระ
 */
export function isMockPaymentBlocked(paymentProvider: string | null | undefined, env: Env): boolean {
  if (paymentProvider !== "mock") return false;
  const config = resolvePaymentConfig(env);
  return !(config.ok && config.provider === "mock");
}

/**
 * แสดงช่องทางโอนเงิน + แนบสลิปให้ลูกค้าหรือไม่ — ค่าเริ่มต้นปิด (บัตรเป็นช่องทางเดียวที่ลูกค้าเห็น)
 * หมายเหตุ: รอบนี้ยังไม่มีขั้นตอนยืนยันสลิป คำสั่งซื้อที่แนบสลิปจะค้างที่ "รอตรวจสลิป"
 */
export function isBankTransferEnabled(env: Env): boolean {
  return env.PAYMENT_BANK_TRANSFER_ENABLED === "true";
}
