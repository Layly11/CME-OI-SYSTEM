import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "./constants";
import {
  clientIpConfigFromEnv,
  clientIpFromHeaders,
  emailKey,
  ipKey,
  loginPairKey,
  loginPairKeyPrefix,
  normalizeIp,
  userKey,
  windowStart,
} from "./rate-limit-core";

describe("windowStart", () => {
  const FIFTEEN_MIN = 15 * 60 * 1000;

  it("ปัดลงหาจุดเริ่ม window", () => {
    const base = Date.UTC(2026, 10, 16, 8, 15, 0);
    expect(windowStart(base, FIFTEEN_MIN).getTime()).toBe(base);
    expect(windowStart(base + 1, FIFTEEN_MIN).getTime()).toBe(base);
    expect(windowStart(base + FIFTEEN_MIN - 1, FIFTEEN_MIN).getTime()).toBe(base);
    expect(windowStart(base + FIFTEEN_MIN, FIFTEEN_MIN).getTime()).toBe(base + FIFTEEN_MIN);
  });

  it("คืน Date", () => {
    expect(windowStart(0, 1000)).toBeInstanceOf(Date);
  });
});

describe("keys", () => {
  it("ไม่มีอีเมลหรือ IP ดิบอยู่ใน key", () => {
    const ek = emailKey("somchai@example.com");
    expect(ek).toMatch(/^email:[0-9a-f]{64}$/);
    expect(ek).not.toContain("somchai");
    expect(ek).not.toContain("example.com");

    const ik = ipKey("203.0.113.7");
    expect(ik).toMatch(/^ip:[0-9a-f]{64}$/);
    expect(ik).not.toContain("203.0.113.7");
  });

  it("อีเมลต่างตัวพิมพ์/มีช่องว่าง ได้ key เดียวกัน อีเมลต่างกันได้ key ต่างกัน", () => {
    expect(emailKey(" Somchai@Example.com ")).toBe(emailKey("somchai@example.com"));
    expect(emailKey("a@example.com")).not.toBe(emailKey("b@example.com"));
    expect(ipKey("203.0.113.7")).not.toBe(ipKey("203.0.113.8"));
    expect(ipKey("203.0.113.7")).not.toBe(emailKey("203.0.113.7"));
  });
});

describe("loginPairKey", () => {
  it("แยกตามอีเมลและ IP, ไม่มีค่าดิบ และขึ้นต้นด้วย prefix ของอีเมล (ใช้ลบทั้งอีเมลได้)", () => {
    const k = loginPairKey("Somchai@Example.com", "203.0.113.7");
    expect(k).toMatch(/^pair:[0-9a-f]{64}:[0-9a-f]{64}$/);
    expect(k).not.toContain("somchai");
    expect(k).not.toContain("203.0.113.7");
    expect(k).toBe(loginPairKey(" somchai@example.com ", "203.0.113.7"));
    expect(k).not.toBe(loginPairKey("somchai@example.com", "203.0.113.8"));
    expect(k).not.toBe(loginPairKey("other@example.com", "203.0.113.7"));
    expect(k.startsWith(loginPairKeyPrefix("somchai@example.com"))).toBe(true);
    expect(k.startsWith(loginPairKeyPrefix("other@example.com"))).toBe(false);
  });

  it("ไม่รู้ IP → ตัวนับต่ออีเมลตัวเดียว", () => {
    const k = loginPairKey("somchai@example.com", null);
    expect(k).toBe(loginPairKeyPrefix("somchai@example.com") + "unknown");
    expect(k).not.toBe(loginPairKey("somchai@example.com", "unknown"));
  });

  it("userKey ไม่มี id ดิบ", () => {
    const id = "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f";
    expect(userKey(id)).toMatch(/^user:[0-9a-f]{64}$/);
    expect(userKey(id)).not.toContain(id);
  });
});

