import { describe, expect, it } from "vitest";
import { partnerBrokers } from "@/content/brokers";
import { findPartnerBroker, isPartnerBrokerCode } from "./brokers";
import { safeExternalUrl } from "./config";

describe("รายชื่อโบรกเกอร์พาร์ตเนอร์", () => {
  it("มี 6 ราย — code และลิงก์ตรงตามที่ผู้ให้บริการส่งมา (กันแก้โดยไม่ตั้งใจ: code อยู่ในฐานข้อมูล ลิงก์มีรหัส IB)", () => {
    expect(partnerBrokers.map((b) => [b.code, b.registerUrl])).toEqual([
      ["fisg", "https://my.fisg.com/register/trader?link_id=irdklcqz&referrer_id=v0cuv9zp"],
      ["cxm", "https://gocxm.io/links/go/407230"],
      ["hfm", "https://register.hfm.com/sv/en/new-live-account/?refid=371744"],
      ["kohle", "https://mt5.kohlecapital.com/th/links/go/20149"],
      ["dooprime", "https://my.dooprime.com/th/links/go/32604"],
      ["hmarkets", "https://hmarkets.com/live-account-pre-registration/?cmp=6q0c6z6k&refid=11084&ent=hm"],
    ]);
  });

  it("code ไม่ซ้ำ ทุกรายมีชื่อ และลิงก์เป็น https ที่ผ่าน safeExternalUrl โดยไม่ถูกเปลี่ยน", () => {
    expect(new Set(partnerBrokers.map((b) => b.code)).size).toBe(6);
    for (const b of partnerBrokers) {
      expect(b.name.trim().length, b.code).toBeGreaterThan(0);
      expect(b.code).toMatch(/^[a-z0-9]+$/);
      expect(new URL(b.registerUrl).protocol, b.code).toBe("https:");
      expect(safeExternalUrl(b.registerUrl), b.code).toBe(b.registerUrl);
    }
  });
});

describe("isPartnerBrokerCode", () => {
  it("รับเฉพาะ code ในรายชื่อ ตรงตัวอักษร", () => {
    for (const b of partnerBrokers) expect(isPartnerBrokerCode(b.code)).toBe(true);
    for (const v of ["", "unknown", "HFM", "Hfm", " hfm", "hfm ", "__proto__", "constructor", "toString", "0"]) {
      expect(isPartnerBrokerCode(v), v).toBe(false);
    }
    for (const v of [null, undefined, 0, 2, {}, [], ["hfm"], true]) {
      expect(isPartnerBrokerCode(v), String(v)).toBe(false);
    }
  });
});

describe("findPartnerBroker", () => {
  it("คืนรายการของ code นั้น หรือ null", () => {
    expect(findPartnerBroker("hfm")).toMatchObject({ code: "hfm", name: "HFM" });
    expect(findPartnerBroker(null)).toBeNull();
    expect(findPartnerBroker("__proto__")).toBeNull();
    expect(findPartnerBroker("removed-broker")).toBeNull();
  });
});
