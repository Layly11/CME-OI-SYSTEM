/**
 * ตั้ง role=admin ให้ผู้ใช้ที่สมัครสมาชิกแล้ว
 * รัน: npm run admin:grant -- <อีเมล>   (ต้องมี DATABASE_URL ใน .env.local)
 * ไม่พบผู้ใช้ → จบด้วย exit code 1
 */
import { eq } from "drizzle-orm";
import { closeDb, getDb, schema } from "../src/db";
import { normalizeEmail } from "../src/lib/auth/validation";

async function main(): Promise<number> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("วิธีใช้: npm run admin:grant -- <อีเมล>");
    return 2;
  }
  const email = normalizeEmail(arg);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.users)
      .set({ role: "admin", updatedAt: new Date() })
      .where(eq(schema.users.email, email))
      .returning({ id: schema.users.id });
    const user = rows[0];
    if (!user) return null;
    // audit เก็บเฉพาะ id — actor เป็น null เพราะสั่งจากสคริปต์ ไม่ใช่ผู้ใช้ที่ล็อกอิน
    await tx.insert(schema.auditLogs).values({
      actorUserId: null,
      action: "user.grant_admin",
      entity: "user",
      entityId: user.id,
      data: { via: "scripts/grant-admin.ts" },
    });
    return user;
  });
  if (!result) {
    console.error("ไม่พบผู้ใช้อีเมลนี้ — ต้องสมัครสมาชิกผ่านหน้าเว็บก่อน");
    return 1;
  }
  console.log(`ตั้งเป็นแอดมินแล้ว (user id ${result.id})`);
  return 0;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.name : "error", "— ตั้งแอดมินไม่สำเร็จ ตรวจ DATABASE_URL และการเชื่อมต่อฐานข้อมูล");
    return 1;
  })
  .then(async (code) => {
    await closeDb().catch(() => {});
    process.exit(code);
  });
