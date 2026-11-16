import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/dal";
import { safeErrorSummary } from "@/lib/db-errors";
import { findSlipForViewer } from "@/lib/purchase/repo";
import { isSlipMime } from "@/lib/purchase/slip-file";
import { getSlipStorage } from "@/lib/slip-storage";

/**
 * GET /api/orders/[id]/slip — ทางเดียวที่อ่านสลิปได้ (ไฟล์อยู่ใน private storage ไม่มี URL สาธารณะ)
 * path นี้อยู่นอก matcher ของ proxy จึงตรวจ session เองทั้งหมด:
 * - ไม่ได้ล็อกอิน → 401
 * - id ผิดรูปแบบ / ไม่ใช่เจ้าของและไม่ใช่แอดมิน / ไม่มีสลิป / ชนิดไฟล์ที่บันทึกไว้ไม่อยู่ในรายการ → 404 (ตอบเหมือนกันหมด)
 */
const privateHeaders = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

function plain(status: number, body: string) {
  return new Response(body, { status, headers: { ...privateHeaders, "content-type": "text/plain; charset=utf-8" } });
}

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/orders/[id]/slip">) {
  const { id } = await ctx.params;

  let user: SessionUser | null;
  try {
    user = await getSessionUser();
  } catch (err) {
    console.error("[slip] session lookup failed:", safeErrorSummary(err));
    return plain(503, "ระบบขัดข้องชั่วคราว");
  }
  if (!user) return plain(401, "กรุณาเข้าสู่ระบบ");

  const orderId = z.uuid().safeParse(id);
  if (!orderId.success) return plain(404, "ไม่พบไฟล์");

  try {
    const slip = await findSlipForViewer(orderId.data, { id: user.id, role: user.role });
    if (!slip || !isSlipMime(slip.mime)) return plain(404, "ไม่พบไฟล์");

    const bytes = (await getSlipStorage()?.get(slip.key)) ?? null;
    if (!bytes) return plain(404, "ไม่พบไฟล์");

    return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
      status: 200,
      headers: {
        ...privateHeaders,
        "content-type": slip.mime,
        "content-length": String(bytes.length),
        // รูปภาพเปิดดูในเบราว์เซอร์ได้ ส่วน PDF ให้ดาวน์โหลด (ไม่ให้เอกสารรันสคริปต์ใน origin ของเว็บ)
        "content-disposition":
          slip.mime === "application/pdf" ? 'attachment; filename="slip.pdf"' : 'inline; filename="slip"',
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    console.error("[slip] read failed:", safeErrorSummary(err));
    return plain(503, "ระบบขัดข้องชั่วคราว");
  }
}
