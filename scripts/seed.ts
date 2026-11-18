/**
 * ตั้งรายการแพ็กเกจในตาราง packages ให้ตรงกับที่ขายจริง (PACKAGE_LINEUP ใน src/lib/purchase/package-lineup.ts):
 *   ฟรี 1 เดือน (ชวนเพื่อน 1 คน) · 3 เดือน แถม 15 วัน 3,000 บาท · 6 เดือน แถม 30 วัน 6,000 บาท · 1 ปี แถม 60 วัน 11,000 บาท
 *   แพ็กเกจเดิมที่เลิกขาย (รายเดือน, ตลอดชีพ) และแพ็กเกจ IB ถูกปิด (is_active = false) ไม่ถูกลบ
 *
 * รัน: npm run db:seed  (ต้องมี DATABASE_URL ใน .env.local หรือใน environment และรัน npm run db:migrate ก่อน)
 * รันซ้ำได้ (idempotent) และใช้กับฐานข้อมูลที่มีรายการแพ็กเกจชุดเดิมอยู่แล้วได้: แก้เฉพาะตาราง packages แบบ upsert ตาม code
 * ไม่แตะคำสั่งซื้อ/license/ผู้ใช้ — หน้าเว็บทุกหน้าอ่านรายการและราคาจากตารางนี้
 */
import { asc } from "drizzle-orm";
import { closeDb, getDb, schema } from "../src/db";
import { applyPackageLineup } from "../src/lib/purchase/package-lineup";

async function main() {
  const count = await applyPackageLineup();
  const rows = await getDb().select().from(schema.packages).orderBy(asc(schema.packages.sortOrder));
  console.log(`seeded ${count} packages`);
  for (const p of rows) {
    const days = p.durationDays === null ? "ตลอดชีพ" : `${p.durationDays}+${p.bonusDays} วัน`;
    const price = p.priceThb === null ? "ยังไม่ตั้งราคา" : `${p.priceThb} บาท`;
    console.log(`  ${p.isActive ? "ขาย " : "ปิด "} ${p.code.padEnd(14)} ${days.padEnd(12)} ${price}  ${p.nameTh}`);
  }
}

main()
  .then(() => 0)
  .catch((e) => {
    console.error(e);
    return 1;
  })
  .then(async (code) => {
    await closeDb().catch(() => {});
    process.exit(code);
  });
