/**
 * ตัวช่วยอ่าน error จาก PostgreSQL
 * drizzle-orm ห่อ error ของ driver ไว้ใน DrizzleQueryError (รหัส pg อยู่ที่ `.cause`) จึงต้องไล่ตาม cause
 */
type PgLikeError = { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    const e = cur as PgLikeError;
    if (e.code === "23505") {
      if (constraint === undefined) return true;
      return e.constraint_name === constraint || e.constraint === constraint;
    }
    cur = e.cause;
  }
  return false;
}

/**
 * สรุป error แบบสั้นสำหรับเขียน log — ไม่ใช้ `err.message` ของ drizzle ตรงๆ
 * เพราะ DrizzleQueryError ใส่ค่าพารามิเตอร์ของ query (อีเมล, hash) ไว้ในข้อความ
 */
export function safeErrorSummary(err: unknown): string {
  if (!err || typeof err !== "object") return typeof err === "string" ? "Error" : String(err);
  const e = err as { name?: unknown; code?: unknown; cause?: unknown };
  const name = typeof e.name === "string" ? e.name : "Error";
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    const c = cur as { code?: unknown; cause?: unknown };
    if (typeof c.code === "string") return `${name} (code ${c.code})`;
    cur = c.cause;
  }
  return name;
}
