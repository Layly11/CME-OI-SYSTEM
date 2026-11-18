import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirectTarget } from "@/test/next-redirect";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/dal", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeRateLimit: vi.fn() }));
vi.mock("@/lib/purchase/repo", () => ({
  attachMt5AccountToOrder: vi.fn(),
  cancelOrder: vi.fn(),
  checkAccountNumber: vi.fn(),
  chooseBrokerForOrder: vi.fn(),
  createOrder: vi.fn(),
  deleteMt5Account: vi.fn(),
  getOrder: vi.fn(),
  insertMt5Account: vi.fn(),
  recordSlip: vi.fn(),
  submitAccountForOrder: vi.fn(),
}));
vi.mock("@/lib/slip-storage", () => ({ getSlipStorage: vi.fn() }));
vi.mock("@/lib/license/fulfil", () => ({ fulfilOrder: vi.fn() }));

import { RATE_LIMITS } from "@/lib/auth/constants";
import { getSessionUser } from "@/lib/auth/dal";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { userKey } from "@/lib/auth/rate-limit-core";
import { fulfilOrder } from "@/lib/license/fulfil";
import { purchaseMessages, purchaseSystemError } from "@/lib/purchase/messages";
import * as repo from "@/lib/purchase/repo";
import { getSlipStorage } from "@/lib/slip-storage";
import {
  addMt5AccountAction,
  attachAccountAction,
  cancelOrderAction,
  chooseBrokerAction,
  createOrderAction,
  deleteMt5AccountAction,
  retryActivationAction,
  uploadSlipAction,
  type Mt5FormState,
} from "./purchase";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "c@example.com", name: null, role: "customer" as const };
const ORDER = "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f";
const ACCOUNT = "0b7e1c52-1111-4222-8333-444455556666";
const PACKAGE = "5a5a5a5a-2222-4333-8444-555566667777";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const LICENSE = "9c9c9c9c-3333-4444-8555-666677778888";
const FULFILLED = {
  activation: { status: "activated", licenseId: LICENSE, expiresAt: "2027-11-16", kind: "new" },
  publish: { status: "published", publicationId: "pub-1", entryCount: 1 },
} as const;
const storage = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
const mt5Initial: Mt5FormState = { ok: false, step: "edit" };

