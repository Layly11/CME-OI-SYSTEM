import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb, schema } from "@/db";
import { createUser } from "@/lib/auth/users";
import { computeNewExpiry } from "@/lib/license-file";
import { collectActiveEntries } from "@/lib/license-publish";
import { getLicenseStorage } from "@/lib/license-storage";
import { markOrderPaid } from "@/lib/payment/mark-paid";
import { todayInBangkok } from "@/lib/purchase/format";
import {
  attachMt5AccountToOrder,
  chooseBrokerForOrder,
  getOrder,
  insertMt5Account,
  submitAccountForOrder,
} from "@/lib/purchase/repo";
import { hasTestDb, resetDb } from "@/test/integration-setup";
import { activateOrderIfReady, sweepPendingActivations } from "./activation";
import { fulfilOrder } from "./fulfil";
import { getActivationBlock, getPaymentBlock } from "./activation-block";
import { purgeMockData } from "./mock-purge";
import { countActiveMockPaidLicenses, getLatestPublishedEntries, publishLicensesSerialized } from "./publish-sync";
import { isLicensePublished } from "./published-state";

const UNKNOWN = "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f";
const today = todayInBangkok(new Date());
const plusDays = (iso: string, n: number) => computeNewExpiry(n, iso, iso);
const fileDate = (iso: string) => iso.replaceAll("-", ".");

type Status = "pending_payment" | "awaiting_review" | "paid" | "rejected" | "cancelled" | "refunded";

