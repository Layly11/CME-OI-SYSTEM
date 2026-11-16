import { parseLicenseFile } from "@/lib/license-file";
import { licenseView } from "@/lib/purchase/format";

/**
 * "license นี้ถึงมือบอทแล้วหรือยัง" — pure
 * ความจริงของลูกค้าไม่ใช่แถวในฐานข้อมูล แต่คือรายชื่อที่เผยแพร่ล่าสุด (license_file_publications แถวใหม่สุด
 * ซึ่งถูกบันทึกหลังเขียน storage สำเร็จเท่านั้น): บอททำงานเมื่อ id<เลขบัญชี>.<วันหมดอายุ> อยู่ในรายชื่อนั้น
 */

/** เลขบัญชี → วันหมดอายุ (YYYY-MM-DD) ของรายชื่อที่เผยแพร่ — เนื้อหาว่าง/อ่านไม่ได้ = ไม่มีรายการ */
export function publishedEntryMap(content: string | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (typeof content !== "string" || content === "") return map;
  for (const e of parseLicenseFile(content).entries) map.set(e.accountNumber, e.expiresAt);
  return map;
}

/** รายการของบัญชีนี้ในรายชื่อที่เผยแพร่ ตรงกับวันหมดอายุในฐานข้อมูลทุกตัวอักษรหรือไม่ (วันเก่ากว่า = ยังไม่เผยแพร่การต่ออายุ) */
export function isLicensePublished(map: Map<string, string>, accountNumber: string, expiresAt: string): boolean {
  return map.get(accountNumber) === expiresAt;
}

/**
 * สถานะการเปิดใช้งานที่แสดงให้ลูกค้า
 * - none     ยังไม่มี license จากคำสั่งซื้อนี้
 * - pending  license เปิดในฐานข้อมูลแล้ว แต่รายชื่อที่เผยแพร่ยังไม่มีรายการนี้ → "กำลังเปิดใช้งาน"
 * - active   อยู่ในรายชื่อที่เผยแพร่แล้ว
 * - ended    license หมดอายุ/ถูกระงับไปแล้ว (ไม่อยู่ในรายชื่อโดยตั้งใจ — ไม่ใช่ "กำลังเปิดใช้งาน")
 */
export type ActivationView =
  | { kind: "none" }
  | { kind: "pending" }
  | { kind: "active"; expiresAt: string; lifetime: boolean; daysRemaining: number | null }
  | { kind: "ended"; status: "expired" | "suspended" | "pending" };

export function activationView(
  license: { status: "pending" | "active" | "expired" | "suspended"; expiresAt: string } | null,
  accountNumber: string | null,
  published: Map<string, string>,
  today: string,
): ActivationView {
  if (!license || accountNumber === null) return { kind: "none" };
  const view = licenseView(license, today);
  if (view.status !== "active") return { kind: "ended", status: view.status };
  if (!isLicensePublished(published, accountNumber, license.expiresAt)) return { kind: "pending" };
  return { kind: "active", expiresAt: license.expiresAt, lifetime: view.lifetime, daysRemaining: view.daysRemaining };
}
