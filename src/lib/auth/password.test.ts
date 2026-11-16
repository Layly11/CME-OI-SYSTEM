import { describe, expect, it } from "vitest";
import { authMessages } from "./messages";
import {
  checkPasswordPolicy,
  DEFAULT_SCRYPT_PARAMS,
  hashPassword,
  needsRehash,
  passwordPolicyMessage,
  verifyPassword,
} from "./password";

// พารามิเตอร์เบาที่สุดที่ verifyPassword ยังยอมรับ — ให้เทสเร็ว
const FAST = { n: 16384, r: 8, p: 1 };

describe("hashPassword / verifyPassword", () => {
  it("รูปแบบที่เก็บ: scrypt$n=…,r=…,p=…$salt$hash", async () => {
    const stored = await hashPassword("correct horse", FAST);
    expect(stored).toMatch(/^scrypt\$n=16384,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(stored).not.toContain("correct horse");
  });

  it("ค่าเริ่มต้นคือ N=32768 r=8 p=3", async () => {
    expect(DEFAULT_SCRYPT_PARAMS).toEqual({ n: 32768, r: 8, p: 3 });
    const stored = await hashPassword("correct horse");
    expect(stored.startsWith("scrypt$n=32768,r=8,p=3$")).toBe(true);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(needsRehash(stored)).toBe(false);
  });

  it("รหัสถูกผ่าน รหัสผิดไม่ผ่าน", async () => {
    const stored = await hashPassword("correct horse", FAST);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("correct horsE", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salt ไม่ซ้ำกัน รหัสเดียวกันได้แฮชต่างกัน", async () => {
    const a = await hashPassword("same password", FAST);
    const b = await hashPassword("same password", FAST);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("แฮชถูกแก้ไข → false", async () => {
    const stored = await hashPassword("correct horse", FAST);
    const parts = stored.split("$");
    const flipped = parts[3][0] === "A" ? "B" : "A";
    const tamperedHash = [parts[0], parts[1], parts[2], flipped + parts[3].slice(1)].join("$");
    expect(await verifyPassword("correct horse", tamperedHash)).toBe(false);
    const otherSalt = [parts[0], parts[1], "AAAAAAAAAAAAAAAAAAAAAA", parts[3]].join("$");
    expect(await verifyPassword("correct horse", otherSalt)).toBe(false);
  });

  it("แฮชผิดรูปแบบ → false ไม่ throw", async () => {
    for (const bad of [
      "",
      "plain-text",
      "scrypt$",
      "scrypt$n=16384,r=8,p=1$salt",
      "scrypt$n=16384,r=8,p=1$$",
      "bcrypt$n=16384,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "scrypt$n=abc,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "scrypt$n=16384,r=8,p=1$AAAA AAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ]) {
      await expect(verifyPassword("x", bad)).resolves.toBe(false);
    }
    // @ts-expect-error ทดสอบค่าที่ไม่ใช่ string
    await expect(verifyPassword("x", null)).resolves.toBe(false);
  });

  it("พารามิเตอร์นอกขอบเขต → false (ไม่ยอมคำนวณ)", async () => {
    const tail = "$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    for (const params of [
      "n=8192,r=8,p=1", // n ต่ำกว่า 2^14
      "n=262144,r=8,p=1", // n สูงกว่า 2^17
      "n=20000,r=8,p=1", // n ไม่ใช่กำลังของ 2
      "n=16384,r=16,p=1", // r ต้องเป็น 8
      "n=16384,r=8,p=6", // p เกิน 5
      "n=16384,r=8,p=0",
    ]) {
      await expect(verifyPassword("x", `scrypt$${params}${tail}`)).resolves.toBe(false);
    }
    // แฮชจริงที่สร้างด้วยค่าต่ำกว่าขอบเขตก็ถูกปฏิเสธ
    const weak = await hashPassword("correct horse", { n: 1024, r: 8, p: 1 });
    expect(await verifyPassword("correct horse", weak)).toBe(false);
  });

  it("normalise แบบ NFKC: พิมพ์ต่างรูปแบบ Unicode ก็ตรงกัน", async () => {
    const composed = "café-รหัสผ่าน";
    const decomposed = "café-รหัสผ่าน";
    expect(composed).not.toBe(decomposed);
    const stored = await hashPassword(composed, FAST);
    expect(await verifyPassword(decomposed, stored)).toBe(true);
    // ตัวเลขเต็มความกว้าง → ตัวเลขปกติ
    const wide = await hashPassword("pass１２３４word", FAST);
    expect(await verifyPassword("pass1234word", wide)).toBe(true);
  });

  it("needsRehash", async () => {
    expect(needsRehash(await hashPassword("correct horse", FAST))).toBe(true);
    expect(needsRehash("garbage")).toBe(true);
    expect(needsRehash("")).toBe(true);
  });
});

describe("checkPasswordPolicy", () => {
  const email = "somchai@example.com";

  it("ผ่านเมื่อยาว 8–128 ตัว ไม่บังคับผสมตัวอักษร", () => {
    expect(checkPasswordPolicy("ทองคำขึ้นลง", email)).toBeNull();
    expect(checkPasswordPolicy("aaaaaaab", email)).toBeNull();
    expect(checkPasswordPolicy("x".repeat(128), email)).toBeNull();
  });

  it("สั้นเกิน", () => {
    expect(checkPasswordPolicy("", email)).toBe("passwordTooShort");
    expect(checkPasswordPolicy("1234567", email)).toBe("passwordTooShort");
  });

  it("ยาวเกิน", () => {
    expect(checkPasswordPolicy("x".repeat(129), email)).toBe("passwordTooLong");
  });

  it("เหมือนอีเมลหรือส่วนหน้า @ (ไม่สนตัวพิมพ์)", () => {
    expect(checkPasswordPolicy("somchai@example.com", email)).toBe("passwordSameAsEmail");
    expect(checkPasswordPolicy("Somchai@Example.COM", email)).toBe("passwordSameAsEmail");
    expect(checkPasswordPolicy("SOMCHAI1", "somchai1@example.com")).toBe("passwordSameAsEmail");
    expect(checkPasswordPolicy("somchai1x", "somchai1@example.com")).toBeNull();
    // อีเมลว่าง/ผิดรูปแบบไม่ทำให้พัง
    expect(checkPasswordPolicy("goodpassword", "")).toBeNull();
  });

  it("อยู่ในรายการรหัสที่เดาง่าย", () => {
    expect(checkPasswordPolicy("password", email)).toBe("passwordTooCommon");
    expect(checkPasswordPolicy("PASSWORD", email)).toBe("passwordTooCommon");
    expect(checkPasswordPolicy("12345678", email)).toBe("passwordTooCommon");
    expect(checkPasswordPolicy("qwerty123", email)).toBe("passwordTooCommon");
  });

  it("ทุกรหัสข้อผิดพลาดมีข้อความไทย", () => {
    expect(passwordPolicyMessage("passwordTooShort")).toBe("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
    expect(passwordPolicyMessage("passwordTooLong")).toBe("รหัสผ่านยาวเกินไป (ไม่เกิน 128 ตัวอักษร)");
    expect(passwordPolicyMessage("passwordTooCommon")).toBe("รหัสผ่านนี้เดาง่ายเกินไป กรุณาตั้งใหม่");
    expect(passwordPolicyMessage("passwordSameAsEmail")).toBe(authMessages.passwordSameAsEmail);
  });
});
