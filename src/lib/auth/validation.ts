import { z } from "zod";
import { packages } from "@/content/site";
import { authMessages } from "./messages";
import { checkPasswordPolicy, PASSWORD_MAX_LENGTH } from "./password";

export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

const PACKAGE_CODES: readonly string[] = packages.map((p) => p.code);

export function isPackageCode(v: unknown): v is string {
  return typeof v === "string" && PACKAGE_CODES.includes(v);
}

/** ช่องไม่บังคับ: ค่าว่าง/ไม่ส่งมา = undefined */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v ?? undefined);

const emailSchema = z
  .string({ error: authMessages.emailInvalid })
  .transform(normalizeEmail)
  .pipe(z.email({ error: authMessages.emailInvalid }).max(254, { error: authMessages.emailInvalid }));

export const registerSchema = z
  .object({
    name: z
      .string({ error: authMessages.nameRequired })
      .trim()
      .min(1, { error: authMessages.nameRequired })
      .max(100, { error: authMessages.nameTooLong }),
    email: emailSchema,
    password: z.string({ error: authMessages.passwordTooShort }),
    phone: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .regex(/^[0-9+\- ]{9,20}$/, { error: authMessages.phoneInvalid })
        .optional(),
    ),
    lineId: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(50, { error: authMessages.lineIdTooLong }).optional(),
    ),
    accept: z.literal("on", { error: authMessages.acceptRequired }),
    // แพ็กเกจที่ไม่รู้จักไม่ถือเป็นข้อผิดพลาดของผู้ใช้ — แค่ไม่พาไปหน้าสั่งซื้อ
    package: z.preprocess((v) => (isPackageCode(v) ? v : undefined), z.string().optional()),
  })
  .superRefine((data, ctx) => {
    const problem = checkPasswordPolicy(data.password, data.email);
    if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: authMessages[problem] });
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type RegisterField = "name" | "email" | "password" | "phone" | "lineId" | "accept";

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** ข้อความแรกของแต่ละช่อง จาก z.flattenError */
export function firstFieldErrors<F extends string>(error: z.ZodError): Partial<Record<F, string>> {
  const flat = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  const out: Partial<Record<F, string>> = {};
  for (const [field, messages] of Object.entries(flat)) {
    if (messages && messages.length > 0) out[field as F] = messages[0];
  }
  return out;
}

/**
 * ปลายทางหลังล็อกอิน: รับเฉพาะ path ภายในใต้ /account หรือ /admin เท่านั้น
 * กัน open redirect (//evil.com, /\evil, https://…) — ไม่ผ่านให้ไป /account
 */
export function safeNextPath(input: unknown): string {
  const fallback = "/account";
  if (typeof input !== "string" || input.length === 0 || input.length > 500) return fallback;
  if (input.includes("//") || input.includes("\\") || input.includes(":")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(input)) return fallback;
  if (!/^\/(account|admin)(?:[/?#]|$)/.test(input)) return fallback;
  return input;
}

/**
 * ต่อ query ที่อนุญาต (`keys`) กลับเข้า path — ใช้สร้างค่า `next` ให้ requireUser()
 * ผู้ใช้ที่ยังไม่ล็อกอินจึงกลับมาที่หน้าเดิมพร้อมแพ็กเกจ/บัญชี/คำสั่งซื้อที่เลือกไว้ (ค่าถูก encode และผ่าน safeNextPath ได้)
 */
export function pathWithQuery(
  path: string,
  searchParams: Record<string, string | string[] | undefined>,
  keys: readonly string[],
): string {
  const query = new URLSearchParams();
  for (const key of keys) {
    const value = searchParams[key];
    if (typeof value === "string" && value !== "" && value.length <= 100) query.set(key, value);
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

/** ลิงก์เข้าสู่ระบบที่พากลับไปหน้าสั่งซื้อแพ็กเกจที่เลือกไว้ (ไม่มีแพ็กเกจ = /login เฉยๆ) */
export function loginPathForPackage(pkg?: unknown): string {
  return isPackageCode(pkg) ? `/login?next=${encodeURIComponent(postRegisterPath(pkg))}` : "/login";
}

/** ปลายทางหลังสมัคร: มีแพ็กเกจที่เลือกมาก็ไปหน้าสั่งซื้อเลย (หน้านี้สร้างในเฟสสั่งซื้อ) */
export function postRegisterPath(pkg?: unknown): string {
  return isPackageCode(pkg) ? `/account/orders/new?package=${pkg}` : "/account";
}
