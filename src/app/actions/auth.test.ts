import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirectTarget } from "@/test/next-redirect";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock("@/lib/auth/password", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/password")>()),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  consumeRateLimit: vi.fn(),
  consumeIpRateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
  pruneRateLimits: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ startSession: vi.fn() }));
vi.mock("@/lib/auth/session-store", () => ({ deleteExpiredSessions: vi.fn() }));
vi.mock("@/lib/auth/users", () => ({ createUser: vi.fn(), findUserForLogin: vi.fn(), writeAuthAudit: vi.fn() }));
vi.mock("@/lib/purchase/referral", () => ({ findReferrerIdByCode: vi.fn() }));

import { cookies, headers } from "next/headers";
import { RATE_LIMITS, REFERRAL_COOKIE_NAME } from "@/lib/auth/constants";
import { authMessages } from "@/lib/auth/messages";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { consumeIpRateLimit, consumeRateLimit, pruneRateLimits, resetRateLimit } from "@/lib/auth/rate-limit";
import { emailKey, loginPairKey } from "@/lib/auth/rate-limit-core";
import { startSession } from "@/lib/auth/session";
import { createUser, findUserForLogin, writeAuthAudit } from "@/lib/auth/users";
import { findReferrerIdByCode } from "@/lib/purchase/referral";
import { loginAction, registerAction } from "./auth";

const REAL_IP = "198.51.100.77";
const ENV_KEYS = ["TRUSTED_PROXY_HOPS", "CLIENT_IP_HEADER", "VERCEL"] as const;
const savedEnv: Record<string, string | undefined> = {};

function requestHeaders(h: Record<string, string>) {
  vi.mocked(headers).mockResolvedValue(new Headers(h) as unknown as Awaited<ReturnType<typeof headers>>);
}
/** cookie ของคำขอ (จำลอง store ของ next/headers เท่าที่ action ใช้) — คืน Map เพื่อดูว่าอะไรถูกลบ */
function requestCookies(initial: Record<string, string> = {}): Map<string, string> {
  const jar = new Map(Object.entries(initial));
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    has: (name: string) => jar.has(name),
    delete: (name: string) => void jar.delete(name),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
  return jar;
}
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const validRegistration = {
  name: "สมชาย ตัวอย่าง",
  email: "Somchai@Example.com",
  password: "ทองคำขึ้นลง2569",
  accept: "on",
};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.TRUSTED_PROXY_HOPS = "1";
  requestHeaders({ "x-forwarded-for": `203.0.113.5, ${REAL_IP}` });
  requestCookies();
  for (const fn of [consumeRateLimit, consumeIpRateLimit]) vi.mocked(fn).mockReset().mockResolvedValue({ allowed: true });
  for (const fn of [resetRateLimit, pruneRateLimits, startSession]) vi.mocked(fn).mockReset().mockResolvedValue(undefined);
  vi.mocked(hashPassword).mockReset().mockResolvedValue("scrypt$hash");
  vi.mocked(verifyPassword).mockReset().mockResolvedValue(false);
  vi.mocked(createUser).mockReset().mockResolvedValue({ id: "u1" });
  vi.mocked(findUserForLogin).mockReset().mockResolvedValue(null);
  vi.mocked(writeAuthAudit).mockReset().mockResolvedValue(undefined);
  vi.mocked(findReferrerIdByCode).mockReset().mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("IP ที่ใช้กับ rate limit", () => {
  it("ใช้ตัวที่ proxy ของเราเติม (ขวาสุด) — ตัวแรกของ x-forwarded-for ที่ผู้ใช้ปลอมมาไม่มีผล", async () => {
    for (const spoofed of ["203.0.113.1", "203.0.113.2", "10.0.0.1"]) {
      requestHeaders({ "x-forwarded-for": `${spoofed}, ${REAL_IP}` });
      await registerAction({ ok: false }, form({}));
    }
    const ips = vi.mocked(consumeIpRateLimit).mock.calls.map((c) => c[0]);
    expect(ips).toEqual([REAL_IP, REAL_IP, REAL_IP]);
  });

  it("ไม่ได้ตั้งค่า proxy ที่เชื่อได้ → ไม่เชื่อ header เลย (IP = null ใช้ตัวนับรวม)", async () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    requestHeaders({ "x-forwarded-for": "203.0.113.1", "x-real-ip": "203.0.113.2" });
    await registerAction({ ok: false }, form({}));
    expect(consumeIpRateLimit).toHaveBeenCalledWith(null, RATE_LIMITS.registerIpRaw, RATE_LIMITS.registerUnknownIpRaw);
  });
});

