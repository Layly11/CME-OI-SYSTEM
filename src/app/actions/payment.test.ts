import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirectTarget } from "@/test/next-redirect";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/dal", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/purchase/repo", () => ({ getOrder: vi.fn() }));
vi.mock("@/lib/payment/mark-paid", () => ({ markOrderPaid: vi.fn() }));
vi.mock("@/lib/license/activation-block", () => ({ getPaymentBlock: vi.fn() }));

import { getSessionUser } from "@/lib/auth/dal";
import { getPaymentBlock } from "@/lib/license/activation-block";
import { markOrderPaid } from "@/lib/payment/mark-paid";
import { purchaseMessages, purchaseSystemError } from "@/lib/purchase/messages";
import { getOrder } from "@/lib/purchase/repo";
import { confirmMockPaymentAction, startCheckoutAction } from "./payment";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "c@example.com", name: null, role: "customer" as const };
const ORDER = "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f";
const ORDER_PATH = `/account/orders/${ORDER}`;

const order = (status: string, over: Record<string, unknown> = {}) =>
  ({ id: ORDER, orderNo: 1001, amountThb: 9900, packageName: "รายปี", packageCode: "yearly", status, ...over }) as Awaited<
    ReturnType<typeof getOrder>
  >;
/** คำสั่งซื้อแพ็กเกจฟรีจากการชวนเพื่อน — ไม่มีขั้นชำระเงิน */
const freeOrder = (status: string) => order(status, { amountThb: 0, packageName: "ฟรี 1 เดือน", packageCode: "free_referral" });

/** เรียกแบบที่ useActionState เรียกจริง: มี state เดิมและ FormData ต่อท้าย (action ต้องไม่อ่าน) */
const callWithForm = (action: (orderId: string) => Promise<unknown>, orderId: string, fd: FormData) =>
  (action as (orderId: string, prev: unknown, fd: FormData) => Promise<unknown>)(orderId, { ok: false }, fd);

