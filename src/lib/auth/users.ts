import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isUniqueViolation } from "@/lib/db-errors";

export type NewUserInput = {
  /** ต้องผ่าน normalizeEmail มาแล้ว (ฐานข้อมูลมี check บังคับตัวพิมพ์เล็กซ้ำอีกชั้น) */
  email: string;
  passwordHash: string;
  name: string;
  phone?: string;
  lineId?: string;
  /**
   * id ของผู้ที่ชวนมาสมัคร (หาจากรหัสใน ?ref= ด้วย findReferrerIdByCode) — บันทึกได้ที่นี่ที่เดียว ตอนสร้างแถว
   * ไม่มีฟังก์ชันใดแก้ค่านี้ภายหลัง และชวนตัวเองไม่ได้โดยโครงสร้าง (แถวของผู้สมัครยังไม่มีตอนอ่านรหัส; ฐานข้อมูลมี CHECK ซ้ำอีกชั้น)
   */
  referredByUserId?: string | null;
};

/**
 * สร้าง user ใหม่ — คืน null เมื่ออีเมลนี้มีอยู่แล้ว (ไม่ throw)
 * รหัสชวนเพื่อน (referral_code) ฐานข้อมูลสุ่มให้เอง: ถ้าสุ่มชนกับของคนอื่น (โอกาสน้อยมาก — 40 บิต) ลองใหม่ได้อีก 2 ครั้ง
 */
export async function createUser(input: NewUserInput): Promise<{ id: string } | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const rows = await getDb()
        .insert(schema.users)
        .values({
          email: input.email,
          passwordHash: input.passwordHash,
          name: input.name,
          phone: input.phone ?? null,
          lineId: input.lineId ?? null,
          termsAcceptedAt: sql`now()`,
          referredByUserId: input.referredByUserId ?? null,
        })
        .onConflictDoNothing({ target: schema.users.email })
        .returning({ id: schema.users.id });
      return rows[0] ?? null;
    } catch (err) {
      if (attempt < 2 && isUniqueViolation(err, "users_referral_code_unique")) continue;
      throw err;
    }
  }
}

export async function findUserForLogin(email: string): Promise<{ id: string; passwordHash: string | null } | null> {
  const rows = await getDb()
    .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  return rows[0] ?? null;
}

/** บันทึก audit — เก็บเฉพาะ id ห้ามใส่อีเมล รหัสผ่าน หรือ token (data: เฉพาะ id/ค่าที่ไม่อ่อนไหว) */
export async function writeAuthAudit(action: string, userId: string, data?: Record<string, string>): Promise<void> {
  await getDb()
    .insert(schema.auditLogs)
    .values({ actorUserId: userId, action, entity: "user", entityId: userId, data: data ?? null });
}
