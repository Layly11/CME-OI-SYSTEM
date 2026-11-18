import { describe, expect, it } from "vitest";
import { packageCode } from "@/db/schema";
import { computeNewExpiry } from "@/lib/license-file";
import { PACKAGE_LINEUP } from "./package-lineup";
import {
  canOrderOnline,
  FREE_REFERRAL_PACKAGE_CODE,
  freeClaimState,
  isFreeReferralPackage,
  isKnownPackageCode,
  orderAmountText,
  PACKAGE_CODES,
  packageDisplayName,
  packagePeriodText,
  packagePriceText,
  packageTotalDays,
  referralProgressText,
  REFERRALS_REQUIRED_FOR_FREE,
} from "./packages";

describe("PACKAGE_CODES", () => {
  it("ตรงกับ enum package_code ในฐานข้อมูลทุกตัว", () => {
    expect([...PACKAGE_CODES].sort()).toEqual([...packageCode.enumValues].sort());
  });

  it("isKnownPackageCode / isFreeReferralPackage", () => {
    expect(isKnownPackageCode("three_months")).toBe(true);
    expect(isKnownPackageCode("free_referral")).toBe(true);
    expect(isKnownPackageCode("FREE_REFERRAL")).toBe(false);
    expect(isKnownPackageCode(null)).toBe(false);
    expect(isFreeReferralPackage({ code: FREE_REFERRAL_PACKAGE_CODE })).toBe(true);
    expect(isFreeReferralPackage({ code: "ib" })).toBe(false);
    expect(isFreeReferralPackage({ code: "monthly" })).toBe(false);
  });
});

describe("อายุและข้อความของแพ็กเกจ", () => {
  it("packageTotalDays = อายุหลัก + วันแถม (ตลอดชีพ = null, วันแถมติดลบถือเป็น 0)", () => {
    expect(packageTotalDays({ durationDays: 90, bonusDays: 15 })).toBe(105);
    expect(packageTotalDays({ durationDays: 180, bonusDays: 30 })).toBe(210);
    expect(packageTotalDays({ durationDays: 365, bonusDays: 60 })).toBe(425);
    expect(packageTotalDays({ durationDays: 30, bonusDays: 0 })).toBe(30);
    expect(packageTotalDays({ durationDays: null, bonusDays: 60 })).toBeNull();
    expect(packageTotalDays({ durationDays: 30, bonusDays: -5 })).toBe(30);
  });

  it("ชื่อและระยะเวลาที่แสดงบอกวันแถมชัดเจน", () => {
    const three = { nameTh: "3 เดือน", durationDays: 90, bonusDays: 15 };
    expect(packageDisplayName(three)).toBe("3 เดือน แถม 15 วัน");
    expect(packagePeriodText(three)).toBe("90 วัน + แถม 15 วัน (รวม 105 วัน)");
    const free = { nameTh: "ฟรี 1 เดือน", durationDays: 30, bonusDays: 0 };
    expect(packageDisplayName(free)).toBe("ฟรี 1 เดือน");
    expect(packagePeriodText(free)).toBe("30 วัน");
    const life = { nameTh: "ตลอดชีพ", durationDays: null, bonusDays: 10 };
    expect(packageDisplayName(life)).toBe("ตลอดชีพ");
    expect(packagePeriodText(life)).toBe("ไม่มีวันหมดอายุ");
  });

  it("ราคาที่แสดง: บาท / ฟรี (เฉพาะแพ็กเกจฟรีจากการชวนเพื่อน) / สอบถามราคา", () => {
    expect(packagePriceText({ code: "three_months", priceThb: 3000 })).toBe("3,000 บาท");
    expect(packagePriceText({ code: "yearly", priceThb: 11000 })).toBe("11,000 บาท");
    expect(packagePriceText({ code: "free_referral", priceThb: 0 })).toBe("ฟรี");
    expect(packagePriceText({ code: "ib", priceThb: 0 })).toBe("0 บาท");
    expect(packagePriceText({ code: "monthly", priceThb: null })).toBe("สอบถามราคา");
    expect(orderAmountText(0)).toBe("ฟรี");
    expect(orderAmountText(6000)).toBe("6,000 บาท");
  });
});

