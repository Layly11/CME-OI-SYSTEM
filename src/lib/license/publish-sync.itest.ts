import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb, schema } from "@/db";
import { createUser } from "@/lib/auth/users";
import { insertMt5Account } from "@/lib/purchase/repo";
import { hasTestDb, resetDb } from "@/test/integration-setup";

// ที่เก็บรายชื่อปลอม: จดทุกครั้งที่ถูกเขียน หน่วงเวลาได้ และสั่งให้ล้มได้ — ไม่มีการเขียนไฟล์/เครือข่ายจริง
const fake = vi.hoisted(() => ({
  puts: [] as string[],
  running: 0,
  maxRunning: 0,
  delayMs: 0,
  fail: null as string | null,
  /** ค่าที่ put() คืนและ currentLicenseDestination() รายงาน — เปลี่ยนเพื่อจำลองการย้ายปลายทาง (เช่น Data_test → Data) */
  destination: "fake://license",
}));
vi.mock("@/lib/license-storage", () => ({
  getLicenseStorage: () => ({
    async put(content: string) {
      fake.running++;
      fake.maxRunning = Math.max(fake.maxRunning, fake.running);
      try {
        if (fake.delayMs > 0) await new Promise((r) => setTimeout(r, fake.delayMs));
        if (fake.fail !== null) throw new Error(fake.fail);
        fake.puts.push(content);
        return fake.destination;
      } finally {
        fake.running--;
      }
    },
  }),
  currentLicenseDestination: () => fake.destination,
}));

import { purgeMockData } from "./mock-purge";
import { fulfilOrder } from "./fulfil";
import { getLatestPublishedEntries, LICENSE_PUBLISH_LOCK_KEY, publishErrorSummary, publishLicensesSerialized } from "./publish-sync";
import { isLicensePublished } from "./published-state";

const accountsIn = (content: string) => (content === "" ? [] : content.split(",").map((e) => e.slice(2).split(".")[0]));