function form(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const mt5Form = (intent: string, accountNumber = "97058698") =>
  form({ intent, accountNumber, accountNumberConfirm: accountNumber, brokerServer: "Broker-Live", label: "" });
const slipForm = (file: File = new File([PNG], "slip.png", { type: "image/png" })) =>
  form({ paymentMethod: "bank_transfer", slip: file });

const repoMocks = Object.values(repo).map((fn) => vi.mocked(fn as (...args: unknown[]) => unknown));

beforeEach(() => {
  vi.mocked(getSessionUser).mockReset().mockResolvedValue(USER);
  vi.mocked(consumeRateLimit).mockReset().mockResolvedValue({ allowed: true });
  for (const fn of repoMocks) fn.mockReset();
  for (const fn of Object.values(storage)) fn.mockReset().mockResolvedValue(undefined);
  vi.mocked(getSlipStorage).mockReset().mockReturnValue(storage);
  vi.mocked(fulfilOrder).mockReset().mockResolvedValue(FULFILLED);
  vi.spyOn(console, "error").mockImplementation(() => {});
  // เทสสลิปด้านล่างรันในโหมดที่เปิดช่องทางโอนเงิน (ค่าเริ่มต้นของระบบคือปิด — มีเทสแยก)
  vi.stubEnv("PAYMENT_BANK_TRANSFER_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ทุก action ตรวจ session เอง", () => {
  const actions: [string, () => Promise<unknown>][] = [
    ["addMt5AccountAction", () => addMt5AccountAction(ORDER, mt5Initial, mt5Form("confirm"))],
    ["chooseBrokerAction", () => chooseBrokerAction(ORDER, { ok: false }, form({ brokerCode: "hfm" }))],
    ["createOrderAction", () => createOrderAction({ ok: false }, form({ packageId: PACKAGE }))],
    ["attachAccountAction", () => attachAccountAction(ORDER, { ok: false }, form({ mt5AccountId: ACCOUNT }))],
    ["uploadSlipAction", () => uploadSlipAction(ORDER, { ok: false }, slipForm())],
    ["cancelOrderAction", () => cancelOrderAction(ORDER)],
    ["deleteMt5AccountAction", () => deleteMt5AccountAction(ACCOUNT)],
    ["retryActivationAction", () => retryActivationAction(ORDER)],
  ];

  it.each(actions)("%s: ไม่ได้ล็อกอิน → ไป /login และไม่แตะฐานข้อมูล/ที่เก็บไฟล์", async (_name, run) => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    expect(await redirectTarget(run)).toBe("/login");
    for (const fn of repoMocks) expect(fn).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(fulfilOrder).not.toHaveBeenCalled();
  });

  it.each(actions)("%s: ตรวจ session ไม่ได้ → ข้อความระบบขัดข้อง ไม่ทำงานต่อ", async (_name, run) => {
    vi.mocked(getSessionUser).mockRejectedValue(new Error("db down"));
    expect(await run()).toMatchObject({ ok: false, formError: purchaseSystemError });
    for (const fn of repoMocks) expect(fn).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    expect(fulfilOrder).not.toHaveBeenCalled();
  });
});

describe("addMt5AccountAction", () => {
  const paidOrder = (over: Record<string, unknown> = {}) =>
    ({ id: ORDER, status: "paid", mt5AccountId: null, partnerBrokerCode: "hfm", ...over }) as Awaited<
      ReturnType<typeof repo.getOrder>
    >;
  beforeEach(() => {
    vi.mocked(repo.getOrder).mockResolvedValue(paidOrder());
  });

  it.each([null, "../../admin", ""])("ไม่มีคำสั่งซื้อ (orderId=%j) → order_required ทุกขั้น และไม่แตะฐานข้อมูล", async (orderId) => {
    for (const intent of ["review", "confirm"]) {
      const state = await addMt5AccountAction(orderId, mt5Initial, mt5Form(intent));
      expect(state).toMatchObject({ ok: false, step: "edit", formError: purchaseMessages.order_required });
    }
    for (const fn of repoMocks) expect(fn).not.toHaveBeenCalled();
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it("ขั้นทวน: ตรวจคำสั่งซื้อของผู้ใช้ จำกัดจำนวนครั้ง แล้วถามว่าเลขว่างหรือไม่ — ยังไม่บันทึก", async () => {
    vi.mocked(repo.checkAccountNumber).mockResolvedValue("free");
    const state = await addMt5AccountAction(ORDER, mt5Initial, mt5Form("review"));
    expect(state).toMatchObject({ ok: false, step: "review" });
    expect(repo.getOrder).toHaveBeenCalledWith(USER.id, ORDER);
    expect(consumeRateLimit).toHaveBeenCalledWith(userKey(USER.id), RATE_LIMITS.mt5Check);
    expect(repo.checkAccountNumber).toHaveBeenCalledWith(USER.id, "97058698");
    expect(repo.submitAccountForOrder).not.toHaveBeenCalled();
    expect(repo.insertMt5Account).not.toHaveBeenCalled();
  });

  it.each([
    ["คำสั่งซื้อของคนอื่น/ไม่มีอยู่", null, "order_not_found"],
    ["ยังไม่ชำระ", { status: "pending_payment" }, "order_not_paid"],
    ["รอตรวจสลิป", { status: "awaiting_review" }, "order_not_paid"],
    ["ยกเลิกแล้ว", { status: "cancelled" }, "order_not_paid"],
    ["มีบัญชีแล้ว", { mt5AccountId: ACCOUNT }, "order_has_account"],
    ["ยังไม่เลือกโบรกเกอร์", { partnerBrokerCode: null }, "broker_required"],
  ] as const)("ขั้นทวน: %s → ไม่ถามว่าเลขว่างหรือไม่", async (_name, over, reason) => {
    vi.mocked(repo.getOrder).mockResolvedValue(over === null ? null : paidOrder(over));
    const state = await addMt5AccountAction(ORDER, mt5Initial, mt5Form("review"));
    expect(state).toMatchObject({ ok: false, step: "edit", formError: purchaseMessages[reason] });
    expect(repo.checkAccountNumber).not.toHaveBeenCalled();
    expect(repo.submitAccountForOrder).not.toHaveBeenCalled();
  });

  it.each(["review", "confirm"])("เกินเพดาน (ขั้น %s) → แจ้งให้รอ และไม่ตอบว่าเลขนั้นมีคนใช้หรือยัง", async (intent) => {
    vi.mocked(consumeRateLimit).mockResolvedValue({ allowed: false });
    const state = await addMt5AccountAction(ORDER, mt5Initial, mt5Form(intent));
    expect(state).toMatchObject({ ok: false, step: "edit", formError: purchaseMessages.mt5_check_rate_limited });
    expect(state.fieldErrors).toBeUndefined();
    expect(repo.checkAccountNumber).not.toHaveBeenCalled();
    expect(repo.submitAccountForOrder).not.toHaveBeenCalled();
  });

  it("ฟอร์มไม่ผ่านการตรวจ → ไม่กินโควตาและไม่แตะฐานข้อมูล", async () => {
    const state = await addMt5AccountAction(ORDER, mt5Initial, mt5Form("review", "0123"));
    expect(state.fieldErrors?.accountNumber).toBe(purchaseMessages.account_number_invalid);
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(repo.checkAccountNumber).not.toHaveBeenCalled();
    expect(repo.getOrder).not.toHaveBeenCalled();
  });

  it("เลขของคนอื่น → ข้อความ taken ที่ช่องเลขบัญชี", async () => {
    vi.mocked(repo.checkAccountNumber).mockResolvedValue("taken");
    const state = await addMt5AccountAction(ORDER, mt5Initial, mt5Form("review"));
    expect(state).toMatchObject({ step: "edit", fieldErrors: { accountNumber: purchaseMessages.taken } });
  });

  it("ขั้นยืนยัน: บันทึกผ่าน submitAccountForOrder ด้วย userId จาก session แล้วกลับหน้าคำสั่งซื้อ", async () => {
    vi.mocked(repo.submitAccountForOrder).mockResolvedValue({ ok: true, accountId: ACCOUNT });
    const fd = mt5Form("confirm");
    fd.set("password", "mt5-secret");
    fd.set("partnerBrokerCode", "cxm");
    expect(await redirectTarget(() => addMt5AccountAction(ORDER, mt5Initial, fd))).toBe(`/account/orders/${ORDER}`);
    expect(repo.submitAccountForOrder).toHaveBeenCalledTimes(1);
    // ส่งเฉพาะ 3 ช่องของบัญชี — โบรกเกอร์คัดลอกจากคำสั่งซื้อในฐานข้อมูล ไม่รับจากฟอร์ม
    expect(repo.submitAccountForOrder).toHaveBeenCalledWith(USER.id, ORDER, {
      accountNumber: "97058698",
      brokerServer: "Broker-Live",
      label: undefined,
    });
    expect(repo.insertMt5Account).not.toHaveBeenCalled();
    // บัญชีผูกแล้ว → เปิด license ทันที (ครั้งเดียว ด้วย id คำสั่งซื้อที่ตรวจแล้ว)
    expect(fulfilOrder).toHaveBeenCalledTimes(1);
    expect(fulfilOrder).toHaveBeenCalledWith(ORDER, { trigger: "account" });
  });

  it.each([
    ["เผยแพร่รายชื่อล้ม", { activation: FULFILLED.activation, publish: { status: "failed", error: "storage down" } }],
    ["คิวเผยแพร่ไม่ว่าง", { activation: FULFILLED.activation, publish: { status: "busy" } }],
    ["เปิด license ไม่ได้", { activation: { status: "error" }, publish: null }],
    ["ถูกกัน", { activation: { status: "blocked", reason: "license_suspended" }, publish: null }],
  ] as const)("ขั้นยืนยัน: ขั้นเปิด license รายงานว่า%s → ยัง redirect ไปหน้าคำสั่งซื้อ (ไม่ใช่ error)", async (_name, outcome) => {
    vi.mocked(repo.submitAccountForOrder).mockResolvedValue({ ok: true, accountId: ACCOUNT });
    vi.mocked(fulfilOrder).mockResolvedValue(outcome);
    expect(await redirectTarget(() => addMt5AccountAction(ORDER, mt5Initial, mt5Form("confirm")))).toBe(
      `/account/orders/${ORDER}`,
    );
  });

  it("ขั้นทวน / repo ปฏิเสธ → ไม่เรียกขั้นเปิด license", async () => {
    vi.mocked(repo.checkAccountNumber).mockResolvedValue("free");
    await addMt5AccountAction(ORDER, mt5Initial, mt5Form("review"));
    vi.mocked(repo.submitAccountForOrder).mockResolvedValue({ ok: false, reason: "taken" });
    await addMt5AccountAction(ORDER, mt5Initial, mt5Form("confirm"));
    expect(fulfilOrder).not.toHaveBeenCalled();
  });

  it.each([
    ["taken", "field"],
    ["duplicate_own", "field"],
    ["order_not_found", "form"],
    ["order_not_paid", "form"],
    ["order_has_account", "form"],
    ["broker_required", "form"],
    ["too_many_accounts", "form"],
  ] as const)("ขั้นยืนยัน: repo ปฏิเสธด้วย %s → ข้อความไทย ไม่ redirect", async (reason, where) => {
    vi.mocked(repo.submitAccountForOrder).mockResolvedValue({ ok: false, reason });
    const state = await addMt5AccountAction(ORDER, mt5Initial, mt5Form("confirm"));
    expect(state).toMatchObject({ ok: false, step: "edit" });
    // เลขของตัวเอง: ไม่ใช่ทางตัน — ข้อความบอกให้กลับไปเลือกบัญชีนั้นในหน้าคำสั่งซื้อ
    const expected = reason === "duplicate_own" ? purchaseMessages.duplicate_own_use_existing : purchaseMessages[reason];
    if (where === "field") expect(state.fieldErrors?.accountNumber).toBe(expected);
    else expect(state.formError).toBe(expected);
  });

  it("ขั้นทวน: เลขที่ตัวเองลงทะเบียนไว้แล้ว → บอกทางไปต่อ (ใช้บัญชีที่ลงทะเบียนไว้แล้ว) ไม่ใช่แค่ \"เพิ่มไว้แล้ว\"", async () => {
    vi.mocked(repo.checkAccountNumber).mockResolvedValue("duplicate_own");
    const state = await addMt5AccountAction(ORDER, mt5Initial, mt5Form("review"));
    expect(state).toMatchObject({ ok: false, step: "edit" });
    expect(state.fieldErrors?.accountNumber).toBe(purchaseMessages.duplicate_own_use_existing);
    expect(state.fieldErrors?.accountNumber).toContain("ใช้บัญชี MT5 ที่ลงทะเบียนไว้แล้ว");
    expect(repo.submitAccountForOrder).not.toHaveBeenCalled();
  });
});

describe("chooseBrokerAction", () => {
  it("บันทึก code ที่อยู่ในรายชื่อด้วย userId จาก session — ช่องอื่นในฟอร์มถูกทิ้ง", async () => {
    vi.mocked(repo.chooseBrokerForOrder).mockResolvedValue({ ok: true });
    const fd = form({ brokerCode: "hfm", registerUrl: "https://evil.example/", userId: "someone-else" });
    expect(await redirectTarget(() => chooseBrokerAction(ORDER, { ok: false }, fd))).toBe(`/account/orders/${ORDER}`);
    expect(repo.chooseBrokerForOrder).toHaveBeenCalledWith(USER.id, ORDER, "hfm");
  });

  it.each(["", "HFM", "unknown", "__proto__", "https://evil.example/"])("code %j ไม่อยู่ในรายชื่อ → ไม่ถึงฐานข้อมูล", async (brokerCode) => {
    const state = await chooseBrokerAction(ORDER, { ok: false }, form({ brokerCode }));
    expect(state).toEqual({ ok: false, fieldErrors: { brokerCode: purchaseMessages.broker_invalid } });
    expect(repo.chooseBrokerForOrder).not.toHaveBeenCalled();
  });

  it("id ที่ไม่ใช่ UUID / repo ปฏิเสธ → ข้อความของ reason", async () => {
    expect(await chooseBrokerAction("x", { ok: false }, form({ brokerCode: "hfm" }))).toEqual({
      ok: false,
      formError: purchaseMessages.order_not_found,
    });
    expect(repo.chooseBrokerForOrder).not.toHaveBeenCalled();
    for (const reason of ["order_not_found", "order_not_paid", "order_has_account"] as const) {
      vi.mocked(repo.chooseBrokerForOrder).mockResolvedValue({ ok: false, reason });
      expect(await chooseBrokerAction(ORDER, { ok: false }, form({ brokerCode: "hfm" }))).toEqual({
        ok: false,
        formError: purchaseMessages[reason],
      });
    }
  });
});

describe("attachAccountAction", () => {
  it("ผูกด้วย userId จาก session — license ถูกระงับ → ข้อความที่ช่องบัญชี", async () => {
    vi.mocked(repo.attachMt5AccountToOrder).mockResolvedValue({ ok: true });
    expect(await redirectTarget(() => attachAccountAction(ORDER, { ok: false }, form({ mt5AccountId: ACCOUNT })))).toBe(
      `/account/orders/${ORDER}`,
    );
    expect(repo.attachMt5AccountToOrder).toHaveBeenCalledWith(USER.id, ORDER, ACCOUNT);

    expect(fulfilOrder).toHaveBeenCalledTimes(1);
    expect(fulfilOrder).toHaveBeenCalledWith(ORDER, { trigger: "account" });

    vi.mocked(fulfilOrder).mockClear();
    vi.mocked(repo.attachMt5AccountToOrder).mockResolvedValue({ ok: false, reason: "license_suspended" });
    const state = await attachAccountAction(ORDER, { ok: false }, form({ mt5AccountId: ACCOUNT }));
    expect(state.fieldErrors?.mt5AccountId).toBe(purchaseMessages.license_suspended);
    expect(fulfilOrder).not.toHaveBeenCalled();
  });

  it("ขั้นเปิด license รายงานว่าเผยแพร่ล้ม → ยัง redirect ไปหน้าคำสั่งซื้อ", async () => {
    vi.mocked(repo.attachMt5AccountToOrder).mockResolvedValue({ ok: true });
    vi.mocked(fulfilOrder).mockResolvedValue({ activation: FULFILLED.activation, publish: { status: "failed", error: "x" } });
    expect(await redirectTarget(() => attachAccountAction(ORDER, { ok: false }, form({ mt5AccountId: ACCOUNT })))).toBe(
      `/account/orders/${ORDER}`,
    );
  });
});

describe("retryActivationAction", () => {
  const order = (over: Record<string, unknown> = {}) =>
    ({ id: ORDER, status: "paid", mt5AccountId: ACCOUNT, ...over }) as Awaited<ReturnType<typeof repo.getOrder>>;
  beforeEach(() => {
    vi.mocked(repo.getOrder).mockResolvedValue(order());
  });

  it("คำสั่งซื้อของตัวเองที่ชำระแล้วและมีบัญชี → ลองเปิดใช้งานใหม่ สำเร็จแล้วกลับหน้าคำสั่งซื้อ", async () => {
    expect(await redirectTarget(() => retryActivationAction(ORDER))).toBe(`/account/orders/${ORDER}`);
    expect(repo.getOrder).toHaveBeenCalledWith(USER.id, ORDER);
    expect(consumeRateLimit).toHaveBeenCalledWith(userKey(USER.id), RATE_LIMITS.activationRetry);
    expect(fulfilOrder).toHaveBeenCalledWith(ORDER, { trigger: "retry" });
  });

  it("เปิดไปแล้วและรายชื่อไม่เปลี่ยน (unchanged) ก็ถือว่าสำเร็จ", async () => {
    vi.mocked(fulfilOrder).mockResolvedValue({
      activation: { status: "already_activated", licenseId: LICENSE, expiresAt: "2027-11-16" },
      publish: { status: "unchanged", entryCount: 1 },
    });
    expect(await redirectTarget(() => retryActivationAction(ORDER))).toBe(`/account/orders/${ORDER}`);
  });

  it.each([
    ["id ไม่ใช่ UUID", "x", order(), "order_not_found"],
    ["คำสั่งซื้อของคนอื่น/ไม่มีอยู่", ORDER, null, "order_not_found"],
    ["ยังไม่ชำระ", ORDER, order({ status: "pending_payment" }), "order_not_paid"],
    ["ยกเลิกแล้ว", ORDER, order({ status: "cancelled" }), "order_not_paid"],
    ["ยังไม่มีบัญชี", ORDER, order({ mt5AccountId: null }), "account_required"],
  ] as const)("%s → ไม่เรียกขั้นเปิด license และไม่กินโควตา", async (_name, id, found, reason) => {
    vi.mocked(repo.getOrder).mockResolvedValue(found);
    expect(await retryActivationAction(id)).toEqual({ ok: false, formError: purchaseMessages[reason] });
    expect(fulfilOrder).not.toHaveBeenCalled();
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it("เกินเพดาน → แจ้งให้รอ ไม่เรียกขั้นเปิด license", async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({ allowed: false });
    expect(await retryActivationAction(ORDER)).toEqual({
      ok: false,
      formError: purchaseMessages.activation_retry_rate_limited,
    });
    expect(fulfilOrder).not.toHaveBeenCalled();
  });

  it.each(["license_suspended", "lifetime_active", "mock_payment"] as const)(
    "ถูกกัน (%s) → กลับหน้าคำสั่งซื้อ (หน้าแสดงสถานะ \"เปิดใช้งานอัตโนมัติไม่ได้\" เอง) ไม่ต่อข้อความใต้ประกาศกำลังเปิดใช้งาน",
    async (reason) => {
      vi.mocked(fulfilOrder).mockResolvedValue({ activation: { status: "blocked", reason }, publish: null });
      expect(await redirectTarget(() => retryActivationAction(ORDER))).toBe(`/account/orders/${ORDER}`);
    },
  );

  it.each([
    ["activation_pending", { activation: FULFILLED.activation, publish: { status: "failed", error: "storage down 12345678" } }],
    ["activation_pending", { activation: FULFILLED.activation, publish: { status: "busy" } }],
    ["activation_pending", { activation: { status: "error" }, publish: null }],
    ["activation_pending", { activation: { status: "not_ready", reason: "not_paid" }, publish: null }],
  ] as const)("ยังไม่สำเร็จ → ข้อความ %s (ไม่ redirect ไม่เผยรายละเอียด error)", async (reason, outcome) => {
    vi.mocked(fulfilOrder).mockResolvedValue(outcome);
    const state = await retryActivationAction(ORDER);
    expect(state).toEqual({ ok: false, formError: purchaseMessages[reason] });
    expect(JSON.stringify(state)).not.toContain("storage down");
  });

  it("แพ็กเกจฟรีจากการชวนเพื่อน (provider referral) ที่ยังไม่สำเร็จ → ข้อความที่ไม่พูดถึงการชำระเงิน", async () => {
    vi.mocked(repo.getOrder).mockResolvedValue(order({ paymentProvider: "referral" }));
    vi.mocked(fulfilOrder).mockResolvedValue({ activation: FULFILLED.activation, publish: { status: "failed", error: "storage down" } });
    const state = await retryActivationAction(ORDER);
    expect(state).toEqual({ ok: false, formError: purchaseMessages.activation_pending_free });
    expect(state.formError).not.toMatch(/ชำระ/);
    expect(state.formError).toContain("สิทธิ์แพ็กเกจฟรี");
    // คำสั่งซื้อที่ชำระเงินจริง/จำลองยังได้ข้อความเดิม
    vi.mocked(repo.getOrder).mockResolvedValue(order({ paymentProvider: "mock" }));
    expect(await retryActivationAction(ORDER)).toEqual({ ok: false, formError: purchaseMessages.activation_pending });
  });

  it("ขั้นเปิด license throw (ไม่ควรเกิด) → ข้อความระบบขัดข้อง", async () => {
    vi.mocked(fulfilOrder).mockRejectedValue(new Error("boom"));
    expect(await retryActivationAction(ORDER)).toEqual({ ok: false, formError: purchaseSystemError });
  });
});

describe("createOrderAction", () => {
  it("ส่งให้ repo เฉพาะแพ็กเกจกับบัญชี — ราคาและ userId ในฟอร์มถูกทิ้ง", async () => {
    vi.mocked(repo.createOrder).mockResolvedValue({ ok: true, id: ORDER, existing: false });
    const fd = form({ packageId: PACKAGE, mt5AccountId: ACCOUNT, amountThb: "1", userId: "someone-else" });
    expect(await redirectTarget(() => createOrderAction({ ok: false }, fd))).toBe(`/account/orders/${ORDER}`);
    expect(repo.createOrder).toHaveBeenCalledWith(USER.id, { packageId: PACKAGE, mt5AccountId: ACCOUNT });
  });

  it("บัญชีมีคำสั่งซื้อค้างอยู่แล้ว → ไปรายการเดิมพร้อม notice ไม่ใช่ redirect เงียบๆ", async () => {
    const fd = form({ packageId: PACKAGE, mt5AccountId: ACCOUNT });
    vi.mocked(repo.createOrder).mockResolvedValue({ ok: true, id: ORDER, existing: true, samePackage: false });
    expect(await redirectTarget(() => createOrderAction({ ok: false }, fd))).toBe(
      `/account/orders/${ORDER}?notice=other-package`,
    );
    vi.mocked(repo.createOrder).mockResolvedValue({ ok: true, id: ORDER, existing: true, samePackage: true });
    expect(await redirectTarget(() => createOrderAction({ ok: false }, fd))).toBe(
      `/account/orders/${ORDER}?notice=existing`,
    );
  });

  it.each(["lifetime_active", "license_suspended", "free_account_used"] as const)("%s → ข้อความที่ช่องบัญชี", async (reason) => {
    vi.mocked(repo.createOrder).mockResolvedValue({ ok: false, reason });
    const state = await createOrderAction({ ok: false }, form({ packageId: PACKAGE, mt5AccountId: ACCOUNT }));
    expect(state.fieldErrors?.mt5AccountId).toBe(purchaseMessages[reason]);
    expect(fulfilOrder).not.toHaveBeenCalled();
  });

  it("คำสั่งซื้อปกติ (ต้องชำระเงิน) → ไม่เรียกขั้นเปิด license ตอนสร้าง", async () => {
    vi.mocked(repo.createOrder).mockResolvedValue({ ok: true, id: ORDER, existing: false });
    await redirectTarget(() => createOrderAction({ ok: false }, form({ packageId: PACKAGE })));
    expect(fulfilOrder).not.toHaveBeenCalled();
  });

  it("แพ็กเกจฟรี (freeClaim): รับสิทธิ์แล้ว → เรียกขั้นเปิด license ต่อทันที แล้วไปหน้าคำสั่งซื้อ (ไม่มีขั้นชำระเงิน)", async () => {
    vi.mocked(repo.createOrder).mockResolvedValue({ ok: true, id: ORDER, existing: false, freeClaim: true });
    expect(await redirectTarget(() => createOrderAction({ ok: false }, form({ packageId: PACKAGE, mt5AccountId: ACCOUNT })))).toBe(
      `/account/orders/${ORDER}`,
    );
    expect(fulfilOrder).toHaveBeenCalledTimes(1);
    expect(fulfilOrder).toHaveBeenCalledWith(ORDER, { trigger: "payment" });
  });

  it("แพ็กเกจฟรีที่รับสิทธิ์ไว้แล้ว (existing) → ไปรายการเดิม ไม่เรียกขั้นเปิด license ซ้ำจากที่นี่", async () => {
    vi.mocked(repo.createOrder).mockResolvedValue({ ok: true, id: ORDER, existing: true, samePackage: true });
    expect(await redirectTarget(() => createOrderAction({ ok: false }, form({ packageId: PACKAGE })))).toBe(
      `/account/orders/${ORDER}?notice=existing`,
    );
    expect(fulfilOrder).not.toHaveBeenCalled();
  });

  it.each(["free_referral_required", "free_already_claimed", "package_unavailable"] as const)(
    "%s (รวมคำขอที่สร้างเองโดยไม่ผ่านฟอร์ม) → ข้อความที่ช่องแพ็กเกจ ไม่ redirect ไม่เปิด license",
    async (reason) => {
      vi.mocked(repo.createOrder).mockResolvedValue({ ok: false, reason });
      const state = await createOrderAction({ ok: false }, form({ packageId: PACKAGE }));
      expect(state).toMatchObject({ ok: false, fieldErrors: { packageId: purchaseMessages[reason] } });
      expect(fulfilOrder).not.toHaveBeenCalled();
    },
  );
});

describe("uploadSlipAction", () => {
  const order = (status: string) => ({ id: ORDER, status }) as Awaited<ReturnType<typeof repo.getOrder>>;

  it.each([undefined, "", "TRUE", "1"])(
    "ช่องทางโอนเงินปิด (PAYMENT_BANK_TRANSFER_ENABLED=%j) → bank_transfer_disabled ก่อนแตะคำสั่งซื้อ/ไฟล์",
    async (flag) => {
      vi.stubEnv("PAYMENT_BANK_TRANSFER_ENABLED", flag as string);
      vi.mocked(repo.getOrder).mockResolvedValue(order("pending_payment"));
      expect(await uploadSlipAction(ORDER, { ok: false }, slipForm())).toEqual({
        ok: false,
        formError: purchaseMessages.bank_transfer_disabled,
      });
      expect(repo.getOrder).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
      expect(repo.recordSlip).not.toHaveBeenCalled();
    },
  );

  it("คำสั่งซื้อของคนอื่น/ไม่มีอยู่ → order_not_found และไม่เขียนไฟล์", async () => {
    vi.mocked(repo.getOrder).mockResolvedValue(null);
    expect(await uploadSlipAction(ORDER, { ok: false }, slipForm())).toMatchObject({
      formError: purchaseMessages.order_not_found,
    });
    expect(repo.getOrder).toHaveBeenCalledWith(USER.id, ORDER);
    expect(storage.put).not.toHaveBeenCalled();
    expect(repo.recordSlip).not.toHaveBeenCalled();
  });

  it.each(["awaiting_review", "paid", "cancelled", "refunded"])("สถานะ %s → แนบสลิปไม่ได้ และไม่เขียนไฟล์", async (status) => {
    vi.mocked(repo.getOrder).mockResolvedValue(order(status));
    expect(await uploadSlipAction(ORDER, { ok: false }, slipForm())).toMatchObject({
      formError: purchaseMessages.slip_not_allowed,
    });
    expect(storage.put).not.toHaveBeenCalled();
    expect(repo.recordSlip).not.toHaveBeenCalled();
  });

  it("ที่เก็บสลิปปิดอยู่ (SLIP_STORAGE=disabled) → บอกให้ส่งทาง LINE", async () => {
    vi.mocked(repo.getOrder).mockResolvedValue(order("pending_payment"));
    vi.mocked(getSlipStorage).mockReturnValue(null);
    expect(await uploadSlipAction(ORDER, { ok: false }, slipForm())).toMatchObject({
      formError: purchaseMessages.slip_upload_unavailable,
    });
    expect(repo.recordSlip).not.toHaveBeenCalled();
  });

  it("ไฟล์ที่ไม่ใช่รูป/PDF (ตัดสินจากไบต์จริง ไม่ใช่ชื่อไฟล์) → bad_type และไม่เขียนไฟล์", async () => {
    vi.mocked(repo.getOrder).mockResolvedValue(order("pending_payment"));
    const html = new File(["<script>alert(1)</script>"], "slip.png", { type: "image/png" });
    const state = await uploadSlipAction(ORDER, { ok: false }, slipForm(html));
    expect(state.fieldErrors?.slip).toBe(purchaseMessages.bad_type);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("สำเร็จ: เขียนไฟล์ด้วย key ที่ระบบสร้างเอง แล้วบันทึกด้วย userId จาก session", async () => {
    vi.mocked(repo.getOrder).mockResolvedValue(order("pending_payment"));
    vi.mocked(repo.recordSlip).mockResolvedValue({ ok: true, previousKey: null });
    expect(await uploadSlipAction(ORDER, { ok: false }, slipForm())).toEqual({ ok: true });
    const key = storage.put.mock.calls[0][0] as string;
    expect(key).toMatch(new RegExp(`^${ORDER}/[0-9a-f-]{36}\\.png$`));
    expect(repo.recordSlip).toHaveBeenCalledWith(USER.id, ORDER, {
      key,
      mime: "image/png",
      size: PNG.length,
      paymentMethod: "bank_transfer",
    });
  });

  it("บันทึกลงคำสั่งซื้อไม่ได้ → ลบไฟล์ที่เพิ่งเขียน", async () => {
    vi.mocked(repo.getOrder).mockResolvedValue(order("rejected"));
    vi.mocked(repo.recordSlip).mockResolvedValue({ ok: false, reason: "account_has_open_order" });
    expect(await uploadSlipAction(ORDER, { ok: false }, slipForm())).toMatchObject({
      formError: purchaseMessages.account_has_open_order,
    });
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0][0]);
  });
});

describe("cancelOrderAction / deleteMt5AccountAction", () => {
  it("ใช้ userId จาก session และส่งข้อความของ reason กลับ", async () => {
    vi.mocked(repo.cancelOrder).mockResolvedValue({ ok: true, freeClaimReleased: false });
    expect(await cancelOrderAction(ORDER)).toEqual({ ok: true });
    expect(repo.cancelOrder).toHaveBeenCalledWith(USER.id, ORDER);
    vi.mocked(repo.cancelOrder).mockResolvedValue({ ok: false, reason: "order_not_cancellable" });
    expect(await cancelOrderAction(ORDER)).toEqual({ ok: false, formError: purchaseMessages.order_not_cancellable });
    // แพ็กเกจฟรีที่ยังไม่ได้เปิด license: repo ตัดสินและคืนสิทธิ์เอง — action แค่ส่งผลต่อ
    vi.mocked(repo.cancelOrder).mockResolvedValue({ ok: true, freeClaimReleased: true });
    expect(await cancelOrderAction(ORDER)).toEqual({ ok: true });

    vi.mocked(repo.deleteMt5Account).mockResolvedValue({ ok: true });
    expect(await deleteMt5AccountAction(ACCOUNT)).toEqual({ ok: true });
    expect(repo.deleteMt5Account).toHaveBeenCalledWith(USER.id, ACCOUNT);
    vi.mocked(repo.deleteMt5Account).mockResolvedValue({ ok: false, reason: "account_in_use" });
    expect(await deleteMt5AccountAction(ACCOUNT)).toEqual({ ok: false, formError: purchaseMessages.account_in_use });
  });

  it("id ที่ไม่ใช่ UUID → ไม่ถึงฐานข้อมูล", async () => {
    expect(await cancelOrderAction("1 or 1=1")).toEqual({ ok: false, formError: purchaseMessages.order_not_found });
    expect(await deleteMt5AccountAction("x")).toEqual({ ok: false, formError: purchaseMessages.account_not_found });
    expect(repo.cancelOrder).not.toHaveBeenCalled();
    expect(repo.deleteMt5Account).not.toHaveBeenCalled();
  });
});
