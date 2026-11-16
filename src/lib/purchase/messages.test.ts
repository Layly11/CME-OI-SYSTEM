import { describe, expect, it } from "vitest";
import { PURCHASE_REASONS, purchaseMessages, purchaseSystemError } from "./messages";

describe("purchaseMessages", () => {
  it("ทุก reason code มีข้อความภาษาไทย", () => {
    for (const reason of PURCHASE_REASONS) {
      expect(purchaseMessages[reason], reason).toMatch(/[฀-๿]/);
    }
    expect(Object.keys(purchaseMessages).sort()).toEqual([...PURCHASE_REASONS].sort());
  });

  it("ข้อความหลักตรงตามที่ตกลง", () => {
    expect(purchaseMessages.account_number_invalid).toBe("เลขบัญชี MT5 ต้องเป็นตัวเลขล้วน 4–20 หลัก และไม่ขึ้นต้นด้วย 0");
    expect(purchaseMessages.account_number_mismatch).toBe("เลขบัญชีทั้งสองช่องไม่ตรงกัน");
    expect(purchaseMessages.taken).toBe(
      "เลขบัญชีนี้ถูกลงทะเบียนในระบบแล้ว หากเป็นบัญชีของคุณ กรุณาติดต่อทีมงานทาง LINE",
    );
    expect(purchaseMessages.duplicate_own).toBe("คุณเพิ่มเลขบัญชีนี้ไว้แล้ว");
    expect(purchaseMessages.package_unavailable).toBe("แพ็กเกจนี้ยังไม่เปิดขายออนไลน์ กรุณาสอบถามราคาทาง LINE");
    expect(purchaseMessages.bad_type).toBe("รองรับเฉพาะไฟล์ JPG, PNG, WebP หรือ PDF");
    expect(purchaseMessages.too_large).toBe("ไฟล์ต้องมีขนาดไม่เกิน 4 MB");
    expect(purchaseMessages.slip_not_allowed).toBe("คำสั่งซื้อนี้แนบสลิปไม่ได้ในสถานะปัจจุบัน");
    expect(purchaseMessages.account_has_open_order).toBe("บัญชีนี้มีคำสั่งซื้อที่รอดำเนินการอยู่แล้ว");
  });

  it("ไม่มีคำการันตีกำไรหรือคำขอรหัสผ่าน MT5", () => {
    const all = Object.values(purchaseMessages).join(" ") + purchaseSystemError;
    expect(all).not.toMatch(/กำไร|การันตี|รับประกัน|win rate|รวย/i);
    expect(all).not.toMatch(/รหัสผ่าน/);
  });
});
