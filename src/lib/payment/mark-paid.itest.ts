import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb, schema } from "@/db";
import { createUser } from "@/lib/auth/users";
import { hasTestDb, resetDb } from "@/test/integration-setup";
import { markOrderPaid } from "./mark-paid";

const UNKNOWN = "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f";
// คำสั่งซื้อในไฟล์นี้ไม่มีบัญชี MT5 → ขั้นเปิด license ที่ต่อจากการชำระเงินยังไม่ทำอะไร (เทสขั้นนั้นอยู่ใน src/lib/license/*.itest.ts)
const NO_ACCOUNT = { activation: { status: "not_ready", reason: "no_account" }, publish: null };

type Status = "pending_payment" | "awaiting_review" | "paid" | "rejected" | "cancelled" | "refunded";

describe.skipIf(!hasTestDb)("markOrderPaid กับ PostgreSQL จริง", () => {
  let userId: string;
  let packageId: string;

  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("PAYMENT_PROVIDER", "mock");
    userId = (await createUser({ email: "pay@example.com", passwordHash: "scrypt$test", name: "ผู้ซื้อ" }))!.id;
    const [pkg] = await getDb()
      .insert(schema.packages)
      .values({ code: "yearly", nameTh: "รายปี", durationDays: 365, priceThb: 9900, sortOrder: 1 })
      .returning();
    packageId = pkg.id;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await closeDb();
  });

  const newOrder = async (status: Status = "pending_payment", amountThb = 9900) => {
    const [order] = await getDb().insert(schema.orders).values({ userId, packageId, amountThb, status }).returning();
    return order.id;
  };
  const row = async (id: string) => (await getDb().select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
  const audits = async (action?: string) => {
    const all = await getDb().select().from(schema.auditLogs);
    return action ? all.filter((a) => a.action === action) : all;
  };

  it("รอชำระ → ชำระแล้ว: บันทึกวิธีชำระ ผู้ให้บริการ เลขอ้างอิง เวลา และ audit (ยอดอ่านจากแถวคำสั่งซื้อ)", async () => {
    const id = await newOrder("pending_payment", 12345);
    expect(await markOrderPaid(id, "mock", `mock-${id}`)).toMatchObject({ ok: true, orderId: id, alreadyPaid: false, fulfilment: NO_ACCOUNT });

    const order = await row(id);
    expect(order).toMatchObject({
      status: "paid",
      paymentMethod: "card",
      paymentProvider: "mock",
      paymentRef: `mock-${id}`,
      amountThb: 12345,
      // คอลัมน์ของขั้นตอนตรวจสลิปเดิมไม่ถูกแตะ
      reviewedBy: null,
      reviewedAt: null,
      adminNote: null,
      mt5AccountId: null,
      partnerBrokerCode: null,
    });
    expect(order.paidAt).toBeInstanceOf(Date);

    const log = await audits();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actorUserId: null,
      action: "order.paid",
      entity: "order",
      entityId: id,
      data: { provider: "mock", providerRef: `mock-${id}`, amountThb: 12345 },
    });
  });

  it("เรียกซ้ำด้วยรายการเดิม → alreadyPaid ไม่เขียนอะไรเพิ่ม เวลาชำระไม่เปลี่ยน", async () => {
    const id = await newOrder();
    await markOrderPaid(id, "mock", `mock-${id}`);
    const first = await row(id);
    expect(await markOrderPaid(id, "mock", `mock-${id}`)).toMatchObject({ ok: true, orderId: id, alreadyPaid: true, fulfilment: NO_ACCOUNT });
    // เลขอ้างอิงถูกตัดช่องว่างหัวท้ายก่อนเทียบ
    expect(await markOrderPaid(id, "mock", `  mock-${id} `)).toMatchObject({ ok: true, orderId: id, alreadyPaid: true, fulfilment: NO_ACCOUNT });
    expect(await row(id)).toEqual(first);
    expect(await audits()).toHaveLength(1);
  });

  it("5 คำขอพร้อมกัน → ชำระครั้งเดียว audit เดียว", async () => {
    const id = await newOrder();
    const results = await Promise.all(Array.from({ length: 5 }, () => markOrderPaid(id, "mock", `mock-${id}`)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && !r.alreadyPaid)).toHaveLength(1);
    expect(await audits("order.paid")).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });

  it("คำสั่งซื้อที่ชำระแล้ว ได้รายการชำระอื่นเข้ามา → ไม่แก้คำสั่งซื้อ แต่บันทึก order.payment_duplicate", async () => {
    const id = await newOrder();
    await markOrderPaid(id, "mock", "ref-1");
    const before = await row(id);
    expect(await markOrderPaid(id, "mock", "ref-2")).toMatchObject({ ok: true, orderId: id, alreadyPaid: true, fulfilment: NO_ACCOUNT });
    expect(await row(id)).toEqual(before);
    const dup = await audits("order.payment_duplicate");
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({ entityId: id, data: { provider: "mock", providerRef: "ref-2" } });
    expect(await audits("order.paid")).toHaveLength(1);
  });

  it("เลขอ้างอิงเดียวกันกับคำสั่งซื้ออีกรายการ → payment_ref_conflict รายการที่สองยังรอชำระ", async () => {
    const first = await newOrder();
    const second = await newOrder();
    await markOrderPaid(first, "mock", "shared-ref");
    expect(await markOrderPaid(second, "mock", "shared-ref")).toEqual({ ok: false, reason: "payment_ref_conflict" });
    expect(await row(second)).toMatchObject({ status: "pending_payment", paidAt: null, paymentRef: null, paymentProvider: null });
    expect(await audits("order.paid")).toHaveLength(1);
  });

  it.each(["cancelled", "refunded"] as const)("%s → order_not_payable สถานะไม่เปลี่ยน และบันทึก order.payment_unexpected", async (status) => {
    const id = await newOrder(status);
    expect(await markOrderPaid(id, "mock", `mock-${id}`)).toEqual({ ok: false, reason: "order_not_payable" });
    expect(await row(id)).toMatchObject({ status, paidAt: null, paymentRef: null });
    const unexpected = await audits("order.payment_unexpected");
    expect(unexpected).toHaveLength(1);
    expect(unexpected[0]).toMatchObject({ entityId: id, data: { provider: "mock", status } });
    expect(await audits("order.paid")).toHaveLength(0);
  });

  it.each(["rejected", "awaiting_review"] as const)("%s (ข้อมูลจากขั้นตอนสลิปเดิม) → ชำระได้", async (status) => {
    const id = await newOrder(status);
    expect(await markOrderPaid(id, "mock", `mock-${id}`)).toMatchObject({ ok: true, orderId: id, alreadyPaid: false, fulfilment: NO_ACCOUNT });
    expect(await row(id)).toMatchObject({ status: "paid", paymentMethod: "card" });
  });

  it("ไม่พบคำสั่งซื้อ → order_not_found ไม่มี audit", async () => {
    expect(await markOrderPaid(UNKNOWN, "mock", "ref")).toEqual({ ok: false, reason: "order_not_found" });
    expect(await audits()).toHaveLength(0);
  });

  it("เลขอ้างอิงว่าง/ยาวเกิน หรือ provider ที่ไม่รู้จัก → throw ไม่แตะคำสั่งซื้อ", async () => {
    const id = await newOrder();
    await expect(markOrderPaid(id, "mock", "   ")).rejects.toThrow();
    await expect(markOrderPaid(id, "mock", "x".repeat(201))).rejects.toThrow();
    await expect(markOrderPaid(id, "stripe" as never, "ref")).rejects.toThrow();
    expect(await row(id)).toMatchObject({ status: "pending_payment", paidAt: null });
    expect(await audits()).toHaveLength(0);
  });

  it.each([
    ["ไม่ได้ตั้ง PAYMENT_PROVIDER", { PAYMENT_PROVIDER: "" }],
    ["production โดยไม่มี flag", { NODE_ENV: "production" }],
    ["รายชื่อ license จริงใน Firebase", { LICENSE_STORAGE: "firebase", FIREBASE_LICENSE_PATH: "CME_Data/Customer Data/Data" }],
  ])("mock ไม่ได้รับอนุญาต (%s) → throw และคำสั่งซื้อไม่ถูกแตะ", async (_name, env) => {
    const id = await newOrder();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    await expect(markOrderPaid(id, "mock", `mock-${id}`)).rejects.toThrow();
    vi.unstubAllEnvs();
    expect(await row(id)).toMatchObject({ status: "pending_payment", paidAt: null, paymentProvider: null, paymentRef: null });
    expect(await audits()).toHaveLength(0);
  });
});
