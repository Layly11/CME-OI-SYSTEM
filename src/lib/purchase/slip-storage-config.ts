/**
 * ค่าตั้งของที่เก็บสลิป (env SLIP_STORAGE) — pure ไม่แตะไฟล์ จึงเรียกได้ตั้งแต่ตอนเซิร์ฟเวอร์เริ่ม (src/instrumentation.ts)
 *
 * - local     เขียนลงดิสก์ของเครื่อง (ค่าเริ่มต้น) — ใช้ได้เฉพาะโฮสต์ที่ดิสก์ถาวร
 * - disabled  ปิดการแนบสลิปผ่านเว็บ หน้าคำสั่งซื้อจะให้ลูกค้าส่งสลิปทาง LINE แทน
 *
 * บนโฮสต์ที่ดิสก์ไม่ถาวร (serverless) ค่า local ถือเป็นการตั้งค่าผิด: ไฟล์จะเขียนไม่ได้หรือหายเมื่อ instance ถูกเปลี่ยน
 * แอดมินจะเปิดดูสลิปไม่ได้ทั้งที่ลูกค้าโอนเงินแล้ว — จึงให้ล้มตั้งแต่ตอนเริ่มเซิร์ฟเวอร์ ไม่ใช่ตอนลูกค้ากดส่งสลิป
 */
export type SlipStorageKind = "local" | "disabled";

export type SlipStorageConfig = { ok: true; kind: SlipStorageKind } | { ok: false; error: string };

type Env = Record<string, string | undefined>;

/** ตัวแปรที่แพลตฟอร์มตั้งให้เอง → ชื่อแพลตฟอร์ม (ทั้งหมดเป็นโฮสต์ที่ดิสก์ไม่ถาวร) */
const EPHEMERAL_HOST_MARKERS: readonly (readonly [string, string])[] = [
  ["VERCEL", "Vercel"],
  ["AWS_LAMBDA_FUNCTION_NAME", "AWS Lambda"],
  ["NETLIFY", "Netlify"],
  ["K_SERVICE", "Cloud Run"],
];

/** ชื่อแพลตฟอร์มถ้ารันบนโฮสต์ที่ดิสก์ไม่ถาวร ไม่ใช่คืน null */
export function ephemeralHostName(env: Env): string | null {
  for (const [key, name] of EPHEMERAL_HOST_MARKERS) {
    if ((env[key] ?? "").trim() !== "") return name;
  }
  return null;
}

export function resolveSlipStorage(env: Env): SlipStorageConfig {
  const kind = (env.SLIP_STORAGE ?? "").trim() || "local";
  if (kind === "disabled") return { ok: true, kind };
  if (kind !== "local") {
    return { ok: false, error: `ไม่รู้จักค่า SLIP_STORAGE="${kind}" — ตอนนี้รองรับเฉพาะ local และ disabled` };
  }
  const host = ephemeralHostName(env);
  if (host) {
    return {
      ok: false,
      error:
        `SLIP_STORAGE=local ใช้บน ${host} ไม่ได้ เพราะดิสก์ไม่ถาวร (สลิปที่ลูกค้าอัปโหลดจะหาย) — ` +
        "ต้องเพิ่มที่เก็บแบบ object storage ใน src/lib/slip-storage.ts ก่อน หรือตั้ง SLIP_STORAGE=disabled " +
        "เพื่อปิดการแนบสลิปผ่านเว็บ (ลูกค้าจะถูกบอกให้ส่งสลิปทาง LINE)",
    };
  }
  return { ok: true, kind };
}
