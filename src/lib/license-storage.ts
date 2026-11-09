import "server-only";
import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";

/**
 * ที่เก็บไฟล์ license ที่ indicator ของลูกค้าอ่าน
 *
 * แนวคิด: แยกออกจากเว็บหลัก เพราะถ้า URL นี้ล่ม บอทของลูกค้าทุกคนจะหยุดทำงาน
 * - dev / ทดสอบ: เขียนลงดิสก์ในเครื่อง (LocalFileStorage)
 * - production: อัปโหลดไป object storage ที่มี CDN เช่น Cloudflare R2, AWS S3, Supabase Storage
 *   (S3CompatibleStorage ด้านล่างเป็นโครงให้เติม เมื่อลูกค้าเลือกผู้ให้บริการแล้ว)
 *
 * เลือกผ่าน env LICENSE_STORAGE = local | s3
 */
export interface LicenseStorage {
  /** เขียนเนื้อหาไฟล์ทั้งหมด คืน URL สาธารณะที่ indicator ใช้อ่าน */
  put(content: string): Promise<string>;
}

export class LocalFileStorage implements LicenseStorage {
  constructor(
    private readonly dir = process.env.LICENSE_LOCAL_DIR ?? path.join(process.cwd(), "storage"),
    private readonly fileName = process.env.LICENSE_FILE_NAME ?? "license.txt",
    private readonly publicUrl = process.env.LICENSE_PUBLIC_URL ?? "/api/license-file",
  ) {}

  async put(content: string): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const target = path.join(this.dir, this.fileName);
    const tmp = target + ".tmp";
    // เขียนลงไฟล์ชั่วคราวแล้ว rename เพื่อให้คนอ่านไม่เจอไฟล์ครึ่งเดียว
    await writeFile(tmp, content, "utf8");
    await rename(tmp, target);
    return this.publicUrl;
  }
}

/**
 * โครงสำหรับ S3-compatible storage (R2 / S3 / Supabase)
 * ต้องติดตั้ง @aws-sdk/client-s3 และเติมโค้ดตอนที่ลูกค้าเลือกผู้ให้บริการแล้ว
 */
export class S3CompatibleStorage implements LicenseStorage {
  async put(): Promise<string> {
    throw new Error(
      "ยังไม่ได้ตั้งค่า S3CompatibleStorage — ติดตั้ง @aws-sdk/client-s3 แล้วเติมโค้ดใน src/lib/license-storage.ts",
    );
  }
}

export function getLicenseStorage(): LicenseStorage {
  const kind = process.env.LICENSE_STORAGE ?? "local";
  if (kind === "s3") return new S3CompatibleStorage();
  return new LocalFileStorage();
}
