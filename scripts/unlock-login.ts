/**
 * ปลดล็อกการล็อกอินของอีเมลหนึ่ง (ลบตัวนับ rate limit ของอีเมลนั้น) — ใช้เมื่อเจ้าของบัญชีถูกล็อกเพราะมีคนลองรหัสผ่านรัวๆ
 * รัน: npm run admin:unlock-login -- <อีเมล>   (ต้องมี DATABASE_URL ใน .env.local)
 * ไม่บอกว่าอีเมลนี้มีบัญชีหรือไม่ — บอกแค่จำนวนตัวนับที่ลบ
 */
import { closeDb } from "../src/db";
import { clearLoginRateLimits } from "../src/lib/auth/login-unlock";
import { normalizeEmail } from "../src/lib/auth/validation";

async function main(): Promise<number> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("วิธีใช้: npm run admin:unlock-login -- <อีเมล>");
    return 2;
  }
  const removed = await clearLoginRateLimits(normalizeEmail(arg));
  console.log(`ปลดล็อกแล้ว — ลบตัวนับ ${removed} รายการ`);
  return 0;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.name : "error", "— ปลดล็อกไม่สำเร็จ ตรวจ DATABASE_URL และการเชื่อมต่อฐานข้อมูล");
    return 1;
  })
  .then(async (code) => {
    await closeDb().catch(() => {});
    process.exit(code);
  });