describe.skipIf(!hasTestDb)("เผยแพร่รายชื่อแบบเรียงคิว กับ PostgreSQL จริง (storage ปลอม)", () => {
  let userId: string;
  let packageId: string;
  let n = 0;

  beforeEach(async () => {
    await resetDb();
    Object.assign(fake, { puts: [], running: 0, maxRunning: 0, delayMs: 0, fail: null, destination: "fake://license" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    // คำสั่งซื้อในไฟล์นี้ถูกสร้างเป็น "ชำระด้วย mock" → ค่าตั้งต้องอนุญาต mock ไม่เช่นนั้นขั้นเปิด license จะกันไว้
    vi.stubEnv("PAYMENT_PROVIDER", "mock");
    userId = (await createUser({ email: "buyer@example.com", passwordHash: "scrypt$test", name: "ผู้ซื้อ" }))!.id;
    const [pkg] = await getDb()
      .insert(schema.packages)
      .values({ code: "yearly", nameTh: "รายปี", durationDays: 365, priceThb: 9900 })
      .returning();
    packageId = pkg.id;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await closeDb();
  });

  const paidOrder = async (accountNumber: string) => {
    const account = await insertMt5Account(userId, { accountNumber, brokerServer: "Broker-Live" });
    if (!account.ok) throw new Error(account.reason);
    const [order] = await getDb()
      .insert(schema.orders)
      .values({ userId, packageId, mt5AccountId: account.id, amountThb: 9900, status: "paid", paymentProvider: "mock", paymentRef: `seed-${++n}` })
      .returning();
    return { orderId: order.id, accountId: account.id };
  };
  const publications = () => getDb().select().from(schema.licenseFilePublications);
  const audits = async (action: string) => (await getDb().select().from(schema.auditLogs)).filter((a) => a.action === action);

  it("เผยแพร่ครั้งแรก → published, เรียกซ้ำ → unchanged ไม่เขียน storage ซ้ำ, force → เขียนซ้ำ", async () => {
    const { orderId } = await paidOrder("60000001");
    expect(await fulfilOrder(orderId, { trigger: "payment" })).toMatchObject({ publish: { status: "published", entryCount: 1 } });
    expect(fake.puts).toHaveLength(1);

    expect(await publishLicensesSerialized({ trigger: "test" })).toEqual({ status: "unchanged", entryCount: 1 });
    expect(fake.puts).toHaveLength(1);
    expect(await publications()).toHaveLength(1);

    expect(await publishLicensesSerialized({ trigger: "test", force: true })).toMatchObject({ status: "published", entryCount: 1 });
    expect(fake.puts).toHaveLength(2);
    expect(fake.puts[1]).toBe(fake.puts[0]);
    // ประวัติและ audit ของ publishLicenseFile ยังถูกบันทึกทุกครั้งที่เขียน
    expect(await publications()).toHaveLength(2);
    expect(await audits("license_file.publish")).toHaveLength(2);
  });

  it("6 คำสั่งซื้อเปิดพร้อมกัน + storage ช้า → เขียนทีละครั้ง รายชื่อไม่ถอยหลัง ครบ 6 เลขในครั้งสุดท้าย", async () => {
    const numbers = Array.from({ length: 6 }, (_, i) => String(60000100 + i));
    const orders = [];
    for (const number of numbers) orders.push(await paidOrder(number));
    fake.delayMs = 40;

    const results = await Promise.all(orders.map((o) => fulfilOrder(o.orderId, { trigger: "payment" })));
    expect(results.every((r) => r.activation.status === "activated")).toBe(true);
    expect(results.every((r) => r.publish?.status === "published" || r.publish?.status === "unchanged")).toBe(true);

    expect(fake.maxRunning).toBe(1);
    expect(fake.puts.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < fake.puts.length; i++) {
      const before = accountsIn(fake.puts[i - 1]);
      const after = new Set(accountsIn(fake.puts[i]));
      // รายชื่อใหม่ต้องมีทุกเลขของรายชื่อก่อนหน้า (รายชื่อเก่ากว่าไม่มีทางเขียนทับรายชื่อใหม่กว่า)
      expect(before.filter((a) => !after.has(a))).toEqual([]);
    }
    expect(accountsIn(fake.puts.at(-1)!).sort()).toEqual(numbers);
    const map = await getLatestPublishedEntries();
    expect([...map.keys()].sort()).toEqual(numbers);
    // แถวประวัติล่าสุด = สิ่งที่เขียน storage ครั้งสุดท้าย
    const rows = await publications();
    expect(rows).toHaveLength(fake.puts.length);
    expect(rows.sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime()).at(-1)!.content).toBe(fake.puts.at(-1));
  });

  it("storage ล้ม → license ยัง active ในฐานข้อมูล, audit publish_failed ไม่มีเลขบัญชี, ไม่มีแถวประวัติ; การเปิดครั้งถัดไปเผยแพร่ครบทั้งคู่", async () => {
    const first = await paidOrder("60000201");
    fake.fail = "เขียนไม่ได้: รายการ id60000201.2027.11.16 ถูกปฏิเสธ";

    const failed = await fulfilOrder(first.orderId, { trigger: "payment" });
    expect(failed.activation).toMatchObject({ status: "activated" });
    expect(failed.publish).toEqual({ status: "failed", error: "เขียนไม่ได้: รายการ id#####.2027.11.16 ถูกปฏิเสธ" });

    const [license] = await getDb().select().from(schema.licenses).where(eq(schema.licenses.mt5AccountId, first.accountId));
    expect(license).toMatchObject({ status: "active", orderId: first.orderId });
    expect(await getDb().select().from(schema.licenseActivations)).toHaveLength(1);
    expect(await publications()).toHaveLength(0);
    expect(fake.puts).toHaveLength(0);
    expect(isLicensePublished(await getLatestPublishedEntries(), "60000201", license.expiresAt)).toBe(false);
    const failedAudits = await audits("license_file.publish_failed");
    expect(failedAudits).toEqual([
      expect.objectContaining({ actorUserId: null, data: { trigger: "payment", orderId: first.orderId, error: expect.any(String) } }),
    ]);
    expect(JSON.stringify(await getDb().select().from(schema.auditLogs))).not.toContain("60000201");

    // ลองใหม่ขณะ storage ยังล้ม → ยังไม่เปิดซ้ำ ยังไม่เผยแพร่
    expect(await fulfilOrder(first.orderId, { trigger: "retry" })).toMatchObject({
      activation: { status: "already_activated" },
      publish: { status: "failed" },
    });
    expect(await getDb().select().from(schema.licenseActivations)).toHaveLength(1);

    // storage กลับมา: การเปิด license ของลูกค้าคนถัดไปพาเลขที่ค้างไปด้วย
    fake.fail = null;
    const second = await paidOrder("60000202");
    expect(await fulfilOrder(second.orderId, { trigger: "payment" })).toMatchObject({ publish: { status: "published", entryCount: 2 } });
    expect(accountsIn(fake.puts.at(-1)!)).toEqual(["60000201", "60000202"]);
    expect(isLicensePublished(await getLatestPublishedEntries(), "60000201", license.expiresAt)).toBe(true);
  });

  it("lock ถูกถือโดย connection อื่น → busy (พร้อม audit publish_deferred) ไม่เขียน storage; ปล่อยแล้วเผยแพร่ได้", async () => {
    const { orderId } = await paidOrder("60000301");
    const other = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      await other.begin(async (tx) => {
        await tx.unsafe(`select pg_advisory_xact_lock(${LICENSE_PUBLISH_LOCK_KEY})`);
        const started = Date.now();
        const r = await fulfilOrder(orderId, { trigger: "payment" });
        expect(r.activation).toMatchObject({ status: "activated" });
        // fulfilOrder ใช้เวลารอค่าเริ่มต้น (15 วินาที) — ทดสอบการรอสั้นด้วย publishLicensesSerialized ตรงๆ ด้านล่าง
        expect(r.publish).toEqual({ status: "busy" });
        expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
      });
    } finally {
      await other.end({ timeout: 5 });
    }
    expect(fake.puts).toHaveLength(0);
    expect(await audits("license_file.publish_deferred")).toEqual([
      expect.objectContaining({ data: { trigger: "payment", orderId } }),
    ]);
    expect(await publishLicensesSerialized({ trigger: "test", waitMs: 300 })).toMatchObject({ status: "published", entryCount: 1 });
    expect(accountsIn(fake.puts[0])).toEqual(["60000301"]);
  }, 30_000);

  it("10 คำขอเผยแพร่พร้อมกัน (pool 5 connection) + storage ช้า → จบครบทุกคำขอ ไม่ค้าง", async () => {
    await fulfilOrder((await paidOrder("60000401")).orderId, { trigger: "payment" });
    fake.delayMs = 60;
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, i) => publishLicensesSerialized({ trigger: `t${i}`, force: true })),
    );
    expect(outcomes.map((o) => o.status)).toEqual(Array(10).fill("published"));
    expect(fake.maxRunning).toBe(1);
    expect(fake.puts).toHaveLength(11);
  }, 30_000);

  it("ปลายทางเปลี่ยน (เช่น Data_test → Data) → เขียนปลายทางใหม่แม้รายชื่อเหมือนเดิมทุกตัวอักษร แล้วจึงกลับมา unchanged", async () => {
    await fulfilOrder((await paidOrder("60000501")).orderId, { trigger: "payment" });
    expect(await publishLicensesSerialized({ trigger: "test" })).toEqual({ status: "unchanged", entryCount: 1 });
    expect(fake.puts).toHaveLength(1);

    fake.destination = "fake://license-live";
    expect(await publishLicensesSerialized({ trigger: "test" })).toMatchObject({ status: "published", entryCount: 1 });
    expect(fake.puts).toHaveLength(2);
    expect(fake.puts[1]).toBe(fake.puts[0]);
    const rows = (await publications()).sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
    expect(rows.map((r) => r.storageUrl)).toEqual(["fake://license", "fake://license-live"]);

    expect(await publishLicensesSerialized({ trigger: "test" })).toEqual({ status: "unchanged", entryCount: 1 });
    expect(fake.puts).toHaveLength(2);
  });

  it("ปลายทางเป็นรายชื่อจริง + มี license ที่ active จากการชำระจำลอง → ปฏิเสธ ไม่เขียน, audit publish_failed; ล้างข้อมูลจำลองแล้วจึงเผยแพร่ได้", async () => {
    // license จากการชำระจำลอง (ช่วงทดสอบ) 1 ใบ + ลูกค้าจริง 1 ใบ
    const mock = await paidOrder("60000601");
    await fulfilOrder(mock.orderId, { trigger: "payment" });
    const real = await paidOrder("60000602");
    await getDb().update(schema.orders).set({ paymentProvider: "gateway-x" }).where(eq(schema.orders.id, real.orderId));
    await fulfilOrder(real.orderId, { trigger: "payment" });
    expect(accountsIn(fake.puts.at(-1)!)).toEqual(["60000601", "60000602"]);
    const writesBefore = fake.puts.length;

    // สลับเป็นค่าตั้งของระบบจริง (storage ในไฟล์นี้เป็นของปลอม — ไม่มีการต่อ Firebase)
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENT_PROVIDER", "");
    vi.stubEnv("LICENSE_STORAGE", "firebase");
    vi.stubEnv("FIREBASE_LICENSE_PATH", "CME_Data/Customer Data/Data");
    fake.destination = "fake://live";

    for (const force of [false, true]) {
      const refused = await publishLicensesSerialized({ trigger: "script", force });
      expect(refused).toMatchObject({ status: "failed" });
      expect(refused.status === "failed" && refused.error).toMatch(/การชำระเงินจำลอง/);
      expect(refused.status === "failed" && refused.error).toContain("license:purge-mock");
    }
    // ลูกค้าจริงคนถัดไป: license เปิดในฐานข้อมูล แต่รายชื่อจริงไม่ถูกเขียนจนกว่าจะล้างข้อมูลจำลอง
    const next = await paidOrder("60000603");
    await getDb().update(schema.orders).set({ paymentProvider: "gateway-x" }).where(eq(schema.orders.id, next.orderId));
    expect(await fulfilOrder(next.orderId, { trigger: "payment" })).toMatchObject({
      activation: { status: "activated" },
      publish: { status: "failed" },
    });
    expect(fake.puts).toHaveLength(writesBefore);
    expect(await audits("license_file.publish_failed")).toHaveLength(3);

    // path ใต้รายชื่อจริงก็ถือเป็นของจริง
    vi.stubEnv("FIREBASE_LICENSE_PATH", "CME_Data/Customer Data/Data/test");
    expect(await publishLicensesSerialized({ trigger: "script" })).toMatchObject({ status: "failed" });
    vi.stubEnv("FIREBASE_LICENSE_PATH", "CME_Data/Customer Data/Data");

    expect(await purgeMockData({ apply: true })).toMatchObject({ ordersCancelled: 1, licensesExpired: 1, skippedLicenseIds: [] });
    expect(await publishLicensesSerialized({ trigger: "script" })).toMatchObject({ status: "published", entryCount: 2 });
    expect(accountsIn(fake.puts.at(-1)!)).toEqual(["60000602", "60000603"]);
  });

  it("ปลายทางไม่ใช่รายชื่อจริง (ทดสอบ/ในเครื่อง) → license จากการชำระจำลองเผยแพร่ได้ตามปกติ", async () => {
    await fulfilOrder((await paidOrder("60000701")).orderId, { trigger: "payment" });
    vi.stubEnv("LICENSE_STORAGE", "firebase");
    vi.stubEnv("FIREBASE_LICENSE_PATH", "CME_Data/Customer Data/Data_test");
    expect(await publishLicensesSerialized({ trigger: "test", force: true })).toMatchObject({ status: "published", entryCount: 1 });
  });

  it("connection ที่ถือ lock ถูกตัดระหว่างเผยแพร่ → รอให้งานที่หลุด lock จบ แล้วเขียนซ้ำภายใน lock: รายชื่อเก่าไม่ได้เป็นการเขียนครั้งสุดท้าย", async () => {
    const a = await paidOrder("70000001");
    const b = await paidOrder("70000002");
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      // A: ได้ lock แล้วค้างอยู่ที่การเขียน storage (ช้า)
      fake.delayMs = 1500;
      const pendingA = fulfilOrder(a.orderId, { trigger: "payment" });
      await vi.waitFor(() => expect(fake.running).toBe(1), { timeout: 10_000, interval: 20 });
      fake.delayMs = 0;

      // ตัด connection ที่ถือ advisory lock (จำลองฐานข้อมูล failover / pooler รีสตาร์ต)
      const killed = await admin.unsafe(
        "select pg_terminate_backend(pid) as done from pg_locks where locktype = 'advisory' and granted and pid <> pg_backend_pid()",
      );
      expect(killed.length).toBe(1);

      // B: เผยแพร่ได้ทันทีเพราะ lock หลุดแล้ว — เขียนรายชื่อใหม่ (2 เลข) ขณะที่งานของ A ยังค้างอยู่นอก lock
      const resultB = await fulfilOrder(b.orderId, { trigger: "payment" });
      expect(resultB).toMatchObject({ activation: { status: "activated" }, publish: { status: "published", entryCount: 2 } });

      // A: ไม่รายงานล้มแล้วทิ้งรายชื่อเก่าไว้ — รองานเดิมจบ แล้วเขียนซ้ำจากฐานข้อมูลภายใน lock
      const resultA = await pendingA;
      expect(resultA).toMatchObject({ activation: { status: "activated" }, publish: { status: "published", entryCount: 2 } });
    } finally {
      await admin.end({ timeout: 5 });
    }

    // ลำดับการเขียน: B (2 เลข) → งานของ A ที่หลุด lock (1 เลข — รายชื่อเก่า) → รอบซ่อมของ A (2 เลข)
    expect(fake.puts.map((p) => accountsIn(p))).toEqual([["70000001", "70000002"], ["70000001"], ["70000001", "70000002"]]);
    expect([...(await getLatestPublishedEntries()).keys()].sort()).toEqual(["70000001", "70000002"]);
    const rows = (await publications()).sort((x, y) => x.publishedAt.getTime() - y.publishedAt.getTime());
    expect(rows.at(-1)!.content).toBe(fake.puts.at(-1));
    expect(await audits("license_file.publish_lock_lost")).toEqual([
      expect.objectContaining({ data: { trigger: "payment", orderId: a.orderId, error: expect.any(String) } }),
    ]);
    expect(await audits("license_file.publish_failed")).toHaveLength(0);
    // lock ไม่ค้าง: เผยแพร่ครั้งถัดไปทำงานได้ทันที
    expect(await publishLicensesSerialized({ trigger: "test", waitMs: 300 })).toEqual({ status: "unchanged", entryCount: 2 });
  }, 30_000);

  it("publishErrorSummary: error ของฐานข้อมูลไม่เอาข้อความดิบ, error อื่นตัดความยาวและบังเลขยาว", () => {
    const dbError = Object.assign(new Error("Failed query: insert ... params: 97058698,a@example.com"), {
      name: "DrizzleQueryError",
      cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
    });
    expect(publishErrorSummary(dbError)).toBe("DrizzleQueryError (code 23505)");
    expect(publishErrorSummary(Object.assign(new Error("ENOTDIR: not a directory, mkdir '/dev/null/x'"), { code: "ENOTDIR" }))).toBe(
      "ENOTDIR: not a directory, mkdir '/dev/null/x'",
    );
    expect(publishErrorSummary(new Error("จะลบ 12 รายการ: id97058698 id1234"))).toBe("จะลบ 12 รายการ: id##### id1234");
    expect(publishErrorSummary(new Error("x".repeat(500)))).toHaveLength(200);
    expect(publishErrorSummary("boom")).toBe("boom");
    expect(publishErrorSummary(null)).toBe("unknown error");
  });
});