describe("สถานะสิทธิ์แพ็กเกจฟรี (สำหรับแสดงผล)", () => {
  it("freeClaimState", () => {
    expect(REFERRALS_REQUIRED_FOR_FREE).toBe(1);
    expect(freeClaimState({ referredCount: 0, claim: null })).toBe("need_referral");
    expect(freeClaimState({ referredCount: 1, claim: null })).toBe("eligible");
    expect(freeClaimState({ referredCount: 5, claim: null })).toBe("eligible");
    expect(freeClaimState({ referredCount: 1, claim: { activated: false } })).toBe("claim_open");
    expect(freeClaimState({ referredCount: 1, claim: { activated: true } })).toBe("claimed");
    // ใช้สิทธิ์ไปแล้วคือใช้แล้ว แม้จำนวนเพื่อนเปลี่ยน
    expect(freeClaimState({ referredCount: 0, claim: { activated: true } })).toBe("claimed");
  });

  it("referralProgressText: ตัวตั้งไม่เกินจำนวนที่ต้องการ", () => {
    expect(referralProgressText(0)).toBe("ชวนเพื่อนสมัครแล้ว 0/1 คน");
    expect(referralProgressText(1)).toBe("ชวนเพื่อนสมัครแล้ว 1/1 คน");
    expect(referralProgressText(7)).toBe("ชวนเพื่อนสมัครแล้ว 1/1 คน");
    expect(referralProgressText(-1)).toBe("ชวนเพื่อนสมัครแล้ว 0/1 คน");
  });
});

describe("PACKAGE_LINEUP (ข้อมูลตั้งต้นของตาราง packages)", () => {
  const byCode = Object.fromEntries(PACKAGE_LINEUP.map((p) => [p.code, p]));
  const selling = PACKAGE_LINEUP.filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder);

  it("ขาย 4 แพ็กเกจตามที่ผู้ว่าจ้างกำหนด เรียงตามลำดับ และสั่งผ่านเว็บได้ทุกตัว", () => {
    expect(selling.map((p) => [p.code, p.priceThb, p.durationDays, p.bonusDays, packageTotalDays(p)])).toEqual([
      ["free_referral", 0, 30, 0, 30],
      ["three_months", 3000, 90, 15, 105],
      ["six_months", 6000, 180, 30, 210],
      ["yearly", 11000, 365, 60, 425],
    ]);
    for (const p of selling) expect(canOrderOnline({ ...p, priceThb: p.priceThb ?? null }), p.code).toBe(true);
    expect(selling.map(packageDisplayName)).toEqual(["ฟรี 1 เดือน", "3 เดือน แถม 15 วัน", "6 เดือน แถม 30 วัน", "1 ปี แถม 60 วัน"]);
  });

  it("แพ็กเกจฟรีบอกเงื่อนไขชวนเพื่อนตามจำนวนที่โค้ดตรวจจริง", () => {
    expect(byCode.free_referral.description).toContain(`${REFERRALS_REQUIRED_FOR_FREE} คน`);
  });

  it("รายเดือน/ตลอดชีพ/IB ถูกปิด ไม่ถูกลบ และรายการครอบคลุมทุก code (ไม่มีแถวตกค้างที่ seed ไม่รู้จัก)", () => {
    for (const code of ["monthly", "lifetime", "ib"] as const) expect(byCode[code].isActive, code).toBe(false);
    expect(PACKAGE_LINEUP.map((p) => p.code).sort()).toEqual([...PACKAGE_CODES].sort());
    // แพ็กเกจที่เลิกขายไม่ถูกเขียนทับราคา (undefined) — ตลอดชีพยังเป็นอายุ null ตามเดิม
    expect(byCode.monthly.priceThb).toBeUndefined();
    expect(byCode.lifetime.priceThb).toBeUndefined();
    expect(byCode.lifetime.durationDays).toBeNull();
  });

  it("วันหมดอายุที่ได้จากอายุรวม: ซื้อใหม่นับจากวันนี้ ต่ออายุนับต่อจากวันหมดเดิม", () => {
    const today = "2026-11-18";
    expect(computeNewExpiry(packageTotalDays(byCode.three_months), null, today)).toBe("2027-03-03");
    expect(computeNewExpiry(packageTotalDays(byCode.six_months), null, today)).toBe("2027-06-16");
    expect(computeNewExpiry(packageTotalDays(byCode.yearly), null, today)).toBe("2028-01-17");
    // บัญชีที่ได้แพ็กเกจฟรี (หมด 2026-12-18) ต่ออายุด้วย 3 เดือน → +105 วันจากวันหมดเดิม
    const freeExpiry = computeNewExpiry(packageTotalDays(byCode.free_referral), null, today);
    expect(freeExpiry).toBe("2026-12-18");
    expect(computeNewExpiry(packageTotalDays(byCode.three_months), freeExpiry, today)).toBe("2027-04-02");
  });
});
