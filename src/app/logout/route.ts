import { endSession } from "@/lib/auth/session";
import { safeErrorSummary } from "@/lib/db-errors";

/**
 * POST /logout — ออกจากระบบด้วยการโหลดหน้าใหม่ทั้งหน้า (ฟอร์ม HTML ธรรมดา ไม่ใช่ Server Action)
 *
 * เหตุผล: ถ้าออกจากระบบด้วย soft navigation Next จะเก็บหน้าที่เคยเปิด (อีเมล เลขบัญชี MT5 คำสั่งซื้อ)
 * ไว้ใน DOM แบบซ่อนจนกว่าจะ reload — เอกสาร Next (preserving-ui-state) แนะนำให้ logout ด้วยการโหลดทั้งหน้า
 *
 * ไม่ต้องมี CSRF token: cookie ของ session เป็น SameSite=Lax จึงไม่ถูกส่งมากับ POST ข้ามเว็บ
 * (คำขอข้ามเว็บจะไม่เจอ session ให้ลบ) และการออกจากระบบไม่เปลี่ยนข้อมูลอื่นใด
 */
export async function POST() {
  try {
    await endSession();
  } catch (err) {
    console.error("[auth] logout failed:", safeErrorSummary(err));
  }
  // 303 = เบราว์เซอร์ตามไปด้วย GET; Location แบบ relative ใช้ได้แม้อยู่หลัง proxy ที่เปลี่ยน host
  return new Response(null, { status: 303, headers: { location: "/", "cache-control": "no-store" } });
}
