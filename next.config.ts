import type { NextConfig } from "next";

/**
 * header ความปลอดภัยของทุกหน้า
 * - HSTS: เบราว์เซอร์ใช้เฉพาะเมื่อได้รับผ่าน https (ส่งผ่าน http ไม่มีผล) — กันถูกลดเป็น http ก่อนส่งฟอร์มล็อกอิน
 * - X-Frame-Options: ห้ามนำหน้าเว็บไปใส่ใน iframe (clickjacking)
 * ไม่ตั้ง Content-Security-Policy รวมที่นี่ — /api/orders/[id]/slip ตั้ง CSP ของตัวเองใน route handler
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // สลิปโอนเงินอัปโหลดผ่าน Server Action: ไฟล์ไม่เกิน 4 MiB (MAX_SLIP_BYTES) + เผื่อ overhead ของ multipart
      bodySizeLimit: "4400kb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
