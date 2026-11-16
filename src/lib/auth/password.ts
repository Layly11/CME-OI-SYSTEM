/**
 * แฮชรหัสผ่านเว็บด้วย scrypt ของ node:crypto (ไม่ต้องลงแพ็กเกจเพิ่ม)
 * ห้าม import ไฟล์นี้จาก client component — ใช้ node:crypto
 *
 * รูปแบบที่เก็บ: scrypt$n=32768,r=8,p=3$<salt base64url>$<hash base64url>
 * พารามิเตอร์อยู่ในสตริง จึงปรับค่าในอนาคตได้โดยรหัสเดิมยังตรวจได้ (ดู needsRehash)
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { authMessages, type PasswordPolicyError } from "./messages";

export type ScryptParams = { n: number; r: number; p: number };

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { n: 32768, r: 8, p: 3 };
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** ขอบเขตพารามิเตอร์ที่ยอมตรวจ — กันสตริงแฮชปลอมที่ตั้งค่าหนักเกินจนเซิร์ฟเวอร์ค้าง */
const MIN_N = 2 ** 14;
const MAX_N = 2 ** 17;
const MAX_P = 5;

function normalize(password: string): string {
  return password.normalize("NFKC");
}

function derive(password: string, salt: Buffer, params: ScryptParams, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      normalize(password),
      salt,
      keylen,
      { N: params.n, r: params.r, p: params.p, maxmem: MAX_MEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

function paramsInBounds(p: ScryptParams): boolean {
  return (
    isPowerOfTwo(p.n) && p.n >= MIN_N && p.n <= MAX_N && p.r === 8 && Number.isInteger(p.p) && p.p >= 1 && p.p <= MAX_P
  );
}

type ParsedHash = { params: ScryptParams; salt: Buffer; hash: Buffer };

const HASH_RE = /^scrypt\$n=(\d{1,7}),r=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9_-]{16,64})\$([A-Za-z0-9_-]{22,128})$/;

function parseHash(stored: string): ParsedHash | null {
  const m = HASH_RE.exec(stored);
  if (!m) return null;
  const params = { n: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
  const salt = Buffer.from(m[4], "base64url");
  const hash = Buffer.from(m[5], "base64url");
  if (salt.length < 8 || hash.length < 16) return null;
  return { params, salt, hash };
}

/** `params` มีไว้ให้เทสใช้ค่าเบาๆ เท่านั้น โค้ดจริงไม่ต้องส่ง */
export async function hashPassword(password: string, params: ScryptParams = DEFAULT_SCRYPT_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, params, KEY_LENGTH);
  return `scrypt$n=${params.n},r=${params.r},p=${params.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** คืน false เสมอ (ไม่ throw) เมื่อแฮชผิดรูปแบบหรือพารามิเตอร์อยู่นอกขอบเขต */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parsed = parseHash(stored);
  if (!parsed || !paramsInBounds(parsed.params)) return false;
  try {
    const actual = await derive(password, parsed.salt, parsed.params, parsed.hash.length);
    return actual.length === parsed.hash.length && timingSafeEqual(actual, parsed.hash);
  } catch {
    return false;
  }
}

/** true เมื่อแฮชถูกสร้างด้วยพารามิเตอร์ที่ต่างจากค่าปัจจุบัน (หรืออ่านไม่ได้) */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  const d = DEFAULT_SCRYPT_PARAMS;
  return (
    parsed.params.n !== d.n ||
    parsed.params.r !== d.r ||
    parsed.params.p !== d.p ||
    parsed.salt.length !== SALT_LENGTH ||
    parsed.hash.length !== KEY_LENGTH
  );
}

/** รหัสผ่านยอดนิยมที่ยาว 8 ตัวขึ้นไป (ตัวที่สั้นกว่าตกเกณฑ์ความยาวอยู่แล้ว) — เทียบแบบไม่สนตัวพิมพ์ */
const DENYLIST = new Set([
  "password",
  "password1",
  "password123",
  "passw0rd",
  "p@ssw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "87654321",
  "11111111",
  "00000000",
  "88888888",
  "qwertyui",
  "qwerty123",
  "qwertyuiop",
  "1q2w3e4r",
  "1qaz2wsx",
  "abcd1234",
  "abc12345",
  "iloveyou",
  "asdfghjk",
  "admin123",
  "letmein123",
]);

/** ตรวจนโยบายรหัสผ่าน: คืน null เมื่อผ่าน หรือรหัสข้อผิดพลาด (ไม่มีกฎบังคับผสมตัวอักษร) */
export function checkPasswordPolicy(password: string, email: string): PasswordPolicyError | null {
  const pw = normalize(password);
  const length = Array.from(pw).length;
  if (length < PASSWORD_MIN_LENGTH) return "passwordTooShort";
  if (length > PASSWORD_MAX_LENGTH) return "passwordTooLong";
  const lower = pw.toLowerCase();
  const mail = email.trim().toLowerCase();
  if (mail) {
    const local = mail.split("@")[0];
    if (lower === mail || (local && lower === local)) return "passwordSameAsEmail";
  }
  if (DENYLIST.has(lower)) return "passwordTooCommon";
  return null;
}

export function passwordPolicyMessage(code: PasswordPolicyError): string {
  return authMessages[code];
}
