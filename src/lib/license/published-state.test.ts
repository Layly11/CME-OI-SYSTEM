import { describe, expect, it } from "vitest";
import { activationView, isLicensePublished, publishedEntryMap } from "./published-state";

const content = "id766232.2027.07.02,id97058698.9999.01.01";
const today = "2026-11-16";

describe("publishedEntryMap / isLicensePublished", () => {
  it("วันหมดอายุตรงกัน → เผยแพร่แล้ว", () => {
    const map = publishedEntryMap(content);
    expect(isLicensePublished(map, "766232", "2027-07-02")).toBe(true);
    expect(isLicensePublished(map, "97058698", "9999-01-01")).toBe(true);
  });

  it("รายชื่อยังเป็นวันหมดอายุเก่า (ต่ออายุแล้วแต่ยังไม่เผยแพร่) → ยังไม่เผยแพร่", () => {
    const map = publishedEntryMap(content);
    expect(isLicensePublished(map, "766232", "2027-08-01")).toBe(false);
    expect(isLicensePublished(map, "766232", "2027-07-01")).toBe(false);
  });

  it("เลขบัญชีไม่อยู่ในรายชื่อ / เลขที่เป็นส่วนหนึ่งของเลขอื่น → ไม่เผยแพร่", () => {
    const map = publishedEntryMap(content);
    expect(isLicensePublished(map, "12345678", "2027-07-02")).toBe(false);
    expect(isLicensePublished(map, "76623", "2027-07-02")).toBe(false);
    expect(isLicensePublished(map, "7662320", "2027-07-02")).toBe(false);
  });

  it.each([null, undefined, "", "garbage", "id12.2027.13.45", "<html>"])("เนื้อหา %j → ไม่มีรายการ", (c) => {
    const map = publishedEntryMap(c as string | null);
    expect(map.size).toBe(0);
    expect(isLicensePublished(map, "766232", "2027-07-02")).toBe(false);
  });

  it("รายการที่ผิดรูปแบบปนอยู่ไม่ทำให้รายการที่ถูกหาย", () => {
    expect(isLicensePublished(publishedEntryMap("oops,id766232.2027.07.02"), "766232", "2027-07-02")).toBe(true);
  });
});

describe("activationView", () => {
  const map = publishedEntryMap(content);

  it("ยังไม่มี license / ไม่มีเลขบัญชี → none", () => {
    expect(activationView(null, "766232", map, today)).toEqual({ kind: "none" });
    expect(activationView({ status: "active", expiresAt: "2027-07-02" }, null, map, today)).toEqual({ kind: "none" });
  });

  it("active และอยู่ในรายชื่อ → active พร้อมวันคงเหลือ / ตลอดชีพ", () => {
    expect(activationView({ status: "active", expiresAt: "2027-07-02" }, "766232", map, today)).toEqual({
      kind: "active",
      expiresAt: "2027-07-02",
      lifetime: false,
      daysRemaining: 228,
    });
    expect(activationView({ status: "active", expiresAt: "9999-01-01" }, "97058698", map, today)).toMatchObject({
      kind: "active",
      lifetime: true,
      daysRemaining: null,
    });
  });

  it("active ในฐานข้อมูลแต่รายชื่อยังไม่มี/ยังเป็นวันเก่า → pending", () => {
    expect(activationView({ status: "active", expiresAt: "2027-08-01" }, "766232", map, today)).toEqual({ kind: "pending" });
    expect(activationView({ status: "active", expiresAt: "2027-07-02" }, "555555", new Map(), today)).toEqual({ kind: "pending" });
  });

  it("หมดอายุ/ถูกระงับ → ended (ไม่ใช่กำลังเปิดใช้งาน)", () => {
    expect(activationView({ status: "active", expiresAt: "2026-11-15" }, "766232", map, today)).toEqual({ kind: "ended", status: "expired" });
    expect(activationView({ status: "suspended", expiresAt: "2027-07-02" }, "766232", map, today)).toEqual({ kind: "ended", status: "suspended" });
    expect(activationView({ status: "expired", expiresAt: "2027-07-02" }, "766232", map, today)).toEqual({ kind: "ended", status: "expired" });
  });
});
