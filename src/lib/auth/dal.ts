import "server-only";
import { cache } from "react";
import { redirect, unstable_rethrow } from "next/navigation";
import { safeErrorSummary } from "@/lib/db-errors";
import { readSessionToken } from "./session";
import { findUserBySessionToken, type SessionUser } from "./session-store";

export type { SessionUser };

/**
 * ผู้ใช้ที่ล็อกอินอยู่ของ request นี้ (หรือ null)
 * - cache() ของ React = อ่านฐานข้อมูลครั้งเดียวต่อ request ไม่ cache ข้าม request (ออกจากระบบแล้วมีผลทันที)
 * - ไม่มี cookie หรือ cookie ผิดรูปแบบ → คืน null โดยไม่แตะฐานข้อมูล หน้าการตลาดจึงทำงานได้แม้ไม่มี DATABASE_URL
 * - อ่าน cookie จึงต้องเรียกจาก component ที่อยู่ใน <Suspense> เท่านั้น
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = await readSessionToken();
  if (!token) return null;
  return findUserBySessionToken(token);
});

/**
 * แบบไม่ throw สำหรับจุดที่ "รู้ว่าล็อกอินอยู่ก็ดี ไม่รู้ก็ไม่เป็นไร" (header, หน้า login/register)
 * ฐานข้อมูลมีปัญหา → ถือว่าเป็นผู้เยี่ยมชม หน้าจึงยังใช้งานได้ — ห้ามใช้ตัวนี้เป็นด่านตรวจสิทธิ์
 */
export async function getSessionUserOrNull(): Promise<SessionUser | null> {
  try {
    return await getSessionUser();
  } catch (err) {
    unstable_rethrow(err);
    console.error("[auth] session lookup failed:", safeErrorSummary(err));
    return null;
  }
}

/** ต้องล็อกอิน — ไม่ได้ล็อกอินจะถูกพาไปหน้าเข้าสู่ระบบแล้วกลับมาที่ `next` */
export async function requireUser(next: string = "/account"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=" + encodeURIComponent(next));
  return user;
}

/** ต้องเป็นแอดมิน — ลูกค้าทั่วไปถูกพากลับหน้าบัญชี */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser("/admin");
  if (user.role !== "admin") redirect("/account");
  return user;
}
