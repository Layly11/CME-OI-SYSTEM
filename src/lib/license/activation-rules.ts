import { computeNewExpiry, LIFETIME_EXPIRY } from "@/lib/license-file";
import { isLifetimeExpiry } from "@/lib/purchase/format";

/**
 * กติกาคำนวณ "คำสั่งซื้อนี้จะเปิด/ต่อ license อย่างไร" — pure ไม่แตะฐานข้อมูล (เวลาปัจจุบันรับเข้ามา)
 *
 * current = แถว license สถานะ active แถวเดียวของบัญชี MT5 นั้น (ฐานข้อมูลบังคับให้มีได้แถวเดียว) หรือ null ถ้าไม่มี
 * - current เป็นตลอดชีพ (ปี ≥ 2099)      → ไม่มีอะไรให้ต่อ (lifetime_active) และกันวันที่เลยปี 9999
 * - current ยังไม่หมด (หมดอายุ ≥ วันนี้)   → extended: นับต่อจากวันหมดอายุเดิม วันเริ่มไม่เปลี่ยน
 * - current เลยวันหมดอายุแล้ว             → reactivated: นับใหม่จากวันนี้ (แก้แถวเดิม)
 * - ไม่มี current                         → new: สร้างแถวใหม่ นับจากวันนี้
 * durationDays = null คือแพ็กเกจตลอดชีพ → วันหมดอายุ 9999-01-01 เสมอ
 */
export type ActivationPlan =
  | {
      ok: true;
      kind: "new" | "extended" | "reactivated";
      /** วันเริ่มที่ต้องเขียน — null = คงค่าเดิมของแถว (เฉพาะ extended) */
      startsAt: string | null;
      expiresAt: string;
      previousExpiresAt: string | null;
    }
  | { ok: false; reason: "lifetime_active" };

export function planActivation(i: {
  durationDays: number | null;
  current: { expiresAt: string } | null;
  /** วันนี้ตามเวลาไทย "YYYY-MM-DD" (todayInBangkok) */
  today: string;
}): ActivationPlan {
  const { durationDays, current, today } = i;
  if (current && isLifetimeExpiry(current.expiresAt)) return { ok: false, reason: "lifetime_active" };

  if (!current) {
    return {
      ok: true,
      kind: "new",
      startsAt: today,
      expiresAt: durationDays === null ? LIFETIME_EXPIRY : computeNewExpiry(durationDays, null, today),
      previousExpiresAt: null,
    };
  }
  const stillValid = current.expiresAt >= today;
  return {
    ok: true,
    kind: stillValid ? "extended" : "reactivated",
    startsAt: stillValid ? null : today,
    // computeNewExpiry: ยังไม่หมด → ต่อจากวันหมดอายุเดิม, หมดแล้ว → นับจากวันนี้, null → ตลอดชีพ
    expiresAt: computeNewExpiry(durationDays, current.expiresAt, today),
    previousExpiresAt: current.expiresAt,
  };
}
