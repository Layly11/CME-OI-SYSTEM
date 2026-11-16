/** ค่าตั้งจาก env ของขั้นตอนสั่งซื้อ — ไม่ hardcode เลขบัญชีรับเงินหรือลิงก์พาร์ตเนอร์ในโค้ด */

export type PaymentInfo = {
  bankName: string;
  accountName: string;
  accountNumber: string;
  promptPayId: string | null;
};

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined) => (v ?? "").trim();

/** null เมื่อข้อมูลบัญชีรับเงินยังไม่ครบ — หน้าคำสั่งซื้อจะบอกให้สอบถามทาง LINE แทน */
export function getPaymentInfo(env: Env): PaymentInfo | null {
  const bankName = clean(env.PAYMENT_BANK_NAME);
  const accountName = clean(env.PAYMENT_ACCOUNT_NAME);
  const accountNumber = clean(env.PAYMENT_ACCOUNT_NUMBER);
  if (!bankName || !accountName || !accountNumber) return null;
  return { bankName, accountName, accountNumber, promptPayId: clean(env.PAYMENT_PROMPTPAY_ID) || null };
}

/** รับเฉพาะ URL แบบ http/https — อย่างอื่น (javascript:, data:, ค่าว่าง, URL เสีย) คืน null */
export function safeExternalUrl(v: string | undefined | null): string | null {
  const raw = (v ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