describe("clientIpConfigFromEnv", () => {
  it("ไม่ตั้งอะไร → ไม่เชื่อ header ใดเลย", () => {
    expect(clientIpConfigFromEnv({})).toEqual({ header: null, hops: 0 });
    expect(clientIpConfigFromEnv({ TRUSTED_PROXY_HOPS: " ", CLIENT_IP_HEADER: "" })).toEqual({ header: null, hops: 0 });
  });

  it("TRUSTED_PROXY_HOPS: รับจำนวนเต็ม 0–10 ค่าเพี้ยนถือเป็น 0", () => {
    expect(clientIpConfigFromEnv({ TRUSTED_PROXY_HOPS: "1" })).toEqual({ header: null, hops: 1 });
    expect(clientIpConfigFromEnv({ TRUSTED_PROXY_HOPS: " 2 " })).toEqual({ header: null, hops: 2 });
    expect(clientIpConfigFromEnv({ TRUSTED_PROXY_HOPS: "99" })).toEqual({ header: null, hops: 10 });
    for (const bad of ["-1", "1.5", "abc", "1e3"]) {
      expect(clientIpConfigFromEnv({ TRUSTED_PROXY_HOPS: bad })).toEqual({ header: null, hops: 0 });
    }
  });

  it("CLIENT_IP_HEADER มาก่อน และชื่อ header ที่ผิดรูปแบบถูกทิ้ง", () => {
    expect(clientIpConfigFromEnv({ CLIENT_IP_HEADER: "CF-Connecting-IP", TRUSTED_PROXY_HOPS: "2" })).toEqual({
      header: "cf-connecting-ip",
      hops: 0,
    });
    expect(clientIpConfigFromEnv({ CLIENT_IP_HEADER: "x real ip" })).toEqual({ header: null, hops: 0 });
  });

  it("บน Vercel (เขียนทับ x-forwarded-for เอง) ใช้ 1 hop เป็นค่าเริ่มต้น — ตั้ง 0 เองได้", () => {
    expect(clientIpConfigFromEnv({ VERCEL: "1" })).toEqual({ header: null, hops: 1 });
    expect(clientIpConfigFromEnv({ VERCEL: "1", TRUSTED_PROXY_HOPS: "0" })).toEqual({ header: null, hops: 0 });
  });
});

