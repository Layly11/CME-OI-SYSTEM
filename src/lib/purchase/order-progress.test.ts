import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, type OrderStatus } from "./order-rules";
import { orderBadgeStatus, orderStep, orderStepLabel, type OrderStep } from "./order-progress";

const ACCOUNT = "0b7e1c52-1111-4222-8333-444455556666";

const o = (status: OrderStatus, mt5AccountId: string | null = null, partnerBrokerCode: string | null = null) => ({
  status,
  mt5AccountId,
  partnerBrokerCode,
});

describe("orderStep", () => {
  it.each<[string, ReturnType<typeof o>, { published: boolean } | null, OrderStep]>([
    ["รอชำระ", o("pending_payment"), null, "pay"],
    ["รอชำระ (ต่ออายุ: มีบัญชีแล้ว)", o("pending_payment", ACCOUNT), null, "pay"],
    ["สลิปไม่ผ่าน → ชำระใหม่", o("rejected"), null, "pay"],
    ["รอตรวจสลิป (ข้อมูลเดิม)", o("awaiting_review"), null, "legacy_review"],
    ["รอตรวจสลิป มีบัญชีแล้ว", o("awaiting_review", ACCOUNT, "hfm"), null, "legacy_review"],
    ["ชำระแล้ว ยังไม่เลือกโบรกเกอร์", o("paid"), null, "choose_broker"],
    ["ชำระแล้ว เลือกโบรกเกอร์แล้ว", o("paid", null, "hfm"), null, "submit_account"],
    ["ชำระแล้ว + มีบัญชี ยังไม่มีแถว activation", o("paid", ACCOUNT, "hfm"), null, "activating"],
    ["ชำระแล้ว + มีบัญชี (ต่ออายุ ไม่ได้เลือกโบรกเกอร์)", o("paid", ACCOUNT), null, "activating"],
    ["เปิด license ใน DB แล้ว แต่ยังไม่อยู่ในรายชื่อที่เผยแพร่", o("paid", ACCOUNT, "hfm"), { published: false }, "activating"],
    ["อยู่ในรายชื่อที่เผยแพร่แล้ว", o("paid", ACCOUNT, "hfm"), { published: true }, "active"],
    ["อยู่ในรายชื่อที่เผยแพร่แล้ว (ต่ออายุ)", o("paid", ACCOUNT), { published: true }, "active"],
    ["ยกเลิก", o("cancelled"), null, "closed"],
    ["คืนเงิน (แม้เคยเปิด license)", o("refunded", ACCOUNT, "hfm"), { published: true }, "closed"],
  ])("%s", (_name, order, activation, expected) => {
    expect(orderStep(order, activation)).toBe(expected);
  });

  it("ถูกกัน (blocked) มีผลเฉพาะ: ชำระแล้ว + มีบัญชี + ยังไม่มีแถว activation", () => {
    expect(orderStep(o("paid", ACCOUNT, "hfm"), null, true)).toBe("blocked");
    expect(orderStep(o("paid", ACCOUNT), null, true)).toBe("blocked");
    // เปิด license ไปแล้ว → ไม่ใช่ blocked ไม่ว่าธงเป็นอะไร
    expect(orderStep(o("paid", ACCOUNT, "hfm"), { published: false }, true)).toBe("activating");
    expect(orderStep(o("paid", ACCOUNT, "hfm"), { published: true }, true)).toBe("active");
    // ยังไม่มีบัญชี / ยังไม่ชำระ / ปิดรายการ → ขั้นเดิม
    expect(orderStep(o("paid"), null, true)).toBe("choose_broker");
    expect(orderStep(o("paid", null, "hfm"), null, true)).toBe("submit_account");
    expect(orderStep(o("pending_payment", ACCOUNT), null, true)).toBe("pay");
    expect(orderStep(o("cancelled", ACCOUNT), null, true)).toBe("closed");
  });

  it("ไม่มีบัญชี = ไม่มีทาง activating/active แม้มีข้อมูล activation หลงมา", () => {
    expect(orderStep(o("paid"), { published: true })).toBe("choose_broker");
    expect(orderStep(o("paid", null, "hfm"), { published: true })).toBe("submit_account");
  });

  it("ยังไม่ชำระ = ไม่มีทางถึงขั้นหลังชำระ ไม่ว่ามีบัญชี/โบรกเกอร์/activation หรือไม่", () => {
    for (const status of ORDER_STATUSES.filter((s) => s !== "paid")) {
      const step = orderStep(o(status, ACCOUNT, "hfm"), { published: true });
      expect(["pay", "legacy_review", "closed"], status).toContain(step);
    }
  });
});

describe("orderStepLabel", () => {
  it("ข้อความภาษาไทยของทุกขั้น", () => {
    expect(orderStepLabel("pay")).toBe("รอชำระ");
    expect(orderStepLabel("legacy_review")).toBe("รอตรวจสลิป");
    expect(orderStepLabel("choose_broker")).toBe("ชำระแล้ว · รอเลือกโบรกเกอร์");
    expect(orderStepLabel("submit_account")).toBe("ชำระแล้ว · รอเลขบัญชี MT5");
    expect(orderStepLabel("activating")).toBe("กำลังเปิดใช้งาน");
    expect(orderStepLabel("blocked")).toBe("ชำระแล้ว · รอทีมงานตรวจสอบ");
    expect(orderStepLabel("active")).toBe("เปิดใช้งานแล้ว");
    expect(orderStepLabel("closed")).toMatch(/[฀-๿]/);
  });
});

describe("orderBadgeStatus", () => {
  const paid = { status: "paid" as const, freeClaim: false };
  const free = { status: "paid" as const, freeClaim: true };

  it("ยังไม่ชำระ/ปิดรายการ → สถานะของคำสั่งซื้อ ไม่ว่าเป็นแพ็กเกจฟรีหรือไม่", () => {
    for (const status of ["pending_payment", "awaiting_review", "rejected", "cancelled", "refunded"] as const) {
      expect(orderBadgeStatus({ status, freeClaim: false }, null, "pay")).toBe(status);
      expect(orderBadgeStatus({ status, freeClaim: true }, null, "closed")).toBe(status);
    }
  });

  it("ชำระแล้ว → ขั้นของคำสั่งซื้อ; license จบไปแล้ว → สถานะของ license; เปิดใช้งานแล้ว → order_active", () => {
    expect(orderBadgeStatus(paid, null, "choose_broker")).toBe("choose_broker");
    expect(orderBadgeStatus(paid, null, "submit_account")).toBe("submit_account");
    expect(orderBadgeStatus(paid, null, "activating")).toBe("activating");
    expect(orderBadgeStatus(paid, null, "blocked")).toBe("blocked");
    expect(orderBadgeStatus(paid, null, "active")).toBe("order_active");
    expect(orderBadgeStatus(paid, "expired", "active")).toBe("expired");
    expect(orderBadgeStatus(free, "suspended", "active")).toBe("suspended");
  });

  it("แพ็กเกจฟรีจากการชวนเพื่อน: ป้ายที่ขึ้นต้นว่า \"ชำระแล้ว\" เปลี่ยนเป็นชุด free_* (\"รับสิทธิ์แล้ว\")", () => {
    expect(orderBadgeStatus(free, null, "choose_broker")).toBe("free_choose_broker");
    expect(orderBadgeStatus(free, null, "submit_account")).toBe("free_submit_account");
    expect(orderBadgeStatus(free, null, "blocked")).toBe("free_blocked");
    expect(orderBadgeStatus(free, null, "activating")).toBe("activating");
    expect(orderBadgeStatus(free, null, "active")).toBe("order_active");
  });
});
