import { describe, expect, it } from "vitest";
import {
  daysBetween,
  formatOrderNo,
  formatThaiDate,
  formatThb,
  groupDigits,
  isLifetimeExpiry,
  licenseView,
  todayInBangkok,
} from "./format";

describe("format", () => {
  it("formatOrderNo", () => {
    expect(formatOrderNo(1001)).toBe("ORD-001001");
    expect(formatOrderNo(7)).toBe("ORD-000007");
    expect(formatOrderNo(1234567)).toBe("ORD-1234567");
  });

  it("formatThb", () => {
    expect(formatThb(990)).toBe("990 บาท");
    expect(formatThb(1500)).toBe("1,500 บาท");
    expect(formatThb(1234567)).toBe("1,234,567 บาท");
  });

  it("formatThaiDate ใช้ พ.ศ. และเวลาไทย", () => {
    // 2026-11-16 18:30 UTC = 17 พ.ย. 01:30 เวลาไทย
    const s = formatThaiDate(new Date("2026-11-16T18:30:00Z"));
    expect(s).toContain("17");
    expect(s).toContain("พ.ย.");
    expect(s).toContain("2569");
    expect(formatThaiDate("2027-01-01")).toMatch(/^1 ม\.ค\. 2570$/);
  });

  it("todayInBangkok ข้ามวันตามเวลาไทย", () => {
    expect(todayInBangkok(new Date("2026-11-16T16:59:59Z"))).toBe("2026-11-16");
    expect(todayInBangkok(new Date("2026-11-16T17:00:00Z"))).toBe("2026-11-17");
    expect(todayInBangkok(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });

  it("daysBetween", () => {
    expect(daysBetween("2026-11-16", "2026-11-16")).toBe(0);
    expect(daysBetween("2026-11-16", "2026-12-16")).toBe(30);
    expect(daysBetween("2026-11-16", "2026-11-15")).toBe(-1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("isLifetimeExpiry: ปี ≥ 2099", () => {
    expect(isLifetimeExpiry("9999-01-01")).toBe(true);
    expect(isLifetimeExpiry("2099-12-29")).toBe(true);
    expect(isLifetimeExpiry("2100-12-30")).toBe(true);
    expect(isLifetimeExpiry("2098-12-31")).toBe(false);
  });

  it("groupDigits แบ่งกลุ่มละ 4", () => {
    expect(groupDigits("97058698")).toBe("9705 8698");
    expect(groupDigits("766232")).toBe("7662 32");
    expect(groupDigits("1234")).toBe("1234");
    expect(groupDigits("")).toBe("");
  });
});

describe("licenseView", () => {
  const today = "2026-11-16";
  it("active ที่ยังไม่หมดอายุ", () => {
    expect(licenseView({ status: "active", expiresAt: "2026-12-16" }, today)).toEqual({
      status: "active",
      lifetime: false,
      daysRemaining: 30,
    });
    expect(licenseView({ status: "active", expiresAt: today }, today).status).toBe("active");
  });
  it("active แต่เลยวันหมดอายุ → แสดง expired", () => {
    expect(licenseView({ status: "active", expiresAt: "2026-11-15" }, today)).toEqual({
      status: "expired",
      lifetime: false,
      daysRemaining: 0,
    });
  });
  it("ตลอดชีพ", () => {
    expect(licenseView({ status: "active", expiresAt: "9999-01-01" }, today)).toEqual({
      status: "active",
      lifetime: true,
      daysRemaining: null,
    });
  });
  it("สถานะอื่นคงเดิม", () => {
    expect(licenseView({ status: "pending", expiresAt: "2026-11-01" }, today).status).toBe("pending");
    expect(licenseView({ status: "suspended", expiresAt: "2027-11-01" }, today).status).toBe("suspended");
  });
});
