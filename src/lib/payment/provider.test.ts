import { describe, expect, it } from "vitest";
import { getPaymentProvider, mockPaymentRef } from "./provider";

const ORDER = { id: "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f", orderNo: 1001, amountThb: 98765, packageName: "รายปี" };

describe("getPaymentProvider", () => {
  it("ยังไม่ตั้งค่า / ค่าไม่รู้จัก / mock ถูกปฏิเสธ → null", () => {
    expect(getPaymentProvider({})).toBeNull();
    expect(getPaymentProvider({ PAYMENT_PROVIDER: "stripe" })).toBeNull();
    expect(getPaymentProvider({ PAYMENT_PROVIDER: "mock", NODE_ENV: "production" })).toBeNull();
    expect(
      getPaymentProvider({
        PAYMENT_PROVIDER: "mock",
        LICENSE_STORAGE: "firebase",
        FIREBASE_LICENSE_PATH: "CME_Data/Customer Data/Data",
      }),
    ).toBeNull();
  });

  it("mock: โหมดทดสอบ พาไปหน้าจำลองของคำสั่งซื้อนั้น — URL เป็น path ในเว็บ ไม่มียอดเงิน", async () => {
    const provider = getPaymentProvider({ PAYMENT_PROVIDER: "mock", NODE_ENV: "development" });
    expect(provider).toMatchObject({ id: "mock", testMode: true });
    const { redirectUrl } = await provider!.createCheckout(ORDER, { returnPath: `/account/orders/${ORDER.id}` });
    expect(redirectUrl).toBe(`/account/orders/${ORDER.id}/mock-pay`);
    expect(redirectUrl).not.toContain("98765");
    expect(redirectUrl).not.toMatch(/amount|\?/i);
  });
});

describe("mockPaymentRef", () => {
  it("คงที่ต่อคำสั่งซื้อ (กดซ้ำ = รายการเดิม)", () => {
    expect(mockPaymentRef(ORDER.id)).toBe(`mock-${ORDER.id}`);
    expect(mockPaymentRef(ORDER.id)).toBe(mockPaymentRef(ORDER.id));
  });
});