describe("normalizeIp", () => {
  it("รับ IPv4/IPv6 ตัดพอร์ตและวงเล็บ", () => {
    expect(normalizeIp(" 203.0.113.7 ")).toBe("203.0.113.7");
    expect(normalizeIp("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("ค่าที่ไม่ใช่ IP → null", () => {
    for (const bad of ["", " ", "unknown", "example.com", "203.0.113", "999.1.1.1", "1.2.3.4, 5.6.7.8", "9".repeat(500), null, undefined]) {
      expect(normalizeIp(bad)).toBeNull();
    }
  });
});

describe("clientIpFromHeaders", () => {
  const from = (h: Record<string, string>, config: { header?: string; hops?: number }) =>
    clientIpFromHeaders((name) => h[name] ?? null, { header: config.header ?? null, hops: config.hops ?? 0 });

  it("ไม่มี proxy ที่เชื่อได้ → ไม่เชื่อ header ที่ผู้ใช้ส่งมาเอง", () => {
    expect(from({ "x-forwarded-for": "203.0.113.7" }, {})).toBeNull();
    expect(from({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.1" }, {})).toBeNull();
    expect(from({}, {})).toBeNull();
  });

  it("1 hop: ใช้ตัวขวาสุด (ที่ proxy ของเราเติม) — ตัวแรกที่ผู้ใช้ปลอมมาไม่มีผล", () => {
    expect(from({ "x-forwarded-for": "198.51.100.77" }, { hops: 1 })).toBe("198.51.100.77");
    for (let n = 1; n <= 5; n++) {
      expect(from({ "x-forwarded-for": `203.0.113.${n}, 198.51.100.77` }, { hops: 1 })).toBe("198.51.100.77");
    }
    expect(from({ "x-forwarded-for": "1.1.1.1,2.2.2.2 , 198.51.100.77 " }, { hops: 1 })).toBe("198.51.100.77");
  });

  it("2 hops: ตัวที่สองจากขวา, รายการสั้นกว่าจำนวน proxy → null", () => {
    expect(from({ "x-forwarded-for": "9.9.9.9, 198.51.100.77, 10.0.0.1" }, { hops: 2 })).toBe("198.51.100.77");
    expect(from({ "x-forwarded-for": "10.0.0.1" }, { hops: 2 })).toBeNull();
  });

  it("ตำแหน่งที่เชื่อได้ไม่ใช่ IP หรือไม่มี header → null", () => {
    expect(from({ "x-forwarded-for": "203.0.113.7, unknown" }, { hops: 1 })).toBeNull();
    expect(from({ "x-forwarded-for": "" }, { hops: 1 })).toBeNull();
    expect(from({}, { hops: 1 })).toBeNull();
    expect(clientIpFromHeaders(() => undefined, { header: null, hops: 1 })).toBeNull();
  });

  it("CLIENT_IP_HEADER: อ่าน header ของแพลตฟอร์ม ไม่สน x-forwarded-for", () => {
    const h = { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "cf-connecting-ip": "198.51.100.77" };
    expect(from(h, { header: "cf-connecting-ip" })).toBe("198.51.100.77");
    expect(from({ "x-forwarded-for": "203.0.113.7" }, { header: "cf-connecting-ip" })).toBeNull();
    // ชี้ไป header ที่เป็นรายการ = ตั้งค่าผิด → ไม่เชื่อ
    expect(from(h, { header: "x-forwarded-for" })).toBeNull();
  });
});

describe("กติกา rate limit", () => {
  it("ตรงตามที่ออกแบบ", () => {
    const MIN = 60 * 1000;
    expect(RATE_LIMITS.loginPair).toMatchObject({ limit: 8, windowMs: 15 * MIN });
    expect(RATE_LIMITS.loginEmail).toMatchObject({ limit: 100, windowMs: 15 * MIN });
    expect(RATE_LIMITS.loginIp).toMatchObject({ limit: 30, windowMs: 15 * MIN });
    expect(RATE_LIMITS.registerIpRaw).toMatchObject({ limit: 40, windowMs: 60 * MIN });
    expect(RATE_LIMITS.registerIp).toMatchObject({ limit: 10, windowMs: 60 * MIN });
    expect(RATE_LIMITS.mt5Check).toMatchObject({ limit: 30, windowMs: 60 * MIN });
  });

  it("เพดานรวมตอนไม่รู้ IP สูงกว่าเพดานต่อ IP และตัวนับก่อน/หลังตรวจฟอร์มไม่ปนกัน", () => {
    expect(RATE_LIMITS.loginUnknownIp.limit).toBeGreaterThan(RATE_LIMITS.loginIp.limit);
    expect(RATE_LIMITS.registerUnknownIp.limit).toBeGreaterThan(RATE_LIMITS.registerIp.limit);
    expect(RATE_LIMITS.registerUnknownIpRaw.limit).toBeGreaterThan(RATE_LIMITS.registerIpRaw.limit);
    expect(RATE_LIMITS.registerIpRaw.limit).toBeGreaterThan(RATE_LIMITS.registerIp.limit);
    expect(RATE_LIMITS.registerIpRaw.name).not.toBe(RATE_LIMITS.registerIp.name);
    // ด่านคู่ (อีเมล, IP) ต้องเข้มกว่าเพดานรวมต่ออีเมล ไม่อย่างนั้นคนอื่นล็อกเจ้าของบัญชีได้ง่ายเหมือนเดิม
    expect(RATE_LIMITS.loginEmail.limit).toBeGreaterThan(RATE_LIMITS.loginPair.limit * 5);
  });
});
