import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { REFERRAL_COOKIE_MAX_AGE_SECONDS, REFERRAL_COOKIE_NAME, SESSION_COOKIE_NAME } from "./lib/auth/constants";
import { parseReferralCode, safeNextPath } from "./lib/auth/validation";
import { config, proxy } from "./proxy";

// proxy.ts เขียนชื่อ cookie ซ้ำเอง (ไม่ import โมดูลร่วม) — เทสนี้กันสองที่เพี้ยนจากกัน
const source = readFileSync(new URL("./proxy.ts", import.meta.url), "utf8");

const request = (path: string, init: { method?: string; cookie?: string } = {}) =>
  new NextRequest(new URL(path, "http://localhost:3000"), {
    method: init.method ?? "GET",
    headers: init.cookie ? { cookie: init.cookie } : undefined,
  });

/** NextResponse.next() ใส่ header นี้ — ใช้แยก "ปล่อยผ่าน" ออกจาก redirect */
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("src/proxy.ts", () => {
  it("ใช้ชื่อ cookie เดียวกับ constants.ts", () => {
    expect(source).toContain(`const SESSION_COOKIE_NAME = "${SESSION_COOKIE_NAME}";`);
  });

  it("คุมทั้ง /account และ /admin และผ่านหน้า /register (จำรหัสชวนเพื่อน)", () => {
    expect(config.matcher).toEqual(["/account/:path*", "/admin/:path*", "/register"]);
  });

  it("export ชื่อ proxy และไม่ import โมดูลของแอป", () => {
    expect(source).toContain("export function proxy(");
    expect(source).not.toMatch(/from "@\//);
    expect(source).not.toMatch(/from "\.\//);
  });

  it("เปิดหน้าโดยไม่มี cookie → redirect ไป /login พร้อม next", () => {
    for (const method of ["GET", "HEAD"]) {
      const res = proxy(request("/account", { method }));
      expect(res.status).toBe(307);
      expect(passedThrough(res)).toBe(false);
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe("/account");
    }
  });

  it("next เก็บ query ของหน้าที่ขอไว้ และผ่าน safeNextPath", () => {
    for (const path of [
      "/account/orders/new?package=yearly",
      "/account/orders/new?account=3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f",
      "/account/mt5/new?order=3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f",
      "/admin",
    ]) {
      const next = new URL(proxy(request(path)).headers.get("location")!).searchParams.get("next");
      expect(next).toBe(path);
      expect(safeNextPath(next)).toBe(path);
    }
  });

  it("มี cookie → ปล่อยผ่าน (การตรวจจริงอยู่ที่หน้า/ action)", () => {
    const res = proxy(request("/account", { cookie: `${SESSION_COOKIE_NAME}=anything` }));
    expect(passedThrough(res)).toBe(true);
    expect(res.headers.get("location")).toBeNull();
  });

  describe("จำรหัสชวนเพื่อนที่ /register?ref=", () => {
    const CODE = "A1B2C3D4E5";
    const referralCookie = (res: ReturnType<typeof proxy>) => res.cookies.get(REFERRAL_COOKIE_NAME);

    it("ใช้ชื่อ cookie และอายุเดียวกับ constants.ts", () => {
      expect(source).toContain(`const REFERRAL_COOKIE_NAME = "${REFERRAL_COOKIE_NAME}";`);
      expect(source).toContain(`const REFERRAL_COOKIE_MAX_AGE_SECONDS = ${REFERRAL_COOKIE_MAX_AGE_SECONDS};`);
    });

    it("รหัสถูกรูปแบบ → ตั้ง cookie httpOnly / SameSite=Lax อายุ 7 วัน และปล่อยผ่าน (ไม่ redirect แม้ไม่มี session)", () => {
      for (const path of [`/register?ref=${CODE}`, `/register?ref=${CODE}&package=three_months`, `/register?package=yearly&ref=${CODE}`]) {
        const res = proxy(request(path));
        expect(passedThrough(res)).toBe(true);
        expect(res.headers.get("location")).toBeNull();
        expect(referralCookie(res)).toMatchObject({
          value: CODE,
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 7 * 24 * 60 * 60,
        });
      }
    });

    it("รับและปฏิเสธรหัสชุดเดียวกับ parseReferralCode (ค่าที่เก็บคือค่าที่ parse แล้ว)", () => {
      for (const raw of [
        CODE,
        CODE.toLowerCase(),
        ` ${CODE} `,
        "0000000000",
        "",
        "abc",
        "A1B2C3D4E",
        "A1B2C3D4E5F",
        "ZZZZZZZZZZ",
        "A1B2-C3D4E5",
        "' or 1=1 --",
        "x".repeat(500),
      ]) {
        const res = proxy(request(`/register?ref=${encodeURIComponent(raw)}`));
        expect(passedThrough(res)).toBe(true);
        expect(referralCookie(res)?.value ?? null).toBe(parseReferralCode(raw));
      }
    });

    it("ไม่มี ?ref= หรือรหัสผิดรูปแบบ → ไม่แตะ cookie เลย (รหัสที่จำไว้ก่อนหน้ายังอยู่)", () => {
      for (const path of ["/register", "/register?package=three_months", "/register?ref=nope"]) {
        const res = proxy(request(path, { cookie: `${REFERRAL_COOKIE_NAME}=${CODE}` }));
        expect(passedThrough(res)).toBe(true);
        expect(res.headers.get("set-cookie")).toBeNull();
      }
    });

    it("ลิงก์ชวนใหม่ทับรหัสเดิม และ POST (ส่งฟอร์มสมัคร) ไม่ตั้ง cookie", () => {
      const res = proxy(request("/register?ref=0F0F0F0F0F", { cookie: `${REFERRAL_COOKIE_NAME}=${CODE}` }));
      expect(referralCookie(res)?.value).toBe("0F0F0F0F0F");
      const post = proxy(request(`/register?ref=${CODE}`, { method: "POST" }));
      expect(passedThrough(post)).toBe(true);
      expect(post.headers.get("set-cookie")).toBeNull();
    });

    it("หน้าอื่นที่มี ?ref= ไม่ตั้ง cookie (เฉพาะ /register)", () => {
      const res = proxy(request(`/account?ref=${CODE}`, { cookie: `${SESSION_COOKIE_NAME}=anything` }));
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  });

  it("POST ที่ไม่มี cookie (Server Action หลัง session หาย) → ปล่อยผ่าน ไม่ redirect", () => {
    for (const path of ["/account/orders/new", "/account/mt5/new", "/admin"]) {
      const res = proxy(request(path, { method: "POST" }));
      expect(passedThrough(res)).toBe(true);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});
