import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb, schema } from "@/db";
import { createUser } from "@/lib/auth/users";
import { hasTestDb, resetDb } from "@/test/integration-setup";
import { releaseMt5AccountByNumber } from "./mt5-release";
import {
  attachMt5AccountToOrder,
  cancelOrder,
  checkAccountNumber,
  chooseBrokerForOrder,
  createOrder,
  deleteMt5Account,
  findSlipForViewer,
  getOrder,
  insertMt5Account,
  listActivePackages,
  listMt5AccountsWithLicense,
  listOrders,
  recordSlip,
  submitAccountForOrder,
} from "./repo";

const ORDER_KEY = (orderId: string, n = 1) => `${orderId}/0b7e1c52-1111-4222-8333-44445555666${n}.png`;

async function seed() {
  const db = getDb();
  const a = (await createUser({ email: "a@example.com", passwordHash: "scrypt$test", name: "เอ" }))!.id;
  const b = (await createUser({ email: "b@example.com", passwordHash: "scrypt$test", name: "บี" }))!.id;
  const admin = (await createUser({ email: "admin@example.com", passwordHash: "scrypt$test", name: "แอดมิน" }))!.id;
  await db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, admin));
  const [yearly] = await db
    .insert(schema.packages)
    .values({ code: "yearly", nameTh: "รายปี", durationDays: 365, priceThb: 9900, sortOrder: 2 })
    .returning();
  const [monthly] = await db
    .insert(schema.packages)
    .values({ code: "monthly", nameTh: "รายเดือน", durationDays: 30, priceThb: null, sortOrder: 1 })
    .returning();
  const [inactive] = await db
    .insert(schema.packages)
    .values({ code: "ib", nameTh: "IB", durationDays: 30, priceThb: 500, isActive: false, sortOrder: 3 })
    .returning();
  return { a, b, admin, yearly, monthly, inactive };
}

