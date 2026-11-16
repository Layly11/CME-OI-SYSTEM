/** กันพลาด: integration test จะ TRUNCATE ทุกตาราง จึงยอมเฉพาะฐานข้อมูลที่ชื่อลงท้ายด้วย _test */
export function assertTestDatabaseUrl(url: string): void {
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("TEST_DATABASE_URL ไม่ใช่ URL ที่ถูกต้อง");
  }
  if (!name.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL ต้องชี้ไปฐานข้อมูลที่ชื่อลงท้ายด้วย _test (เทสจะล้างข้อมูลทุกตาราง)");
  }
}
