import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * ด่านแรกของหน้าสมาชิก/แอดมิน: เปิดหน้า (GET/HEAD) โดยไม่มี cookie session → ส่งไปหน้าเข้าสู่ระบบทันที
 * เป็นแค่การเช็คแบบเร็ว (มี cookie หรือไม่) — การตรวจจริงอยู่ที่ requireUser()/requireAdmin() ในแต่ละหน้า
 * และในทุก Server Action / Route Handler
 *
 * คำขออื่น (POST ของ Server Action) ปล่อยผ่านเสมอ: ถ้า redirect ที่นี่ ฟอร์มจะได้คำตอบที่ Next อ่านไม่ออก
 * แล้วขึ้นหน้า error แทนที่จะพาไปหน้าเข้าสู่ระบบ — action ทุกตัวตรวจ session เองและ redirect ไป /login อยู่แล้ว
 *
 * ค่านี้ต้องตรงกับ SESSION_COOKIE_NAME ใน src/lib/auth/constants.ts
 * (เขียนซ้ำตรงนี้เพราะเอกสาร Next บอกว่า proxy ไม่ควรพึ่งโมดูลร่วมกับโค้ด render — มีเทสคุมไว้ใน proxy.test.ts)
 */
const SESSION_COOKIE_NAME = "cme_session";

/**
 * จำรหัสชวนเพื่อน: เปิด /register?ref=CODE (ลิงก์ชวนเพื่อน) → เก็บรหัสไว้ใน cookie อายุสั้น
 * เพื่อนที่กดไปดูหน้าแพ็กเกจ/หน้าเข้าสู่ระบบก่อนแล้วค่อยกลับมาสมัคร (URL ไม่มี ?ref= แล้ว) จึงยังถูกนับให้ผู้ชวน
 * registerAction อ่าน cookie นี้เมื่อฟอร์มไม่มีรหัส (หลังผ่าน rate limit ทั้งสองด่านเหมือนรหัสจากฟอร์ม) และลบทิ้งเมื่อสมัครสำเร็จ
 *
 * ที่นี่ตรวจแค่ "รูปแบบ" ของรหัส ไม่ค้นฐานข้อมูล — จึงไม่มีจุดให้ไล่เดาว่ารหัสไหนมีอยู่จริง และไม่มีงานฐานข้อมูลต่อคำขอ
 * cookie เป็น httpOnly: ไม่มีสคริปต์ฝั่งเบราว์เซอร์อ่านได้ และไม่มีข้อมูลส่วนบุคคล (มีแค่รหัสของผู้ชวน)
 *
 * ชื่อ cookie / อายุ / รูปแบบรหัส ต้องตรงกับ REFERRAL_COOKIE_NAME, REFERRAL_COOKIE_MAX_AGE_SECONDS (src/lib/auth/constants.ts)
 * และ parseReferralCode (src/lib/auth/validation.ts) — เขียนซ้ำด้วยเหตุผลเดียวกับด้านบน มีเทสคุมไว้ใน proxy.test.ts
 */
const REFERRAL_COOKIE_NAME = "cme_ref";
const REFERRAL_COOKIE_MAX_AGE_SECONDS = 604800;
const REFERRAL_CODE_PATTERN = /^[0-9A-F]{10}$/;

function rememberReferral(request: NextRequest) {
  const response = NextResponse.next();
  const raw = request.nextUrl.searchParams.get("ref");
  if (raw === null || raw.length > 40) return response;
  const code = raw.trim().toUpperCase();
  // รหัสผิดรูปแบบ = ไม่ทำอะไร (ไม่ลบรหัสที่จำไว้ก่อนหน้า) — ลิงก์ชวนใหม่ที่ถูกรูปแบบจะทับของเดิม (ลิงก์ล่าสุดชนะ)
  if (!REFERRAL_CODE_PATTERN.test(code)) return response;
  response.cookies.set(REFERRAL_COOKIE_NAME, code, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

export function proxy(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  // หน้าสมัครสมาชิกเป็นหน้าสาธารณะ: ไม่มีการ redirect ไป /login — มีไว้จำรหัสชวนเพื่อนเท่านั้น
  if (request.nextUrl.pathname === "/register") return rememberReferral(request);
  if (request.cookies.has(SESSION_COOKIE_NAME)) return NextResponse.next();
  const url = new URL("/login", request.url);
  // เก็บ query ไว้ด้วย (เช่น ?package=yearly) — หน้า login ตรวจค่านี้ด้วย safeNextPath() ก่อนใช้
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/account/:path*", "/admin/:path*", "/register"],
};
