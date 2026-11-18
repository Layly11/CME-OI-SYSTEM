import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { closeDb, getDb, schema } from "@/db";
import { createUser } from "@/lib/auth/users";
import { isUniqueViolation } from "@/lib/db-errors";
import { computeNewExpiry } from "@/lib/license-file";
import { activateOrderIfReady, sweepPendingActivations } from "@/lib/license/activation";
import { getActivationBlock } from "@/lib/license/activation-block";
import { fulfilOrder } from "@/lib/license/fulfil";
import { purgeMockData } from "@/lib/license/mock-purge";
import { countActiveMockPaidLicenses } from "@/lib/license/publish-sync";
import { markOrderPaid } from "@/lib/payment/mark-paid";
import { hasTestDb, resetDb } from "@/test/integration-setup";
import { todayInBangkok } from "./format";
import { applyPackageLineup, PACKAGE_LINEUP } from "./package-lineup";
import { countReferredUsers, findReferrerIdByCode, getReferralSummary } from "./referral";
import {
  attachMt5AccountToOrder,
  cancelOrder,
  chooseBrokerForOrder,
  createOrder,
  getOrder,
  insertMt5Account,
  listActivePackages,
  listMt5AccountsWithLicense,
  submitAccountForOrder,
} from "./repo";

const today = todayInBangkok(new Date());
const plusDays = (iso: string, n: number) => computeNewExpiry(n, iso, iso);
const fileDate = (iso: string) => iso.replaceAll("-", ".");