describe.skipIf(!hasTestDb)("purchase กับ PostgreSQL จริง", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => {
    await resetDb();
    s = await seed();
  });
  afterAll(async () => {
    await closeDb();
  });

  const addAccount = async (userId: string, accountNumber: string, brokerServer = "Broker-Live") => {
    const r = await insertMt5Account(userId, { accountNumber, brokerServer });
    if (!r.ok) throw new Error("เพิ่มบัญชีไม่ได้: " + r.reason);
    return r.id;
  };

  it("listActivePackages: เฉพาะที่เปิดขาย เรียงตาม sortOrder และบอกว่าสั่งออนไลน์ได้หรือไม่", async () => {
    const list = await listActivePackages();
    expect(list.map((p) => [p.code, p.orderable])).toEqual([
      ["monthly", false],
      ["yearly", true],
    ]);
  });

  it("เลขบัญชีซ้ำ: ของตัวเอง → duplicate_own, ของคนอื่น (สะกด server ต่างกัน) → taken", async () => {
    expect(await checkAccountNumber(s.a, "97058698")).toBe("free");
    await addAccount(s.a, "97058698", "Broker-Live");

    expect(await checkAccountNumber(s.a, "97058698")).toBe("duplicate_own");
    expect(await checkAccountNumber(s.b, "97058698")).toBe("taken");
    expect(await insertMt5Account(s.a, { accountNumber: "97058698", brokerServer: "Broker-Live" })).toEqual({
      ok: false,
      reason: "duplicate_own",
    });
    expect(await insertMt5Account(s.b, { accountNumber: "97058698", brokerServer: "broker live 2" })).toEqual({
      ok: false,
      reason: "taken",
    });
    expect(await getDb().select().from(schema.mt5Accounts)).toHaveLength(1);
    // audit: การสร้างครั้งแรก + ทุกครั้งที่คนอื่นได้คำตอบ "taken" (ขั้นทวนและขั้นยืนยัน) — เก็บเฉพาะ id ไม่มีเลขบัญชี
    const audits = await getDb().select().from(schema.auditLogs);
    expect(audits.map((x) => x.action).sort()).toEqual([
      "mt5_account.create",
      "mt5_account.taken_attempt",
      "mt5_account.taken_attempt",
    ]);
    const [account] = await getDb().select().from(schema.mt5Accounts);
    const taken = audits.filter((x) => x.action === "mt5_account.taken_attempt");
    expect(taken.every((x) => x.actorUserId === s.b && x.entityId === account.id)).toBe(true);
    expect(taken.map((x) => (x.data as { step: string }).step).sort()).toEqual(["check", "confirm"]);
    expect(JSON.stringify(audits)).not.toContain("97058698");
  });

  it("ฐานข้อมูลปฏิเสธเลขบัญชีที่ขึ้นต้นด้วย 0 — 0123456 กับ 123456 เป็นเจ้าของคนละคนไม่ได้", async () => {
    await addAccount(s.b, "123456");
    await expect(insertMt5Account(s.a, { accountNumber: "0123456", brokerServer: "Broker-Live" })).rejects.toThrow();
    await expect(insertMt5Account(s.a, { accountNumber: "0", brokerServer: "Broker-Live" })).rejects.toThrow();
    // เขียนตรงโดยไม่ผ่านฟังก์ชันของแอป (เช่นสคริปต์ import) ก็ไม่ผ่าน
    await expect(
      getDb().insert(schema.mt5Accounts).values({ userId: s.a, accountNumber: "0123456", brokerServer: "Broker-Live" }),
    ).rejects.toThrow();
    expect((await getDb().select().from(schema.mt5Accounts)).map((x) => x.accountNumber)).toEqual(["123456"]);
  });

  it("ฐานข้อมูลปฏิเสธเลขบัญชีที่ไม่ใช่ตัวเลข (check mt5_accounts_number_digits)", async () => {
    await expect(insertMt5Account(s.a, { accountNumber: "97O58698", brokerServer: "Broker-Live" })).rejects.toThrow();
    expect(await getDb().select().from(schema.mt5Accounts)).toHaveLength(0);
  });

  it("เพดาน 10 บัญชีต่อผู้ใช้", async () => {
    for (let i = 0; i < 10; i++) await addAccount(s.a, String(50000 + i));
    expect(await insertMt5Account(s.a, { accountNumber: "60000", brokerServer: "Broker-Live" })).toEqual({
      ok: false,
      reason: "too_many_accounts",
    });
    expect(await insertMt5Account(s.a, { accountNumber: "50000", brokerServer: "Broker-Live" })).toEqual({
      ok: false,
      reason: "duplicate_own",
    });
    expect(await listMt5AccountsWithLicense(s.a)).toHaveLength(10);
  });

  it("createOrder: แพ็กเกจราคา null / ปิดขาย / ไม่มีอยู่ → package_unavailable", async () => {
    for (const packageId of [s.monthly.id, s.inactive.id, "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f"]) {
      expect(await createOrder(s.a, { packageId })).toEqual({ ok: false, reason: "package_unavailable" });
    }
    expect(await getDb().select().from(schema.orders)).toHaveLength(0);
  });

  it("createOrder: ยอดเงิน = ราคาในฐานข้อมูล, ไม่มีบัญชีก็สร้างได้, เลขที่เริ่ม 1001", async () => {
    const r = await createOrder(s.a, { packageId: s.yearly.id });
    expect(r.ok && !r.existing).toBe(true);
    const order = await getOrder(s.a, (r as { id: string }).id);
    expect(order).toMatchObject({
      orderNo: 1001,
      amountThb: 9900,
      status: "pending_payment",
      packageName: "รายปี",
      mt5AccountId: null,
      accountNumber: null,
      hasSlip: false,
    });
    expect(order).not.toHaveProperty("slipKey");
    const r2 = await createOrder(s.a, { packageId: s.yearly.id });
    expect((await getOrder(s.a, (r2 as { id: string }).id))?.orderNo).toBe(1002);
  });

  it("createOrder: บัญชีของคนอื่น → account_not_found", async () => {
    const bAccount = await addAccount(s.b, "11112222");
    expect(await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: bAccount })).toEqual({
      ok: false,
      reason: "account_not_found",
    });
  });

  it("createOrder ซ้ำสำหรับบัญชีเดียวกัน → ได้คำสั่งซื้อเดิม (รวมกรณียิงพร้อมกัน)", async () => {
    const account = await addAccount(s.a, "97058698");
    const first = await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: account });
    const second = await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: account });
    expect(first).toMatchObject({ ok: true, existing: false });
    expect(second).toEqual({ ok: true, id: (first as { id: string }).id, existing: true, samePackage: true });

    const account2 = await addAccount(s.a, "97058699");
    const results = await Promise.all(
      Array.from({ length: 4 }, () => createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: account2 })),
    );
    expect(new Set(results.map((r) => (r.ok ? r.id : r.reason))).size).toBe(1);
    expect(await listOrders(s.a)).toHaveLength(2);
  });

  it("เพดานคำสั่งซื้อค้าง 5 รายการ", async () => {
    for (let i = 0; i < 5; i++) expect((await createOrder(s.a, { packageId: s.yearly.id })).ok).toBe(true);
    expect(await createOrder(s.a, { packageId: s.yearly.id })).toEqual({ ok: false, reason: "too_many_open_orders" });
    expect((await createOrder(s.b, { packageId: s.yearly.id })).ok).toBe(true);
  });

  it("ผูกบัญชีภายหลัง: ของตัวเองได้, ของคนอื่น/คำสั่งซื้อคนอื่นไม่ได้, ผูกซ้ำไม่ได้", async () => {
    const order = (await createOrder(s.a, { packageId: s.yearly.id })) as { id: string };
    const mine = await addAccount(s.a, "97058698");
    const theirs = await addAccount(s.b, "11112222");

    expect(await attachMt5AccountToOrder(s.a, order.id, theirs)).toEqual({ ok: false, reason: "account_not_found" });
    expect(await attachMt5AccountToOrder(s.b, order.id, theirs)).toEqual({ ok: false, reason: "order_not_found" });
    expect(await attachMt5AccountToOrder(s.a, order.id, mine)).toEqual({ ok: true });
    expect((await getOrder(s.a, order.id))?.accountNumber).toBe("97058698");
    expect(await attachMt5AccountToOrder(s.a, order.id, mine)).toEqual({ ok: false, reason: "order_not_attachable" });

    // บัญชีที่มีคำสั่งซื้อค้างอยู่แล้ว ผูกกับคำสั่งซื้อค้างอีกรายการไม่ได้
    const other = (await createOrder(s.a, { packageId: s.yearly.id })) as { id: string };
    expect(await attachMt5AccountToOrder(s.a, other.id, mine)).toEqual({ ok: false, reason: "account_has_open_order" });
  });

  it("insertMt5Account + attachToOrderId: ผูกเฉพาะคำสั่งซื้อของตัวเอง", async () => {
    const mine = (await createOrder(s.a, { packageId: s.yearly.id })) as { id: string };
    const theirs = (await createOrder(s.b, { packageId: s.yearly.id })) as { id: string };

    const r1 = await insertMt5Account(s.a, { accountNumber: "70001", brokerServer: "Broker-Live" }, theirs.id);
    expect(r1).toMatchObject({ ok: true, attached: false });
    expect((await getOrder(s.b, theirs.id))?.mt5AccountId).toBeNull();

    const r2 = await insertMt5Account(s.a, { accountNumber: "70002", brokerServer: "Broker-Live" }, mine.id);
    expect(r2).toMatchObject({ ok: true, attached: true });
    expect((await getOrder(s.a, mine.id))?.accountNumber).toBe("70002");
  });

  it("recordSlip: → awaiting_review, ครั้งที่สองถูกปฏิเสธ, ของคนอื่นทำไม่ได้, rejected แนบใหม่ได้", async () => {
    const order = (await createOrder(s.a, { packageId: s.yearly.id })) as { id: string };
    const slip = { key: ORDER_KEY(order.id), mime: "image/png", size: 1234, paymentMethod: "bank_transfer" as const };

    expect(await recordSlip(s.b, order.id, slip)).toEqual({ ok: false, reason: "order_not_found" });
    expect((await getOrder(s.a, order.id))?.status).toBe("pending_payment");

    expect(await recordSlip(s.a, order.id, slip)).toEqual({ ok: true, previousKey: null });
    const after = await getOrder(s.a, order.id);
    expect(after).toMatchObject({ status: "awaiting_review", hasSlip: true, paymentMethod: "bank_transfer" });
    expect(after?.slipUploadedAt).toBeInstanceOf(Date);

    expect(await recordSlip(s.a, order.id, { ...slip, key: ORDER_KEY(order.id, 2) })).toEqual({
      ok: false,
      reason: "slip_not_allowed",
    });

    await getDb().update(schema.orders).set({ status: "rejected" }).where(eq(schema.orders.id, order.id));
    expect(await recordSlip(s.a, order.id, { ...slip, key: ORDER_KEY(order.id, 3), paymentMethod: "promptpay" })).toEqual({
      ok: true,
      previousKey: ORDER_KEY(order.id),
    });

    for (const status of ["paid", "cancelled", "refunded"] as const) {
      await getDb().update(schema.orders).set({ status }).where(eq(schema.orders.id, order.id));
      expect(await recordSlip(s.a, order.id, slip)).toEqual({ ok: false, reason: "slip_not_allowed" });
    }
  });

  it("getOrder / listOrders: ไม่เห็นคำสั่งซื้อของคนอื่น", async () => {
    const order = (await createOrder(s.a, { packageId: s.yearly.id })) as { id: string };
    expect(await getOrder(s.b, order.id)).toBeNull();
    expect(await getOrder(s.admin, order.id)).toBeNull(); // หน้าลูกค้าไม่มีสิทธิ์พิเศษของแอดมิน
    expect(await listOrders(s.b)).toEqual([]);
    expect(await listOrders(s.a)).toHaveLength(1);
  });

  it("findSlipForViewer: เจ้าของและแอดมินเห็น คนอื่นไม่เห็น ไม่มีสลิปคืน null", async () => {
    const order = (await createOrder(s.a, { packageId: s.yearly.id })) as { id: string };
    const owner = { id: s.a, role: "customer" as const };
    expect(await findSlipForViewer(order.id, owner)).toBeNull();

    const key = ORDER_KEY(order.id);
    await recordSlip(s.a, order.id, { key, mime: "image/png", size: 10, paymentMethod: "bank_transfer" });
    expect(await findSlipForViewer(order.id, owner)).toEqual({ key, mime: "image/png" });
    expect(await findSlipForViewer(order.id, { id: s.admin, role: "admin" })).toEqual({ key, mime: "image/png" });
    expect(await findSlipForViewer(order.id, { id: s.b, role: "customer" })).toBeNull();
    expect(await findSlipForViewer("3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f", owner)).toBeNull();
  });

  it("listMt5AccountsWithLicense: แสดง license ที่ใช้งานอยู่ก่อน และไม่เห็นบัญชีของคนอื่น", async () => {
    const account = await addAccount(s.a, "97058698");
    await addAccount(s.b, "11112222");
    await getDb()
      .insert(schema.licenses)
      .values([
        { userId: s.a, mt5AccountId: account, packageId: s.yearly.id, startsAt: "2025-01-01", expiresAt: "2030-01-01", status: "expired" },
        { userId: s.a, mt5AccountId: account, packageId: s.yearly.id, startsAt: "2026-01-01", expiresAt: "2027-01-01", status: "active" },
      ]);
    const list = await listMt5AccountsWithLicense(s.a);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      accountNumber: "97058698",
      license: { status: "active", expiresAt: "2027-01-01", packageName: "รายปี" },
    });
    expect((await listMt5AccountsWithLicense(s.b))[0].license).toBeNull();
  });

  // ---- คำสั่งซื้อค้าง: เปลี่ยนแพ็กเกจ / ยกเลิก ----

  const addPackage = async (code: "six_months" | "lifetime", priceThb: number) => {
    const [pkg] = await getDb()
      .insert(schema.packages)
      .values({ code, nameTh: code, durationDays: code === "lifetime" ? null : 180, priceThb, sortOrder: 9 })
      .returning();
    return pkg;
  };
  const setStatus = (orderId: string, status: "pending_payment" | "awaiting_review" | "paid" | "rejected" | "cancelled" | "refunded") =>
    getDb().update(schema.orders).set({ status }).where(eq(schema.orders.id, orderId));

  it("createOrder แพ็กเกจอื่นให้บัญชีที่มีคำสั่งซื้อค้าง → คืนรายการเดิมพร้อม samePackage: false (ยอดและแพ็กเกจเดิมไม่เปลี่ยน)", async () => {
    const other = await addPackage("six_months", 5900);
    const account = await addAccount(s.a, "97058698");
    const first = (await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: account })) as { id: string };

    expect(await createOrder(s.a, { packageId: other.id, mt5AccountId: account })).toEqual({
      ok: true,
      id: first.id,
      existing: true,
      samePackage: false,
    });
    expect(await getOrder(s.a, first.id)).toMatchObject({ packageName: "รายปี", amountThb: 9900 });
    expect(await listOrders(s.a)).toHaveLength(1);
  });

  it("cancelOrder: เจ้าของยกเลิกรายการที่รอชำระได้ แล้วสั่งแพ็กเกจใหม่ให้บัญชีเดิมได้", async () => {
    const other = await addPackage("six_months", 5900);
    const account = await addAccount(s.a, "97058698");
    const first = (await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: account })) as { id: string };

    expect(await cancelOrder(s.b, first.id)).toEqual({ ok: false, reason: "order_not_found" });
    expect((await getOrder(s.a, first.id))?.status).toBe("pending_payment");

    expect(await cancelOrder(s.a, first.id)).toEqual({ ok: true });
    expect((await getOrder(s.a, first.id))?.status).toBe("cancelled");
    expect(await cancelOrder(s.a, first.id)).toEqual({ ok: false, reason: "order_not_cancellable" });

    const second = await createOrder(s.a, { packageId: other.id, mt5AccountId: account });
    expect(second).toMatchObject({ ok: true, existing: false });
    expect(await getOrder(s.a, (second as { id: string }).id)).toMatchObject({ amountThb: 5900, status: "pending_payment" });

    const audits = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "order.cancel"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: s.a, entityId: first.id });
  });

  it("cancelOrder: สถานะอื่นนอกจากรอชำระยกเลิกเองไม่ได้ และสถานะไม่ถูกแตะ", async () => {
    const order = (await createOrder(s.a, { packageId: s.yearly.id })) as { id: string };
    for (const status of ["awaiting_review", "paid", "rejected", "cancelled", "refunded"] as const) {
      await setStatus(order.id, status);
      expect(await cancelOrder(s.a, order.id)).toEqual({ ok: false, reason: "order_not_cancellable" });
      expect((await getOrder(s.a, order.id))?.status).toBe(status);
    }
    expect(await cancelOrder(s.a, "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f")).toEqual({ ok: false, reason: "order_not_found" });
  });

  it("ยกเลิกรายการที่ไม่ใช้ แล้วสั่งซื้อต่อได้เมื่อชนเพดาน 5 รายการ", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(((await createOrder(s.a, { packageId: s.yearly.id })) as { id: string }).id);
    expect(await createOrder(s.a, { packageId: s.yearly.id })).toEqual({ ok: false, reason: "too_many_open_orders" });
    expect(await cancelOrder(s.a, ids[0])).toEqual({ ok: true });
    expect(await createOrder(s.a, { packageId: s.yearly.id })).toMatchObject({ ok: true, existing: false });
  });

  // ---- license ตลอดชีพ ----

  it("บัญชีที่มี license ตลอดชีพใช้งานอยู่: สั่งซื้อ/ผูกกับคำสั่งซื้อไม่ได้ (lifetime_active)", async () => {
    const account = await addAccount(s.a, "97058698");
    const license = { userId: s.a, mt5AccountId: account, packageId: s.yearly.id, startsAt: "2026-01-01" };
    const [row] = await getDb()
      .insert(schema.licenses)
      .values({ ...license, expiresAt: "9999-01-01", status: "active" })
      .returning();

    expect(await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: account })).toEqual({
      ok: false,
      reason: "lifetime_active",
    });
    const loose = (await createOrder(s.a, { packageId: s.yearly.id })) as { id: string };
    expect(await attachMt5AccountToOrder(s.a, loose.id, account)).toEqual({ ok: false, reason: "lifetime_active" });
    expect((await getOrder(s.a, loose.id))?.mt5AccountId).toBeNull();
    expect(await listOrders(s.a)).toHaveLength(1);

    // รูปแบบตลอดชีพในข้อมูลเดิม (ปี 2099/2100) นับเหมือนกัน
    for (const expiresAt of ["2099-12-29", "2100-12-30"]) {
      await getDb().update(schema.licenses).set({ expiresAt }).where(eq(schema.licenses.id, row.id));
      expect(await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: account })).toMatchObject({ ok: false });
    }
  });

  it("license ที่ไม่ใช่ตลอดชีพ หรือตลอดชีพที่หมดอายุ → ยังต่ออายุได้", async () => {
    const dated = await addAccount(s.a, "97058698");
    const expired = await addAccount(s.a, "97058699");
    await getDb()
      .insert(schema.licenses)
      .values([
        { userId: s.a, mt5AccountId: dated, startsAt: "2026-01-01", expiresAt: "2027-01-01", status: "active" },
        { userId: s.a, mt5AccountId: expired, startsAt: "2026-01-01", expiresAt: "9999-01-01", status: "expired" },
      ]);
    expect(await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: dated })).toMatchObject({ ok: true, existing: false });
    expect(await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: expired })).toMatchObject({
      ok: true,
      existing: false,
    });
  });

  it("บัญชีที่มี license ถูกระงับ: สั่งซื้อ/ผูกกับคำสั่งซื้อไม่ได้ (license_suspended) — การชำระเงินต้องไม่ปลดการระงับเอง", async () => {
    const account = await addAccount(s.a, "97058698");
    await getDb()
      .insert(schema.licenses)
      .values([
        // มีทั้งแถวหมดอายุและแถวถูกระงับ — แถวถูกระงับแถวเดียวก็พอให้ปฏิเสธ (ทั้งแบบมีวันหมดอายุและตลอดชีพ)
        { userId: s.a, mt5AccountId: account, startsAt: "2025-01-01", expiresAt: "2025-02-01", status: "expired" },
        { userId: s.a, mt5AccountId: account, startsAt: "2026-01-01", expiresAt: "9999-01-01", status: "suspended" },
      ]);

    expect(await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: account })).toEqual({
      ok: false,
      reason: "license_suspended",
    });
    expect(await listOrders(s.a)).toHaveLength(0);

    for (const status of ["pending_payment", "paid"] as const) {
      const loose = (await createOrder(s.a, { packageId: s.yearly.id })) as { id: string };
      await setStatus(loose.id, status);
      expect(await attachMt5AccountToOrder(s.a, loose.id, account)).toEqual({ ok: false, reason: "license_suspended" });
      expect((await getOrder(s.a, loose.id))?.mt5AccountId).toBeNull();
    }
    const licenses = await getDb().select().from(schema.licenses);
    expect(licenses.map((l) => l.status).sort()).toEqual(["expired", "suspended"]);
  });

  // ---- ลบ/ปล่อยเลขบัญชี ----

  it("deleteMt5Account: เจ้าของลบบัญชีที่ยังไม่มี license ได้ เลขกลับมาว่าง และคำสั่งซื้อที่รอชำระแค่ถูกถอดบัญชี", async () => {
    const account = await addAccount(s.a, "97058698");
    const order = (await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: account })) as { id: string };

    expect(await deleteMt5Account(s.b, account)).toEqual({ ok: false, reason: "account_not_found" });
    expect(await checkAccountNumber(s.a, "97058698")).toBe("duplicate_own");

    expect(await deleteMt5Account(s.a, account)).toEqual({ ok: true });
    expect(await listMt5AccountsWithLicense(s.a)).toEqual([]);
    expect(await getOrder(s.a, order.id)).toMatchObject({ status: "pending_payment", mt5AccountId: null, accountNumber: null });
    expect(await checkAccountNumber(s.b, "97058698")).toBe("free");
    expect(await insertMt5Account(s.b, { accountNumber: "97058698", brokerServer: "Broker-Live" })).toMatchObject({ ok: true });

    const [audit] = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "mt5_account.delete"));
    expect(audit).toMatchObject({ actorUserId: s.a, entityId: account, data: { detachedOrders: 1 } });
    expect(await deleteMt5Account(s.a, account)).toEqual({ ok: false, reason: "account_not_found" });
  });

  it("deleteMt5Account: มี license หรือมีคำสั่งซื้อที่รอตรวจ/ชำระแล้ว/คืนเงิน → account_in_use และไม่มีอะไรถูกลบ", async () => {
    const licensed = await addAccount(s.a, "97058698");
    await getDb()
      .insert(schema.licenses)
      .values({ userId: s.a, mt5AccountId: licensed, startsAt: "2025-01-01", expiresAt: "2025-02-01", status: "expired" });
    expect(await deleteMt5Account(s.a, licensed)).toEqual({ ok: false, reason: "account_in_use" });

    const ordered = await addAccount(s.a, "97058699");
    const order = (await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: ordered })) as { id: string };
    for (const status of ["awaiting_review", "paid", "refunded"] as const) {
      await setStatus(order.id, status);
      expect(await deleteMt5Account(s.a, ordered)).toEqual({ ok: false, reason: "account_in_use" });
      expect((await getOrder(s.a, order.id))?.mt5AccountId).toBe(ordered);
    }
    expect(await listMt5AccountsWithLicense(s.a)).toHaveLength(2);

    // ไม่ผ่าน / ยกเลิก → ลบได้ คำสั่งซื้อยังอยู่ครบ
    await setStatus(order.id, "rejected");
    expect(await deleteMt5Account(s.a, ordered)).toEqual({ ok: true });
    expect(await getOrder(s.a, order.id)).toMatchObject({ status: "rejected", mt5AccountId: null });
  });

  it("releaseMt5AccountByNumber (สคริปต์แอดมิน): ปล่อยเลขที่คนอื่นจองไว้ได้ เว้นแต่มี license/คำสั่งซื้อที่ชำระแล้ว", async () => {
    const squatted = await addAccount(s.b, "97058698");
    expect(await insertMt5Account(s.a, { accountNumber: "97058698", brokerServer: "Broker-Live" })).toMatchObject({
      ok: false,
      reason: "taken",
    });

    expect(await releaseMt5AccountByNumber("11110000", "test")).toEqual({ ok: false, reason: "account_not_found" });
    expect(await releaseMt5AccountByNumber("97058698", "test")).toEqual({ ok: true, accountId: squatted, detachedOrders: 0 });
    expect(await insertMt5Account(s.a, { accountNumber: "97058698", brokerServer: "Broker-Live" })).toMatchObject({ ok: true });

    const [audit] = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "mt5_account.release"));
    expect(audit).toMatchObject({ actorUserId: null, entityId: squatted, data: { via: "test", previousUserId: s.b } });
    expect(JSON.stringify(audit)).not.toContain("97058698");

    // บัญชีที่มีคำสั่งซื้อชำระแล้ว ปล่อยไม่ได้
    const paid = await addAccount(s.b, "11112222");
    const order = (await createOrder(s.b, { packageId: s.yearly.id, mt5AccountId: paid })) as { id: string };
    await setStatus(order.id, "paid");
    expect(await releaseMt5AccountByNumber("11112222", "test")).toEqual({ ok: false, reason: "account_in_use" });
    expect(await checkAccountNumber(s.b, "11112222")).toBe("duplicate_own");
  });

  // ---- ด่านที่การทดสอบเดิมไม่ครอบคลุม ----

  it("recordSlip: แนบสลิปใหม่ให้รายการที่ถูกปฏิเสธ ขณะบัญชีเดียวกันมีคำสั่งซื้อค้างอีกรายการ → account_has_open_order", async () => {
    const account = await addAccount(s.a, "97058698");
    const first = (await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: account })) as { id: string };
    const slip = { key: ORDER_KEY(first.id), mime: "image/png", size: 10, paymentMethod: "bank_transfer" as const };
    expect(await recordSlip(s.a, first.id, slip)).toEqual({ ok: true, previousKey: null });
    await setStatus(first.id, "rejected");

    const second = await createOrder(s.a, { packageId: s.yearly.id, mt5AccountId: account });
    expect(second).toMatchObject({ ok: true, existing: false });

    expect(await recordSlip(s.a, first.id, { ...slip, key: ORDER_KEY(first.id, 2) })).toEqual({
      ok: false,
      reason: "account_has_open_order",
    });
    // transaction ถูกยกเลิกทั้งก้อน: สถานะและสลิปเดิมไม่เปลี่ยน
    expect(await getOrder(s.a, first.id)).toMatchObject({ status: "rejected", hasSlip: true });
    expect(await findSlipForViewer(first.id, { id: s.a, role: "customer" })).toEqual({ key: slip.key, mime: "image/png" });
  });

  it("insertMt5Account + attachToOrderId: ผูกได้เฉพาะคำสั่งซื้อที่ยังไม่มีบัญชีและยังไม่ถูกยกเลิก/คืนเงิน", async () => {
    const newOrder = async () => ((await createOrder(s.a, { packageId: s.yearly.id })) as { id: string }).id;
    let n = 70000;
    const insertFor = (orderId: string) =>
      insertMt5Account(s.a, { accountNumber: String(++n), brokerServer: "Broker-Live" }, orderId);

    // ชำระแล้วแต่ยังไม่ระบุบัญชี → ผูกได้
    const paid = await newOrder();
    await setStatus(paid, "paid");
    expect(await insertFor(paid)).toMatchObject({ ok: true, attached: true });
    expect((await getOrder(s.a, paid))?.accountNumber).toBe("70001");

    // ยกเลิก / คืนเงิน → บัญชีถูกสร้าง แต่ไม่ผูก
    for (const status of ["cancelled", "refunded"] as const) {
      const order = await newOrder();
      await setStatus(order, status);
      expect(await insertFor(order)).toMatchObject({ ok: true, attached: false });
      expect((await getOrder(s.a, order))?.mt5AccountId).toBeNull();
    }

    // มีบัญชีผูกอยู่แล้ว → ไม่ถูกเขียนทับ
    const attached = await newOrder();
    expect(await insertFor(attached)).toMatchObject({ ok: true, attached: true });
    const before = (await getOrder(s.a, attached))?.mt5AccountId;
    expect(await insertFor(attached)).toMatchObject({ ok: true, attached: false });
    expect((await getOrder(s.a, attached))?.mt5AccountId).toBe(before);
  });
  // ---- ชำระด้วยบัตร → เลือกโบรกเกอร์ → กรอกเลขบัญชี MT5 ----

  const paidOrder = async (userId: string, brokerCode: string | null = "hfm") => {
    const order = (await createOrder(userId, { packageId: s.yearly.id })) as { id: string };
    await setStatus(order.id, "paid");
    if (brokerCode) expect(await chooseBrokerForOrder(userId, order.id, brokerCode)).toEqual({ ok: true });
    return order.id;
  };
  const accountRows = () => getDb().select().from(schema.mt5Accounts);
  const INPUT = { accountNumber: "97058698", brokerServer: "Broker-Live" };

  it("chooseBrokerForOrder: เฉพาะคำสั่งซื้อของตัวเองที่ชำระแล้วและยังไม่มีบัญชี — เลือกใหม่ทับได้ และมี audit", async () => {
    const order = (await createOrder(s.a, { packageId: s.yearly.id })) as { id: string };
    expect(await getOrder(s.a, order.id)).toMatchObject({ partnerBrokerCode: null, paidAt: null });

    // ยังไม่ชำระทุกสถานะ → ไม่ได้
    for (const status of ["pending_payment", "awaiting_review", "rejected", "cancelled", "refunded"] as const) {
      await setStatus(order.id, status);
      expect(await chooseBrokerForOrder(s.a, order.id, "hfm")).toEqual({ ok: false, reason: "order_not_paid" });
    }
    await setStatus(order.id, "paid");

    expect(await chooseBrokerForOrder(s.b, order.id, "hfm")).toEqual({ ok: false, reason: "order_not_found" });
    expect(await chooseBrokerForOrder(s.a, "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f", "hfm")).toEqual({
      ok: false,
      reason: "order_not_found",
    });
    for (const bad of ["", "HFM", "unknown", "__proto__", "https://evil.example/"]) {
      expect(await chooseBrokerForOrder(s.a, order.id, bad)).toEqual({ ok: false, reason: "broker_invalid" });
    }
    expect((await getOrder(s.a, order.id))?.partnerBrokerCode).toBeNull();

    expect(await chooseBrokerForOrder(s.a, order.id, "hfm")).toEqual({ ok: true });
    expect((await getOrder(s.a, order.id))?.partnerBrokerCode).toBe("hfm");
    expect(await chooseBrokerForOrder(s.a, order.id, "cxm")).toEqual({ ok: true });
    expect((await getOrder(s.a, order.id))?.partnerBrokerCode).toBe("cxm");

    const audits = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "order.choose_broker"));
    expect(audits.map((x) => [x.actorUserId, x.entityId, x.data])).toEqual([
      [s.a, order.id, { brokerCode: "hfm" }],
      [s.a, order.id, { brokerCode: "cxm" }],
    ]);

    // มีบัญชีแล้ว → เปลี่ยนโบรกเกอร์ไม่ได้
    expect(await submitAccountForOrder(s.a, order.id, INPUT)).toMatchObject({ ok: true });
    expect(await chooseBrokerForOrder(s.a, order.id, "hfm")).toEqual({ ok: false, reason: "order_has_account" });
    expect((await getOrder(s.a, order.id))?.partnerBrokerCode).toBe("cxm");
  });

  it("submitAccountForOrder: สร้างบัญชี + ผูกคำสั่งซื้อ คัดลอกโบรกเกอร์ ib_status ยังเป็น unverified และ audit ไม่มีเลขบัญชี", async () => {
    const order = await paidOrder(s.a, "kohle");
    const result = await submitAccountForOrder(s.a, order, { ...INPUT, label: "บัญชีหลัก" });
    expect(result).toMatchObject({ ok: true });
    const accountId = (result as { accountId: string }).accountId;

    const [account] = await accountRows();
    expect(account).toMatchObject({
      id: accountId,
      userId: s.a,
      accountNumber: "97058698",
      brokerServer: "Broker-Live",
      label: "บัญชีหลัก",
      partnerBrokerCode: "kohle",
      ibStatus: "unverified",
      ibVerifiedAt: null,
      ibVerifiedBy: null,
    });
    expect(await getOrder(s.a, order)).toMatchObject({
      status: "paid",
      mt5AccountId: accountId,
      accountNumber: "97058698",
      partnerBrokerCode: "kohle",
    });
    expect((await listMt5AccountsWithLicense(s.a))[0]).toMatchObject({ partnerBrokerCode: "kohle", license: null });
    // ฟังก์ชันนี้ไม่เปิด license เอง
    expect(await getDb().select().from(schema.licenses)).toHaveLength(0);

    const audits = await getDb().select().from(schema.auditLogs);
    expect(audits.filter((x) => x.action === "mt5_account.create")).toHaveLength(1);
    expect(audits.filter((x) => x.action === "order.attach_account")).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain("97058698");
  });

  it("submitAccountForOrder: ทุกกรณีที่ไม่ผ่าน ไม่มีแถวบัญชีถูกสร้าง และคำสั่งซื้อไม่เปลี่ยน", async () => {
    // ไม่มีคำสั่งซื้อ / ของคนอื่น
    const theirs = await paidOrder(s.b);
    expect(await submitAccountForOrder(s.a, "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f", INPUT)).toEqual({
      ok: false,
      reason: "order_not_found",
    });
    expect(await submitAccountForOrder(s.a, theirs, INPUT)).toEqual({ ok: false, reason: "order_not_found" });
    expect((await getOrder(s.b, theirs))?.mt5AccountId).toBeNull();

    // ยังไม่ชำระ (ทุกสถานะที่ไม่ใช่ paid) แม้เลือกโบรกเกอร์ไว้แล้ว
    const unpaid = await paidOrder(s.a);
    for (const status of ["pending_payment", "awaiting_review", "rejected", "cancelled", "refunded"] as const) {
      await setStatus(unpaid, status);
      expect(await submitAccountForOrder(s.a, unpaid, INPUT)).toEqual({ ok: false, reason: "order_not_paid" });
    }
    await setStatus(unpaid, "cancelled");

    // ชำระแล้วแต่ยังไม่เลือกโบรกเกอร์
    const noBroker = await paidOrder(s.a, null);
    expect(await submitAccountForOrder(s.a, noBroker, INPUT)).toEqual({ ok: false, reason: "broker_required" });

    expect(await accountRows()).toHaveLength(0);
    expect(await checkAccountNumber(s.b, "97058698")).toBe("free");
    expect((await getOrder(s.a, noBroker))?.mt5AccountId).toBeNull();
  });

  it("submitAccountForOrder: เลขซ้ำ (ของคนอื่น/ของตัวเอง) และคำสั่งซื้อที่มีบัญชีแล้ว → ไม่สร้างแถวใหม่", async () => {
    const mine = await paidOrder(s.a);
    expect(await submitAccountForOrder(s.a, mine, INPUT)).toMatchObject({ ok: true });

    // คำสั่งซื้อเดิมมีบัญชีแล้ว (กดยืนยันซ้ำ/เลขอื่น)
    expect(await submitAccountForOrder(s.a, mine, INPUT)).toEqual({ ok: false, reason: "order_has_account" });
    expect(await submitAccountForOrder(s.a, mine, { ...INPUT, accountNumber: "11112222" })).toEqual({
      ok: false,
      reason: "order_has_account",
    });

    // คำสั่งซื้อใหม่ของตัวเองกับเลขเดิม → duplicate_own (ต้องใช้ทางต่ออายุ), ของคนอื่น → taken พร้อม audit
    const mine2 = await paidOrder(s.a);
    expect(await submitAccountForOrder(s.a, mine2, INPUT)).toEqual({ ok: false, reason: "duplicate_own" });
    const theirs = await paidOrder(s.b);
    expect(await submitAccountForOrder(s.b, theirs, { ...INPUT, brokerServer: "Other-Server" })).toEqual({
      ok: false,
      reason: "taken",
    });
    expect((await getOrder(s.a, mine2))?.mt5AccountId).toBeNull();
    expect((await getOrder(s.b, theirs))?.mt5AccountId).toBeNull();
    expect(await accountRows()).toHaveLength(1);

    const taken = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "mt5_account.taken_attempt"));
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ actorUserId: s.b, data: { step: "confirm" } });
    expect(JSON.stringify(await getDb().select().from(schema.auditLogs))).not.toContain("97058698");
  });

  it("submitAccountForOrder: เพดาน 10 บัญชีต่อผู้ใช้ → too_many_accounts ไม่สร้างแถว", async () => {
    for (let i = 0; i < 10; i++) await addAccount(s.a, String(50000 + i));
    const order = await paidOrder(s.a);
    expect(await submitAccountForOrder(s.a, order, { accountNumber: "60000", brokerServer: "Broker-Live" })).toEqual({
      ok: false,
      reason: "too_many_accounts",
    });
    expect(await submitAccountForOrder(s.a, order, { accountNumber: "50000", brokerServer: "Broker-Live" })).toEqual({
      ok: false,
      reason: "duplicate_own",
    });
    expect(await accountRows()).toHaveLength(10);
    expect((await getOrder(s.a, order))?.mt5AccountId).toBeNull();
  });

  it("submitAccountForOrder: กดยืนยันพร้อมกันหลายครั้ง → บัญชีเดียว ผูกครั้งเดียว", async () => {
    const order = await paidOrder(s.a);
    const results = await Promise.all(Array.from({ length: 5 }, () => submitAccountForOrder(s.a, order, INPUT)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "order_has_account")).toBe(true);
    expect(await accountRows()).toHaveLength(1);
    const audits = await getDb().select().from(schema.auditLogs);
    expect(audits.filter((x) => x.action === "order.attach_account")).toHaveLength(1);
    expect(audits.filter((x) => x.action === "mt5_account.create")).toHaveLength(1);
  });

  it("submitAccountForOrder: สองคนกรอกเลขเดียวกันพร้อมกัน → ได้คนเดียว อีกคน taken และไม่มีแถวค้าง", async () => {
    const a = await paidOrder(s.a);
    const b = await paidOrder(s.b);
    const [ra, rb] = await Promise.all([submitAccountForOrder(s.a, a, INPUT), submitAccountForOrder(s.b, b, INPUT)]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    const loser = ra.ok ? rb : ra;
    expect(loser).toEqual({ ok: false, reason: "taken" });
    expect(await accountRows()).toHaveLength(1);
    const orders = [await getOrder(s.a, a), await getOrder(s.b, b)];
    expect(orders.filter((o) => o?.mt5AccountId !== null)).toHaveLength(1);
  });
});
