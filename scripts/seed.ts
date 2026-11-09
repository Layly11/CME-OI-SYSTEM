/**
 * ใส่ข้อมูลตั้งต้น: แพ็กเกจ 4 แบบ (+ แพ็กเกจ IB)
 * รัน: npm run db:seed  (ต้องมี DATABASE_URL ใน .env.local และรัน npm run db:migrate ก่อน)
 *
 * ราคา (price_thb) ยังเป็น null จนกว่าลูกค้าจะยืนยัน — หน้าเว็บจะแสดง "สอบถามราคา"
 */
import { getDb, schema } from "../src/db";

async function main() {
  const db = getDb();
  const rows: (typeof schema.packages.$inferInsert)[] = [
    { code: "monthly", nameTh: "รายเดือน", durationDays: 30, priceThb: null, maxAccounts: 1, sortOrder: 1 },
    { code: "six_months", nameTh: "6 เดือน", durationDays: 180, priceThb: null, maxAccounts: 1, sortOrder: 2 },
    { code: "yearly", nameTh: "รายปี", durationDays: 365, priceThb: null, maxAccounts: 1, sortOrder: 3 },
    { code: "lifetime", nameTh: "ตลอดชีพ", durationDays: null, priceThb: null, maxAccounts: 1, sortOrder: 4 },
    {
      code: "ib",
      nameTh: "สำหรับลูกค้า IB",
      description: "สำหรับบัญชีที่เปิดผ่าน IB ของผู้ให้บริการ (เงื่อนไขรอยืนยัน)",
      durationDays: 30,
      priceThb: 0,
      maxAccounts: 1,
      isActive: false,
      sortOrder: 5,
    },
  ];

  for (const r of rows) {
    await db
      .insert(schema.packages)
      .values(r)
      .onConflictDoUpdate({
        target: schema.packages.code,
        set: { nameTh: r.nameTh, durationDays: r.durationDays, maxAccounts: r.maxAccounts, sortOrder: r.sortOrder },
      });
  }
  console.log(`seeded ${rows.length} packages`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
