import { describe, expect, it } from "vitest";
import {
  canAttachAccount,
  canChooseBroker,
  canOrderOnline,
  canPayByCard,
  canSubmitAccount,
  canUploadSlip,
  createOrderSchema,
  isSlipPaymentMethod,
  MAX_MT5_ACCOUNTS_PER_USER,
  MAX_OPEN_ORDERS_PER_USER,
  ORDER_STATUSES,
} from "./order-rules";

const ID = "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f";

describe("canOrderOnline", () => {
  it.each([
    [{ isActive: true, priceThb: 1500 }, true],
    [{ isActive: true, priceThb: null }, false],
    [{ isActive: true, priceThb: 0 }, false],
    [{ isActive: true, priceThb: -1 }, false],
    [{ isActive: false, priceThb: 1500 }, false],
  ])("%j → %s", (pkg, expected) => {
    expect(canOrderOnline(pkg)).toBe(expected);
  });
});

describe("สถานะคำสั่งซื้อ", () => {
  it("canUploadSlip: เฉพาะ pending_payment และ rejected", () => {
    const allowed = ORDER_STATUSES.filter((s) => canUploadSlip(s));
    expect(allowed).toEqual(["pending_payment", "rejected"]);
  });

  it("canAttachAccount: ยังไม่มีบัญชี และไม่ใช่ cancelled/refunded", () => {
    const allowed = ORDER_STATUSES.filter((s) => canAttachAccount({ mt5AccountId: null, status: s }));
    expect(allowed).toEqual(["pending_payment", "awaiting_review", "paid", "rejected"]);
  });

  it("canAttachAccount: มีบัญชีแล้วผูกซ้ำไม่ได้ทุกสถานะ", () => {
    expect(ORDER_STATUSES.some((s) => canAttachAccount({ mt5AccountId: ID, status: s }))).toBe(false);
  });

  it("canPayByCard: เฉพาะ pending_payment และ rejected (รอตรวจสลิปไม่มีปุ่มบัตร กันจ่ายซ้ำ)", () => {
    expect(ORDER_STATUSES.filter((s) => canPayByCard(s))).toEqual(["pending_payment", "rejected"]);
  });

  it("canChooseBroker: ชำระแล้วและยังไม่มีบัญชีเท่านั้น", () => {
    expect(ORDER_STATUSES.filter((s) => canChooseBroker({ status: s, mt5AccountId: null }))).toEqual(["paid"]);
    expect(ORDER_STATUSES.some((s) => canChooseBroker({ status: s, mt5AccountId: ID }))).toBe(false);
  });

  it("canSubmitAccount: ชำระแล้ว เลือกโบรกเกอร์แล้ว และยังไม่มีบัญชี", () => {
    const allowed = ORDER_STATUSES.filter((s) => canSubmitAccount({ status: s, mt5AccountId: null, partnerBrokerCode: "hfm" }));
    expect(allowed).toEqual(["paid"]);
    expect(canSubmitAccount({ status: "paid", mt5AccountId: null, partnerBrokerCode: null })).toBe(false);
    expect(canSubmitAccount({ status: "paid", mt5AccountId: ID, partnerBrokerCode: "hfm" })).toBe(false);
    expect(canSubmitAccount({ status: "pending_payment", mt5AccountId: null, partnerBrokerCode: "hfm" })).toBe(false);
  });

  it("เพดาน", () => {
    expect(MAX_MT5_ACCOUNTS_PER_USER).toBe(10);
    expect(MAX_OPEN_ORDERS_PER_USER).toBe(5);
  });
});

describe("createOrderSchema", () => {
  it("รับ packageId + mt5AccountId ที่เป็น uuid", () => {
    expect(createOrderSchema.parse({ packageId: ID, mt5AccountId: ID })).toEqual({ packageId: ID, mt5AccountId: ID });
  });
  it('mt5AccountId "" หรือไม่ส่ง → undefined', () => {
    expect(createOrderSchema.parse({ packageId: ID, mt5AccountId: "" }).mt5AccountId).toBeUndefined();
    expect(createOrderSchema.parse({ packageId: ID }).mt5AccountId).toBeUndefined();
  });
  it("id ที่ไม่ใช่ uuid ไม่ผ่าน", () => {
    expect(createOrderSchema.safeParse({ packageId: "yearly" }).success).toBe(false);
    expect(createOrderSchema.safeParse({ packageId: "" }).success).toBe(false);
    expect(createOrderSchema.safeParse({ packageId: ID, mt5AccountId: "1 or 1=1" }).success).toBe(false);
  });
  it("ไม่มีช่องราคาในผลลัพธ์ แม้ client ส่งมา", () => {
    const out = createOrderSchema.parse({ packageId: ID, amountThb: 1, priceThb: 1 } as never);
    expect(Object.keys(out).sort()).toEqual(["packageId"]);
  });
});

describe("isSlipPaymentMethod", () => {
  it("รับเฉพาะ bank_transfer / promptpay", () => {
    expect(isSlipPaymentMethod("bank_transfer")).toBe(true);
    expect(isSlipPaymentMethod("promptpay")).toBe(true);
    expect(isSlipPaymentMethod("card")).toBe(false);
    expect(isSlipPaymentMethod("")).toBe(false);
    expect(isSlipPaymentMethod(null)).toBe(false);
  });
});
