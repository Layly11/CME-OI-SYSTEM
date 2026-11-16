import { describe, expect, it } from "vitest";
import {
  buildSlipKey,
  extForMime,
  isSlipMime,
  isValidSlipKey,
  MAX_SLIP_BYTES,
  sniffSlipType,
  validateSlip,
} from "./slip-file";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...new TextEncoder().encode(p)] : p)));

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], "....JFIF");
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "....IHDR");
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ");
const PDF = bytes("%PDF-1.7\n");

const ORDER = "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f";
const FILE = "0b7e1c52-1111-4222-8333-444455556666";

describe("sniffSlipType / validateSlip", () => {
  it("รู้จัก 4 ชนิดจากไบต์ต้นไฟล์", () => {
    expect(sniffSlipType(JPEG)).toBe("image/jpeg");
    expect(sniffSlipType(PNG)).toBe("image/png");
    expect(sniffSlipType(WEBP)).toBe("image/webp");
    expect(sniffSlipType(PDF)).toBe("application/pdf");
    expect(validateSlip(PNG)).toEqual({ ok: true, mime: "image/png" });
  });

  it.each([
    ["HTML ที่ตั้งชื่อ .jpg", bytes("<!doctype html><script>alert(1)</script>")],
    ["SVG", bytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')],
    ["ไฟล์ .exe (MZ)", bytes("MZ", [0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0])],
    ["RIFF ที่ไม่ใช่ WEBP (WAV)", bytes("RIFF", [0x24, 0, 0, 0], "WAVEfmt ")],
    ["GIF", bytes("GIF89a", [1, 0, 1, 0])],
    ["JPEG ถูกตัดเหลือ 2 ไบต์", bytes([0xff, 0xd8])],
    ["PNG ถูกตัด", bytes([0x89, 0x50, 0x4e, 0x47])],
    ["RIFF ถูกตัดก่อนถึง WEBP", bytes("RIFF", [0x24, 0, 0, 0], "WE")],
    ["ข้อความธรรมดา", bytes("id97058698.2027.01.01")],
  ])("ปฏิเสธ: %s", (_name, data) => {
    expect(sniffSlipType(data)).toBeNull();
    expect(validateSlip(data)).toEqual({ ok: false, reason: "bad_type" });
  });

  it("ไฟล์ว่าง → empty", () => {
    expect(validateSlip(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
  });

  it("เกิน 4 MiB → too_large แม้ต้นไฟล์ถูกชนิด และพอดี 4 MiB ผ่าน", () => {
    const big = new Uint8Array(MAX_SLIP_BYTES + 1);
    big.set(PNG);
    expect(validateSlip(big)).toEqual({ ok: false, reason: "too_large" });
    const exact = new Uint8Array(MAX_SLIP_BYTES);
    exact.set(PNG);
    expect(validateSlip(exact)).toEqual({ ok: true, mime: "image/png" });
  });
});

describe("key ของสลิป", () => {
  it("extForMime / isSlipMime", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("application/pdf")).toBe("pdf");
    expect(isSlipMime("image/webp")).toBe(true);
    expect(isSlipMime("image/svg+xml")).toBe(false);
    expect(isSlipMime("text/html")).toBe(false);
  });

  it("buildSlipKey → <orderId>/<uuid>.<ext> และผ่าน isValidSlipKey", () => {
    const key = buildSlipKey(ORDER, FILE.toUpperCase(), "image/png");
    expect(key).toBe(`${ORDER}/${FILE}.png`);
    expect(isValidSlipKey(key)).toBe(true);
  });

  it("buildSlipKey โยน error เมื่อ id ไม่ใช่ uuid", () => {
    expect(() => buildSlipKey("../../etc", FILE, "image/png")).toThrow();
    expect(() => buildSlipKey(ORDER, "passwd", "image/png")).toThrow();
  });

  it.each([
    `../${ORDER}/${FILE}.png`,
    `${ORDER}/../${FILE}.png`,
    `${ORDER}/${FILE}.png/..`,
    `${ORDER}/${FILE}.html`,
    `${ORDER}/${FILE}.svg`,
    `${ORDER}/${FILE}`,
    `${ORDER}\\${FILE}.png`,
    `/${ORDER}/${FILE}.png`,
    `${ORDER}/${FILE}.png\n`,
    `${ORDER}/${FILE}.png\0.jpg`,
    `${ORDER}/slip.png`,
    "",
  ])("isValidSlipKey ปฏิเสธ %j", (key) => {
    expect(isValidSlipKey(key)).toBe(false);
  });

  it("isValidSlipKey ปฏิเสธค่าที่ไม่ใช่ string", () => {
    expect(isValidSlipKey(null)).toBe(false);
    expect(isValidSlipKey(undefined)).toBe(false);
    expect(isValidSlipKey(123)).toBe(false);
  });
});
