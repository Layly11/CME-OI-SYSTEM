import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { safeErrorSummary } from "@/lib/db-errors";
import type { RateLimitRule } from "./constants";
import { ipKey, UNKNOWN_IP_KEY, windowStart } from "./rate-limit-core";

/** โอกาสที่การนับ 1 ครั้งจะพ่วงงานลบตัวนับเก่า — ตารางจึงไม่โตไม่จำกัดแม้ไม่มีใครล็อกอินสำเร็จเลย */
const PRUNE_PROBABILITY = 1 / 50;

/**
 * นับ 1 ครั้งใน fixed window ปัจจุบัน แล้วบอกว่ายังอยู่ในเพดานหรือไม่
 * `key` มาจาก emailKey()/ipKey()/… — ระบบเติมชื่อกติกานำหน้าให้ ตัวนับของ login กับ register จึงไม่ปนกัน
 * `nowMs` และ `random` มีไว้ให้เทสเลื่อนเวลา/บังคับงานเก็บกวาด
 */
export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  nowMs: number = Date.now(),
  random: () => number = Math.random,
): Promise<{ allowed: boolean }> {
  const t = schema.rateLimitBuckets;
  const rows = await getDb()
    .insert(t)
    .values({ key: `${rule.name}:${key}`, windowStart: windowStart(nowMs, rule.windowMs), count: 1 })
    .onConflictDoUpdate({ target: [t.key, t.windowStart], set: { count: sql`${t.count} + 1` } })
    .returning({ count: t.count });
  const count = rows[0]?.count ?? Number.MAX_SAFE_INTEGER;

  if (random() < PRUNE_PROBABILITY) {
    // งานเก็บกวาด — พลาดก็ไม่กระทบคำขอนี้
    await pruneRateLimits().catch((err) => console.error("[auth] prune rate limits failed:", safeErrorSummary(err)));
  }
  return { allowed: count <= rule.limit };
}

/**
 * นับต่อ IP — ถ้าระบุ IP ที่เชื่อได้ไม่ได้ (ip = null) ใช้ตัวนับร่วมตัวเดียวกับกติกา `whenUnknown` ที่เพดานสูงกว่า
 * (ดีกว่าเชื่อ IP ที่ผู้ใช้ส่งมาเอง ซึ่งเท่ากับไม่มีเพดานเลย)
 */
export async function consumeIpRateLimit(
  ip: string | null,
  rule: RateLimitRule,
  whenUnknown: RateLimitRule,
): Promise<{ allowed: boolean }> {
  return ip === null ? consumeRateLimit(UNKNOWN_IP_KEY, whenUnknown) : consumeRateLimit(ipKey(ip), rule);
}

/** ล้างตัวนับของ key นี้ใน window ปัจจุบัน (ใช้ตอนล็อกอินสำเร็จ — ตัวนับคู่อีเมล+IP จึงนับเฉพาะครั้งที่ผิด) */
export async function resetRateLimit(key: string, rule: RateLimitRule, nowMs: number = Date.now()): Promise<void> {
  const t = schema.rateLimitBuckets;
  await getDb()
    .delete(t)
    .where(and(eq(t.key, `${rule.name}:${key}`), eq(t.windowStart, windowStart(nowMs, rule.windowMs))));
}

/** ลบตัวนับที่เก่ากว่า 1 วัน (window ยาวสุดของทุกกติกาคือ 1 ชั่วโมง) */
export async function pruneRateLimits(): Promise<void> {
  const t = schema.rateLimitBuckets;
  await getDb().delete(t).where(lt(t.windowStart, sql`now() - interval '1 day'`));
}
