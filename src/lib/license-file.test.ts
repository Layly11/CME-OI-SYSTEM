import { describe, expect, it } from "vitest";
import {
  buildLicenseFile,
  computeNewExpiry,
  daysRemaining,
  diffLicenseFiles,
  formatEntry,
  isEntryActive,
  LIFETIME_EXPIRY,
  parseEntry,
  parseLicenseFile,
} from "./license-file";

// ตัวอย่างจากไฟล์จริงของลูกค้า (ถ่ายจากหน้าจอ)
const SAMPLE =
  "id26763436.2100.12.30,id50357499.2027.06.21,id135111136.2027.06.25,id97087346.2027.05.06," +
  "id97086328.2027.05.12,id97088021.2027.05.19,id50354004.2027.05.19,id97087296.2027.05.19," +
  "id97086577.2027.06.07,id320019789.2099.09.09,id97086397.2027.07.01,id766232.2027.07.02," +
  "id737832.2027.07.10,id97085702.2027.07.17,id97089206.2027.07.23,id97089335.2027.07.24," +
  "id25881267.2100.05.12,id752439.2027.08.14,id780258.2027.09.19";

describe("formatEntry", () => {
  it("สร้างรายการตรงรูปแบบเดิม id<บัญชี>.<ปี>.<เดือน>.<วัน>", () => {
    expect(formatEntry({ accountNumber: "766232", expiresAt: "2027-07-02" })).toBe(
      "id766232.2027.07.02",
    );
  });

  it("ตลอดชีพใช้ 9999.01.01", () => {
    expect(formatEntry({ accountNumber: "97058698", expiresAt: LIFETIME_EXPIRY })).toBe(
      "id97058698.9999.01.01",
    );
  });

  it("ปฏิเสธเลขบัญชีที่ไม่ใช่ตัวเลข", () => {
    expect(() => formatEntry({ accountNumber: "76 6232", expiresAt: "2027-07-02" })).toThrow();
    expect(() => formatEntry({ accountNumber: "", expiresAt: "2027-07-02" })).toThrow();
  });
});

describe("parseEntry", () => {
  it("อ่านรายการจริงได้ถูกต้อง", () => {
    expect(parseEntry("id766232.2027.07.02")).toMatchObject({
      accountNumber: "766232",
      expiresAt: "2027-07-02",
      isLifetime: false,
    });
  });

  it("ถือว่าปี 2099/2100/9999 เป็นตลอดชีพ", () => {
    expect(parseEntry("id320019789.2099.09.09")?.isLifetime).toBe(true);
    expect(parseEntry("id26763436.2100.12.30")?.isLifetime).toBe(true);
    expect(parseEntry("id1.9999.01.01")?.isLifetime).toBe(true);
  });

  it("ปฏิเสธรูปแบบผิดและวันที่ไม่มีจริง", () => {
    expect(parseEntry("766232.2027.07.02")).toBeNull(); // ไม่มี id
    expect(parseEntry("id766232.2027-07-02")).toBeNull(); // ใช้ขีดแทนจุด
    expect(parseEntry("id766232.2027.13.01")).toBeNull(); // เดือน 13
    expect(parseEntry("id766232.2027.02.30")).toBeNull(); // 30 ก.พ.
    expect(parseEntry("idabc.2027.07.02")).toBeNull();
  });
});

describe("parseLicenseFile", () => {
  it("อ่านไฟล์ตัวอย่างได้ครบทุกรายการ ไม่มีปัญหา", () => {
    const { entries, issues } = parseLicenseFile(SAMPLE);
    expect(issues).toEqual([]);
    expect(entries).toHaveLength(19);
    expect(entries.find((e) => e.accountNumber === "766232")?.expiresAt).toBe("2027-07-02");
  });

  it("ทนต่อขึ้นบรรทัดใหม่ ช่องว่าง คอมมาซ้ำ และ BOM", () => {
    const messy = "﻿id1.2027.01.01,\n id2.2027.01.02 ,,\r\nid3.2027.01.03\n";
    const { entries, issues } = parseLicenseFile(messy);
    expect(issues).toEqual([]);
    expect(entries.map((e) => e.accountNumber)).toEqual(["1", "2", "3"]);
  });

  it("รายงานรายการผิดและเลขบัญชีซ้ำแทนการทิ้งทั้งไฟล์", () => {
    const { entries, issues } = parseLicenseFile("id1.2027.01.01,garbage,id1.2028.01.01");
    expect(entries).toHaveLength(1);
    expect(issues).toHaveLength(2);
    expect(issues[0].raw).toBe("garbage");
    expect(issues[1].reason).toContain("ซ้ำ");
  });
});

