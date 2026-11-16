import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb, schema } from "@/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { hasTestDb, resetDb } from "@/test/integration-setup";
import { RATE_LIMITS } from "./constants";
import { clearLoginRateLimits } from "./login-unlock";
import { consumeIpRateLimit, consumeRateLimit, pruneRateLimits, resetRateLimit } from "./rate-limit";
import { emailKey, ipKey, loginPairKey } from "./rate-limit-core";
import {
  deleteExpiredSessions,
  deleteSessionByToken,
  findUserBySessionToken,
  insertSession,
} from "./session-store";
import { generateSessionToken, hashSessionToken } from "./session-token";
import { createUser, findUserForLogin } from "./users";

const newUser = (email: string) => ({ email, passwordHash: "scrypt$test", name: "ผู้ทดสอบ" });

describe.skipIf(!hasTestDb)("auth กับ PostgreSQL จริง", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("createUser: สร้างได้ ตั้ง termsAcceptedAt และอีเมลซ้ำคืน null", async () => {
    const created = await createUser({ ...newUser("a@example.com"), phone: "0812345678" });
    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/);
    const [row] = await getDb().select().from(schema.users).where(eq(schema.users.id, created!.id));
    expect(row.termsAcceptedAt).toBeInstanceOf(Date);
    expect(row.role).toBe("customer");
    expect(row.phone).toBe("0812345678");
    expect(row.lineId).toBeNull();

    expect(await createUser(newUser("a@example.com"))).toBeNull();
    expect(await findUserForLogin("a@example.com")).toEqual({ id: created!.id, passwordHash: "scrypt$test" });
    expect(await findUserForLogin("nobody@example.com")).toBeNull();
  });

  it("ฐานข้อมูลปฏิเสธอีเมลที่มีตัวพิมพ์ใหญ่ (check users_email_lowercase)", async () => {
    let caught: unknown;
    try {
      await createUser(newUser("Upper@Example.com"));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { code?: string; constraint_name?: string } }).cause;
    expect(cause?.code).toBe("23514");
    expect(cause?.constraint_name).toBe("users_email_lowercase");
  });

  it("isUniqueViolation อ่าน error จริงของ drizzle ได้", async () => {
    await createUser(newUser("dup@example.com"));
    let caught: unknown;
    try {
      await getDb().insert(schema.users).values({ email: "dup@example.com" });
    } catch (e) {
      caught = e;
    }
    expect(isUniqueViolation(caught)).toBe(true);
    expect(isUniqueViolation(caught, "users_email_unique")).toBe(true);
    expect(isUniqueViolation(caught, "other_constraint")).toBe(false);
  });

  it("session: สร้าง หาเจอ ลบแล้วหาไม่เจอ และเก็บเฉพาะ hash", async () => {
    const user = await createUser(newUser("s@example.com"));
    const token = await insertSession(user!.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const rows = await getDb().select().from(schema.sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashSessionToken(token));
    expect(rows[0].tokenHash).not.toContain(token);
    const days = (rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    expect(await findUserBySessionToken(token)).toEqual({
      id: user!.id,
      email: "s@example.com",
      name: "ผู้ทดสอบ",
      role: "customer",
    });
    expect(await findUserBySessionToken(generateSessionToken())).toBeNull();

    await deleteSessionByToken(token);
    expect(await findUserBySessionToken(token)).toBeNull();
  });

  it("session ที่หมดอายุหาไม่เจอ และ deleteExpiredSessions ลบเฉพาะที่หมดอายุ", async () => {
    const user = await createUser(newUser("e@example.com"));
    const expired = generateSessionToken();
    await getDb()
      .insert(schema.sessions)
      .values({ tokenHash: hashSessionToken(expired), userId: user!.id, expiresAt: sql`now() - interval '1 second'` });
    const live = await insertSession(user!.id);

    expect(await findUserBySessionToken(expired)).toBeNull();
    await deleteExpiredSessions(user!.id);
    const rows = await getDb().select().from(schema.sessions);
    expect(rows.map((r) => r.tokenHash)).toEqual([hashSessionToken(live)]);
  });

  it("ลบ user แล้ว session หายตาม (cascade)", async () => {
    const user = await createUser(newUser("c@example.com"));
    await insertSession(user!.id);
    await getDb().delete(schema.users).where(eq(schema.users.id, user!.id));
    expect(await getDb().select().from(schema.sessions)).toHaveLength(0);
  });

  it("rate limit: บล็อกเมื่อเกินเพดาน แยกตาม key/กติกา และเริ่มนับใหม่ใน window ถัดไป", async () => {
    const rule = { name: "t", limit: 3, windowMs: 60_000 };
    const now = 1_800_000_000_000;
    for (let i = 0; i < 3; i++) {
      expect(await consumeRateLimit("ip:abc", rule, now + i)).toEqual({ allowed: true });
    }
    expect(await consumeRateLimit("ip:abc", rule, now + 10)).toEqual({ allowed: false });
    expect(await consumeRateLimit("ip:other", rule, now + 10)).toEqual({ allowed: true });
    expect(await consumeRateLimit("ip:abc", { ...rule, name: "u" }, now + 10)).toEqual({ allowed: true });
    expect(await consumeRateLimit("ip:abc", rule, now + 60_000)).toEqual({ allowed: true });
  });

  it("pruneRateLimits ลบเฉพาะตัวนับที่เก่ากว่า 1 วัน", async () => {
    const rule = { name: "t", limit: 3, windowMs: 60_000 };
    await consumeRateLimit("old", rule, Date.now() - 2 * 86_400_000);
    await consumeRateLimit("new", rule);
    await pruneRateLimits();
    const rows = await getDb().select().from(schema.rateLimitBuckets);
    expect(rows.map((r) => r.key)).toEqual(["t:new"]);
  });

  it("consumeRateLimit พ่วงงานลบตัวนับเก่าเป็นครั้งคราว (ไม่ต้องรอให้มีคนล็อกอินสำเร็จ)", async () => {
    const rule = { name: "t", limit: 3, windowMs: 60_000 };
    await consumeRateLimit("old", rule, Date.now() - 2 * 86_400_000, () => 1);
    await consumeRateLimit("new", rule, Date.now(), () => 0.99);
    expect(await getDb().select().from(schema.rateLimitBuckets)).toHaveLength(2);

    // random ต่ำกว่าโอกาสเก็บกวาด → ลบตัวนับเก่าในคำขอเดียวกัน
    expect(await consumeRateLimit("new", rule, Date.now(), () => 0)).toEqual({ allowed: true });
    const rows = await getDb().select().from(schema.rateLimitBuckets);
    expect(rows.map((r) => r.key)).toEqual(["t:new"]);
  });

  it("ล็อกอิน: ตัวนับคู่ (อีเมล, IP) แยกตาม IP — คนอื่นยิงจนเต็มไม่กระทบเจ้าของบัญชีที่มาจาก IP อื่น", async () => {
    const rule = RATE_LIMITS.loginPair;
    const email = "owner@example.com";
    const attacker = loginPairKey(email, "203.0.113.9");
    const owner = loginPairKey(email, "198.51.100.77");

    for (let i = 0; i < rule.limit; i++) expect((await consumeRateLimit(attacker, rule)).allowed).toBe(true);
    expect((await consumeRateLimit(attacker, rule)).allowed).toBe(false);
    expect((await consumeRateLimit(owner, rule)).allowed).toBe(true);
    // เพดานรวมต่ออีเมลยังไม่ถึง
    expect((await consumeRateLimit(emailKey(email), RATE_LIMITS.loginEmail)).allowed).toBe(true);
  });

  it("resetRateLimit: ล้างเฉพาะตัวนับของ key นั้น (ล็อกอินสำเร็จแล้วเริ่มนับใหม่)", async () => {
    const rule = RATE_LIMITS.loginPair;
    const mine = loginPairKey("owner@example.com", "198.51.100.77");
    const other = loginPairKey("owner@example.com", "203.0.113.9");
    for (let i = 0; i < rule.limit + 1; i++) {
      await consumeRateLimit(mine, rule);
      await consumeRateLimit(other, rule);
    }
    expect((await consumeRateLimit(mine, rule)).allowed).toBe(false);

    await resetRateLimit(mine, rule);
    expect((await consumeRateLimit(mine, rule)).allowed).toBe(true);
    expect((await consumeRateLimit(other, rule)).allowed).toBe(false);
  });

  it("consumeIpRateLimit: ไม่รู้ IP → ทุกคำขอใช้ตัวนับร่วมตัวเดียวกับเพดานของกติกาสำรอง", async () => {
    const perIp = { name: "t", limit: 1, windowMs: 60_000 };
    const shared = { name: "t", limit: 3, windowMs: 60_000 };
    expect((await consumeIpRateLimit("203.0.113.9", perIp, shared)).allowed).toBe(true);
    expect((await consumeIpRateLimit("203.0.113.9", perIp, shared)).allowed).toBe(false);
    for (let i = 0; i < 3; i++) expect((await consumeIpRateLimit(null, perIp, shared)).allowed).toBe(true);
    expect((await consumeIpRateLimit(null, perIp, shared)).allowed).toBe(false);
    const keys = (await getDb().select().from(schema.rateLimitBuckets)).map((r) => r.key).sort();
    expect(keys).toEqual(["t:" + ipKey("203.0.113.9"), "t:ip:unknown"].sort());
  });

  it("clearLoginRateLimits (สคริปต์ปลดล็อก): ลบตัวนับของอีเมลนั้นทุก IP ไม่แตะอีเมลอื่นและตัวนับต่อ IP", async () => {
    const victim = "victim@example.com";
    await consumeRateLimit(loginPairKey(victim, "203.0.113.9"), RATE_LIMITS.loginPair);
    await consumeRateLimit(loginPairKey(victim, "203.0.113.10"), RATE_LIMITS.loginPair);
    await consumeRateLimit(loginPairKey(victim, null), RATE_LIMITS.loginPair);
    await consumeRateLimit(emailKey(victim), RATE_LIMITS.loginEmail);
    await consumeRateLimit(emailKey(victim), RATE_LIMITS.loginEmail, Date.now() - RATE_LIMITS.loginEmail.windowMs);
    await consumeRateLimit(loginPairKey("other@example.com", "203.0.113.9"), RATE_LIMITS.loginPair);
    await consumeRateLimit(emailKey("other@example.com"), RATE_LIMITS.loginEmail);
    await consumeRateLimit(ipKey("203.0.113.9"), RATE_LIMITS.loginIp);

    expect(await clearLoginRateLimits(" Victim@Example.com ")).toBe(5);
    expect(await getDb().select().from(schema.rateLimitBuckets)).toHaveLength(3);
    expect(await clearLoginRateLimits(victim)).toBe(0);
  });
});
