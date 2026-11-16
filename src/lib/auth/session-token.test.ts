import { describe, expect, it } from "vitest";
import { generateSessionToken, hashSessionToken, isWellFormedToken } from "./session-token";

describe("session token", () => {
  it("เป็น base64url 43 ตัวอักษร (32 ไบต์)", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(isWellFormedToken(token)).toBe(true);
  });

  it("ไม่ซ้ำกัน", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateSessionToken()));
    expect(tokens.size).toBe(200);
  });

  it("hash เป็น hex 64 ตัว คงที่ต่อ token และไม่มี token อยู่ข้างใน", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hash);
    expect(hashSessionToken(generateSessionToken())).not.toBe(hash);
    expect(hash).not.toContain(token);
    expect(hashSessionToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("isWellFormedToken ปฏิเสธค่าผิดรูปแบบ", () => {
    const token = generateSessionToken();
    for (const bad of [
      "",
      token.slice(1),
      token + "A",
      token.slice(0, 42) + "+",
      token.slice(0, 42) + "/",
      token.slice(0, 42) + "=",
      token.slice(0, 42) + " ",
      token.slice(0, 42) + "\n",
      undefined,
      null,
      123,
      {},
    ]) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
  });
});
