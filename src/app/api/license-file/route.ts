import { connection } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { desc } from "drizzle-orm";

/**
 * GET /api/license-file
 *
 * จุดให้ indicator อ่านไฟล์ license (ใช้ตอน dev หรือเป็นทางสำรอง)
 * ใน production แนะนำให้ indicator อ่านจาก object storage + CDN ที่แยกจากเว็บนี้
 * (ดู src/lib/license-storage.ts) เพื่อไม่ให้บอทของลูกค้าหยุดเมื่อเว็บล่ม
 *
 * ตอบเป็น text/plain เนื้อหาเหมือนไฟล์เดิมทุกตัวอักษร
 */
export async function GET() {
  await connection(); // บังคับให้ทำงานตอน request ไม่ prerender

  // 1) อ่านจากไฟล์ในเครื่องก่อน (ไม่พึ่งฐานข้อมูล)
  const dir = process.env.LICENSE_LOCAL_DIR ?? path.join(process.cwd(), "storage");
  const fileName = process.env.LICENSE_FILE_NAME ?? "license.txt";
  try {
    const content = await readFile(path.join(/*turbopackIgnore: true*/ dir, fileName), "utf8");
    return textResponse(content);
  } catch {
    // ไม่มีไฟล์ในเครื่อง → ลองฐานข้อมูล
  }

  // 2) อ่านสำเนาล่าสุดจากฐานข้อมูล
  try {
    const { getDb, schema } = await import("@/db");
    const [last] = await getDb()
      .select({ content: schema.licenseFilePublications.content })
      .from(schema.licenseFilePublications)
      .orderBy(desc(schema.licenseFilePublications.publishedAt))
      .limit(1);
    if (last) return textResponse(last.content);
  } catch {
    // ฐานข้อมูลยังไม่ได้ตั้งค่า
  }

  return new Response("", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function textResponse(content: string) {
  return new Response(content, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // ให้ CDN/เบราว์เซอร์แคชสั้นๆ ลดโหลด แต่ยังอัปเดตได้ภายใน 1 นาที
      "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
