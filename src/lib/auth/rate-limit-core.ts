import { createHash } from "node:crypto";
import { isIP } from "node:net";

/** จุดเริ่มของ fixed window ที่ `nowMs` ตกอยู่ */
export function windowStart(nowMs: number, windowMs: number): Date {
  return new Date(Math.floor(nowMs / windowMs) * windowMs);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** key ของตัวนับ — เก็บเฉพาะ hash ไม่เก็บอีเมล/IP ดิบลงฐานข้อมูล */
export function emailKey(email: string): string {
  return `email:${sha256(email.trim().toLowerCase())}`;
}

export function ipKey(ip: string): string {
  return `ip:${sha256(ip.trim())}`;
}

export function userKey(userId: string): string {
  return `user:${sha256(userId)}`;
}

/** key ของ "ไม่รู้ IP" — ทุกคำขอที่ระบุ IP ไม่ได้ใช้ตัวนับร่วมตัวเดียว (ดู clientIpFromHeaders) */
export const UNKNOWN_IP_KEY = "ip:unknown";

/**
 * key ของคู่ (อีเมล, IP) สำหรับนับการล็อกอินผิด — ขึ้นต้นด้วย hash ของอีเมลเสมอ
 * สคริปต์ปลดล็อกจึงลบตัวนับของอีเมลหนึ่งได้ด้วย prefix (ดู loginPairKeyPrefix)
 */
export function loginPairKey(email: string, ip: string | null): string {
  return `${loginPairKeyPrefix(email)}${ip === null ? "unknown" : sha256(ip.trim())}`;
}

export function loginPairKeyPrefix(email: string): string {
  return `pair:${sha256(email.trim().toLowerCase())}:`;
}

export type ClientIpConfig = {
  /** ชื่อ header ที่แพลตฟอร์ม/proxy ของเราเขียนทับเองเสมอ (เช่น cf-connecting-ip, x-real-ip) — null = ไม่ใช้ */
  header: string | null;
  /** จำนวน proxy ที่เชื่อถือได้ซึ่ง "ต่อท้าย" x-forwarded-for — 0 = ไม่มี จึงไม่เชื่อ header นี้เลย */
  hops: number;
};

const MAX_PROXY_HOPS = 10;

/**
 * อ่านค่าตั้งว่าจะเชื่อ IP จากไหน
 * - CLIENT_IP_HEADER=<ชื่อ header>  ใช้ header ของแพลตฟอร์มที่ผู้ใช้ปลอมไม่ได้
 * - TRUSTED_PROXY_HOPS=<n>          นับจากขวาของ x-forwarded-for (nginx 1 ชั้น = 1)
 * - ไม่ตั้งทั้งคู่ + รันบน Vercel    เท่ากับ hops = 1 (Vercel เขียนทับ header เอง)
 * - ไม่ตั้งทั้งคู่                   ไม่เชื่อ header ใดเลย
 */
export function clientIpConfigFromEnv(env: Record<string, string | undefined>): ClientIpConfig {
  const header = (env.CLIENT_IP_HEADER ?? "").trim().toLowerCase();
  if (/^[a-z0-9-]{1,64}$/.test(header)) return { header, hops: 0 };

  const raw = (env.TRUSTED_PROXY_HOPS ?? "").trim();
  if (raw !== "") {
    const hops = /^[0-9]{1,2}$/.test(raw) ? Number(raw) : 0;
    return { header: null, hops: Math.min(hops, MAX_PROXY_HOPS) };
  }
  return { header: null, hops: env.VERCEL === "1" ? 1 : 0 };
}

/** รับเฉพาะค่าที่เป็น IP จริง (ตัดพอร์ต/วงเล็บออก) — อย่างอื่นคืน null */
export function normalizeIp(value: string | null | undefined): string | null {
  let v = (value ?? "").trim().toLowerCase();
  if (v === "" || v.length > 100) return null;
  const bracketed = /^\[([0-9a-f:.]+)\](?::[0-9]{1,5})?$/.exec(v);
  if (bracketed) v = bracketed[1];
  else if (/^[0-9.]+:[0-9]{1,5}$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  if (v.startsWith("::ffff:") && isIP(v.slice(7)) === 4) v = v.slice(7);
  return isIP(v) === 0 ? null : v;
}

/**
 * IP ของผู้ใช้จากแหล่งที่ deployment ควบคุมเท่านั้น — คืน null เมื่อไม่มีแหล่งที่เชื่อได้
 *
 * ห้ามใช้ตัวแรกของ x-forwarded-for: ผู้ใช้ส่ง header นี้มาเองได้ และ proxy ส่วนใหญ่ (nginx, Cloudflare)
 * รวมถึง `next start` เปล่าๆ จะ "ต่อท้าย/คงค่าเดิม" ไม่ได้เขียนทับ ตัวแรกจึงเป็นค่าที่ผู้โจมตีเลือกเอง
 * ตัวที่เชื่อได้คือตัวที่ proxy ของเราเติมให้ = นับจากขวาตามจำนวน proxy ที่ตั้งไว้
 */
export function clientIpFromHeaders(
  get: (name: string) => string | null | undefined,
  config: ClientIpConfig,
): string | null {
  if (config.header) {
    const value = get(config.header);
    // header ของแพลตฟอร์มต้องมี IP เดียว — เป็นรายการแปลว่าตั้งค่าผิด (เช่นชี้ไป x-forwarded-for) จึงไม่เชื่อ
    if (!value || value.includes(",")) return null;
    return normalizeIp(value);
  }
  if (config.hops < 1) return null;
  const parts = (get("x-forwarded-for") ?? "").split(",").map((p) => p.trim());
  if (parts.length < config.hops) return null;
  return normalizeIp(parts[parts.length - config.hops]);
}
