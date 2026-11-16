import "server-only";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidSlipKey } from "./purchase/slip-file";
import { resolveSlipStorage } from "./purchase/slip-storage-config";

/**
 * ที่เก็บสลิปโอนเงิน — เป็นที่เก็บส่วนตัว ไม่มี URL สาธารณะ
 * อ่านได้ทางเดียวคือ GET /api/orders/[id]/slip ซึ่งตรวจ session + ความเป็นเจ้าของก่อนทุกครั้ง
 *
 * - dev / เครื่องเดียว: LocalSlipStorage เขียนลง storage/slips (นอก public/ และอยู่ใน .gitignore)
 * - โฮสต์ที่ดิสก์ไม่ถาวร (serverless): ยังไม่มี implementation แบบ object storage — ต้องเพิ่มก่อน deploy
 *   ระหว่างนี้ค่า local บนโฮสต์แบบนั้นจะทำให้เซิร์ฟเวอร์ไม่เริ่ม (ดู src/instrumentation.ts)
 *   ทางเลี่ยงชั่วคราวคือ SLIP_STORAGE=disabled: ปิดการแนบสลิปผ่านเว็บ ให้ลูกค้าส่งทาง LINE
 *
 * เลือกผ่าน env SLIP_STORAGE = local | disabled (กติกาอยู่ใน purchase/slip-storage-config.ts)
 */
export interface SlipStorage {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** null เมื่อไม่มีไฟล์ */
  get(key: string): Promise<Uint8Array | null>;
  /** ไม่มีไฟล์อยู่แล้วก็ไม่ถือเป็น error */
  delete(key: string): Promise<void>;
}

export class LocalSlipStorage implements SlipStorage {
  private readonly dir: string;

  constructor(dir: string = process.env.SLIP_LOCAL_DIR || path.join(process.cwd(), "storage", "slips")) {
    this.dir = path.resolve(/*turbopackIgnore: true*/ dir);
  }

  /** key ต้องผ่านรูปแบบเข้มงวด และ path ที่ได้ต้องอยู่ใต้โฟลเดอร์เก็บสลิปเท่านั้น */
  private resolve(key: string): string {
    if (!isValidSlipKey(key)) throw new Error("key ของสลิปไม่ถูกต้อง");
    const target = path.resolve(/*turbopackIgnore: true*/ this.dir, key);
    if (!target.startsWith(this.dir + path.sep)) throw new Error("key ของสลิปชี้ออกนอกโฟลเดอร์ที่เก็บ");
    return target;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.resolve(key);
    await mkdir(/*turbopackIgnore: true*/ path.dirname(target), { recursive: true });
    const tmp = target + ".tmp";
    // เขียนไฟล์ชั่วคราวแล้ว rename — ไม่มีใครอ่านเจอไฟล์ครึ่งเดียว
    await writeFile(/*turbopackIgnore: true*/ tmp, bytes, { mode: 0o600 });
    await rename(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ target);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const target = this.resolve(key);
    try {
      return new Uint8Array(await readFile(/*turbopackIgnore: true*/ target));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key);
    try {
      await unlink(/*turbopackIgnore: true*/ target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

/**
 * ที่เก็บสลิปตามค่าตั้ง — null เมื่อปิดการแนบสลิปผ่านเว็บ (SLIP_STORAGE=disabled)
 * ค่าตั้งผิด (ค่าที่ไม่รู้จัก หรือ local บนโฮสต์ที่ดิสก์ไม่ถาวร) → throw ดู resolveSlipStorage
 */
export function getSlipStorage(): SlipStorage | null {
  const config = resolveSlipStorage(process.env);
  if (!config.ok) throw new Error(config.error);
  return config.kind === "disabled" ? null : new LocalSlipStorage();
}
