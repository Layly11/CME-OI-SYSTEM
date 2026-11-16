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

export function proxy(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE_NAME)) return NextResponse.next();
  const url = new URL("/login", request.url);
  // เก็บ query ไว้ด้วย (เช่น ?package=yearly) — หน้า login ตรวจค่านี้ด้วย safeNextPath() ก่อนใช้
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/account/:path*", "/admin/:path*"],
};
