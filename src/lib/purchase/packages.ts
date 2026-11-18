import { formatThb } from "./format";

/**
 * กติกาของ "แพ็กเกจ" ที่ไม่แตะฐานข้อมูล — pure
 *
 * แหล่งข้อมูลเดียวของรายการแพ็กเกจ/ราคา/อายุ คือตาราง packages (ตั้งค่าด้วย `npm run db:seed` — ดู package-lineup.ts)
 * ไฟล์นี้มีแค่ "วิธีตีความ" แถวของตารางนั้น: อายุรวม (อายุหลัก + วันแถม), ข้อความที่แสดง, และแพ็กเกจฟรีจากการชวนเพื่อน
 */

/** ค่าของ enum package_code — ต้องตรงกับ packageCode ใน src/db/schema.ts (มีเทสเทียบ) */
export const PACKAGE_CODES = [
  "monthly",
  "six_months",
  "yearly",
  "lifetime",
  "ib",
  "three_months",
  "free_referral",
] as const;
export type PackageCode = (typeof PACKAGE_CODES)[number];

export function isKnownPackageCode(v: unknown): v is PackageCode {
  return typeof v === "string" && (PACKAGE_CODES as readonly string[]).includes(v);
}

/** แพ็กเกจฟรี 1 เดือนจากการชวนเพื่อน — ราคา 0 และรับได้ผ่านเงื่อนไขใน referral.ts เท่านั้น */
export const FREE_REFERRAL_PACKAGE_CODE = "free_referral" satisfies PackageCode;
/** จำนวนเพื่อนที่ต้องสมัครสมาชิกผ่านลิงก์ชวน จึงจะรับแพ็กเกจฟรีได้ */
export const REFERRALS_REQUIRED_FOR_FREE = 1;

export function isFreeReferralPackage(pkg: { code: string }): boolean {
  return pkg.code === FREE_REFERRAL_PACKAGE_CODE;
}

/**
 * สั่งซื้อผ่านเว็บได้หรือไม่ (ยังไม่ดูสิทธิ์ของผู้ใช้):
 * - แพ็กเกจทั่วไป: เปิดขายและมีราคามากกว่า 0 (null = "สอบถามราคา")
 * - แพ็กเกจฟรีจากการชวนเพื่อน: เปิดขายและราคาเป็น 0 พอดี (ราคาอื่น = ตั้งค่าผิด ถือว่าปิด)
 * แพ็กเกจราคา 0 อื่นๆ (เช่น ib) สั่งผ่านเว็บไม่ได้ — ของฟรีต้องมีเงื่อนไขที่โค้ดตรวจได้เท่านั้น
 */
export function canOrderOnline(pkg: { isActive: boolean; priceThb: number | null; code: string }): boolean {
  if (!pkg.isActive || pkg.priceThb === null) return false;
  return isFreeReferralPackage(pkg) ? pkg.priceThb === 0 : pkg.priceThb > 0;
}

type Duration = { durationDays: number | null; bonusDays: number };

/** อายุ license ที่แพ็กเกจให้จริง = อายุหลัก + วันแถม (null = ตลอดชีพ วันแถมไม่มีผล) */
export function packageTotalDays(pkg: Duration): number | null {
  if (pkg.durationDays === null) return null;
  return pkg.durationDays + Math.max(0, pkg.bonusDays);
}

/** ชื่อที่แสดง: "3 เดือน" + วันแถม → "3 เดือน แถม 15 วัน" */
export function packageDisplayName(pkg: { nameTh: string } & Duration): string {
  return pkg.durationDays !== null && pkg.bonusDays > 0 ? `${pkg.nameTh} แถม ${pkg.bonusDays} วัน` : pkg.nameTh;
}

/** ระยะเวลาที่แสดงใต้ชื่อ: "90 วัน + แถม 15 วัน (รวม 105 วัน)" / "30 วัน" / "ไม่มีวันหมดอายุ" */
export function packagePeriodText(pkg: Duration): string {
  if (pkg.durationDays === null) return "ไม่มีวันหมดอายุ";
  if (pkg.bonusDays <= 0) return `${pkg.durationDays} วัน`;
  return `${pkg.durationDays} วัน + แถม ${pkg.bonusDays} วัน (รวม ${pkg.durationDays + pkg.bonusDays} วัน)`;
}

/** ราคาที่แสดง: แพ็กเกจฟรี → "ฟรี", ยังไม่ตั้งราคา → "สอบถามราคา" */
export function packagePriceText(pkg: { code: string; priceThb: number | null }): string {
  if (pkg.priceThb === null) return "สอบถามราคา";
  if (pkg.priceThb === 0 && isFreeReferralPackage(pkg)) return "ฟรี";
  return formatThb(pkg.priceThb);
}

/** ยอดของคำสั่งซื้อที่แสดงให้ลูกค้า: 0 บาท → "ฟรี" */
export function orderAmountText(amountThb: number): string {
  return amountThb === 0 ? "ฟรี" : formatThb(amountThb);
}

/**
 * สถานะสิทธิ์แพ็กเกจฟรีของผู้ใช้ (สำหรับแสดงผล — ด่านจริงอยู่ที่ createOrder และขั้นเปิด license)
 * - need_referral  ยังมีเพื่อนสมัครผ่านลิงก์ไม่ครบ
 * - eligible       รับสิทธิ์ได้
 * - claim_open     รับสิทธิ์แล้ว แต่ยังไม่ได้เปิด license (ทำขั้นถัดไปของคำสั่งซื้อนั้นต่อ หรือยกเลิกเพื่อคืนสิทธิ์)
 * - claimed        เปิด license ด้วยสิทธิ์นี้ไปแล้ว (ครั้งเดียวต่อผู้ใช้)
 */
export type FreeClaimState = "need_referral" | "eligible" | "claim_open" | "claimed";

export function freeClaimState(s: { referredCount: number; claim: { activated: boolean } | null }): FreeClaimState {
  if (s.claim) return s.claim.activated ? "claimed" : "claim_open";
  return s.referredCount >= REFERRALS_REQUIRED_FOR_FREE ? "eligible" : "need_referral";
}

/** "ชวนเพื่อนสมัครแล้ว 0/1 คน" — ตัวตั้งไม่เกินจำนวนที่ต้องการ (จำนวนจริงแสดงแยกในหน้าบัญชี) */
export function referralProgressText(referredCount: number): string {
  const done = Math.max(0, Math.min(referredCount, REFERRALS_REQUIRED_FOR_FREE));
  return `ชวนเพื่อนสมัครแล้ว ${done}/${REFERRALS_REQUIRED_FOR_FREE} คน`;
}