describe("registerAction", () => {
  it("กรอกผิด → กินแค่โควตาคำขอดิบ ไม่กินโควตาสมัครจริง และไม่แฮชรหัสผ่าน", async () => {
    const short = await registerAction({ ok: false }, form({ ...validRegistration, password: "short" }));
    expect(short.fieldErrors?.password).toBe(authMessages.passwordTooShort);
    const unticked = await registerAction({ ok: false }, form({ ...validRegistration, accept: "" }));
    expect(unticked.fieldErrors?.accept).toBe(authMessages.acceptRequired);
    expect(consumeIpRateLimit).toHaveBeenCalledTimes(2);
    expect(consumeIpRateLimit).toHaveBeenCalledWith(REAL_IP, RATE_LIMITS.registerIpRaw, RATE_LIMITS.registerUnknownIpRaw);
    expect(hashPassword).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("กรอกถูก → นับโควตาสมัครจริงก่อนแฮช แล้วสร้างบัญชีและเริ่ม session", async () => {
    const target = await redirectTarget(() =>
      registerAction({ ok: false }, form({ ...validRegistration, package: "yearly" })),
    );
    expect(target).toBe("/account/orders/new?package=yearly");
    expect(vi.mocked(consumeIpRateLimit).mock.calls.map((c) => c[1])).toEqual([
      RATE_LIMITS.registerIpRaw,
      RATE_LIMITS.registerIp,
    ]);
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email: "somchai@example.com", passwordHash: "scrypt$hash" }));
    expect(startSession).toHaveBeenCalledWith("u1");
  });

  it("เกินเพดานคำขอดิบ → หยุดก่อนตรวจฟอร์ม", async () => {
    vi.mocked(consumeIpRateLimit).mockResolvedValueOnce({ allowed: false });
    const state = await registerAction({ ok: false }, form(validRegistration));
    expect(state.formError).toBe(authMessages.rateLimited);
    expect(consumeIpRateLimit).toHaveBeenCalledTimes(1);
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("เกินเพดานสมัครจริง → หยุดก่อนแฮชรหัสผ่านและก่อนบอกว่าอีเมลซ้ำหรือไม่", async () => {
    vi.mocked(consumeIpRateLimit).mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    const state = await registerAction({ ok: false }, form(validRegistration));
    expect(state.formError).toBe(authMessages.rateLimited);
    expect(hashPassword).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("อีเมลซ้ำ → แจ้งที่ช่องอีเมล ไม่เริ่ม session และไม่ส่งรหัสผ่านกลับ", async () => {
    vi.mocked(createUser).mockResolvedValue(null);
    const state = await registerAction({ ok: false }, form(validRegistration));
    expect(state.fieldErrors?.email).toBe(authMessages.emailTaken);
    expect(startSession).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).not.toContain(validRegistration.password);
  });
});

describe("registerAction กับรหัสชวนเพื่อน (?ref=)", () => {
  const REFERRER = "22222222-2222-4222-8222-222222222222";
  const CODE = "A1B2C3D4E5";

  it("รหัสถูกรูปแบบและมีอยู่จริง → บันทึกผู้ชวนตอนสร้างบัญชี (ครั้งเดียว) และยังไปหน้าสั่งซื้อแพ็กเกจที่เลือก", async () => {
    vi.mocked(findReferrerIdByCode).mockResolvedValue(REFERRER);
    const target = await redirectTarget(() =>
      registerAction({ ok: false }, form({ ...validRegistration, package: "three_months", ref: ` ${CODE.toLowerCase()} ` })),
    );
    expect(target).toBe("/account/orders/new?package=three_months");
    // รหัสถูกทำให้เป็นตัวพิมพ์ใหญ่และตัดช่องว่างก่อนค้น
    expect(findReferrerIdByCode).toHaveBeenCalledWith(CODE);
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email: "somchai@example.com", referredByUserId: REFERRER }));
    expect(writeAuthAudit).toHaveBeenCalledWith("user.register", "u1", { referredByUserId: REFERRER });
  });

  it("รหัสที่ไม่มีอยู่จริง → สมัครได้ตามปกติ ไม่มีผู้ชวน และคำตอบไม่บอกว่ารหัสผิด", async () => {
    vi.mocked(findReferrerIdByCode).mockResolvedValue(null);
    const target = await redirectTarget(() => registerAction({ ok: false }, form({ ...validRegistration, ref: CODE })));
    expect(target).toBe("/account");
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ referredByUserId: null }));
    expect(writeAuthAudit).toHaveBeenCalledWith("user.register", "u1", undefined);
  });

  it.each(["", "abc", "A1B2C3D4E", "A1B2C3D4E5F", "ZZZZZZZZZZ", "A1B2-C3D4E5", "' or 1=1 --", "x".repeat(500)])(
    "รหัสผิดรูปแบบ %j → ไม่ค้นฐานข้อมูลเลย สมัครได้ตามปกติ",
    async (ref) => {
      expect(await redirectTarget(() => registerAction({ ok: false }, form({ ...validRegistration, ref })))).toBe("/account");
      expect(findReferrerIdByCode).not.toHaveBeenCalled();
      expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ referredByUserId: null }));
    },
  );

  it("ค้นรหัสหลังผ่าน rate limit ทั้งสองด่านและหลังตรวจฟอร์มเท่านั้น (เอาไปไล่เดารหัสถี่ๆ ไม่ได้)", async () => {
    vi.mocked(findReferrerIdByCode).mockResolvedValue(REFERRER);
    // เกินเพดานคำขอดิบ
    vi.mocked(consumeIpRateLimit).mockResolvedValueOnce({ allowed: false });
    await registerAction({ ok: false }, form({ ...validRegistration, ref: CODE }));
    // เกินเพดานสมัครจริง
    vi.mocked(consumeIpRateLimit).mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    await registerAction({ ok: false }, form({ ...validRegistration, ref: CODE }));
    // กรอกฟอร์มผิด
    const invalid = await registerAction({ ok: false }, form({ ...validRegistration, password: "short", ref: CODE }));
    expect(invalid.fieldErrors?.password).toBe(authMessages.passwordTooShort);
    expect(findReferrerIdByCode).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("อีเมลซ้ำ → ไม่มีอะไรถูกบันทึก (ผู้ใช้เดิมเปลี่ยนผู้ชวนด้วยการสมัครซ้ำไม่ได้)", async () => {
    vi.mocked(findReferrerIdByCode).mockResolvedValue(REFERRER);
    vi.mocked(createUser).mockResolvedValue(null);
    const state = await registerAction({ ok: false }, form({ ...validRegistration, ref: CODE }));
    expect(state.fieldErrors?.email).toBe(authMessages.emailTaken);
    expect(writeAuthAudit).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  describe("รหัสที่ proxy จำไว้ใน cookie (เพื่อนเปิดลิงก์ชวนแล้วไปหน้าอื่นก่อนสมัคร)", () => {
    const OTHER_CODE = "0F0F0F0F0F";

    it("ฟอร์มไม่มีรหัส → ใช้รหัสจาก cookie บันทึกผู้ชวน แล้วลบ cookie เมื่อสมัครสำเร็จ (แพ็กเกจที่เลือกยังอยู่)", async () => {
      vi.mocked(findReferrerIdByCode).mockResolvedValue(REFERRER);
      const jar = requestCookies({ [REFERRAL_COOKIE_NAME]: CODE, other: "keep" });
      const target = await redirectTarget(() =>
        registerAction({ ok: false }, form({ ...validRegistration, package: "three_months" })),
      );
      expect(target).toBe("/account/orders/new?package=three_months");
      expect(findReferrerIdByCode).toHaveBeenCalledWith(CODE);
      expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ referredByUserId: REFERRER }));
      expect([...jar.keys()]).toEqual(["other"]);
    });

    it("ฟอร์มมีรหัส (ลิงก์ที่เพิ่งเปิด) → ใช้รหัสของฟอร์ม ไม่ใช่ของ cookie", async () => {
      vi.mocked(findReferrerIdByCode).mockResolvedValue(REFERRER);
      const jar = requestCookies({ [REFERRAL_COOKIE_NAME]: OTHER_CODE });
      await redirectTarget(() => registerAction({ ok: false }, form({ ...validRegistration, ref: CODE })));
      expect(findReferrerIdByCode).toHaveBeenCalledTimes(1);
      expect(findReferrerIdByCode).toHaveBeenCalledWith(CODE);
      expect(jar.size).toBe(0);
    });

    it.each(["abc", "ZZZZZZZZZZ", "' or 1=1 --", "x".repeat(500)])(
      "cookie ผิดรูปแบบ %j (ผู้ใช้แก้เอง) → ไม่ค้นฐานข้อมูล สมัครได้ตามปกติ ไม่มีผู้ชวน",
      async (value) => {
        requestCookies({ [REFERRAL_COOKIE_NAME]: value });
        expect(await redirectTarget(() => registerAction({ ok: false }, form(validRegistration)))).toBe("/account");
        expect(findReferrerIdByCode).not.toHaveBeenCalled();
        expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ referredByUserId: null }));
      },
    );

    it("สมัครไม่สำเร็จ (เกิน rate limit / กรอกผิด / อีเมลซ้ำ) → cookie ยังอยู่ให้ลองใหม่ และไม่ค้นรหัสก่อนผ่านด่าน", async () => {
      vi.mocked(findReferrerIdByCode).mockResolvedValue(REFERRER);
      const jar = requestCookies({ [REFERRAL_COOKIE_NAME]: CODE });
      vi.mocked(consumeIpRateLimit).mockResolvedValueOnce({ allowed: false });
      await registerAction({ ok: false }, form(validRegistration));
      vi.mocked(consumeIpRateLimit).mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
      await registerAction({ ok: false }, form(validRegistration));
      await registerAction({ ok: false }, form({ ...validRegistration, password: "short" }));
      expect(findReferrerIdByCode).not.toHaveBeenCalled();

      vi.mocked(createUser).mockResolvedValue(null);
      const taken = await registerAction({ ok: false }, form(validRegistration));
      expect(taken.fieldErrors?.email).toBe(authMessages.emailTaken);
      expect(jar.get(REFERRAL_COOKIE_NAME)).toBe(CODE);
    });
  });
});

