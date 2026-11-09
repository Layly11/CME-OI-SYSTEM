import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * เชื่อมต่อฐานข้อมูลแบบ lazy: สร้าง connection ครั้งแรกตอนถูกเรียกใช้จริงเท่านั้น
 * ทำให้ `next build` ผ่านได้แม้ยังไม่ได้ตั้งค่า DATABASE_URL
 */
let _db: ReturnType<typeof createDb> | null = null;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "ยังไม่ได้ตั้งค่า DATABASE_URL — คัดลอก .env.example เป็น .env.local แล้วใส่ connection string ของ PostgreSQL",
    );
  }
  // Neon/Supabase pooler ต้องการ prepare: false
  const client = postgres(url, { prepare: false, max: 5 });
  return drizzle(client, { schema });
}

export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}

export { schema };
