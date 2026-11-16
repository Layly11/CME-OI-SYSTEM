import "server-only";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_TEST_LICENSE_PATH, encodeLicensePath, FirebaseRtdb, type ServiceAccount } from "./firebase-rtdb";
import { resolveLicenseStorageConfig } from "./license-storage-config";

/**
 * ที่เก็บไฟล์ license ที่ indicator ของลูกค้าอ่าน
 *
 * แนวคิด: แยกออกจากเว็บหลัก เพราะถ้า URL นี้ล่ม บอทของลูกค้าทุกคนจะหยุดทำงาน
 * - dev / ทดสอบ: เขียนลงดิสก์ในเครื่อง (LocalFileStorage)
 * - ของจริง: indicator อ่านรายชื่อจาก Firebase Realtime Database (FirebaseRtdbStorage)
 * - S3CompatibleStorage ด้านล่างเป็นโครงที่ยังไม่ได้ทำ — เลือกผ่าน env ไม่ได้
 *
 * เลือกผ่าน env LICENSE_STORAGE = local | firebase กติกาและข้อความ error อยู่ใน ./license-storage-config.ts
 * (ค่าที่ไม่รู้จัก หรือไม่ตั้งค่านอก development/test = error ไม่ถอยไปเขียนไฟล์ในเครื่องเงียบๆ)
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

/**
 * เขียนรายชื่อทั้งก้อนทับค่าใน Firebase Realtime Database ที่ indicator อ่านอยู่
 * ด่านตรวจก่อนเขียนทั้งหมดอยู่ใน src/lib/firebase-rtdb.ts
 *
 * FIREBASE_SERVICE_ACCOUNT_JSON ใส่ได้ทั้ง JSON ทั้งก้อน หรือ path ของไฟล์ key
 * ถ้าไม่ตั้ง FIREBASE_LICENSE_PATH จะเขียน path ทดสอบ (Data_test) ไม่แตะรายชื่อจริง
 */
export class FirebaseRtdbStorage implements LicenseStorage {
  private client: FirebaseRtdb | null = null;

  private async getClient(): Promise<FirebaseRtdb> {
    if (this.client) return this.client;
    const databaseUrl = process.env.FIREBASE_DATABASE_URL;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (!databaseUrl || !raw) {
      throw new Error(
        "ยังไม่ได้ตั้งค่า Firebase — ต้องมี FIREBASE_DATABASE_URL และ FIREBASE_SERVICE_ACCOUNT_JSON",
      );
    }
    const json = raw.startsWith("{") ? raw : await readFile(/*turbopackIgnore: true*/ raw, "utf8");
    let serviceAccount: ServiceAccount;
    try {
      serviceAccount = JSON.parse(json);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON อ่านเป็น JSON ไม่ได้");
    }
    const maxRemoved = process.env.FIREBASE_MAX_REMOVED_ENTRIES;
    this.client = new FirebaseRtdb({
      databaseUrl,
      serviceAccount,
      path: process.env.FIREBASE_LICENSE_PATH?.trim() || DEFAULT_TEST_LICENSE_PATH,
      maxRemovedEntries: maxRemoved ? Number(maxRemoved) : undefined,
    });
    return this.client;
  }

  async put(content: string): Promise<string> {
    const client = await this.getClient();
    await client.write(content);
    return client.publicUrl;
  }
}

/** throw เมื่อ LICENSE_STORAGE ตั้งผิด/ไม่ได้ตั้ง (ดู ./license-storage-config.ts) — ผู้เรียก (การเผยแพร่) รายงานเป็น "เผยแพร่ไม่สำเร็จ" */
export function getLicenseStorage(): LicenseStorage {
  const config = resolveLicenseStorageConfig(process.env);
  if (!config.ok) throw new Error(config.error);
  if (config.kind === "firebase") return new FirebaseRtdbStorage();
  return new LocalFileStorage();
}

/**
 * ปลายทางปัจจุบันในรูปเดียวกับค่า storage_url ที่บันทึกในประวัติการเผยแพร่ — ไม่เขียน ไม่ต่อเครือข่าย
 * ใช้เทียบกับแถวประวัติล่าสุด: ต่างกัน = ปลายทางถูกเปลี่ยน (เช่น Data_test → Data) ต้องเขียนใหม่แม้รายชื่อเหมือนเดิม
 * หมายเหตุ: local คืน URL สาธารณะ ไม่ใช่โฟลเดอร์ — การเปลี่ยน LICENSE_LOCAL_DIR อย่างเดียวจึงตรวจไม่พบ (ใช้ `npm run license:publish`)
 * คืน null เมื่อค่าตั้งผิด (การเผยแพร่จะล้มพร้อมข้อความของตัวเอง)
 */
export function currentLicenseDestination(): string | null {
  const config = resolveLicenseStorageConfig(process.env);
  if (!config.ok) return null;
  if (config.kind === "local") return process.env.LICENSE_PUBLIC_URL ?? "/api/license-file";
  try {
    const base = (process.env.FIREBASE_DATABASE_URL ?? "").replace(/\/+$/, "");
    return `${base}/${encodeLicensePath(config.licensePath ?? DEFAULT_TEST_LICENSE_PATH)}.json`;
  } catch {
    return null;
  }
}
