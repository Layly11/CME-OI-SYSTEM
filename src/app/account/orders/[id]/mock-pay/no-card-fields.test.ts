import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * กฎเหล็ก: ข้อมูลบัตรต้องไม่ผ่านและไม่ถูกเก็บในระบบเรา — หน้าจำลองการชำระเงินจึงต้องไม่มีช่องกรอกใดๆ
 * เทสนี้อ่านซอร์สของหน้าและฟอร์ม กันคนเพิ่มช่องกรอก (โดยเฉพาะเลขบัตร/วันหมดอายุ/CVV) โดยไม่ตั้งใจ
 */
const dir = path.join(process.cwd(), "src/app/account/orders/[id]/mock-pay");
const files = ["page.tsx", "mock-pay-form.tsx"];

describe("หน้าจำลองการชำระเงิน", () => {
  it.each(files)("%s ไม่มีช่องกรอกข้อมูล และไม่มีคำที่เกี่ยวกับช่องข้อมูลบัตร", (file) => {
    const source = readFileSync(path.join(dir, file), "utf8");
    expect(source).not.toMatch(/<input\b|<Input\b|<textarea\b|<select\b|<Select\b/);
    expect(source).not.toMatch(/card.?number|cvv|cvc|expiry|เลขบัตร|autocomplete="cc-|autoComplete="cc-/i);
  });

  it("หน้าเพจมีป้ายโหมดทดสอบตรงตามที่ตกลง และบอกว่าไม่ตัดเงินจริง", () => {
    const page = readFileSync(path.join(dir, "page.tsx"), "utf8");
    expect(page).toContain("จำลองการชำระเงิน (โหมดทดสอบ)");
    expect(page).toContain("ไม่มีการตัดเงินจริง");
    expect(page).toContain("ไม่มีช่องกรอกข้อมูลบัตร");
  });

  it("action ของหน้านี้และปุ่มเริ่มชำระ ไม่อ่านข้อมูลฟอร์มเลย", () => {
    const actions = readFileSync(path.join(process.cwd(), "src/app/actions/payment.ts"), "utf8");
    expect(actions).not.toMatch(/formData|FormData/);
  });
});