describe.skipIf(!hasTestDb)("เปิด license อัตโนมัติ กับ PostgreSQL จริง + ไฟล์รายชื่อในเครื่อง", () => {
  let userId: string;
  let monthly: string;
  let yearly: string;
  let lifetime: string;
  let dir: string;
  let n = 0;

  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("PAYMENT_PROVIDER", "mock");
    dir = await mkdtemp(path.join(os.tmpdir(), "cme-oi-web-itest-activation-"));
    vi.stubEnv("LICENSE_STORAGE", "local");
    vi.stubEnv("LICENSE_LOCAL_DIR", dir);
    userId = (await createUser({ email: "buyer@example.com", passwordHash: "scrypt$test", name: "ผู้ซื้อ" }))!.id;
    const db = getDb();
    const pkg = async (code: "monthly" | "yearly" | "lifetime", durationDays: number | null) =>
      (await db.insert(schema.packages).values({ code, nameTh: code, durationDays, priceThb: 1000 }).returning())[0].id;
    monthly = await pkg("monthly", 30);
    yearly = await pkg("yearly", 365);
    lifetime = await pkg("lifetime", null);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });
  afterAll(async () => {
    await closeDb();
  });

  const db = () => getDb();
  const newAccount = async (accountNumber: string, owner = userId) => {
    const r = await insertMt5Account(owner, { accountNumber, brokerServer: "Broker-Live" });
    if (!r.ok) throw new Error("เพิ่มบัญชีไม่ได้: " + r.reason);
    return r.id;
  };
  const newOrder = async (o: { status?: Status; mt5AccountId?: string | null; packageId?: string; owner?: string } = {}) => {
    const [order] = await db()
      .insert(schema.orders)
      .values({
        userId: o.owner ?? userId,
        packageId: o.packageId ?? monthly,
        mt5AccountId: o.mt5AccountId ?? null,
        amountThb: 1000,
        status: o.status ?? "pending_payment",
        // คำสั่งซื้อที่ชำระแล้วต้องมีเลขอ้างอิงไม่ซ้ำกัน
        ...(o.status === "paid" ? { paymentProvider: "mock", paymentRef: `seed-${++n}`, paidAt: new Date() } : {}),
      })
      .returning();
    return order.id;
  };
  const licensesOf = (mt5AccountId: string) =>
    db().select().from(schema.licenses).where(eq(schema.licenses.mt5AccountId, mt5AccountId));
  const ledger = () => db().select().from(schema.licenseActivations);
  const audits = async (action: string) => (await db().select().from(schema.auditLogs)).filter((a) => a.action === action);
  const file = () => readFile(path.join(dir, "license.txt"), "utf8").catch(() => null);
  const seedLicense = (mt5AccountId: string, v: { expiresAt: string; status?: "active" | "expired" | "suspended" | "pending"; source?: "web" | "import" }) =>
    db()
      .insert(schema.licenses)
      .values({ userId, mt5AccountId, startsAt: "2026-01-01", expiresAt: v.expiresAt, status: v.status ?? "active", source: v.source ?? "import" })
      .returning();

  it("ยังไม่พร้อม (ไม่มีคำสั่งซื้อ / ยังไม่ชำระ / ยกเลิก / ไม่มีบัญชี) → ไม่สร้างอะไรเลย ไม่เผยแพร่", async () => {
    const account = await newAccount("50000001");
    expect(await activateOrderIfReady(UNKNOWN)).toEqual({ status: "not_ready", reason: "order_not_found" });
    for (const status of ["pending_payment", "awaiting_review", "rejected", "cancelled", "refunded"] as const) {
      // 1 บัญชีมีคำสั่งซื้อค้างได้ครั้งละรายการ → รายการที่ค้างไม่ผูกบัญชี
      const open = status === "pending_payment" || status === "awaiting_review";
      const id = await newOrder({ status, mt5AccountId: open && status === "awaiting_review" ? null : account });
      expect(await fulfilOrder(id, { trigger: "retry" })).toEqual({
        activation: { status: "not_ready", reason: "not_paid" },
        publish: null,
      });
      await db().update(schema.orders).set({ mt5AccountId: null }).where(eq(schema.orders.id, id));
    }
    const paidNoAccount = await newOrder({ status: "paid" });
    expect(await fulfilOrder(paidNoAccount, { trigger: "payment" })).toEqual({
      activation: { status: "not_ready", reason: "no_account" },
      publish: null,
    });
    expect(await licensesOf(account)).toHaveLength(0);
    expect(await ledger()).toHaveLength(0);
    expect(await db().select().from(schema.licenseFilePublications)).toHaveLength(0);
    expect(await file()).toBeNull();
  });

  it("ชำระทีหลัง: คำสั่งซื้อมีบัญชีอยู่แล้ว → markOrderPaid เปิด license + เผยแพร่รายชื่อเอง", async () => {
    const account = await newAccount("50000002");
    const id = await newOrder({ mt5AccountId: account, packageId: yearly });

    const paid = await markOrderPaid(id, "mock", `mock-${id}`);
    const expiresAt = plusDays(today, 365);
    expect(paid).toMatchObject({
      ok: true,
      alreadyPaid: false,
      fulfilment: { activation: { status: "activated", kind: "new", expiresAt }, publish: { status: "published", entryCount: 1 } },
    });

    const [license] = await licensesOf(account);
    expect(license).toMatchObject({ status: "active", source: "web", userId, packageId: yearly, orderId: id, startsAt: today, expiresAt });
    expect(await ledger()).toEqual([
      expect.objectContaining({ orderId: id, licenseId: license.id, mt5AccountId: account, packageId: yearly, durationDays: 365, previousExpiresAt: null, newExpiresAt: expiresAt }),
    ]);
    const [audit] = await audits("license.activate");
    expect(audit).toMatchObject({
      actorUserId: null,
      entity: "license",
      entityId: license.id,
      data: { orderId: id, userId, kind: "new", previousExpiresAt: null, newExpiresAt: expiresAt },
    });
    expect(JSON.stringify(await db().select().from(schema.auditLogs))).not.toContain("50000002");
    expect(await file()).toBe(`id50000002.${fileDate(expiresAt)}`);
    expect(isLicensePublished(await getLatestPublishedEntries(), "50000002", expiresAt)).toBe(true);
    expect((await getOrder(userId, id))?.activatedLicense).toEqual({ status: "active", expiresAt });
  });

  it("กรอกเลขทีหลัง: ชำระ → เลือกโบรกเกอร์ → กรอกเลข → fulfilOrder เปิด license + เผยแพร่", async () => {
    const id = await newOrder();
    expect(await markOrderPaid(id, "mock", `mock-${id}`)).toMatchObject({
      ok: true,
      fulfilment: { activation: { status: "not_ready", reason: "no_account" }, publish: null },
    });
    expect(await ledger()).toHaveLength(0);
    expect((await getOrder(userId, id))?.activatedLicense).toBeNull();

    expect(await chooseBrokerForOrder(userId, id, "hfm")).toEqual({ ok: true });
    const submitted = await submitAccountForOrder(userId, id, { accountNumber: "50000003", brokerServer: "HFM-Live" });
    if (!submitted.ok) throw new Error(submitted.reason);
    // ผูกบัญชีอย่างเดียวยังไม่เปิด license — ผู้เรียกต้องเรียก fulfilOrder หลัง commit
    expect(await ledger()).toHaveLength(0);

    const expiresAt = plusDays(today, 30);
    expect(await fulfilOrder(id, { trigger: "account" })).toMatchObject({
      activation: { status: "activated", kind: "new", expiresAt },
      publish: { status: "published", entryCount: 1 },
    });
    const [license] = await licensesOf(submitted.accountId);
    expect(license).toMatchObject({ status: "active", source: "web", orderId: id, expiresAt });
    expect(await ledger()).toHaveLength(1);
    expect(await audits("license.activate")).toHaveLength(1);
    expect(await file()).toBe(`id50000003.${fileDate(expiresAt)}`);
    const [acct] = await db().select().from(schema.mt5Accounts).where(eq(schema.mt5Accounts.id, submitted.accountId));
    expect(acct).toMatchObject({ partnerBrokerCode: "hfm", ibStatus: "unverified" });
  });

  it("เรียกซ้ำตามลำดับ → already_activated วันหมดอายุไม่ขยับ รายชื่อไม่ถูกเขียนซ้ำ", async () => {
    const account = await newAccount("50000004");
    const id = await newOrder({ status: "paid", mt5AccountId: account });
    const first = await fulfilOrder(id, { trigger: "payment" });
    expect(first.activation).toMatchObject({ status: "activated" });
    const expiresAt = plusDays(today, 30);

    for (let i = 0; i < 3; i++) {
      const again = await fulfilOrder(id, { trigger: "retry" });
      expect(again.activation).toEqual({ status: "already_activated", licenseId: (first.activation as { licenseId: string }).licenseId, expiresAt });
      expect(again.publish).toEqual({ status: "unchanged", entryCount: 1 });
    }
    expect(await licensesOf(account)).toEqual([expect.objectContaining({ expiresAt })]);
    expect(await ledger()).toHaveLength(1);
    expect(await audits("license.activate")).toHaveLength(1);
    expect(await db().select().from(schema.licenseFilePublications)).toHaveLength(1);
  });

  it("markOrderPaid ซ้ำ 2 ครั้ง (webhook ส่งซ้ำ) → เปิด license ครั้งเดียว", async () => {
    const account = await newAccount("50000005");
    const id = await newOrder({ mt5AccountId: account });
    await markOrderPaid(id, "mock", `mock-${id}`);
    expect(await markOrderPaid(id, "mock", `mock-${id}`)).toMatchObject({
      ok: true,
      alreadyPaid: true,
      fulfilment: { activation: { status: "already_activated" }, publish: { status: "unchanged" } },
    });
    expect(await ledger()).toHaveLength(1);
    expect(await licensesOf(account)).toEqual([expect.objectContaining({ expiresAt: plusDays(today, 30) })]);
  });

  it("8 คำขอพร้อมกันบนคำสั่งซื้อเดียว → license 1 ใบ สมุดบันทึก 1 แถว audit 1 แถว", async () => {
    const account = await newAccount("50000006");
    const id = await newOrder({ status: "paid", mt5AccountId: account });
    const results = await Promise.all(Array.from({ length: 8 }, () => fulfilOrder(id, { trigger: "retry" })));
    expect(results.filter((r) => r.activation.status === "activated")).toHaveLength(1);
    expect(results.filter((r) => r.activation.status === "already_activated")).toHaveLength(7);
    expect(await licensesOf(account)).toEqual([expect.objectContaining({ status: "active", expiresAt: plusDays(today, 30) })]);
    expect(await ledger()).toHaveLength(1);
    expect(await audits("license.activate")).toHaveLength(1);
    expect(await file()).toBe(`id50000006.${fileDate(plusDays(today, 30))}`);
  });

  it("ชำระเงินกับผูกบัญชีเกิดพร้อมกัน → ไม่ว่าอย่างไหนเสร็จทีหลัง ได้ license 1 ใบพอดี", async () => {
    for (let round = 0; round < 5; round++) {
      const account = await newAccount(String(50001000 + round));
      const id = await newOrder();
      await Promise.all([
        markOrderPaid(id, "mock", `mock-${id}`),
        attachMt5AccountToOrder(userId, id, account).then((r) => {
          if (!r.ok) throw new Error(r.reason);
          return fulfilOrder(id, { trigger: "account" });
        }),
      ]);
      expect(await licensesOf(account)).toEqual([expect.objectContaining({ status: "active", orderId: id })]);
    }
    expect(await ledger()).toHaveLength(5);
    expect(await audits("license.activate")).toHaveLength(5);
  });

  it("ฐานข้อมูลกันเอง: แถวสมุดบันทึกซ้ำของคำสั่งซื้อเดียวกัน และ license active ใบที่สองของบัญชีเดียวกัน ถูกปฏิเสธ (23505)", async () => {
    const account = await newAccount("50000007");
    const id = await newOrder({ status: "paid", mt5AccountId: account });
    await fulfilOrder(id, { trigger: "payment" });
    const [row] = await ledger();
    const code = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e) => (e as { cause?: { code?: string; constraint_name?: string } }).cause,
      );
    expect(
      await code(db().insert(schema.licenseActivations).values({ orderId: id, licenseId: row.licenseId, mt5AccountId: account, packageId: monthly, newExpiresAt: "2030-01-01" })),
    ).toMatchObject({ code: "23505", constraint_name: "license_activations_order_id_unique" });
    expect(
      await code(db().insert(schema.licenses).values({ userId, mt5AccountId: account, startsAt: today, expiresAt: "2030-01-01", status: "active" })),
    ).toMatchObject({ code: "23505", constraint_name: "licenses_active_per_account_idx" });
  });

  it("ต่ออายุก่อนหมด → แก้แถวเดิม นับต่อจากวันหมดอายุเดิม วันเริ่มและ source ไม่เปลี่ยน", async () => {
    const account = await newAccount("50000008");
    const oldExpiry = plusDays(today, 10);
    const [old] = await seedLicense(account, { expiresAt: oldExpiry, source: "import" });
    const id = await newOrder({ mt5AccountId: account, packageId: yearly });

    const paid = await markOrderPaid(id, "mock", `mock-${id}`);
    const expiresAt = plusDays(oldExpiry, 365);
    expect(paid).toMatchObject({ ok: true, fulfilment: { activation: { status: "activated", kind: "extended", licenseId: old.id, expiresAt } } });
    expect(await licensesOf(account)).toEqual([
      expect.objectContaining({ id: old.id, status: "active", source: "import", startsAt: "2026-01-01", expiresAt, orderId: id, packageId: yearly }),
    ]);
    expect(await ledger()).toEqual([expect.objectContaining({ previousExpiresAt: oldExpiry, newExpiresAt: expiresAt, durationDays: 365 })]);
    expect(await file()).toBe(`id50000008.${fileDate(expiresAt)}`);
  });

  it("แถว active ที่เลยวันหมดอายุแล้ว → แก้แถวเดิม นับใหม่จากวันนี้", async () => {
    const account = await newAccount("50000009");
    const [old] = await seedLicense(account, { expiresAt: "2026-02-01" });
    const id = await newOrder({ status: "paid", mt5AccountId: account });
    expect((await fulfilOrder(id, { trigger: "payment" })).activation).toMatchObject({ status: "activated", kind: "reactivated", licenseId: old.id });
    expect(await licensesOf(account)).toEqual([
      expect.objectContaining({ id: old.id, status: "active", startsAt: today, expiresAt: plusDays(today, 30) }),
    ]);
  });

  it("แถวเดิมสถานะ expired → เก็บแถวเดิมไว้ สร้างแถว active ใหม่นับจากวันนี้", async () => {
    const account = await newAccount("50000010");
    const [old] = await seedLicense(account, { expiresAt: "2026-02-01", status: "expired" });
    const id = await newOrder({ status: "paid", mt5AccountId: account });
    expect((await fulfilOrder(id, { trigger: "payment" })).activation).toMatchObject({ status: "activated", kind: "new" });
    const rows = await licensesOf(account);
    expect(rows).toHaveLength(2);
    expect(rows.find((l) => l.id === old.id)).toMatchObject({ status: "expired", expiresAt: "2026-02-01" });
    expect(rows.find((l) => l.id !== old.id)).toMatchObject({ status: "active", source: "web", startsAt: today, expiresAt: plusDays(today, 30) });
  });

  it("คำสั่งซื้อ 2 รายการของบัญชีเดียวกันเปิดพร้อมกัน → อายุบวกครบทั้งคู่ แถว active แถวเดียว", async () => {
    const account = await newAccount("50000011");
    const a = await newOrder({ status: "paid", mt5AccountId: account, packageId: monthly });
    const b = await newOrder({ status: "paid", mt5AccountId: account, packageId: yearly });
    const results = await Promise.all([fulfilOrder(a, { trigger: "payment" }), fulfilOrder(b, { trigger: "payment" })]);
    expect(results.map((r) => r.activation.status)).toEqual(["activated", "activated"]);
    const expiresAt = plusDays(today, 395);
    expect(await licensesOf(account)).toEqual([expect.objectContaining({ status: "active", expiresAt })]);
    expect(await ledger()).toHaveLength(2);
    expect(await file()).toBe(`id50000011.${fileDate(expiresAt)}`);
  });

  it("แพ็กเกจตลอดชีพ → 9999-01-01 และคำสั่งซื้อถัดไปของบัญชีนั้นถูกกัน (ไม่ต่ออายุ ไม่เกินปี 9999)", async () => {
    const account = await newAccount("50000012");
    const id = await newOrder({ status: "paid", mt5AccountId: account, packageId: lifetime });
    expect(await fulfilOrder(id, { trigger: "payment" })).toMatchObject({
      activation: { status: "activated", kind: "new", expiresAt: "9999-01-01" },
      publish: { status: "published" },
    });
    expect(await ledger()).toEqual([expect.objectContaining({ durationDays: null, newExpiresAt: "9999-01-01" })]);
    expect(await file()).toBe("id50000012.9999.01.01");

    const next = await newOrder({ status: "paid", mt5AccountId: account, packageId: yearly });
    for (let i = 0; i < 2; i++) {
      expect(await fulfilOrder(next, { trigger: "retry" })).toEqual({
        activation: { status: "blocked", reason: "lifetime_active" },
        publish: null,
      });
    }
    expect(await licensesOf(account)).toEqual([expect.objectContaining({ expiresAt: "9999-01-01" })]);
    expect(await ledger()).toHaveLength(1);
    // ลองใหม่กี่ครั้งก็บันทึกเหตุที่ถูกกันครั้งเดียว
    expect(await audits("license.activate_blocked")).toEqual([
      expect.objectContaining({ entity: "order", entityId: next, data: { orderId: next, userId, reason: "lifetime_active" } }),
    ]);
  });

  it("license ถูกระงับ → การชำระเงินไม่ปลดระงับ: ถูกกัน license ไม่ถูกแตะ ไม่มีในรายชื่อ", async () => {
    const account = await newAccount("50000013");
    const [suspended] = await seedLicense(account, { expiresAt: "2027-06-01", status: "suspended" });
    const id = await newOrder({ status: "paid", mt5AccountId: account });
    expect(await fulfilOrder(id, { trigger: "payment" })).toEqual({
      activation: { status: "blocked", reason: "license_suspended" },
      publish: null,
    });
    expect(await licensesOf(account)).toEqual([expect.objectContaining({ id: suspended.id, status: "suspended", expiresAt: "2027-06-01", orderId: null })]);
    expect(await ledger()).toHaveLength(0);
    expect(await audits("license.activate_blocked")).toHaveLength(1);
    expect(await file()).toBeNull();
  });

  it("sweepPendingActivations: เก็บตกคำสั่งซื้อที่ชำระแล้ว+มีบัญชีแต่ยังไม่ได้เปิด — ข้ามรายการที่ยังไม่พร้อม/เปิดแล้ว/ถูกกัน", async () => {
    const a1 = await newAccount("50000014");
    const a2 = await newAccount("50000015");
    const a3 = await newAccount("50000016");
    const a4 = await newAccount("50000017");
    await seedLicense(a3, { expiresAt: "2027-06-01", status: "suspended" });
    const stuck1 = await newOrder({ status: "paid", mt5AccountId: a1 });
    const stuck2 = await newOrder({ status: "paid", mt5AccountId: a2, packageId: lifetime });
    await newOrder({ status: "paid", mt5AccountId: a3 }); // ถูกกัน
    await newOrder({ status: "paid" }); // ยังไม่มีบัญชี
    await newOrder({ status: "pending_payment", mt5AccountId: a4 }); // ยังไม่ชำระ
    const done = await newOrder({ status: "paid", mt5AccountId: a4 });
    await activateOrderIfReady(done);

    expect(await sweepPendingActivations()).toEqual({ activated: 2, blocked: 1, failed: 0 });
    expect((await ledger()).map((r) => r.orderId).sort()).toEqual([stuck1, stuck2, done].sort());
    expect(await licensesOf(a4)).toEqual([expect.objectContaining({ expiresAt: plusDays(today, 30) })]);
    // รอบสองไม่มีอะไรให้ทำเพิ่ม
    expect(await sweepPendingActivations()).toEqual({ activated: 0, blocked: 1, failed: 0 });
    expect(await ledger()).toHaveLength(3);
    // sweep ไม่เผยแพร่เอง
    expect(await db().select().from(schema.licenseFilePublications)).toHaveLength(0);
  });

  // ---- การชำระเงินจำลองต้องไม่กลายเป็น license จริงเมื่อค่าตั้งเปลี่ยน (ด่านตอนเปิด license ไม่ใช่แค่ตอนชำระ) ----
  /** ค่าตั้งของระบบจริง: ปิด mock และชี้รายชื่อจริง — เทสนี้ไม่เรียกขั้นเผยแพร่ในค่าตั้งนี้ จึงไม่มีการต่อ Firebase */
  const liveEnv = () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENT_PROVIDER", "");
    vi.stubEnv("LICENSE_STORAGE", "firebase");
    vi.stubEnv("FIREBASE_LICENSE_PATH", "CME_Data/Customer Data/Data");
  };
  const mockEnv = () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAYMENT_PROVIDER", "mock");
    vi.stubEnv("LICENSE_STORAGE", "local");
    vi.stubEnv("FIREBASE_LICENSE_PATH", "");
  };

  it("คำสั่งซื้อตลอดชีพที่ชำระแบบจำลองแล้วค้างไว้ (ยังไม่มีบัญชี) เอามาแลก license หลังเปิดระบบจริงไม่ได้", async () => {
    const banked: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = await newOrder({ packageId: lifetime });
      expect(await markOrderPaid(id, "mock", `mock-${id}`)).toMatchObject({ ok: true });
      banked.push(id);
    }

    liveEnv();
    expect(await chooseBrokerForOrder(userId, banked[0], "hfm")).toEqual({ ok: true });
    const submitted = await submitAccountForOrder(userId, banked[0], { accountNumber: "77000001", brokerServer: "HFM-Live" });
    if (!submitted.ok) throw new Error(submitted.reason);
    for (let i = 0; i < 2; i++) {
      // ถูกกันก่อนถึงขั้นเผยแพร่ → publish: null (ไม่มีการแตะปลายทางใดๆ)
      expect(await fulfilOrder(banked[0], { trigger: "account" })).toEqual({
        activation: { status: "blocked", reason: "mock_payment" },
        publish: null,
      });
    }
    expect(await licensesOf(submitted.accountId)).toEqual([]);
    expect(await ledger()).toHaveLength(0);
    expect(await audits("license.activate_blocked")).toEqual([
      expect.objectContaining({ entity: "order", entityId: banked[0], data: { orderId: banked[0], userId, reason: "mock_payment" } }),
    ]);
    expect(await sweepPendingActivations()).toEqual({ activated: 0, blocked: 1, failed: 0 });
    expect(await getActivationBlock((await getOrder(userId, banked[0]))!)).toBe("mock_payment");
    expect(await file()).toBeNull();

    // การกันไม่ถาวร: กลับไปค่าตั้งทดสอบที่อนุญาต mock → เปิดได้ตามปกติ
    mockEnv();
    expect(await getActivationBlock((await getOrder(userId, banked[0]))!)).toBeNull();
    expect(await fulfilOrder(banked[0], { trigger: "retry" })).toMatchObject({
      activation: { status: "activated", expiresAt: "9999-01-01" },
      publish: { status: "published" },
    });
  });

  it.each([
    ["ปิด mock ไปแล้ว (เก็บรายชื่อในเครื่อง)", { PAYMENT_PROVIDER: "" }],
    ["production โดยไม่มี flag", { NODE_ENV: "production" }],
    ["NODE_ENV แปลก (staging)", { NODE_ENV: "staging" }],
  ])("คำสั่งซื้อที่ชำระแบบจำลอง + ค่าตั้ง: %s → ไม่เปิด license", async (_name, env) => {
    const account = await newAccount("77000010");
    const id = await newOrder({ status: "paid", mt5AccountId: account });
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect(await fulfilOrder(id, { trigger: "payment" })).toEqual({
      activation: { status: "blocked", reason: "mock_payment" },
      publish: null,
    });
    expect(await licensesOf(account)).toEqual([]);
  });

  it("คำสั่งซื้อที่ไม่ได้ชำระด้วย mock ไม่ถูกด่านนี้กัน แม้ปิด mock แล้ว", async () => {
    const account = await newAccount("77000011");
    const id = await newOrder({ status: "paid", mt5AccountId: account });
    await db().update(schema.orders).set({ paymentProvider: "gateway-x", paymentRef: "ch_1" }).where(eq(schema.orders.id, id));
    vi.stubEnv("PAYMENT_PROVIDER", "");
    expect(await fulfilOrder(id, { trigger: "payment" })).toMatchObject({
      activation: { status: "activated" },
      publish: { status: "published" },
    });
  });

  it("purgeMockData: license จากการชำระจำลองหมดอายุ, license เดิมที่ถูกต่ออายุได้วันหมดอายุเดิมคืน, คำสั่งซื้อจำลองถูกยกเลิก", async () => {
    // (1) license ใหม่จากคำสั่งซื้อจำลอง + ต่ออายุจำลองอีกรอบ
    const fresh = await newAccount("77000020");
    const o1 = await newOrder({ status: "paid", mt5AccountId: fresh });
    const o2 = await newOrder({ status: "paid", mt5AccountId: fresh, packageId: yearly });
    await fulfilOrder(o1, { trigger: "payment" });
    await fulfilOrder(o2, { trigger: "payment" });
    // (2) license เดิม (import) ที่ถูกคำสั่งซื้อจำลองต่ออายุ
    const legacy = await newAccount("77000021");
    const legacyExpiry = plusDays(today, 100);
    const [imported] = await seedLicense(legacy, { expiresAt: legacyExpiry });
    const o3 = await newOrder({ status: "paid", mt5AccountId: legacy, packageId: lifetime });
    await fulfilOrder(o3, { trigger: "payment" });
    // (3) คำสั่งซื้อจำลองที่ค้างไว้ ยังไม่มีบัญชี
    const banked = await newOrder({ status: "paid", packageId: lifetime });
    // (4) license ที่มีการชำระ "จริง" ต่ออายุหลังการชำระจำลอง → ต้องจัดการเอง
    const mixed = await newAccount("77000022");
    const o4 = await newOrder({ status: "paid", mt5AccountId: mixed });
    await fulfilOrder(o4, { trigger: "payment" });
    const o5 = await newOrder({ status: "paid", mt5AccountId: mixed });
    await db().update(schema.orders).set({ paymentProvider: "gateway-x", paymentRef: "ch_5" }).where(eq(schema.orders.id, o5));
    await fulfilOrder(o5, { trigger: "payment" });
    // (5) ลูกค้าจริงล้วน — ต้องไม่ถูกแตะ
    const real = await newAccount("77000023");
    const o6 = await newOrder({ status: "paid", mt5AccountId: real });
    await db().update(schema.orders).set({ paymentProvider: "gateway-x", paymentRef: "ch_6" }).where(eq(schema.orders.id, o6));
    await fulfilOrder(o6, { trigger: "payment" });

    expect(await countActiveMockPaidLicenses()).toBe(3);
    const before = JSON.stringify([await db().select().from(schema.orders), await db().select().from(schema.licenses), await ledger()]);

    // ทดลอง: รายงานเหมือนของจริง แต่ไม่มีอะไรเปลี่ยน
    const expected = { ordersCancelled: 4, activationsRemoved: 3, licensesExpired: 1, licensesRestored: 1 };
    const dry = await purgeMockData({ apply: false });
    expect(dry).toMatchObject({ applied: false, ...expected });
    expect(dry.skippedLicenseIds).toHaveLength(1);
    expect(JSON.stringify([await db().select().from(schema.orders), await db().select().from(schema.licenses), await ledger()])).toBe(before);
    expect(await audits("license.mock_purged")).toHaveLength(0);

    const applied = await purgeMockData({ apply: true });
    expect(applied).toMatchObject({ applied: true, ...expected });
    const statusOf = async (id: string) => (await db().select().from(schema.orders).where(eq(schema.orders.id, id)))[0].status;
    for (const id of [o1, o2, o3, banked]) expect(await statusOf(id), id).toBe("cancelled");
    for (const id of [o4, o5, o6]) expect(await statusOf(id), id).toBe("paid");
    expect(await licensesOf(fresh)).toEqual([expect.objectContaining({ status: "expired" })]);
    expect(await licensesOf(legacy)).toEqual([
      expect.objectContaining({ id: imported.id, status: "active", source: "import", expiresAt: legacyExpiry, orderId: null }),
    ]);
    expect(await licensesOf(real)).toEqual([expect.objectContaining({ status: "active", orderId: o6, expiresAt: plusDays(today, 30) })]);
    const [mixedLicense] = await licensesOf(mixed);
    expect(mixedLicense).toMatchObject({ status: "active", expiresAt: plusDays(today, 60) });
    expect(applied.skippedLicenseIds).toEqual([mixedLicense.id]);
    expect((await ledger()).map((r) => r.orderId).sort()).toEqual([o4, o5, o6].sort());
    // เหลือ license จำลองที่ต้องจัดการเอง 1 ใบ — ด่านเผยแพร่ไปรายชื่อจริงยังต้องเห็นมัน
    expect(await countActiveMockPaidLicenses()).toBe(1);
    expect(await audits("order.mock_purged")).toHaveLength(4);
    expect(await audits("license.mock_purged")).toHaveLength(2);
    expect(JSON.stringify(await db().select().from(schema.auditLogs))).not.toMatch(/7700002\d/);

    // คำสั่งซื้อที่ถูกยกเลิกแล้ว เปิด license/ชำระซ้ำไม่ได้อีก และรันซ้ำไม่มีอะไรเพิ่ม
    expect(await fulfilOrder(banked, { trigger: "retry" })).toEqual({ activation: { status: "not_ready", reason: "not_paid" }, publish: null });
    expect(await markOrderPaid(banked, "mock", `mock-${banked}`)).toEqual({ ok: false, reason: "order_not_payable" });
    expect(await purgeMockData({ apply: true })).toMatchObject({ ordersCancelled: 0, activationsRemoved: 0, licensesExpired: 0, licensesRestored: 0 });

    // เผยแพร่ใหม่: license จำลองที่หมดอายุหลุดจากรายชื่อ, ของเดิมกลับเป็นวันหมดอายุเดิม
    expect(await publishLicensesSerialized({ trigger: "test", force: true })).toMatchObject({ status: "published", entryCount: 3 });
    expect(await file()).toBe(
      [`id77000021.${fileDate(legacyExpiry)}`, `id77000022.${fileDate(plusDays(today, 60))}`, `id77000023.${fileDate(plusDays(today, 30))}`].join(","),
    );
  });

  it("ก่อนรับเงิน: บัญชีที่กลายเป็นตลอดชีพ/ถูกระงับหลังสร้างคำสั่งซื้อ → getPaymentBlock บอกเหตุผล; ชำระไปแล้ว → getActivationBlock", async () => {
    const account = await newAccount("77000030");
    const renewal = await newOrder({ mt5AccountId: account });
    expect(await getPaymentBlock((await getOrder(userId, renewal))!)).toBeNull();
    expect(await getPaymentBlock({ mt5AccountId: null })).toBeNull();

    const life = await newOrder({ status: "paid", mt5AccountId: account, packageId: lifetime });
    await fulfilOrder(life, { trigger: "payment" });
    expect(await getPaymentBlock((await getOrder(userId, renewal))!)).toBe("lifetime_active");
    // ยังไม่ชำระ = ยังไม่ใช่ "ชำระแล้วแต่เปิดไม่ได้"
    expect(await getActivationBlock((await getOrder(userId, renewal))!)).toBeNull();
    expect(await getActivationBlock((await getOrder(userId, life))!)).toBeNull();

    // ถ้าเงินเข้ามาอยู่ดี (เช่น webhook ของ gateway จริง) → บันทึกว่าชำระ แต่ถูกกัน และหน้าเว็บรู้เหตุผล
    await markOrderPaid(renewal, "mock", `mock-${renewal}`);
    expect(await getActivationBlock((await getOrder(userId, renewal))!)).toBe("lifetime_active");

    const other = await newAccount("77000031");
    await seedLicense(other, { expiresAt: "2027-06-01", status: "suspended" });
    expect(await getPaymentBlock({ mt5AccountId: other })).toBe("license_suspended");
  });

  // ---- วันที่ของรายชื่อ = วันที่ไทย ไม่ใช่เวลาเครื่อง ----
  describe("collectActiveEntries ใช้วันที่ไทย ไม่ว่าเซิร์ฟเวอร์ตั้ง timezone อะไร", () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      vi.useRealTimers();
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });
    const seed = async () => {
      await seedLicense(await newAccount("78000016"), { expiresAt: "2026-11-16" });
      await seedLicense(await newAccount("78000017"), { expiresAt: "2026-11-17" });
    };
    const numbers = async () => (await collectActiveEntries()).map((e) => e.accountNumber).sort();

    it("เซิร์ฟเวอร์ UTC ตอน 18:00Z (= 01:00 ของวันถัดไปที่ไทย) → รายที่หมดอายุเมื่อวานตามเวลาไทยไม่อยู่ในรายชื่อแล้ว", async () => {
      await seed();
      process.env.TZ = "UTC";
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
      expect(new Date().getDate()).toBe(16); // เวลาเครื่องยังเป็นวันที่ 16
      expect(todayInBangkok(new Date())).toBe("2026-11-17");
      expect(await numbers()).toEqual(["78000017"]);
    });

    it("เซิร์ฟเวอร์ที่เร็วกว่าไทย (Tokyo) ตอน 15:30Z (= 22:30 ที่ไทย) → วันสุดท้ายยังไม่จบ ยังอยู่ในรายชื่อ", async () => {
      await seed();
      process.env.TZ = "Asia/Tokyo";
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-16T15:30:00Z"));
      expect(new Date().getDate()).toBe(17); // เวลาเครื่องข้ามวันไปแล้ว
      expect(todayInBangkok(new Date())).toBe("2026-11-16");
      expect(await numbers()).toEqual(["78000016", "78000017"]);
    });
  });

  // ---- ปลายทางรายชื่อ: ค่าตั้งผิด/หาย ต้องล้มให้เห็น ไม่ถอยไปเขียนไฟล์ในเครื่อง ----
  it.each([
    ["ค่าไม่รู้จัก (ตัวพิมพ์ใหญ่)", { LICENSE_STORAGE: "Firebase" }],
    ["s3 (ยังไม่ได้ทำ)", { LICENSE_STORAGE: "s3" }],
    ["ไม่ตั้งค่าใน production", { LICENSE_STORAGE: "", NODE_ENV: "production" }],
    ["ไม่ตั้งค่าและไม่มี NODE_ENV (สคริปต์)", { LICENSE_STORAGE: "", NODE_ENV: "" }],
    ["firebase แต่ไม่มี credential", { LICENSE_STORAGE: "firebase" }],
  ])("LICENSE_STORAGE: %s → getLicenseStorage throw และการเผยแพร่รายงาน failed (license ยัง active, ไม่มีไฟล์, ไม่มีแถวประวัติ)", async (_name, env) => {
    const account = await newAccount("79000001");
    const id = await newOrder({ status: "paid", mt5AccountId: account });
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    // ด่านของ mock ไม่ใช่สิ่งที่ทดสอบที่นี่ — ทำให้คำสั่งซื้อเป็นการชำระจริง
    await db().update(schema.orders).set({ paymentProvider: "gateway-x", paymentRef: "ch_s" }).where(eq(schema.orders.id, id));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => getLicenseStorage()).toThrow(/LICENSE_STORAGE/);
    const result = await fulfilOrder(id, { trigger: "payment" });
    expect(result.activation).toMatchObject({ status: "activated" });
    expect(result.publish).toMatchObject({ status: "failed" });
    expect(await licensesOf(account)).toEqual([expect.objectContaining({ status: "active" })]);
    expect(await db().select().from(schema.licenseFilePublications)).toHaveLength(0);
    expect(await audits("license_file.publish_failed")).toHaveLength(1);
    expect(await file()).toBeNull();
  });
});
