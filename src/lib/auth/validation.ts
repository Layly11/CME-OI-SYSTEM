import { z } from "zod";
import { FREE_REFERRAL_PACKAGE_CODE, isKnownPackageCode } from "@/lib/purchase/packages";
import { authMessages } from "./messages";
import { checkPasswordPolicy, PASSWORD_MAX_LENGTH } from "./password";

export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * code แพ็กเกจที่รับจาก ?package= (หน้าแพ็กเกจ → สมัคร/ล็อกอิน → หน้าสั่งซื้อ) — รายการและราคาจริงอยู่ในตาราง packages
 * ที่นี่ตรวจแค่ว่าเป็น code ที่รู้จัก (กันค่าแปลกปลอมใน URL) หน้าสั่งซื้อเลือกให้เฉพาะแพ็กเกจที่เปิดขายอยู่
 * "ib" ไม่รับ: ไม่ใช่แพ็กเกจที่ลูกค้าเลือกซื้อเอง
 */
export function isPackageCode(v: unknown): v is string {
  return isKnownPackageCode(v) && v !== "ib";
}

/** รหัสชวนเพื่อน: เลขฐานสิบหก 10 ตัว (ฐานข้อมูลสร้างเป็นตัวพิมพ์ใหญ่ — ดู users.referral_code) */
const REFERRAL_CODE_PATTERN = /^[0-9A-F]{10}$/;

/**
 * อ่านรหัสชวนเพื่อนจาก ?ref= หรือช่องซ่อนของฟอร์มสมัคร — รูปแบบไม่ถูก = ไม่มีรหัส (null) ไม่ถือเป็นข้อผิดพลาดของผู้ใช้
 * (ลิงก์ที่พิมพ์เล็ก/มีช่องว่างจากการคัดลอกยังใช้ได้)
 */
export function parseReferralCode(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 40) return null;
  const code = v.trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

/** ลิงก์ชวนเพื่อนของผู้ใช้ (path ภายในเว็บ) */
export function referralInvitePath(code: string): string {
  return `/register?ref=${encodeURIComponent(code)}`;
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
    // รหัสชวนเพื่อนที่รูปแบบไม่ถูกถูกทิ้งเงียบๆ — สมัครได้ตามปกติ แค่ไม่มีผู้ชวน (รหัสที่ไม่มีอยู่จริงก็เช่นกัน ดู registerAction)
    ref: z.preprocess((v) => parseReferralCode(v) ?? undefined, z.string().optional()),
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

/** ลิงก์เข้าสู่ระบบที่พากลับไปปลายทางของแพ็กเกจที่เลือกไว้ (ดู postRegisterPath — ไม่มีแพ็กเกจ = /login เฉยๆ) */
export function loginPathForPackage(pkg?: unknown): string {
  return isPackageCode(pkg) ? `/login?next=${encodeURIComponent(postRegisterPath(pkg))}` : "/login";
}

/**
 * ปลายทางหลังสมัคร/ล็อกอิน: มีแพ็กเกจที่เลือกมาก็ไปหน้าสั่งซื้อแพ็กเกจนั้นเลย
 * ยกเว้นแพ็กเกจฟรีจากการชวนเพื่อน → หน้าบัญชีของฉัน: ปุ่มบนหน้าแพ็กเกจคือ "สมัครและรับลิงก์ชวนเพื่อน" และลิงก์ชวนเพื่อนอยู่ที่หน้านั้น
 * (สมาชิกใหม่ยังรับแพ็กเกจฟรีไม่ได้ จึงไม่พาไปหน้าสั่งซื้อที่ตัวเลือกนี้ถูกปิดอยู่ — ครบเงื่อนไขแล้วหน้าบัญชีมีลิงก์ "รับแพ็กเกจฟรี")
 */
export function postRegisterPath(pkg?: unknown): string {
  if (!isPackageCode(pkg) || pkg === FREE_REFERRAL_PACKAGE_CODE) return "/account";
  return `/account/orders/new?package=${pkg}`;
}
