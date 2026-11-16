/** ตัวช่วยจัดรูปแบบสำหรับหน้าสมาชิก — pure ทั้งหมด (เวลาปัจจุบันรับเข้ามาเป็นพารามิเตอร์) */

/** 1001 → "ORD-001001" */
export function formatOrderNo(n: number): string {
  return "ORD-" + String(n).padStart(6, "0");
}

/** 12500 → "12,500 บาท" */
export function formatThb(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " บาท";
}

const thaiDate = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** วันที่แบบไทย (พ.ศ.) ตามเวลาไทย เช่น "16 พ.ย. 2569" — รับ Date หรือ "YYYY-MM-DD" */
export function formatThaiDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d.slice(0, 10) + "T12:00:00+07:00") : d;
  return thaiDate.format(date);
}

/** วันนี้ตามเวลาไทย (UTC+7 ไม่มี DST) → "YYYY-MM-DD" */
export function todayInBangkok(now: Date): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** จำนวนวันจาก from ถึง to (ทั้งคู่เป็น "YYYY-MM-DD") ติดลบได้ */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

/** ปี ≥ 2099 ถือเป็น license ตลอดชีพ (ตามรูปแบบรายชื่อเดิม) */
export function isLifetimeExpiry(expiresAt: string): boolean {
  return Number(expiresAt.slice(0, 4)) >= 2099;
}

/** แบ่งเลขเป็นกลุ่มละ 4 หลักให้อ่านทวนง่าย: "97058698" → "9705 8698" */
export function groupDigits(s: string): string {
  return s.replace(/(.{4})(?=.)/g, "$1 ");
}

export type LicenseView = {
  /** สถานะที่แสดงให้ลูกค้า — active ที่เลยวันหมดอายุแล้วแสดงเป็น expired */
  status: "pending" | "active" | "expired" | "suspended";
  lifetime: boolean;
  /** จำนวนวันที่เหลือ (null เมื่อเป็นตลอดชีพ) ไม่ติดลบ */
  daysRemaining: number | null;
};

export function licenseView(
  license: { status: "pending" | "active" | "expired" | "suspended"; expiresAt: string },
  today: string,
): LicenseView {
  const lifetime = isLifetimeExpiry(license.expiresAt);
  if (lifetime) return { status: license.status, lifetime, daysRemaining: null };
  const days = daysBetween(today, license.expiresAt);
  const status = license.status === "active" && days < 0 ? "expired" : license.status;
  return { status, lifetime, daysRemaining: Math.max(0, days) };
}