beforeEach(() => {
  vi.mocked(getSessionUser).mockReset().mockResolvedValue(USER);
  vi.mocked(getOrder).mockReset().mockResolvedValue(order("pending_payment"));
  vi.mocked(markOrderPaid).mockReset().mockResolvedValue({ ok: true, orderId: ORDER, alreadyPaid: false });
  vi.mocked(getPaymentBlock).mockReset().mockResolvedValue(null);
  vi.stubEnv("PAYMENT_PROVIDER", "mock");
  vi.stubEnv("PAYMENT_MOCK_ALLOW_IN_PRODUCTION", "");
  vi.stubEnv("LICENSE_STORAGE", "local");
  vi.stubEnv("FIREBASE_LICENSE_PATH", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ทุก action ตรวจ session เอง", () => {
  const actions: [string, () => Promise<unknown>][] = [
    ["startCheckoutAction", () => startCheckoutAction(ORDER)],
    ["confirmMockPaymentAction", () => confirmMockPaymentAction(ORDER)],
  ];

  it.each(actions)("%s: ไม่ได้ล็อกอิน → ไป /login และไม่แตะคำสั่งซื้อ", async (_name, run) => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    expect(await redirectTarget(run)).toBe("/login");
    expect(getOrder).not.toHaveBeenCalled();
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it.each(actions)("%s: ตรวจ session ไม่ได้ → ข้อความระบบขัดข้อง ไม่ทำงานต่อ", async (_name, run) => {
    vi.mocked(getSessionUser).mockRejectedValue(new Error("db down"));
    expect(await run()).toEqual({ ok: false, formError: purchaseSystemError });
    expect(getOrder).not.toHaveBeenCalled();
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it.each(actions)("%s: id ที่ไม่ใช่ UUID → ไม่ถึงฐานข้อมูล", async (name) => {
    const action = name === "startCheckoutAction" ? startCheckoutAction : confirmMockPaymentAction;
    expect(await action("1 or 1=1")).toEqual({ ok: false, formError: purchaseMessages.order_not_found });
    expect(getOrder).not.toHaveBeenCalled();
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it.each(actions)("%s: คำสั่งซื้อของคนอื่น/ไม่มีอยู่ → order_not_found และไม่บันทึกการชำระ", async (_name, run) => {
    vi.mocked(getOrder).mockResolvedValue(null);
    expect(await run()).toEqual({ ok: false, formError: purchaseMessages.order_not_found });
    expect(getOrder).toHaveBeenCalledWith(USER.id, ORDER);
    expect(markOrderPaid).not.toHaveBeenCalled();
  });
});

describe("startCheckoutAction", () => {
  it("mock: พาไปหน้าจำลองของคำสั่งซื้อนั้น — ยังไม่บันทึกว่าชำระ", async () => {
    expect(await redirectTarget(() => startCheckoutAction(ORDER))).toBe(`${ORDER_PATH}/mock-pay`);
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it.each([
    ["ไม่ได้ตั้ง PAYMENT_PROVIDER", { PAYMENT_PROVIDER: "" }],
    ["ค่าไม่รู้จัก", { PAYMENT_PROVIDER: "stripe" }],
    ["mock ใน production โดยไม่มี flag", { NODE_ENV: "production" }],
    ["mock กับรายชื่อ license จริง", { LICENSE_STORAGE: "firebase", FIREBASE_LICENSE_PATH: "CME_Data/Customer Data/Data" }],
  ])("%s → payment_unavailable", async (_name, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect(await startCheckoutAction(ORDER)).toEqual({ ok: false, formError: purchaseMessages.payment_unavailable });
  });

  // แท็บค้าง: คืนแค่ข้อความ หน้าจะไม่ render ใหม่และยังโชว์ปุ่มชำระ → ต้อง redirect ให้หน้าคำสั่งซื้อแสดงสถานะจริง
  it.each(["awaiting_review", "paid", "cancelled", "refunded"])(
    "สถานะ %s (ชำระไม่ได้แล้ว) → กลับหน้าคำสั่งซื้อ ไม่ไปหน้าชำระ ไม่ถามผู้ให้บริการ",
    async (status) => {
      vi.mocked(getOrder).mockResolvedValue(order(status));
      expect(await redirectTarget(() => startCheckoutAction(ORDER))).toBe(ORDER_PATH);
      expect(getPaymentBlock).not.toHaveBeenCalled();
      expect(markOrderPaid).not.toHaveBeenCalled();
    },
  );

  it.each(["lifetime_active", "license_suspended"] as const)(
    "บัญชี MT5 ของคำสั่งซื้อรับการต่ออายุไม่ได้แล้ว (%s) → ไม่พาไปชำระ กลับหน้าคำสั่งซื้อ",
    async (reason) => {
      vi.mocked(getPaymentBlock).mockResolvedValue(reason);
      expect(await redirectTarget(() => startCheckoutAction(ORDER))).toBe(ORDER_PATH);
      expect(getPaymentBlock).toHaveBeenCalledTimes(1);
    },
  );

  it("ตรวจบัญชี MT5 ไม่ได้ (ฐานข้อมูลล่ม) → ข้อความระบบขัดข้อง ไม่พาไปชำระ", async () => {
    vi.mocked(getPaymentBlock).mockRejectedValue(new Error("db down"));
    expect(await startCheckoutAction(ORDER)).toEqual({ ok: false, formError: purchaseSystemError });
  });

  it("สลิปไม่ผ่าน (rejected) → ชำระด้วยบัตรได้", async () => {
    vi.mocked(getOrder).mockResolvedValue(order("rejected"));
    expect(await redirectTarget(() => startCheckoutAction(ORDER))).toBe(`${ORDER_PATH}/mock-pay`);
  });
});

describe("confirmMockPaymentAction", () => {
  it("สำเร็จ: บันทึกด้วย (orderId, mock, mock-<orderId>) เท่านั้น แล้วกลับหน้าคำสั่งซื้อ", async () => {
    expect(await redirectTarget(() => confirmMockPaymentAction(ORDER))).toBe(ORDER_PATH);
    expect(getOrder).toHaveBeenCalledWith(USER.id, ORDER);
    expect(markOrderPaid).toHaveBeenCalledTimes(1);
    expect(markOrderPaid).toHaveBeenCalledWith(ORDER, "mock", `mock-${ORDER}`);
  });

  it("ช่องในฟอร์ม (เลขบัตร, cvv, ยอดเงิน, orderId อื่น) ไม่ถูกอ่านเลย", async () => {
    const fd = new FormData();
    const get = vi.spyOn(fd, "get");
    const getAll = vi.spyOn(fd, "getAll");
    const entries = vi.spyOn(fd, "entries");
    for (const [k, v] of Object.entries({ cardNumber: "4111111111111111", cvv: "123", amountThb: "1", orderId: "x" })) {
      fd.set(k, v);
    }
    expect(await redirectTarget(() => callWithForm(confirmMockPaymentAction, ORDER, fd))).toBe(ORDER_PATH);
    expect(get).not.toHaveBeenCalled();
    expect(getAll).not.toHaveBeenCalled();
    expect(entries).not.toHaveBeenCalled();
    expect(markOrderPaid).toHaveBeenCalledWith(ORDER, "mock", `mock-${ORDER}`);
    expect(JSON.stringify(vi.mocked(markOrderPaid).mock.calls)).not.toContain("4111");
  });

  it.each([
    ["ไม่ได้ตั้ง PAYMENT_PROVIDER", { PAYMENT_PROVIDER: "" }],
    ["ค่าไม่รู้จัก", { PAYMENT_PROVIDER: "stripe" }],
    ["production โดยไม่มี flag", { NODE_ENV: "production" }],
    ["production flag ไม่ตรงตัว", { NODE_ENV: "production", PAYMENT_MOCK_ALLOW_IN_PRODUCTION: "TRUE" }],
    ["รายชื่อ license จริง", { LICENSE_STORAGE: "firebase", FIREBASE_LICENSE_PATH: "CME_Data/Customer Data/Data" }],
  ])("mock ปิดอยู่ (%s) → payment_unavailable, ไม่อ่านคำสั่งซื้อ ไม่บันทึกการชำระ", async (_name, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect(await confirmMockPaymentAction(ORDER)).toEqual({ ok: false, formError: purchaseMessages.payment_unavailable });
    expect(getOrder).not.toHaveBeenCalled();
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it("production + flag true + เก็บรายชื่อในเครื่อง → ใช้ได้", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENT_MOCK_ALLOW_IN_PRODUCTION", "true");
    expect(await redirectTarget(() => confirmMockPaymentAction(ORDER))).toBe(ORDER_PATH);
    expect(markOrderPaid).toHaveBeenCalledTimes(1);
  });

  it("ชำระแล้ว (กดซ้ำ/เปิดหน้าค้างไว้) → กลับหน้าคำสั่งซื้อโดยไม่บันทึกซ้ำ", async () => {
    vi.mocked(getOrder).mockResolvedValue(order("paid"));
    expect(await redirectTarget(() => confirmMockPaymentAction(ORDER))).toBe(ORDER_PATH);
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it.each(["awaiting_review", "cancelled", "refunded"])("สถานะ %s → order_not_payable ไม่บันทึก", async (status) => {
    vi.mocked(getOrder).mockResolvedValue(order(status));
    expect(await confirmMockPaymentAction(ORDER)).toEqual({ ok: false, formError: purchaseMessages.order_not_payable });
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it.each(["lifetime_active", "license_suspended"] as const)(
    "บัญชี MT5 รับการต่ออายุไม่ได้แล้ว (%s) → ไม่บันทึกการชำระ ตอบข้อความเดียวกับตอนสั่งซื้อ",
    async (reason) => {
      vi.mocked(getPaymentBlock).mockResolvedValue(reason);
      expect(await confirmMockPaymentAction(ORDER)).toEqual({ ok: false, formError: purchaseMessages[reason] });
      expect(markOrderPaid).not.toHaveBeenCalled();
    },
  );

  it("markOrderPaid ปฏิเสธ/ล้ม → ข้อความไทย ไม่ redirect", async () => {
    vi.mocked(markOrderPaid).mockResolvedValue({ ok: false, reason: "order_not_payable" });
    expect(await confirmMockPaymentAction(ORDER)).toEqual({ ok: false, formError: purchaseMessages.order_not_payable });
    vi.mocked(markOrderPaid).mockResolvedValue({ ok: false, reason: "payment_ref_conflict" });
    expect(await confirmMockPaymentAction(ORDER)).toEqual({ ok: false, formError: purchaseSystemError });
    vi.mocked(markOrderPaid).mockRejectedValue(new Error("mock refused"));
    expect(await confirmMockPaymentAction(ORDER)).toEqual({ ok: false, formError: purchaseSystemError });
  });
});

describe("แพ็กเกจฟรีจากการชวนเพื่อนไม่ผ่านขั้นชำระเงิน", () => {
  it.each(["pending_payment", "rejected", "paid", "cancelled"])(
    "startCheckoutAction: คำสั่งซื้อแพ็กเกจฟรี (%s) → กลับหน้าคำสั่งซื้อ ไม่ไปหน้าชำระ ไม่ถามผู้ให้บริการ",
    async (status) => {
      vi.mocked(getOrder).mockResolvedValue(freeOrder(status));
      expect(await redirectTarget(() => startCheckoutAction(ORDER))).toBe(ORDER_PATH);
      expect(getPaymentBlock).not.toHaveBeenCalled();
      expect(markOrderPaid).not.toHaveBeenCalled();
    },
  );

  it.each(["pending_payment", "rejected", "paid", "cancelled"])(
    "confirmMockPaymentAction: คำสั่งซื้อแพ็กเกจฟรี (%s) → order_not_payable ไม่บันทึกการชำระจำลอง",
    async (status) => {
      vi.mocked(getOrder).mockResolvedValue(freeOrder(status));
      expect(await confirmMockPaymentAction(ORDER)).toEqual({ ok: false, formError: purchaseMessages.order_not_payable });
      expect(markOrderPaid).not.toHaveBeenCalled();
    },
  );
});
