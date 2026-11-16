import { defineConfig } from "drizzle-kit";

// drizzle-kit ไม่โหลด .env.local เอง — โหลดให้ถ้ามีไฟล์ (ไม่มีก็ข้าม เช่นตอน db:generate ที่ไม่ต้องใช้ฐานข้อมูล)
try {
  process.loadEnvFile(".env.local");
} catch {}

const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // ไม่มีค่าเริ่มต้น: ถ้าไม่ตั้ง DATABASE_URL คำสั่งที่ต้องต่อฐานข้อมูล (migrate/studio) จะแจ้ง error แทนที่จะไปต่อฐานของโปรเจกต์อื่น
  ...(url ? { dbCredentials: { url } } : {}),
});
