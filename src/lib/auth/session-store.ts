import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SESSION_TTL_DAYS } from "./constants";
import { generateSessionToken, hashSessionToken } from "./session-token";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: "customer" | "admin";
};

/** สร้าง session ใหม่ คืน token ดิบ (สำหรับใส่ cookie) — ฐานข้อมูลเก็บเฉพาะ hash */
export async function insertSession(userId: string): Promise<string> {
  const token = generateSessionToken();
  await getDb()
    .insert(schema.sessions)
    .values({
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt: sql`now() + make_interval(days => ${SESSION_TTL_DAYS})`,
    });
  return token;
}

/** หา user จาก token — เทียบวันหมดอายุใน SQL (expires_at > now()) จึงไม่ต้องเรียก Date ในโค้ด */
export async function findUserBySessionToken(token: string): Promise<SessionUser | null> {
  const rows = await getDb()
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(eq(schema.sessions.tokenHash, hashSessionToken(token)), sql`${schema.sessions.expiresAt} > now()`))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteSessionByToken(token: string): Promise<void> {
  await getDb().delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashSessionToken(token)));
}

/** ล้าง session ที่หมดอายุแล้วของ user (เรียกตอนล็อกอินสำเร็จ) */
export async function deleteExpiredSessions(userId: string): Promise<void> {
  await getDb()
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), lt(schema.sessions.expiresAt, sql`now()`)));
}
