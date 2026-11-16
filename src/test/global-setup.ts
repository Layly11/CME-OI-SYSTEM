import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { assertTestDatabaseUrl } from "./test-db-guard";

/** รันครั้งเดียวก่อน integration test ทั้งหมด: migrate ฐานข้อมูลเทสให้เป็นเวอร์ชันล่าสุด */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  assertTestDatabaseUrl(url);
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  } finally {
    await client.end({ timeout: 5 });
  }
}
