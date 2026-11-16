import { z } from "zod";
import { purchaseMessages } from "./messages";

/**
 * ตรวจข้อมูลบัญชี MT5 ที่ลูกค้ากรอก
 * กฎเหล็ก: ไม่มีช่องรหัสผ่าน MT5 และไม่อ่านค่าใดๆ ที่ชื่อมีคำว่า password จากฟอร์ม
 */

/** ตัดช่องว่างหัวท้ายเท่านั้น — ไม่แปลงเลขไทย/เลขเต็มความกว้างให้ (กรอกผิดต้องเห็นว่าผิด) */
export function normalizeAccountNumber(s: string): string {
  return s.trim();
}

/** ตัดหัวท้าย และยุบช่องว่างซ้อนให้เหลือช่องเดียว */
export function normalizeBrokerServer(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

const ACCOUNT_NUMBER_RE = /^[1-9][0-9]{3,19}$/;
const BROKER_SERVER_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,62}[A-Za-z0-9]$/;

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v ?? undefined);

export const mt5AccountSchema = z
  .object({
    accountNumber: z
      .string({ error: purchaseMessages.account_number_invalid })
      .transform(normalizeAccountNumber)
      .pipe(z.string().regex(ACCOUNT_NUMBER_RE, { error: purchaseMessages.account_number_invalid })),
    accountNumberConfirm: z.string({ error: purchaseMessages.account_number_mismatch }).transform(normalizeAccountNumber),
    brokerServer: z
      .string({ error: purchaseMessages.broker_server_invalid })
      .transform(normalizeBrokerServer)
      .pipe(z.string().regex(BROKER_SERVER_RE, { error: purchaseMessages.broker_server_invalid })),
    label: z.preprocess(
      blankToUndefined,
      z.string().trim().max(40, { error: purchaseMessages.label_too_long }).optional(),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.accountNumber !== data.accountNumberConfirm) {
      ctx.addIssue({ code: "custom", path: ["accountNumberConfirm"], message: purchaseMessages.account_number_mismatch });
    }
  });

export type Mt5AccountInput = z.infer<typeof mt5AccountSchema>;
export type Mt5Field = "accountNumber" | "accountNumberConfirm" | "brokerServer" | "label";

export const MT5_FIELDS: readonly Mt5Field[] = ["accountNumber", "accountNumberConfirm", "brokerServer", "label"];

/**
 * อ่านเฉพาะ 4 ช่องที่รู้จักจากฟอร์ม — ช่องอื่นทั้งหมด (รวมทุกชื่อที่มีคำว่า password) ถูกทิ้ง
 * ค่าที่ไม่ใช่ string (เช่นไฟล์) นับเป็นค่าว่าง
 */
export function pickMt5Fields(get: (name: string) => unknown): Record<Mt5Field, string> {
  const out = {} as Record<Mt5Field, string>;
  for (const f of MT5_FIELDS) {
    const v = get(f);
    out[f] = typeof v === "string" ? v.slice(0, 200) : "";
  }
  return out;
}