describe.skipIf(!hasTestDb)("แพ็กเกจ 4 แบบ + ชวนเพื่อน กับ PostgreSQL จริง", () => {
  let dir: string;
  /** id ของแพ็กเกจตาม code (หลัง applyPackageLineup) */
  let pkg: Record<string, string>;
  let inviter: string;
  let n = 0;

  const db = () => getDb();
  const newUser = async (email: string, referredByUserId?: string) =>
    (await createUser({ email, passwordHash: "scrypt$test", name: email, referredByUserId }))!.id;
  const userRow = async (id: string) => (await db().select().from(schema.users).where(eq(schema.users.id, id)))[0];
  const orderRow = async (id: string) => (await db().select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
  const claims = () => db().select().from(schema.referralClaims);
  const ledger = () => db().select().from(schema.licenseActivations);
  const licensesOf = (mt5AccountId: string) =>
    db().select().from(schema.licenses).where(eq(schema.licenses.mt5AccountId, mt5AccountId));
  const audits = async (action: string) => (await db().select().from(schema.auditLogs)).filter((a) => a.action === action);
  const file = () => readFile(path.join(dir, "license.txt"), "utf8").catch(() => null);
  const newAccount = async (owner: string, accountNumber: string) => {
    const r = await insertMt5Account(owner, { accountNumber, brokerServer: "Broker-Live" });
    if (!r.ok) throw new Error("เพิ่มบัญชีไม่ได้: " + r.reason);
    return r.id;
  };
  /** ชวนเพื่อน 1 คนให้ผู้ใช้นี้ (เพื่อนสมัครผ่านรหัสของเขา) */
  const inviteFriend = async (userId: string) => {
    const code = (await userRow(userId)).referralCode;
    const referrer = await findReferrerIdByCode(code);
    return newUser(`friend-${++n}@example.com`, referrer ?? undefined);
  };
  /** รับแพ็กเกจฟรี → เลือกโบรกเกอร์ → กรอกเลขบัญชี → เปิด license (ทางเดียวกับที่หน้าเว็บเรียก) */
  const claimFreeTo = async (userId: string, accountNumber: string) => {
    const created = await createOrder(userId, { packageId: pkg.free_referral });
    if (!created.ok || created.existing) throw new Error("รับแพ็กเกจฟรีไม่ได้: " + JSON.stringify(created));
    await fulfilOrder(created.id, { trigger: "payment" });
    expect(await chooseBrokerForOrder(userId, created.id, "hfm")).toEqual({ ok: true });
    const submitted = await submitAccountForOrder(userId, created.id, { accountNumber, brokerServer: "Broker-Live" });
    if (!submitted.ok) throw new Error("กรอกเลขบัญชีไม่ได้: " + submitted.reason);
    const fulfilment = await fulfilOrder(created.id, { trigger: "account" });
    return { orderId: created.id, accountId: submitted.accountId, fulfilment };
  };
  /** ซื้อแพ็กเกจที่ต้องจ่ายเงินให้บัญชีเดิม (ชำระจำลอง) → ต่ออายุ */
  const buyFor = async (userId: string, code: string, mt5AccountId: string) => {
    const created = await createOrder(userId, { packageId: pkg[code], mt5AccountId });
    if (!created.ok || created.existing) throw new Error("สั่งซื้อไม่ได้: " + JSON.stringify(created));
    const paid = await markOrderPaid(created.id, "mock", `mock-${created.id}`);
    return { orderId: created.id, paid };
  };

  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("PAYMENT_PROVIDER", "mock");
    dir = await mkdtemp(path.join(os.tmpdir(), "cme-oi-web-itest-referral-"));
    vi.stubEnv("LICENSE_STORAGE", "local");
    vi.stubEnv("LICENSE_LOCAL_DIR", dir);
    await applyPackageLineup();
    pkg = Object.fromEntries((await db().select().from(schema.packages)).map((p) => [p.code, p.id]));
    inviter = await newUser("inviter@example.com");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });
  afterAll(async () => {
    await closeDb();
  });

  describe("รายการแพ็กเกจ (seed)", () => {
    it("listActivePackages: 4 แพ็กเกจตามลำดับ พร้อมราคา อายุหลัก วันแถม อายุรวม และสั่งผ่านเว็บได้ทุกตัว", async () => {
      const list = await listActivePackages();
      expect(list.map((p) => [p.code, p.nameTh, p.priceThb, p.durationDays, p.bonusDays, p.totalDays, p.orderable])).toEqual([
        ["free_referral", "ฟรี 1 เดือน", 0, 30, 0, 30, true],
        ["three_months", "3 เดือน", 3000, 90, 15, 105, true],
        ["six_months", "6 เดือน", 6000, 180, 30, 210, true],
        ["yearly", "1 ปี", 11000, 365, 60, 425, true],
      ]);
      expect(list[0].description).toBe("ชวนเพื่อนสมัครสมาชิก 1 คน");
    });

    it("รันซ้ำกับฐานที่มีรายการชุดเดิม (ราคา null, รายเดือน/ตลอดชีพเปิดขาย) + คำสั่งซื้อ/license เดิม → ได้รายการใหม่ ไม่แตะข้อมูลอื่น", async () => {
      // จำลองฐานก่อนเปลี่ยนรายการ: seed ชุดเดิม (ไม่มี three_months / free_referral)
      await db().delete(schema.packages);
      const old = await db()
        .insert(schema.packages)
        .values([
          { code: "monthly", nameTh: "รายเดือน", durationDays: 30, priceThb: 1200, sortOrder: 1 },
          { code: "six_months", nameTh: "6 เดือน", durationDays: 180, priceThb: null, sortOrder: 2 },
          { code: "yearly", nameTh: "รายปี", durationDays: 365, priceThb: null, sortOrder: 3 },
          { code: "lifetime", nameTh: "ตลอดชีพ", durationDays: null, priceThb: 59000, sortOrder: 4 },
          { code: "ib", nameTh: "สำหรับลูกค้า IB", durationDays: 30, priceThb: 0, isActive: false, sortOrder: 5 },
        ])
        .returning();
      const oldId = Object.fromEntries(old.map((p) => [p.code, p.id]));
      // ลูกค้าเดิม: คำสั่งซื้อรายเดือนที่ชำระแล้ว + license ตลอดชีพที่ใช้งานอยู่
      const account = await newAccount(inviter, "70000001");
      const [order] = await db()
        .insert(schema.orders)
        .values({ userId: inviter, packageId: oldId.monthly, mt5AccountId: account, amountThb: 1200, status: "paid", paymentProvider: "gateway-x", paymentRef: "ch_old" })
        .returning();
      const [license] = await db()
        .insert(schema.licenses)
        .values({ userId: inviter, mt5AccountId: account, packageId: oldId.lifetime, orderId: order.id, startsAt: "2026-01-01", expiresAt: "9999-01-01", status: "active" })
        .returning();
      const snapshot = async () => ({
        packages: await db().select().from(schema.packages).orderBy(asc(schema.packages.sortOrder)),
        orders: await db().select().from(schema.orders),
        licenses: await db().select().from(schema.licenses),
        users: (await db().select().from(schema.users)).length,
      });

      expect(await applyPackageLineup()).toBe(PACKAGE_LINEUP.length);
      const first = await snapshot();
      expect(await applyPackageLineup()).toBe(PACKAGE_LINEUP.length);
      const second = await snapshot();
      expect(second).toEqual(first);

      expect(first.packages.map((p) => [p.code, p.isActive, p.priceThb, p.durationDays, p.bonusDays, p.nameTh])).toEqual([
        ["free_referral", true, 0, 30, 0, "ฟรี 1 เดือน"],
        ["three_months", true, 3000, 90, 15, "3 เดือน"],
        ["six_months", true, 6000, 180, 30, "6 เดือน"],
        ["yearly", true, 11000, 365, 60, "1 ปี"],
        // เลิกขาย: ปิด ไม่ลบ และราคาเดิมไม่ถูกแตะ
        ["monthly", false, 1200, 30, 0, "รายเดือน"],
        ["lifetime", false, 59000, null, 0, "ตลอดชีพ"],
        ["ib", false, 0, 30, 0, "สำหรับลูกค้า IB"],
      ]);
      // id ของแถวเดิมไม่เปลี่ยน → คำสั่งซื้อ/license ที่อ้างอยู่ยังชี้ถูกแถว
      for (const code of Object.keys(oldId)) expect(first.packages.find((p) => p.code === code)?.id, code).toBe(oldId[code]);
      expect(first.orders).toHaveLength(1);
      expect(first.orders[0]).toMatchObject({ id: order.id, packageId: oldId.monthly, amountThb: 1200, status: "paid" });
      expect(first.licenses).toEqual([expect.objectContaining({ id: license.id, packageId: oldId.lifetime, expiresAt: "9999-01-01", status: "active" })]);

      // license ตลอดชีพเดิมยังใช้งานได้และกติกา lifetime_active เหมือนเดิม: ซื้อ/รับฟรีทับไม่ได้
      const lineup = Object.fromEntries(first.packages.map((p) => [p.code, p.id]));
      expect(await createOrder(inviter, { packageId: lineup.three_months, mt5AccountId: account })).toEqual({ ok: false, reason: "lifetime_active" });
      // แพ็กเกจที่เลิกขายสั่งซื้อไม่ได้แล้ว แม้ส่ง id มาตรงๆ
      expect(await createOrder(inviter, { packageId: lineup.monthly })).toEqual({ ok: false, reason: "package_unavailable" });
      expect(await createOrder(inviter, { packageId: lineup.lifetime })).toEqual({ ok: false, reason: "package_unavailable" });
      expect(await createOrder(inviter, { packageId: lineup.ib })).toEqual({ ok: false, reason: "package_unavailable" });
    });
  });

  describe("รหัสชวนเพื่อนและการบันทึกผู้ชวน", () => {
    it("ผู้ใช้ทุกคนได้รหัสไม่ซ้ำกัน (เลขฐานสิบหก 10 ตัว) จากฐานข้อมูลเอง", async () => {
      const ids = await Promise.all(Array.from({ length: 25 }, (_, i) => newUser(`u${i}@example.com`)));
      const codes = await Promise.all(ids.map(async (id) => (await userRow(id)).referralCode));
      for (const code of codes) expect(code).toMatch(/^[0-9A-F]{10}$/);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it("สมัครผ่านรหัส → นับให้ผู้ชวน; รหัสที่ไม่มีอยู่จริง → ไม่มีผู้ชวน; สรุปของหน้าสมาชิกถูกต้อง", async () => {
      const code = (await userRow(inviter)).referralCode;
      expect(await findReferrerIdByCode(code)).toBe(inviter);
      expect(await findReferrerIdByCode("0000000000")).toBeNull();
      expect(await getReferralSummary(inviter)).toEqual({ code, referredCount: 0, claim: null });

      const friend = await inviteFriend(inviter);
      expect((await userRow(friend)).referredByUserId).toBe(inviter);
      expect(await countReferredUsers(db(), inviter)).toBe(1);
      // เพื่อนไม่ได้อะไรเป็นพิเศษ และจำนวนของเพื่อนเองยังเป็น 0
      expect(await getReferralSummary(friend)).toMatchObject({ referredCount: 0, claim: null });
      expect(await getReferralSummary(inviter)).toMatchObject({ referredCount: 1, claim: null });
      expect(await getReferralSummary("3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f")).toBeNull();
    });

    it("ฐานข้อมูลไม่ยอมให้ชวนตัวเอง และรหัสซ้ำกันไม่ได้", async () => {
      await expect(db().update(schema.users).set({ referredByUserId: inviter }).where(eq(schema.users.id, inviter))).rejects.toThrow();
      const other = await newUser("other@example.com");
      const code = (await userRow(inviter)).referralCode;
      const clash = await db()
        .update(schema.users)
        .set({ referralCode: code })
        .where(eq(schema.users.id, other))
        .then(() => null, (err) => err);
      expect(isUniqueViolation(clash, "users_referral_code_unique")).toBe(true);
    });
  });

  describe("รับแพ็กเกจฟรี (สร้างคำสั่งซื้อ)", () => {
    it("ยังไม่มีเพื่อนสมัคร → ปฏิเสธ ไม่มีคำสั่งซื้อ ไม่มีแถวสิทธิ์ (รวมคำขอที่สร้างเอง)", async () => {
      expect(await createOrder(inviter, { packageId: pkg.free_referral })).toEqual({ ok: false, reason: "free_referral_required" });
      expect(await db().select().from(schema.orders)).toHaveLength(0);
      expect(await claims()).toHaveLength(0);
      // เพื่อนของ "คนอื่น" ไม่นับ
      const other = await newUser("other@example.com");
      await inviteFriend(other);
      expect(await createOrder(inviter, { packageId: pkg.free_referral })).toEqual({ ok: false, reason: "free_referral_required" });
    });

    it("มีเพื่อนสมัครแล้ว → ได้คำสั่งซื้อ 0 บาทที่เป็น \"รับสิทธิ์แล้ว\" ทันที (provider referral) ไม่มีขั้นชำระเงิน", async () => {
      await inviteFriend(inviter);
      const created = await createOrder(inviter, { packageId: pkg.free_referral });
      expect(created).toEqual({ ok: true, id: expect.any(String), existing: false, freeClaim: true });
      if (!created.ok) return;
      const order = await orderRow(created.id);
      expect(order).toMatchObject({
        status: "paid",
        amountThb: 0,
        paymentProvider: "referral",
        paymentRef: `referral-${created.id}`,
        // ไม่ใช่การชำระด้วยบัตร/โอน
        paymentMethod: null,
        mt5AccountId: null,
      });
      expect(order.paidAt).toBeInstanceOf(Date);
      expect(await claims()).toEqual([
        expect.objectContaining({ userId: inviter, orderId: created.id, mt5AccountId: null, activatedAt: null }),
      ]);
      expect((await audits("order.paid")).map((a) => a.data)).toEqual([
        { provider: "referral", providerRef: `referral-${created.id}`, amountThb: 0 },
      ]);
      // หน้าเว็บเห็นเป็นคำสั่งซื้อที่รอเลือกโบรกเกอร์ ไม่ถูกกัน
      const dto = await getOrder(inviter, created.id);
      expect(dto).toMatchObject({ status: "paid", packageCode: "free_referral", paymentProvider: "referral", amountThb: 0 });
      expect(await getActivationBlock(dto!)).toBeNull();
      expect(await getReferralSummary(inviter)).toMatchObject({ referredCount: 1, claim: { orderId: created.id, activated: false } });
    });

    it("กดซ้ำ / สองคำขอพร้อมกัน → คำสั่งซื้อเดียว สิทธิ์เดียว", async () => {
      await inviteFriend(inviter);
      const results = await Promise.all(Array.from({ length: 4 }, () => createOrder(inviter, { packageId: pkg.free_referral })));
      const fresh = results.filter((r) => r.ok && !r.existing);
      const reused = results.filter((r) => r.ok && r.existing);
      expect(fresh).toHaveLength(1);
      expect(reused).toHaveLength(3);
      const id = fresh[0].ok ? fresh[0].id : "";
      for (const r of reused) expect(r).toEqual({ ok: true, id, existing: true, samePackage: true });
      expect(await db().select().from(schema.orders)).toHaveLength(1);
      expect(await claims()).toHaveLength(1);
    });

    it("ฐานข้อมูลเป็นด่านสุดท้าย: แถวสิทธิ์ที่สองของผู้ใช้เดียวกัน / บัญชีเดียวกัน ถูกปฏิเสธด้วย unique constraint", async () => {
      await inviteFriend(inviter);
      const created = await createOrder(inviter, { packageId: pkg.free_referral });
      const [other] = await db().insert(schema.orders).values({ userId: inviter, packageId: pkg.free_referral, amountThb: 0 }).returning();
      const second = await db()
        .insert(schema.referralClaims)
        .values({ userId: inviter, orderId: other.id })
        .then(() => null, (err) => err);
      expect(isUniqueViolation(second, "referral_claims_user_id_unique")).toBe(true);

      // ครั้งเดียวต่อบัญชี MT5: สองแถวสิทธิ์ (ของผู้ใช้คนละคน) ชี้บัญชีเดียวกันไม่ได้
      const account = await newAccount(inviter, "70000002");
      const stranger = await newUser("stranger@example.com");
      const [strangerOrder] = await db().insert(schema.orders).values({ userId: stranger, packageId: pkg.free_referral, amountThb: 0 }).returning();
      await db().update(schema.referralClaims).set({ mt5AccountId: account, activatedAt: new Date() }).where(eq(schema.referralClaims.userId, inviter));
      const dup = await db()
        .insert(schema.referralClaims)
        .values({ userId: stranger, orderId: strangerOrder.id, mt5AccountId: account, activatedAt: new Date() })
        .then(() => null, (err) => err);
      expect(isUniqueViolation(dup, "referral_claims_mt5_account_id_unique")).toBe(true);
      // บัญชีต้องถูกบันทึกพร้อมเวลาที่ใช้สิทธิ์เสมอ
      await expect(
        db().insert(schema.referralClaims).values({ userId: stranger, orderId: strangerOrder.id, mt5AccountId: null, activatedAt: new Date() }),
      ).rejects.toThrow();
      expect(created.ok).toBe(true);
    });
  });

  describe("เปิด license จากแพ็กเกจฟรี", () => {
    it("เลือกโบรกเกอร์ → กรอกเลขบัญชี → license ใช้ได้ 30 วัน อยู่ในรายชื่อที่เผยแพร่ และสิทธิ์ถูกใช้ (ผูกกับบัญชี)", async () => {
      await inviteFriend(inviter);
      const { orderId, accountId, fulfilment } = await claimFreeTo(inviter, "70000010");
      const expiry = plusDays(today, 30);
      expect(fulfilment.activation).toMatchObject({ status: "activated", kind: "new", expiresAt: expiry });
      expect(fulfilment.publish).toMatchObject({ status: "published", entryCount: 1 });
      expect(await file()).toBe(`id70000010.${fileDate(expiry)}`);
      expect(await licensesOf(accountId)).toEqual([
        expect.objectContaining({ status: "active", startsAt: today, expiresAt: expiry, packageId: pkg.free_referral, orderId, source: "web" }),
      ]);
      expect(await ledger()).toEqual([expect.objectContaining({ orderId, durationDays: 30, previousExpiresAt: null, newExpiresAt: expiry })]);
      const [claim] = await claims();
      expect(claim).toMatchObject({ userId: inviter, orderId, mt5AccountId: accountId });
      expect(claim.activatedAt).toBeInstanceOf(Date);
      expect((await audits("license.activate"))[0].data).toMatchObject({ baseDays: 30, bonusDays: 0, freeClaim: true });
      expect(await getReferralSummary(inviter)).toMatchObject({ claim: { orderId, activated: true } });

      // เรียกซ้ำ: ไม่ต่ออายุซ้ำ
      expect((await fulfilOrder(orderId, { trigger: "retry" })).activation).toMatchObject({ status: "already_activated", expiresAt: expiry });
      expect(await ledger()).toHaveLength(1);
    });

    it("รับครั้งที่สองโดยผู้ใช้เดิม → ปฏิเสธ (ครั้งเดียวต่อผู้ใช้) แม้ชวนเพื่อนเพิ่ม", async () => {
      await inviteFriend(inviter);
      await claimFreeTo(inviter, "70000011");
      await inviteFriend(inviter);
      await inviteFriend(inviter);
      expect(await createOrder(inviter, { packageId: pkg.free_referral })).toEqual({ ok: false, reason: "free_already_claimed" });
      const account2 = await newAccount(inviter, "70000012");
      expect(await createOrder(inviter, { packageId: pkg.free_referral, mt5AccountId: account2 })).toEqual({ ok: false, reason: "free_already_claimed" });
      expect(await db().select().from(schema.orders)).toHaveLength(1);
      expect(await claims()).toHaveLength(1);
    });

    it("บัญชี MT5 ที่เคยได้แพ็กเกจฟรีแล้ว → ผู้ใช้อีกคน (ที่ยังไม่เคยรับ) รับให้บัญชีนั้นไม่ได้ ทั้งตอนสั่ง ตอนผูกบัญชี และตอนเปิด", async () => {
      await inviteFriend(inviter);
      const { accountId } = await claimFreeTo(inviter, "70000013");
      // บัญชีถูกย้ายเจ้าของ (จำลองทีมงานย้ายให้) — เจ้าของใหม่มีเพื่อนสมัครแล้วและยังไม่เคยรับสิทธิ์
      const second = await newUser("second@example.com");
      await inviteFriend(second);
      await db().update(schema.mt5Accounts).set({ userId: second }).where(eq(schema.mt5Accounts.id, accountId));

      // 1) ตอนสั่งซื้อ
      expect(await createOrder(second, { packageId: pkg.free_referral, mt5AccountId: accountId })).toEqual({ ok: false, reason: "free_account_used" });
      expect(await claims()).toHaveLength(1);

      // 2) รับสิทธิ์แบบยังไม่ระบุบัญชี แล้วพยายามผูกบัญชีนั้นทีหลัง
      const created = await createOrder(second, { packageId: pkg.free_referral });
      expect(created).toMatchObject({ ok: true, freeClaim: true });
      if (!created.ok) return;
      expect(await attachMt5AccountToOrder(second, created.id, accountId)).toEqual({ ok: false, reason: "free_account_used" });
      expect((await orderRow(created.id)).mt5AccountId).toBeNull();

      // 3) ด่านสุดท้ายตอนเปิด license: ต่อให้คำสั่งซื้อถูกผูกบัญชีนั้นด้วยทางอื่น ก็ไม่เปิด
      await db().update(schema.orders).set({ mt5AccountId: accountId }).where(eq(schema.orders.id, created.id));
      const before = await licensesOf(accountId);
      expect(await activateOrderIfReady(created.id)).toEqual({ status: "blocked", reason: "free_account_used" });
      expect(await licensesOf(accountId)).toEqual(before);
      expect(await ledger()).toHaveLength(1);
      expect(await getActivationBlock((await getOrder(second, created.id))!)).toBe("free_account_used");
      expect((await audits("license.activate_blocked")).map((a) => (a.data as { reason: string }).reason)).toEqual(["free_account_used"]);

      // ยกเลิกเพื่อคืนสิทธิ์ แล้วรับใหม่กับบัญชีอื่นได้
      expect(await cancelOrder(second, created.id)).toEqual({ ok: true, freeClaimReleased: true });
      const again = await claimFreeTo(second, "70000014");
      expect(again.fulfilment.activation).toMatchObject({ status: "activated", expiresAt: plusDays(today, 30) });
    });

    it("สิทธิ์ถูกตรวจซ้ำตอนเปิด: ไม่มีเพื่อนแล้ว / ไม่มีแถวสิทธิ์ / provider ไม่ตรงกับแพ็กเกจ → ไม่เปิด license", async () => {
      const friend = await inviteFriend(inviter);
      const created = await createOrder(inviter, { packageId: pkg.free_referral });
      if (!created.ok) throw new Error("ต้องรับสิทธิ์ได้");
      const account = await newAccount(inviter, "70000015");
      await db().update(schema.orders).set({ mt5AccountId: account }).where(eq(schema.orders.id, created.id));

      // เพื่อนคนเดียวที่ชวนมาหายไป (เช่นบัญชีเพื่อนถูกลบ) → ไม่ครบเงื่อนไขแล้ว
      await db().update(schema.users).set({ referredByUserId: null }).where(eq(schema.users.id, friend));
      expect(await activateOrderIfReady(created.id)).toEqual({ status: "blocked", reason: "free_referral_required" });
      await db().update(schema.users).set({ referredByUserId: inviter }).where(eq(schema.users.id, friend));

      // ไม่มีแถวสิทธิ์ของคำสั่งซื้อนี้
      const [claim] = await claims();
      await db().delete(schema.referralClaims);
      expect(await activateOrderIfReady(created.id)).toEqual({ status: "blocked", reason: "free_claim_invalid" });
      expect(await getActivationBlock((await getOrder(inviter, created.id))!)).toBe("free_claim_invalid");
      await db().insert(schema.referralClaims).values({ id: claim.id, userId: inviter, orderId: created.id });

      // แพ็กเกจฟรีที่ถูกบันทึกว่าชำระด้วย provider อื่น (ไม่ได้มาทางสิทธิ์ชวนเพื่อน)
      await db().update(schema.orders).set({ paymentProvider: "gateway-x" }).where(eq(schema.orders.id, created.id));
      expect(await activateOrderIfReady(created.id)).toEqual({ status: "blocked", reason: "free_claim_invalid" });
      // provider "referral" กับแพ็กเกจที่ต้องจ่ายเงิน = ไม่ใช่สิทธิ์ฟรี
      await db().update(schema.orders).set({ paymentProvider: "referral", packageId: pkg.yearly }).where(eq(schema.orders.id, created.id));
      expect(await activateOrderIfReady(created.id)).toEqual({ status: "blocked", reason: "free_claim_invalid" });
      expect(await licensesOf(account)).toHaveLength(0);
      expect(await ledger()).toHaveLength(0);

      // คืนค่าให้ถูก → เปิดได้ตามปกติ (การกันไม่ถาวร)
      await db().update(schema.orders).set({ packageId: pkg.free_referral }).where(eq(schema.orders.id, created.id));
      expect(await activateOrderIfReady(created.id)).toMatchObject({ status: "activated", expiresAt: plusDays(today, 30) });
    });

    it("รับให้บัญชีเดิมที่มี license อยู่แล้ว → ต่อจากวันหมดอายุเดิม 30 วัน ทันทีตอนรับสิทธิ์", async () => {
      await inviteFriend(inviter);
      const account = await newAccount(inviter, "70000016");
      const first = await buyFor(inviter, "three_months", account);
      expect(first.paid).toMatchObject({ ok: true });
      const paidExpiry = plusDays(today, 105);
      const created = await createOrder(inviter, { packageId: pkg.free_referral, mt5AccountId: account });
      expect(created).toMatchObject({ ok: true, freeClaim: true });
      if (!created.ok) return;
      const fulfilment = await fulfilOrder(created.id, { trigger: "payment" });
      expect(fulfilment.activation).toMatchObject({ status: "activated", kind: "extended", expiresAt: plusDays(paidExpiry, 30) });
      expect(await file()).toBe(`id70000016.${fileDate(plusDays(paidExpiry, 30))}`);
    });

    it("บัญชีที่มี license ตลอดชีพ / ถูกระงับ → รับแพ็กเกจฟรีให้บัญชีนั้นไม่ได้ และไม่เสียสิทธิ์", async () => {
      await inviteFriend(inviter);
      const lifetime = await newAccount(inviter, "70000017");
      await db().insert(schema.licenses).values({ userId: inviter, mt5AccountId: lifetime, startsAt: "2026-01-01", expiresAt: "9999-01-01", status: "active", source: "import" });
      expect(await createOrder(inviter, { packageId: pkg.free_referral, mt5AccountId: lifetime })).toEqual({ ok: false, reason: "lifetime_active" });
      const suspended = await newAccount(inviter, "70000018");
      await db().insert(schema.licenses).values({ userId: inviter, mt5AccountId: suspended, startsAt: "2026-01-01", expiresAt: "2027-01-01", status: "suspended", source: "import" });
      expect(await createOrder(inviter, { packageId: pkg.free_referral, mt5AccountId: suspended })).toEqual({ ok: false, reason: "license_suspended" });
      expect(await claims()).toHaveLength(0);
      expect(await db().select().from(schema.orders)).toHaveLength(0);
    });
  });

  describe("ยกเลิกก่อนเปิด license = คืนสิทธิ์", () => {
    it("ยกเลิกคำสั่งซื้อฟรีที่ยังไม่ได้เปิด → สิทธิ์กลับมา รับใหม่ได้ และคำสั่งซื้อเดิมเอาไปเปิด license ไม่ได้อีก", async () => {
      await inviteFriend(inviter);
      const first = await createOrder(inviter, { packageId: pkg.free_referral });
      if (!first.ok) throw new Error("ต้องรับสิทธิ์ได้");
      await chooseBrokerForOrder(inviter, first.id, "hfm");
      // คนอื่นยกเลิกแทนไม่ได้
      const other = await newUser("other@example.com");
      expect(await cancelOrder(other, first.id)).toEqual({ ok: false, reason: "order_not_found" });
      expect(await claims()).toHaveLength(1);

      expect(await cancelOrder(inviter, first.id)).toEqual({ ok: true, freeClaimReleased: true });
      expect((await orderRow(first.id)).status).toBe("cancelled");
      expect(await claims()).toHaveLength(0);
      expect(await getReferralSummary(inviter)).toMatchObject({ referredCount: 1, claim: null });
      expect((await audits("order.cancel")).map((a) => a.data)).toEqual([{ freeClaimReleased: true }]);
      // ยกเลิกซ้ำ / เอาคำสั่งซื้อที่ยกเลิกแล้วไปกรอกเลขบัญชี
      expect(await cancelOrder(inviter, first.id)).toEqual({ ok: false, reason: "order_not_cancellable" });
      expect(await submitAccountForOrder(inviter, first.id, { accountNumber: "70000020", brokerServer: "Broker-Live" })).toEqual({ ok: false, reason: "order_not_paid" });
      expect(await markOrderPaid(first.id, "referral", `referral-${first.id}`)).toEqual({ ok: false, reason: "order_not_payable" });
      expect((await orderRow(first.id)).status).toBe("cancelled");

      // รับใหม่ได้ และใช้จนเปิด license ได้
      const second = await claimFreeTo(inviter, "70000021");
      expect(second.orderId).not.toBe(first.id);
      expect(second.fulfilment.activation).toMatchObject({ status: "activated" });
      expect(await claims()).toHaveLength(1);
    });

    it("เปิด license แล้วยกเลิกไม่ได้ (สิทธิ์ถูกใช้แล้ว) และคำสั่งซื้อที่ชำระเงินแล้วยกเลิกเองไม่ได้เหมือนเดิม", async () => {
      await inviteFriend(inviter);
      const { orderId, accountId } = await claimFreeTo(inviter, "70000022");
      expect(await cancelOrder(inviter, orderId)).toEqual({ ok: false, reason: "order_not_cancellable" });
      expect((await orderRow(orderId)).status).toBe("paid");
      expect(await claims()).toHaveLength(1);
      expect((await licensesOf(accountId))[0].status).toBe("active");

      // คำสั่งซื้อที่ชำระเงิน (จำลอง) แล้ว ยังไม่มีบัญชี → ยกเลิกเองไม่ได้
      const paid = await createOrder(inviter, { packageId: pkg.yearly });
      if (!paid.ok) throw new Error("ต้องสั่งซื้อได้");
      await markOrderPaid(paid.id, "mock", `mock-${paid.id}`);
      expect(await cancelOrder(inviter, paid.id)).toEqual({ ok: false, reason: "order_not_cancellable" });
    });
  });

  /**
   * lockUser (FOR NO KEY UPDATE) กับ foreign key ของ INSERT ในขั้นเปิด license ต้องไม่เป็นวง
   * ตอน lockUser เป็น FOR UPDATE สองกรณีนี้ deadlock แทบทุกรอบ: ฝ่ายหนึ่งถูก PostgreSQL ยกเลิกด้วย 40P01 หลังรอครบ deadlock_timeout (ปกติ 1 วินาที)
   * เทสจึงดูทั้ง "ไม่มีฝ่ายไหน throw / ไม่มี audit license.activate_failed" และ "ไม่มีรอบไหนช้าถึง deadlock_timeout"
   * (ข้อหลังจับกรณีที่ขั้นเปิด license เป็นฝ่ายแพ้แล้วลองใหม่เองสำเร็จ ซึ่งผลลัพธ์ดูปกติ)
   */
  describe("ไม่ deadlock: ล็อกแถวผู้ใช้กับขั้นเปิด license", () => {
    const ROUNDS = 6;
    const deadlockTimeoutMs = async () => {
      const [row] = await db().execute<{ ms: string }>(
        sql`select (extract(epoch from current_setting('deadlock_timeout')::interval) * 1000)::int as ms`,
      );
      return Number(row.ms);
    };

    it("ยกเลิกคำสั่งซื้อฟรีพร้อมกับการเปิด license ของคำสั่งซื้อเดียวกัน → จบทั้งคู่ ได้ผลอย่างใดอย่างหนึ่ง ไม่มี 40P01", async () => {
      const limit = await deadlockTimeoutMs();
      let slowest = 0;
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser(`race-cancel-${round}@example.com`);
        await inviteFriend(user);
        const created = await createOrder(user, { packageId: pkg.free_referral });
        if (!created.ok) throw new Error("ต้องรับสิทธิ์ได้");
        await chooseBrokerForOrder(user, created.id, "hfm");
        const submitted = await submitAccountForOrder(user, created.id, { accountNumber: String(71000000 + round), brokerServer: "Broker-Live" });
        if (!submitted.ok) throw new Error("ต้องกรอกเลขได้");

        const startedAt = performance.now();
        const [fulfilled, cancelled] = await Promise.allSettled([
          fulfilOrder(created.id, { trigger: "account" }),
          cancelOrder(user, created.id),
        ]);
        slowest = Math.max(slowest, performance.now() - startedAt);

        if (fulfilled.status !== "fulfilled" || cancelled.status !== "fulfilled") throw new Error("ต้องไม่มีฝ่ายไหน throw");
        const licenses = await licensesOf(submitted.accountId);
        const claim = (await claims()).find((c) => c.orderId === created.id);
        if (cancelled.value.ok) {
          // ยกเลิกชนะ: สิทธิ์ถูกคืน ไม่มี license
          expect(cancelled.value).toEqual({ ok: true, freeClaimReleased: true });
          expect(fulfilled.value.activation).toEqual({ status: "not_ready", reason: "not_paid" });
          expect((await orderRow(created.id)).status).toBe("cancelled");
          expect(licenses).toHaveLength(0);
          expect(claim).toBeUndefined();
        } else {
          // เปิด license ชนะ: สิทธิ์ถูกใช้ ยกเลิกไม่ได้
          expect(cancelled.value).toEqual({ ok: false, reason: "order_not_cancellable" });
          expect(fulfilled.value.activation).toMatchObject({ status: "activated" });
          expect((await orderRow(created.id)).status).toBe("paid");
          expect(licenses.map((l) => l.status)).toEqual(["active"]);
          expect(claim?.activatedAt).not.toBeNull();
        }
      }
      expect(await audits("license.activate_failed")).toHaveLength(0);
      expect(slowest).toBeLessThan(limit);
    });

    it("รับแพ็กเกจฟรีให้บัญชีเดิม พร้อมกับการเปิด license ครั้งแรกของคำสั่งซื้อที่ชำระแล้วของบัญชีเดียวกัน → เปิดได้ทั้งคู่ ไม่มี 40P01", async () => {
      const limit = await deadlockTimeoutMs();
      let slowest = 0;
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser(`race-claim-${round}@example.com`);
        await inviteFriend(user);
        const account = await newAccount(user, String(72000000 + round));
        // คำสั่งซื้อที่ต้องจ่ายเงินของบัญชีนี้ ชำระแล้ว แต่ยังไม่ได้เปิด license (บันทึก "ชำระแล้ว" ตรงในฐานข้อมูล ไม่ผ่าน fulfilOrder)
        const [paid] = await db()
          .insert(schema.orders)
          .values({ userId: user, packageId: pkg.three_months, mt5AccountId: account, amountThb: 3000, status: "paid", paidAt: new Date(), paymentMethod: "card", paymentProvider: "mock", paymentRef: `mock-race-${round}` })
          .returning();

        const startedAt = performance.now();
        const [fulfilled, claimed] = await Promise.allSettled([
          fulfilOrder(paid.id, { trigger: "payment" }),
          createOrder(user, { packageId: pkg.free_referral, mt5AccountId: account }),
        ]);
        slowest = Math.max(slowest, performance.now() - startedAt);

        if (fulfilled.status !== "fulfilled" || claimed.status !== "fulfilled") throw new Error("ต้องไม่มีฝ่ายไหน throw");
        expect(fulfilled.value.activation).toMatchObject({ status: "activated" });
        if (!claimed.value.ok || claimed.value.existing) throw new Error("ต้องรับสิทธิ์ได้: " + JSON.stringify(claimed.value));
        expect((await fulfilOrder(claimed.value.id, { trigger: "payment" })).activation).toMatchObject({ status: "activated" });
        // ได้อายุครบทั้งสองรายการ ไม่ว่ารายการไหนเปิดก่อน: 105 + 30 วัน
        expect((await licensesOf(account)).map((l) => [l.status, l.expiresAt])).toEqual([["active", plusDays(today, 135)]]);
      }
      expect(await audits("license.activate_failed")).toHaveLength(0);
      expect(slowest).toBeLessThan(limit);
    });
  });

  describe("ด่านของการบันทึก \"ชำระแล้ว\"", () => {
    it("provider referral ใช้กับคำสั่งซื้อแพ็กเกจที่ต้องจ่ายเงินไม่ได้ (ไม่ได้ของฟรี)", async () => {
      await inviteFriend(inviter);
      const paid = await createOrder(inviter, { packageId: pkg.three_months });
      if (!paid.ok) throw new Error("ต้องสั่งซื้อได้");
      expect(await markOrderPaid(paid.id, "referral", `referral-${paid.id}`)).toEqual({ ok: false, reason: "order_not_payable" });
      expect(await orderRow(paid.id)).toMatchObject({ status: "pending_payment", paymentProvider: null, paidAt: null });
      expect((await audits("order.payment_unexpected")).map((a) => (a.data as { reason: string }).reason)).toEqual(["not_a_free_claim"]);
    });

    it("คำสั่งซื้อแพ็กเกจฟรีรับการชำระจำลอง (หรือ provider อื่น) ไม่ได้ และแพ็กเกจฟรีที่ไม่มีแถวสิทธิ์ก็บันทึกด้วย referral ไม่ได้", async () => {
      // คำสั่งซื้อแพ็กเกจฟรีที่ค้างรอชำระ (สร้างตรงในฐานข้อมูล — ทางปกติไม่มีสถานะนี้)
      const [stray] = await db().insert(schema.orders).values({ userId: inviter, packageId: pkg.free_referral, amountThb: 0 }).returning();
      expect(await markOrderPaid(stray.id, "mock", `mock-${stray.id}`)).toEqual({ ok: false, reason: "order_not_payable" });
      expect(await markOrderPaid(stray.id, "referral", `referral-${stray.id}`)).toEqual({ ok: false, reason: "order_not_payable" });
      expect(await orderRow(stray.id)).toMatchObject({ status: "pending_payment", paymentProvider: null });
      expect((await audits("order.payment_unexpected")).map((a) => (a.data as { reason: string }).reason).sort()).toEqual(["free_package", "not_a_free_claim"]);
      // ลูกค้ายกเลิกรายการค้างแบบนี้เองได้
      expect(await cancelOrder(inviter, stray.id)).toEqual({ ok: true, freeClaimReleased: false });
    });

    it("บันทึกซ้ำด้วยเลขอ้างอิงเดิม → ไม่เขียนอะไรเพิ่ม (idempotent)", async () => {
      await inviteFriend(inviter);
      const created = await createOrder(inviter, { packageId: pkg.free_referral });
      if (!created.ok) throw new Error("ต้องรับสิทธิ์ได้");
      const before = await orderRow(created.id);
      expect(await markOrderPaid(created.id, "referral", `referral-${created.id}`)).toMatchObject({ ok: true, alreadyPaid: true });
      expect(await orderRow(created.id)).toEqual(before);
      expect(await audits("order.paid")).toHaveLength(1);
      expect(await audits("order.payment_duplicate")).toHaveLength(0);
    });
  });

  describe("แพ็กเกจฟรีไม่ใช่การชำระเงินจำลอง", () => {
    it("ปิด mock (ไม่ตั้ง PAYMENT_PROVIDER): แพ็กเกจฟรียังรับและเปิด license ได้ ส่วนคำสั่งซื้อที่ชำระจำลองยังถูกกัน", async () => {
      await inviteFriend(inviter);
      // คำสั่งซื้อจำลองที่ชำระไว้ตอน mock ยังเปิดอยู่ (ยังไม่กรอกเลขบัญชี)
      const mockOrder = await createOrder(inviter, { packageId: pkg.three_months });
      if (!mockOrder.ok) throw new Error("ต้องสั่งซื้อได้");
      await markOrderPaid(mockOrder.id, "mock", `mock-${mockOrder.id}`);
      await chooseBrokerForOrder(inviter, mockOrder.id, "hfm");

      vi.stubEnv("PAYMENT_PROVIDER", "");
      const free = await claimFreeTo(inviter, "70000030");
      expect(free.fulfilment.activation).toMatchObject({ status: "activated", expiresAt: plusDays(today, 30) });
      expect(free.fulfilment.publish).toMatchObject({ status: "published", entryCount: 1 });

      const submitted = await submitAccountForOrder(inviter, mockOrder.id, { accountNumber: "70000031", brokerServer: "Broker-Live" });
      if (!submitted.ok) throw new Error("ต้องกรอกเลขได้");
      expect((await fulfilOrder(mockOrder.id, { trigger: "account" })).activation).toEqual({ status: "blocked", reason: "mock_payment" });
      expect(await licensesOf(submitted.accountId)).toHaveLength(0);
      expect(await file()).toBe(`id70000030.${fileDate(plusDays(today, 30))}`);
      expect(await getActivationBlock((await getOrder(inviter, mockOrder.id))!)).toBe("mock_payment");
      // สคริปต์เก็บตกก็ให้ผลเดียวกัน
      expect(await sweepPendingActivations()).toEqual({ activated: 0, blocked: 1, failed: 0 });
    });

    it("ด่านเผยแพร่ไปรายชื่อจริงและ license:purge-mock ไม่นับ/ไม่แตะ license จากแพ็กเกจฟรี", async () => {
      await inviteFriend(inviter);
      const free = await claimFreeTo(inviter, "70000032");
      expect(await countActiveMockPaidLicenses()).toBe(0);
      // อีกบัญชีหนึ่งซื้อด้วยการชำระจำลอง
      const mockAccount = await newAccount(inviter, "70000033");
      await buyFor(inviter, "three_months", mockAccount);
      expect(await countActiveMockPaidLicenses()).toBe(1);

      const report = await purgeMockData({ apply: true });
      expect(report).toMatchObject({ applied: true, ordersCancelled: 1, activationsRemoved: 1, licensesExpired: 1, licensesRestored: 0, skippedLicenseIds: [] });
      expect((await orderRow(free.orderId)).status).toBe("paid");
      expect((await licensesOf(free.accountId))[0]).toMatchObject({ status: "active", expiresAt: plusDays(today, 30) });
      expect((await licensesOf(mockAccount))[0].status).toBe("expired");
      expect(await claims()).toHaveLength(1);
      expect(await countActiveMockPaidLicenses()).toBe(0);
    });

    it("license ที่สร้างด้วยการชำระจำลองแล้วต่ออายุด้วยแพ็กเกจฟรี → purge ข้าม (ไม่เดาวันหมดอายุ) และด่านเผยแพร่ไปรายชื่อจริงยังนับอยู่", async () => {
      // พฤติกรรมที่ตั้งใจ (ล้มไปทางปลอดภัย) — บันทึกไว้ใน README "ก่อนเปิดระบบจริง" ข้อ 2: ฐานข้อมูลแบบนี้ต้องเริ่มระบบจริงด้วยฐานข้อมูลใหม่
      await inviteFriend(inviter);
      const account = await newAccount(inviter, "70000034");
      const mock = await buyFor(inviter, "six_months", account);
      const free = await createOrder(inviter, { packageId: pkg.free_referral, mt5AccountId: account });
      if (!free.ok || free.existing) throw new Error("ต้องรับสิทธิ์ได้");
      expect((await fulfilOrder(free.id, { trigger: "payment" })).activation).toMatchObject({ status: "activated", kind: "extended", expiresAt: plusDays(today, 240) });

      const [license] = await licensesOf(account);
      const report = await purgeMockData({ apply: true });
      expect(report).toMatchObject({ ordersCancelled: 0, activationsRemoved: 0, licensesExpired: 0, licensesRestored: 0, skippedLicenseIds: [license.id] });
      expect((await licensesOf(account))[0]).toMatchObject({ status: "active", expiresAt: plusDays(today, 240) });
      expect((await orderRow(mock.orderId)).status).toBe("paid");
      expect((await orderRow(free.id)).status).toBe("paid");
      expect(await claims()).toHaveLength(1);
      expect(await countActiveMockPaidLicenses()).toBe(1);
    });
  });

  describe("แพ็กเกจที่ต้องจ่ายเงิน: อายุ = อายุหลัก + วันแถม", () => {
    it.each([
      ["three_months", 3000, 105, 90, 15],
      ["six_months", 6000, 210, 180, 30],
      ["yearly", 11000, 425, 365, 60],
    ] as const)("%s: ยอด %i บาท → license %i วัน และสมุดบันทึกเก็บยอดรวมที่ให้จริง", async (code, price, total, base, bonus) => {
      const created = await createOrder(inviter, { packageId: pkg[code] });
      if (!created.ok) throw new Error("ต้องสั่งซื้อได้");
      expect((await orderRow(created.id)).amountThb).toBe(price);
      // ชื่อและระยะเวลาที่หน้าคำสั่งซื้อ/หน้าชำระเงินแสดง มีวันแถมเหมือนหน้าแพ็กเกจ (ไม่ใช่ชื่อเปล่า "3 เดือน")
      const lineup = PACKAGE_LINEUP.find((p) => p.code === code)!;
      expect(await getOrder(inviter, created.id)).toMatchObject({
        packageName: `${lineup.nameTh} แถม ${bonus} วัน`,
        packagePeriod: `${base} วัน + แถม ${bonus} วัน (รวม ${total} วัน)`,
      });
      // ขั้นตอนเดิมทุกขั้น: ชำระ (จำลอง) → เลือกโบรกเกอร์ → กรอกเลข → เปิด
      expect(await markOrderPaid(created.id, "mock", `mock-${created.id}`)).toMatchObject({
        ok: true,
        fulfilment: { activation: { status: "not_ready", reason: "no_account" }, publish: null },
      });
      expect(await orderRow(created.id)).toMatchObject({ status: "paid", paymentProvider: "mock", paymentMethod: "card" });
      await chooseBrokerForOrder(inviter, created.id, "cxm");
      const submitted = await submitAccountForOrder(inviter, created.id, { accountNumber: "70000040", brokerServer: "Broker-Live" });
      if (!submitted.ok) throw new Error("ต้องกรอกเลขได้");
      const expiry = plusDays(today, total);
      expect((await fulfilOrder(created.id, { trigger: "account" })).activation).toMatchObject({ status: "activated", expiresAt: expiry });
      expect(await file()).toBe(`id70000040.${fileDate(expiry)}`);
      expect(await ledger()).toEqual([expect.objectContaining({ orderId: created.id, durationDays: total, newExpiresAt: expiry })]);
      expect((await audits("license.activate"))[0].data).toMatchObject({ baseDays: base, bonusDays: bonus });
      expect(await claims()).toHaveLength(0);
      // ตาราง license ของหน้าบัญชีใช้ชื่อเดียวกัน
      expect((await listMt5AccountsWithLicense(inviter)).map((a) => a.license?.packageName)).toEqual([`${lineup.nameTh} แถม ${bonus} วัน`]);
    });

    it("แพ็กเกจที่ไม่มีวันแถม (ฟรี 1 เดือน) และแพ็กเกจที่เลิกขายแล้ว แสดงชื่อเดิม ไม่มีคำว่าแถม", async () => {
      await inviteFriend(inviter);
      const free = await claimFreeTo(inviter, "70000045");
      expect(await getOrder(inviter, free.orderId)).toMatchObject({ packageName: "ฟรี 1 เดือน", packagePeriod: "30 วัน" });
      expect((await listMt5AccountsWithLicense(inviter))[0].license).toMatchObject({ packageName: "ฟรี 1 เดือน" });
      // คำสั่งซื้อเดิมของแพ็กเกจตลอดชีพ (เลิกขายแล้ว แถวยังอยู่) ยังแสดงได้
      const [legacy] = await db().insert(schema.orders).values({ userId: inviter, packageId: pkg.lifetime, amountThb: 59000 }).returning();
      expect(await getOrder(inviter, legacy.id)).toMatchObject({ packageName: "ตลอดชีพ", packagePeriod: "ไม่มีวันหมดอายุ" });
    });

    it("ต่ออายุบัญชีที่ได้แพ็กเกจฟรีด้วยแพ็กเกจ 3 เดือน → นับต่อจากวันหมดอายุเดิม +105 วัน", async () => {
      await inviteFriend(inviter);
      const free = await claimFreeTo(inviter, "70000041");
      const freeExpiry = plusDays(today, 30);
      const renewal = await buyFor(inviter, "three_months", free.accountId);
      expect(renewal.paid).toMatchObject({
        ok: true,
        fulfilment: { activation: { status: "activated", kind: "extended", expiresAt: plusDays(freeExpiry, 105) } },
      });
      expect(await file()).toBe(`id70000041.${fileDate(plusDays(freeExpiry, 105))}`);
      const [license] = await licensesOf(free.accountId);
      expect(license).toMatchObject({ status: "active", startsAt: today, expiresAt: plusDays(today, 135), packageId: pkg.three_months });
      expect((await ledger()).map((l) => [l.durationDays, l.previousExpiresAt, l.newExpiresAt])).toEqual(
        expect.arrayContaining([
          [30, null, freeExpiry],
          [105, freeExpiry, plusDays(freeExpiry, 105)],
        ]),
      );
      // สิทธิ์ฟรีของบัญชีนี้ยังถูกนับว่าใช้แล้ว
      expect(await createOrder(inviter, { packageId: pkg.free_referral, mt5AccountId: free.accountId })).toEqual({ ok: false, reason: "free_already_claimed" });
    });
  });
});
