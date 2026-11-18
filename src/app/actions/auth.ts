"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { RATE_LIMITS, REFERRAL_COOKIE_NAME } from "@/lib/auth/constants";
import { authMessages } from "@/lib/auth/messages";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { consumeIpRateLimit, consumeRateLimit, pruneRateLimits, resetRateLimit } from "@/lib/auth/rate-limit";
import { clientIpConfigFromEnv, clientIpFromHeaders, emailKey, loginPairKey } from "@/lib/auth/rate-limit-core";
import { startSession } from "@/lib/auth/session";
import { deleteExpiredSessions } from "@/lib/auth/session-store";
import { createUser, findUserForLogin, writeAuthAudit } from "@/lib/auth/users";
import {
  firstFieldErrors,
  loginSchema,
  parseReferralCode,
  postRegisterPath,
  registerSchema,
  safeNextPath,
  type RegisterField,
} from "@/lib/auth/validation";
import { safeErrorSummary } from "@/lib/db-errors";
import type { FormState } from "@/lib/form-state";
import { findReferrerIdByCode } from "@/lib/purchase/referral";

export type RegisterState = FormState<RegisterField>;
export type LoginState = FormState<"email">;

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

let warnedUnknownIp = false;

/** IP จากแหล่งที่ deployment ควบคุมเท่านั้น — null = ระบุไม่ได้ (ตัวนับต่อ IP จะใช้เพดานรวมแทน) */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const ip = clientIpFromHeaders((name) => h.get(name), clientIpConfigFromEnv(process.env));
  if (ip === null && process.env.NODE_ENV === "production" && !warnedUnknownIp) {
    warnedUnknownIp = true;
    console.warn(
      "[auth] ระบุ IP ของผู้ใช้ไม่ได้ — ตั้ง TRUSTED_PROXY_HOPS หรือ CLIENT_IP_HEADER ให้ตรงกับ proxy ที่อยู่หน้าเว็บ " +
        "(ตอนนี้ rate limit ต่อ IP ใช้ตัวนับรวมทั้งระบบแทน)",
    );
  }
  return ip;
}

/** แฮชหลอกสำหรับกรณีไม่พบผู้ใช้ — ให้เวลาตอบใกล้เคียงกับกรณีรหัสผ่านผิด (กันเดาว่าอีเมลไหนมีบัญชี) */
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing-only");
  return dummyHash;
}

