import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { assertTestDatabaseUrl } from "./test-db-guard";

const url = process.env.TEST_DATABASE_URL;
if (url) {
  assertTestDatabaseUrl(url);
  // โค้ดแอปอ่าน DATABASE_URL — ชี้ไปฐานเทสเท่านั้นระหว่างรัน integration test
  process.env.DATABASE_URL = url;
} else {
  delete process.env.DATABASE_URL;
}

// integration test ต้องไม่มีทางเขียนรายชื่อ license ไป Firebase: บังคับเขียนลงโฟลเดอร์ชั่วคราวในเครื่อง
// และลบค่าตั้ง Firebase ทั้งหมดออกจาก process (ต่อให้ .env.local มีค่าจริงอยู่)
process.env.LICENSE_STORAGE = "local";
process.env.LICENSE_LOCAL_DIR = path.join(os.tmpdir(), "cme-oi-web-itest-license");
for (const key of Object.keys(process.env)) {
  if (key.startsWith("FIREBASE_")) delete process.env[key];
}

/** false = ไม่ได้ตั้ง TEST_DATABASE_URL → ใช้กับ describe.skipIf(!hasTestDb) */
export const hasTestDb = Boolean(url);

const APP_TABLES = [
  "audit_logs",
  "rate_limit_buckets",
  "sessions",
  "license_file_publications",
  "download_assets",
  "license_activations",
  "licenses",
  "orders",
  "mt5_accounts",
  "packages",
  "users",
];

/** ล้างข้อมูลทุกตารางของแอป (เรียกใน beforeEach) */
export async function resetDb(): Promise<void> {
  if (!url) throw new Error("ไม่ได้ตั้ง TEST_DATABASE_URL");
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  const { getDb } = await import("@/db");
  const list = APP_TABLES.map((t) => `"${t}"`).join(", ");
  await getDb().execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
}