describe("buildLicenseFile", () => {
  it("round-trip: อ่านไฟล์จริงแล้วสร้างใหม่ได้รายการครบเท่าเดิม", () => {
    const parsed = parseLicenseFile(SAMPLE).entries;
    const rebuilt = buildLicenseFile(parsed, { sort: false });
    expect(rebuilt).toBe(SAMPLE);
  });

  it("ค่าเริ่มต้นเรียงตามเลขบัญชี ไม่มีช่องว่าง ไม่มีบรรทัดใหม่ท้ายไฟล์", () => {
    const out = buildLicenseFile([
      { accountNumber: "97086397", expiresAt: "2027-07-01" },
      { accountNumber: "766232", expiresAt: "2027-07-02" },
    ]);
    expect(out).toBe("id766232.2027.07.02,id97086397.2027.07.01");
    expect(out.endsWith("\n")).toBe(false);
    expect(out.includes(" ")).toBe(false);
  });

  it("เลขบัญชีซ้ำ เก็บวันหมดอายุที่ไกลที่สุด", () => {
    const out = buildLicenseFile([
      { accountNumber: "766232", expiresAt: "2027-07-02" },
      { accountNumber: "766232", expiresAt: "2028-07-02" },
    ]);
    expect(out).toBe("id766232.2028.07.02");
  });

  it("มีรายการผิดแม้รายการเดียว ต้องไม่สร้างไฟล์", () => {
    expect(() =>
      buildLicenseFile([
        { accountNumber: "766232", expiresAt: "2027-07-02" },
        { accountNumber: "x", expiresAt: "2027-07-02" },
      ]),
    ).toThrow();
  });
});

describe("active / expiry calculations", () => {
  it("วันหมดอายุยังนับเป็นวันที่ใช้ได้", () => {
    const e = { accountNumber: "1", expiresAt: "2027-07-02" };
    expect(isEntryActive(e, "2027-07-02")).toBe(true);
    expect(isEntryActive(e, "2027-07-03")).toBe(false);
    expect(daysRemaining(e, "2027-06-25")).toBe(7);
    expect(daysRemaining({ accountNumber: "1", expiresAt: LIFETIME_EXPIRY }, "2027-06-25")).toBe(
      Infinity,
    );
  });

  it("ต่ออายุก่อนหมด: นับต่อจากวันหมดอายุเดิม", () => {
    expect(computeNewExpiry(30, "2027-07-02", "2027-06-20")).toBe("2027-08-01");
  });

  it("ต่ออายุหลังหมด หรือซื้อใหม่: นับจากวันนี้", () => {
    expect(computeNewExpiry(30, "2027-05-01", "2027-06-20")).toBe("2027-07-20");
    expect(computeNewExpiry(365, null, "2026-11-09")).toBe("2027-11-09");
  });

  it("ตลอดชีพ", () => {
    expect(computeNewExpiry(null, "2027-07-02", "2027-06-20")).toBe(LIFETIME_EXPIRY);
  });
});

describe("diffLicenseFiles", () => {
  it("แยกรายการเพิ่ม/ลบ/เปลี่ยนวันหมดอายุ", () => {
    const before = "id1.2027.01.01,id2.2027.01.01,id3.2027.01.01";
    const after = "id1.2027.01.01,id2.2028.01.01,id4.2027.01.01";
    const d = diffLicenseFiles(before, after);
    expect(d.added.map((e) => e.accountNumber)).toEqual(["4"]);
    expect(d.removed.map((e) => e.accountNumber)).toEqual(["3"]);
    expect(d.changed).toEqual([{ accountNumber: "2", from: "2027-01-01", to: "2028-01-01" }]);
  });
});
