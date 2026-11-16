/**
 * ค่าตั้งของปลายทางรายชื่อ license (env LICENSE_STORAGE) — pure ไม่แตะไฟล์/เครือข่าย จึงเรียกได้ตั้งแต่ตอนเซิร์ฟเวอร์เริ่ม
 * (src/instrumentation.ts) และใช้ร่วมกับด่านของการชำระเงินจำลอง (src/lib/payment/config.ts)
 *
 * - local     เขียนไฟล์ลงดิสก์ของเครื่อง (dev / ทดสอบ) — บอทของลูกค้าไม่ได้อ่านจากที่นี่
 * - firebase  เขียนทับค่าใน Firebase RTDB ที่ indicator อ่าน (ไม่ตั้ง FIREBASE_LICENSE_PATH = path ทดสอบ Data_test)
 *
 * ทำไมต้อง "ล้มแบบปิด": การเปิด license เป็นอัตโนมัติ ถ้าตัวแปรนี้หาย/พิมพ์ผิดแล้วระบบเงียบๆ ไปเขียนไฟล์ในเครื่องแทน
 * ลูกค้าที่จ่ายเงินจะเห็น "เปิดใช้งานแล้ว" ทั้งที่รายชื่อที่บอทอ่านไม่ถูกแตะเลย และไม่มี error ที่ไหน
 * - ค่าที่ไม่รู้จัก ("Firebase", พิมพ์ผิด, s3 ที่ยังไม่ได้ทำ) → ผิดเสมอ ทุก NODE_ENV
 * - ไม่ตั้งค่า → ใช้ local ได้เฉพาะ NODE_ENV=development หรือ test (ตรงตัว) ที่เหลือทั้งหมด (production, ค่าแปลก, ไม่ตั้ง NODE_ENV
 *   เช่นตอนรันสคริปต์) ต้องตั้ง LICENSE_STORAGE เองให้ชัดเจน
 * - firebase ต้องมี FIREBASE_DATABASE_URL และ FIREBASE_SERVICE_ACCOUNT_JSON
 * ค่าถูกตัดช่องว่างหัวท้ายก่อนเทียบเสมอ ("firebase " = firebase ทั้งที่นี่และที่ด่านของการชำระเงินจำลอง)
 */
export const LICENSE_STORAGE_KINDS = ["local", "firebase"] as const;
export type LicenseStorageKind = (typeof LICENSE_STORAGE_KINDS)[number];

/** path ของรายชื่อ license จริงที่ indicator ของลูกค้าอ่าน (CLAUDE.md ข้อ 3) */
export const LIVE_FIREBASE_LICENSE_PATH = "CME_Data/Customer Data/Data";

export type LicenseStorageConfig =
  | { ok: true; kind: "local" }
  /** licensePath = ค่าที่ตัดช่องว่างแล้ว หรือ null เมื่อไม่ได้ตั้ง (ผู้ใช้ค่าใช้ path ทดสอบแทน) */
  | { ok: true; kind: "firebase"; licensePath: string | null; live: boolean }
  | { ok: false; error: string };

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined) => (v ?? "").trim();

/** path ของ Firebase แบบเทียบได้: ตัดช่องว่าง และ "/" หัวท้าย/ซ้ำ */
function normalizePath(raw: string | undefined): string {
  return clean(raw)
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join("/");
}

/**
 * รายชื่อ license ของ env นี้ชี้ไปรายชื่อจริงใน Firebase หรือไม่
 * path จริง "และทุก path ที่อยู่ใต้มัน" ถือเป็นของจริง: ใน RTDB การเขียนลูกของ node ที่เก็บ string
 * จะแทน string นั้นด้วย object = รายชื่อจริงทั้งก้อนหาย
 */
export function targetsLiveLicenseList(env: Env): boolean {
  if (clean(env.LICENSE_STORAGE) !== "firebase") return false;
  const path = normalizePath(env.FIREBASE_LICENSE_PATH);
  return path === LIVE_FIREBASE_LICENSE_PATH || path.startsWith(LIVE_FIREBASE_LICENSE_PATH + "/");
}

/** NODE_ENV ที่ยอมให้ใช้ค่าเริ่มต้นแบบผ่อนปรน — ตรงตัวอักษรเท่านั้น (ไม่ตั้ง / "Production" / "staging" ไม่นับ) */
export function isDevOrTestEnv(env: Env): boolean {
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

export function resolveLicenseStorageConfig(env: Env): LicenseStorageConfig {
  const kind = clean(env.LICENSE_STORAGE);
  if (kind === "") {
    if (isDevOrTestEnv(env)) return { ok: true, kind: "local" };
    return {
      ok: false,
      error:
        "ยังไม่ได้ตั้ง LICENSE_STORAGE — นอก NODE_ENV=development/test ต้องระบุเองว่าเป็น firebase (รายชื่อที่บอทอ่าน) หรือ local " +
        "(ไฟล์ในเครื่อง สำหรับทดสอบ) ระบบไม่เดาให้ เพราะถ้าเขียนผิดที่ ลูกค้าที่จ่ายเงินแล้วจะไม่ได้ license จริง",
    };
  }
  if (kind === "local") return { ok: true, kind };
  if (kind !== "firebase") {
    return {
      ok: false,
      error: `ไม่รู้จักค่า LICENSE_STORAGE="${kind.slice(0, 40)}" — ตอนนี้รองรับเฉพาะ local และ firebase (ตัวพิมพ์เล็ก)`,
    };
  }
  const missing = ["FIREBASE_DATABASE_URL", "FIREBASE_SERVICE_ACCOUNT_JSON"].filter((k) => clean(env[k]) === "");
  if (missing.length > 0) {
    return { ok: false, error: `LICENSE_STORAGE=firebase ต้องตั้ง ${missing.join(" และ ")} ด้วย` };
  }
  const licensePath = clean(env.FIREBASE_LICENSE_PATH);
  return { ok: true, kind, licensePath: licensePath === "" ? null : licensePath, live: targetsLiveLicenseList(env) };
}