describe("loginAction", () => {
  const credentials = { email: "Owner@Example.com", password: "ทองคำขึ้นลง2569", next: "/account/orders/new?package=yearly" };
  const pairKey = loginPairKey("owner@example.com", REAL_IP);

  it("นับ 3 ตัว: คู่ (อีเมล, IP), เพดานรวมต่ออีเมล, ต่อ IP", async () => {
    await loginAction({ ok: false }, form(credentials));
    expect(consumeRateLimit).toHaveBeenCalledWith(pairKey, RATE_LIMITS.loginPair);
    expect(consumeRateLimit).toHaveBeenCalledWith(emailKey("owner@example.com"), RATE_LIMITS.loginEmail);
    expect(consumeIpRateLimit).toHaveBeenCalledWith(REAL_IP, RATE_LIMITS.loginIp, RATE_LIMITS.loginUnknownIp);
  });

  it("ตัวนับคู่ของ IP อื่นเป็นคนละ key — คนที่รู้แค่อีเมลล็อกเจ้าของบัญชีไม่ได้", async () => {
    requestHeaders({ "x-forwarded-for": "203.0.113.9" });
    await loginAction({ ok: false }, form(credentials));
    const attackerKey = vi.mocked(consumeRateLimit).mock.calls.find((c) => c[1] === RATE_LIMITS.loginPair)?.[0];
    expect(attackerKey).toBe(loginPairKey("owner@example.com", "203.0.113.9"));
    expect(attackerKey).not.toBe(pairKey);
  });

  it.each([RATE_LIMITS.loginPair, RATE_LIMITS.loginEmail])("เกินเพดาน %o → ไม่ตรวจรหัสผ่านเลย", async (rule) => {
    vi.mocked(consumeRateLimit).mockImplementation(async (_key, r) => ({ allowed: r !== rule }));
    const state = await loginAction({ ok: false }, form(credentials));
    expect(state.formError).toBe(authMessages.rateLimited);
    expect(findUserForLogin).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("รหัสผ่านผิด / ไม่มีผู้ใช้ → ข้อความเดียวกัน และไม่ล้างตัวนับ", async () => {
    const noUser = await loginAction({ ok: false }, form(credentials));
    vi.mocked(findUserForLogin).mockResolvedValue({ id: "u1", passwordHash: "scrypt$stored" });
    const wrong = await loginAction({ ok: false }, form(credentials));
    expect(noUser.formError).toBe(authMessages.invalidLogin);
    expect(wrong).toEqual(noUser);
    expect(verifyPassword).toHaveBeenCalledTimes(2);
    expect(resetRateLimit).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("รหัสผ่านถูก → เริ่ม session, ล้างตัวนับคู่ของตัวเอง (นับเฉพาะครั้งที่ผิด) และไปปลายทางที่ปลอดภัย", async () => {
    vi.mocked(findUserForLogin).mockResolvedValue({ id: "u1", passwordHash: "scrypt$stored" });
    vi.mocked(verifyPassword).mockResolvedValue(true);
    expect(await redirectTarget(() => loginAction({ ok: false }, form(credentials)))).toBe(
      "/account/orders/new?package=yearly",
    );
    expect(startSession).toHaveBeenCalledWith("u1");
    expect(resetRateLimit).toHaveBeenCalledWith(pairKey, RATE_LIMITS.loginPair);

    expect(await redirectTarget(() => loginAction({ ok: false }, form({ ...credentials, next: "//evil.example" })))).toBe(
      "/account",
    );
  });
});
