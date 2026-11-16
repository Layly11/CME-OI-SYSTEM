import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type NewUserInput = {
  /** ต้องผ่าน normalizeEmail มาแล้ว (ฐานข้อมูลมี check บังคับตัวพิมพ์เล็กซ้ำอีกชั้น) */
  email: string;
  passwordHash: string;
  name: string;
  phone?: string;
  lineId?: string;
};

/** สร้าง user ใหม่ — คืน null เมื่ออีเมลนี้มีอยู่แล้ว (ไม่ throw) */
export async function createUser(input: NewUserInput): Promise<{ id: string } | null> {
  const rows = await getDb()
    .insert(schema.users)
    .values({
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      phone: input.phone ?? null,
      lineId: input.lineId ?? null,
      termsAcceptedAt: sql`now()`,
    })
    .onConflictDoNothing({ target: schema.users.email })
    .returning({ id: schema.users.id });
  return rows[0] ?? null;
}

export async function findUserForLogin(email: string): Promise<{ id: string; passwordHash: string | null } | null> {
  const rows = await getDb()
    .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  return rows[0] ?? null;
}

/** บันทึก audit — เก็บเฉพาะ id ห้ามใส่อีเมล รหัสผ่าน หรือ token */
export async function writeAuthAudit(action: string, userId: string): Promise<void> {
  await getDb().insert(schema.auditLogs).values({ actorUserId: userId, action, entity: "user", entityId: userId });
}