export async function registerAction(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  // ค่าที่ส่งกลับไปเติมฟอร์ม — ไม่มีรหัสผ่าน
  const values: RegisterState["values"] = {
    name: text(formData, "name").slice(0, 200),
    email: text(formData, "email").slice(0, 300),
    phone: text(formData, "phone").slice(0, 50),
    lineId: text(formData, "lineId").slice(0, 100),
  };

  let destination: string;
  try {
    const ip = await clientIp();
    // ด่านที่ 1: ทุกคำขอ (เพดานสูง) — กรอกผิดไม่กินโควตาสมัครจริงของคนที่ใช้ IP เดียวกัน (เน็ตมือถือ/ออฟฟิศ)
    const raw = await consumeIpRateLimit(ip, RATE_LIMITS.registerIpRaw, RATE_LIMITS.registerUnknownIpRaw);
    if (!raw.allowed) return { ok: false, formError: authMessages.rateLimited, values };

    const parsed = registerSchema.safeParse({
      name: text(formData, "name"),
      email: text(formData, "email"),
      password: text(formData, "password"),
      phone: text(formData, "phone"),
      lineId: text(formData, "lineId"),
      accept: text(formData, "accept"),
      package: text(formData, "package"),
      ref: text(formData, "ref"),
    });
    if (!parsed.success) {
      return { ok: false, fieldErrors: firstFieldErrors<RegisterField>(parsed.error), values };
    }
    const input = parsed.data;

    // ด่านที่ 2: เฉพาะคำขอที่ผ่านการตรวจฟอร์ม — นับก่อนงานหนัก (แฮชรหัสผ่าน) และก่อนบอกว่าอีเมลซ้ำหรือไม่
    const limit = await consumeIpRateLimit(ip, RATE_LIMITS.registerIp, RATE_LIMITS.registerUnknownIp);
    if (!limit.allowed) return { ok: false, formError: authMessages.rateLimited, values };

    // รหัสชวนเพื่อน (?ref=) — อ่านหลังผ่าน rate limit ทั้งสองด่านเท่านั้น จึงเอาไปไล่เดารหัสถี่ๆ ไม่ได้
    // และคำตอบไม่บอกว่ารหัสมีอยู่จริงหรือไม่: รหัสผิดรูปแบบ/ไม่มีอยู่จริง = สมัครได้ตามปกติ แค่ไม่มีผู้ชวน
    // ฟอร์มไม่มีรหัส (เพื่อนเปิดลิงก์ชวนแล้วไปดูหน้าอื่นก่อน กลับมาสมัครด้วย URL ที่ไม่มี ?ref= แล้ว) → ใช้รหัสที่ src/proxy.ts จำไว้ใน cookie
    // รหัสในฟอร์ม (ลิงก์ที่เพิ่งเปิด) มาก่อน cookie เสมอ และ cookie ผ่านการตรวจรูปแบบเดียวกัน (ผู้ใช้แก้ cookie เองได้ = เท่ากับพิมพ์ ?ref= เอง)
    // ข้อจำกัดที่รับทราบแล้ว: ยังไม่มีการยืนยันอีเมล "เพื่อน" จึงเป็นบัญชีสมัครทิ้งได้ — ดูหัวไฟล์ src/lib/purchase/referral.ts
    const cookieStore = await cookies();
    const refCode = input.ref ?? parseReferralCode(cookieStore.get(REFERRAL_COOKIE_NAME)?.value);
    const referredByUserId = refCode ? await findReferrerIdByCode(refCode) : null;

    const passwordHash = await hashPassword(input.password);
    const user = await createUser({
      email: input.email,
      passwordHash,
      name: input.name,
      phone: input.phone,
      lineId: input.lineId,
      referredByUserId,
    });
    // ความเสี่ยงที่ยอมรับไว้ก่อน (ยังไม่มีระบบส่งอีเมล): คำตอบนี้บอกได้ว่าอีเมลไหนมีบัญชีแล้ว และยังไม่มีการยืนยันอีเมล
    // ใครก็สมัครด้วยอีเมลของคนอื่นได้ — ด่านเดียวตอนนี้คือ rate limit ด้านบน
    // เมื่อเพิ่มอีเมล (Resend) ให้ตอบ "กรุณาตรวจอีเมล" เหมือนกันทั้งสองกรณี และเปิดใช้บัญชีหลังยืนยันอีเมลเท่านั้น
    if (!user) return { ok: false, fieldErrors: { email: authMessages.emailTaken }, values };

    await writeAuthAudit("user.register", user.id, referredByUserId ? { referredByUserId } : undefined);
    await startSession(user.id);
    // สมัครสำเร็จแล้ว: รหัสที่จำไว้หมดหน้าที่ (ผู้ชวนถูกบันทึกครั้งเดียวตอนสร้างบัญชี) — ลบเพื่อไม่ให้ติดไปกับการสมัครบัญชีถัดไปในเบราว์เซอร์นี้
    if (cookieStore.has(REFERRAL_COOKIE_NAME)) cookieStore.delete(REFERRAL_COOKIE_NAME);
    destination = postRegisterPath(input.package);
  } catch (err) {
    console.error("[auth] register failed:", safeErrorSummary(err));
    return { ok: false, formError: authMessages.systemError, values };
  }
  redirect(destination);
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const values: LoginState["values"] = { email: text(formData, "email").slice(0, 300) };
  const invalid: LoginState = { ok: false, formError: authMessages.invalidLogin, values };

  let destination: string;
  try {
    const parsed = loginSchema.safeParse({ email: text(formData, "email"), password: text(formData, "password") });
    if (!parsed.success) return invalid;
    const { email, password } = parsed.data;

    const ip = await clientIp();
    // ด่านหลักคือคู่ (อีเมล, IP): คนที่รู้แค่อีเมลล็อกเจ้าของบัญชีจาก IP อื่นไม่ได้ ดูคำอธิบายแต่ละกติกาใน constants.ts
    const pairKey = loginPairKey(email, ip);
    const [byPair, byEmail, byIp] = await Promise.all([
      consumeRateLimit(pairKey, RATE_LIMITS.loginPair),
      consumeRateLimit(emailKey(email), RATE_LIMITS.loginEmail),
      consumeIpRateLimit(ip, RATE_LIMITS.loginIp, RATE_LIMITS.loginUnknownIp),
    ]);
    if (!byPair.allowed || !byEmail.allowed || !byIp.allowed) {
      return { ok: false, formError: authMessages.rateLimited, values };
    }

    const user = await findUserForLogin(email);
    // ตรวจรหัสผ่านเสมอ แม้ไม่พบผู้ใช้ และตอบข้อความเดียวกันทั้งสองกรณี
    const matches = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !user.passwordHash || !matches) return invalid;

    await deleteExpiredSessions(user.id);
    await startSession(user.id);
    await writeAuthAudit("user.login", user.id);
    // งานเก็บกวาด — พลาดก็ไม่กระทบการล็อกอิน: ล้างตัวนับครั้งที่ผิดของคู่นี้ (นับเฉพาะครั้งที่ผิด) และลบตัวนับเก่า
    await resetRateLimit(pairKey, RATE_LIMITS.loginPair)
      .then(() => pruneRateLimits())
      .catch((err) => console.error("[auth] rate limit cleanup failed:", safeErrorSummary(err)));
    destination = safeNextPath(text(formData, "next"));
  } catch (err) {
    console.error("[auth] login failed:", safeErrorSummary(err));
    return { ok: false, formError: authMessages.systemError, values };
  }
  redirect(destination);
}
