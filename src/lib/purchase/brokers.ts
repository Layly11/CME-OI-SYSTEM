import { partnerBrokers, type PartnerBroker } from "@/content/brokers";

/** ตัวช่วยเหนือรายชื่อโบรกเกอร์พาร์ตเนอร์ (src/content/brokers.ts) — pure */

/** รับเฉพาะ code ที่อยู่ในรายชื่อ ตรงตัวอักษร (ค่าจากฟอร์มถือเป็นข้อมูลจากผู้ใช้) */
export function isPartnerBrokerCode(v: unknown): v is string {
  return typeof v === "string" && partnerBrokers.some((b) => b.code === v);
}

/** null เมื่อยังไม่ได้เลือก หรือ code ไม่อยู่ในรายชื่อแล้ว */
export function findPartnerBroker(code: string | null): PartnerBroker | null {
  if (code === null) return null;
  return partnerBrokers.find((b) => b.code === code) ?? null;
}
