import { like, or, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { RATE_LIMITS } from "./constants";
import { emailKey, loginPairKeyPrefix } from "./rate-limit-core";

/**
 * ปลดล็อกการล็อกอินของอีเมลหนึ่ง: ลบตัวนับ rate limit ของอีเมลนั้นทุก IP และทุก window
 * ใช้จากสคริปต์ `npm run admin:unlock-login -- <อีเมล>` (ไฟล์นี้จึงไม่ import "server-only")
 * คืนจำนวนแถวที่ลบ — ไม่แตะตัวนับต่อ IP และไม่แตะบัญชีผู้ใช้
 */
export async function clearLoginRateLimits(email: string): Promise<number> {
  const t = schema.rateLimitBuckets;
  // prefix เป็น hex ล้วน ไม่มีอักขระพิเศษของ LIKE
  const pairPrefix = `${RATE_LIMITS.loginPair.name}:${loginPairKeyPrefix(email)}`;
  const deleted = await getDb()
    .delete(t)
    .where(or(eq(t.key, `${RATE_LIMITS.loginEmail.name}:${emailKey(email)}`), like(t.key, `${pairPrefix}%`)))
    .returning({ key: t.key });
  return deleted.length;
}
