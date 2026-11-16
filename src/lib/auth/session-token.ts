import { createHash, randomBytes } from "node:crypto";

/** token สุ่ม 32 ไบต์ เข้ารหัส base64url ได้ 43 ตัวอักษร — ค่านี้อยู่ใน cookie ของผู้ใช้เท่านั้น */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** ฐานข้อมูลเก็บเฉพาะ SHA-256 (hex 64 ตัว) ของ token — ฐานข้อมูลรั่วก็เอาไปล็อกอินไม่ได้ */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}
