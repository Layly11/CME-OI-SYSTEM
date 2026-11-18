import { describe, expect, it } from "vitest";
import { getPaymentInfo, safeExternalUrl, siteOriginFromEnv } from "./config";

describe("getPaymentInfo", () => {
  const full = { PAYMENT_BANK_NAME: "ธนาคารตัวอย่าง", PAYMENT_ACCOUNT_NAME: "บจก. ตัวอย่าง", PAYMENT_ACCOUNT_NUMBER: "000-0-00000-0" };

  it("ครบ 3 ค่า → คืนข้อมูล, PromptPay ไม่บังคับ", () => {
    expect(getPaymentInfo(full)).toEqual({
      bankName: "ธนาคารตัวอย่าง",
      accountName: "บจก. ตัวอย่าง",
      accountNumber: "000-0-00000-0",
      promptPayId: null,
    });
    expect(getPaymentInfo({ ...full, PAYMENT_PROMPTPAY_ID: " 0000000000 " })?.promptPayId).toBe("0000000000");
  });

  it.each(["PAYMENT_BANK_NAME", "PAYMENT_ACCOUNT_NAME", "PAYMENT_ACCOUNT_NUMBER"])("ขาด %s → null", (key) => {
    expect(getPaymentInfo({ ...full, [key]: undefined })).toBeNull();
    expect(getPaymentInfo({ ...full, [key]: "   " })).toBeNull();
  });

  it("env ว่าง → null", () => {
    expect(getPaymentInfo({})).toBeNull();
  });
});

describe("safeExternalUrl", () => {
  it("รับ http/https", () => {
    expect(safeExternalUrl("https://broker.example/open?ib=123")).toBe("https://broker.example/open?ib=123");
    expect(safeExternalUrl(" http://broker.example ")).toBe("http://broker.example/");
  });
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "ftp://x", "//broker.example", "/local", "not a url", "", "   "])(
    "ปฏิเสธ %j",
    (v) => {
      expect(safeExternalUrl(v)).toBeNull();
    },
  );
  it("undefined / null → null", () => {
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});

describe("siteOriginFromEnv (NEXT_PUBLIC_SITE_URL → ต้นทางของลิงก์ชวนเพื่อน)", () => {
  it("คืนเฉพาะ origin ของ URL แบบ http/https", () => {
    expect(siteOriginFromEnv("https://cmeoi.example/th/?x=1")).toBe("https://cmeoi.example");
    expect(siteOriginFromEnv(" http://localhost:3000 ")).toBe("http://localhost:3000");
  });

  it("ไม่ได้ตั้ง / ไม่ใช่ URL / scheme อื่น → null (หน้าเว็บใช้ origin ของเบราว์เซอร์แทน)", () => {
    for (const v of [undefined, null, "", "   ", "cmeoi.example", "javascript:alert(1)", "ftp://x.example"]) {
      expect(siteOriginFromEnv(v), String(v)).toBeNull();
    }
  });
});
