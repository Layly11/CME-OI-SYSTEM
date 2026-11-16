/**
 * ตรวจไฟล์สลิป — ไม่มี import ของ node จึงใช้ค่าคงที่จากฝั่ง client ได้
 * ชนิดไฟล์ตัดสินจาก "ไบต์ต้นไฟล์" เท่านั้น ไม่เชื่อชื่อไฟล์หรือ content-type ที่เบราว์เซอร์ส่งมา
 */
export const MAX_SLIP_BYTES = 4 * 1024 * 1024;

export const SLIP_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type SlipMime = (typeof SLIP_MIMES)[number];

export function isSlipMime(v: unknown): v is SlipMime {
  return typeof v === "string" && (SLIP_MIMES as readonly string[]).includes(v);
}

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export function sniffSlipType(bytes: Uint8Array): SlipMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return "image/webp";
  if (startsWith(bytes, PDF)) return "application/pdf";
  return null;
}

export type SlipValidation = { ok: true; mime: SlipMime } | { ok: false; reason: "empty" | "too_large" | "bad_type" };

export function validateSlip(bytes: Uint8Array): SlipValidation {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_SLIP_BYTES) return { ok: false, reason: "too_large" };
  const mime = sniffSlipType(bytes);
  if (!mime) return { ok: false, reason: "bad_type" };
  return { ok: true, mime };
}

const EXT: Record<SlipMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function extForMime(mime: SlipMime): string {
  return EXT[mime];
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SLIP_KEY_RE = new RegExp(`^${UUID}/${UUID}\\.(jpg|png|webp|pdf)$`);

/** key = `<orderId>/<uuid สุ่ม>.<ext>` — ชื่อไฟล์ของผู้ใช้ไม่ถูกนำมาใช้เลย */
export function buildSlipKey(orderId: string, fileId: string, mime: SlipMime): string {
  const key = `${orderId.toLowerCase()}/${fileId.toLowerCase()}.${extForMime(mime)}`;
  if (!isValidSlipKey(key)) throw new Error("สร้าง key ของสลิปไม่ได้: orderId หรือ fileId ไม่ใช่ UUID");
  return key;
}

export function isValidSlipKey(key: unknown): key is string {
  return typeof key === "string" && SLIP_KEY_RE.test(key);
}
