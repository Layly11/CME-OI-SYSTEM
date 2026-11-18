/** ชื่อ cookie ของ session — ถ้าแก้ ต้องแก้ค่าเดียวกันใน src/proxy.ts ด้วย (proxy ไม่ import โมดูลร่วม) */
export const SESSION_COOKIE_NAME = "cme_session";

/**
 * cookie จำรหัสชวนเพื่อน — src/proxy.ts ตั้งเมื่อมีคนเปิด /register?ref=CODE, registerAction อ่านเมื่อฟอร์มไม่มีรหัส และลบเมื่อสมัครสำเร็จ
 * ถ้าแก้ชื่อหรืออายุ ต้องแก้ค่าเดียวกันใน src/proxy.ts ด้วย (proxy ไม่ import โมดูลร่วม — มีเทสคุมไว้)
 * อายุ 7 วัน: นานพอให้เพื่อนกลับมาสมัครทีหลัง แต่ไม่ค้างในเบราว์เซอร์เครื่องที่ใช้ร่วมกันนานเกินไป
 */
export const REFERRAL_COOKIE_NAME = "cme_ref";
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 604800

/** อายุ session คงที่ 30 วัน (ไม่ต่ออายุอัตโนมัติ) */
export const SESSION_TTL_DAYS = 30;
export const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60; // 2592000

export type RateLimitRule = {
  /** ชื่อกลุ่ม ใช้เป็น prefix ของ key เพื่อไม่ให้ตัวนับของแต่ละกติกาปนกัน */
  name: string;
  limit: number;
  windowMs: number;
};

const MINUTE = 60 * 1000;

/**
 * กติกา rate limit
 *
 * ล็อกอิน
 * - loginPair   คู่ (อีเมล, IP) — ด่านหลักกันเดารหัสผ่าน ล็อกอินสำเร็จแล้วล้างตัวนับ (เท่ากับนับเฉพาะครั้งที่ผิด)
 *               คนอื่นที่รู้แค่อีเมลจึงล็อกเจ้าของบัญชีไม่ได้ เพราะ IP ต่างกัน = ตัวนับคนละตัว
 * - loginEmail  เพดานรวมต่ออีเมลจากทุก IP — สูงกว่ามาก มีไว้กันการเดาแบบกระจายหลาย IP
 * - loginIp     เพดานต่อ IP ข้ามทุกอีเมล (กัน password spraying)
 *
 * สมัครสมาชิก
 * - registerIpRaw  ทุกคำขอ นับก่อนตรวจฟอร์ม (กันยิงถี่)
 * - registerIp     เฉพาะคำขอที่กรอกครบถูกต้อง นับก่อนแฮชรหัสผ่าน/สร้างบัญชี — กรอกผิดจึงไม่กินโควตานี้
 *
 * *UnknownIp ใช้แทนกติกาต่อ IP เมื่อระบุ IP ที่เชื่อได้ไม่ได้ (ยังไม่ตั้ง TRUSTED_PROXY_HOPS/CLIENT_IP_HEADER)
 * ทุกคนใช้ตัวนับร่วมตัวเดียว เพดานจึงตั้งสูง — เป็นแค่ฝากันระบบล่ม ไม่ใช่การจำกัดรายคน
 *
 * mt5Check  ต่อผู้ใช้: จำนวนครั้งที่ถามระบบว่าเลขบัญชี MT5 ว่างหรือไม่ (ขั้นทวน + ขั้นยืนยัน)
 * activationRetry  ต่อผู้ใช้: ปุ่ม "ตรวจสอบสถานะอีกครั้ง" ของคำสั่งซื้อที่กำลังเปิดใช้งาน (แต่ละครั้งอาจเขียนรายชื่อ license ใหม่)
 */
export const RATE_LIMITS = {
  loginPair: { name: "login", limit: 8, windowMs: 15 * MINUTE },
  loginEmail: { name: "login", limit: 100, windowMs: 15 * MINUTE },
  loginIp: { name: "login", limit: 30, windowMs: 15 * MINUTE },
  loginUnknownIp: { name: "login", limit: 300, windowMs: 15 * MINUTE },
  registerIpRaw: { name: "register-raw", limit: 40, windowMs: 60 * MINUTE },
  registerIp: { name: "register", limit: 10, windowMs: 60 * MINUTE },
  registerUnknownIpRaw: { name: "register-raw", limit: 600, windowMs: 60 * MINUTE },
  registerUnknownIp: { name: "register", limit: 120, windowMs: 60 * MINUTE },
  mt5Check: { name: "mt5-check", limit: 30, windowMs: 60 * MINUTE },
  activationRetry: { name: "activation-retry", limit: 10, windowMs: 10 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;
