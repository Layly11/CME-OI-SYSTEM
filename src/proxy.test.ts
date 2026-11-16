import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "./lib/auth/constants";
import { safeNextPath } from "./lib/auth/validation";
import { config, proxy } from "./proxy";

// proxy.ts เขียนชื่อ cookie ซ้ำเอง (ไม่ import โมดูลร่วม) — เทสนี้กันสองที่เพี้ยนจากกัน
const source = readFileSync(new URL("./proxy.ts", import.meta.url), "utf8");

const request = (path: string, init: { method?: string; cookie?: string } = {}) =>
  new NextRequest(new URL(path, "http://localhost:3000"), {
    method: init.method ?? "GET",
    headers: init.cookie ? { cookie: init.cookie } : undefined,
  });

/** NextResponse.next() ใส่ header นี้ — ใช้แยก "ปล่อยผ่าน" ออกจาก redirect */
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("src/proxy.ts", () => {
  it("ใช้ชื่อ cookie เดียวกับ constants.ts", () => {
    expect(source).toContain(`const SESSION_COOKIE_NAME = "${SESSION_COOKIE_NAME}";`);
  });

  it("คุมทั้ง /account และ /admin", () => {
    expect(config.matcher).toEqual(["/account/:path*", "/admin/:path*"]);
  });

  it("export ชื่อ proxy และไม่ import โมดูลของแอป", () => {
    expect(source).toContain("export function proxy(");
    expect(source).not.toMatch(/from "@\//);
    expect(source).not.toMatch(/from "\.\//);
  });

  it("เปิดหน้าโดยไม่มี cookie → redirect ไป /login พร้อม next", () => {
    for (const method of ["GET", "HEAD"]) {
      const res = proxy(request("/account", { method }));
      expect(res.status).toBe(307);
      expect(passedThrough(res)).toBe(false);
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe("/account");
    }
  });

  it("next เก็บ query ของหน้าที่ขอไว้ และผ่าน safeNextPath", () => {
    for (const path of [
      "/account/orders/new?package=yearly",
      "/account/orders/new?account=3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f",
      "/account/mt5/new?order=3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f",
      "/admin",
    ]) {
      const next = new URL(proxy(request(path)).headers.get("location")!).searchParams.get("next");
      expect(next).toBe(path);
      expect(safeNextPath(next)).toBe(path);
    }
  });

  it("มี cookie → ปล่อยผ่าน (การตรวจจริงอยู่ที่หน้า/ action)", () => {
    const res = proxy(request("/account", { cookie: `${SESSION_COOKIE_NAME}=anything` }));
    expect(passedThrough(res)).toBe(true);
    expect(res.headers.get("location")).toBeNull();
  });

  it("POST ที่ไม่มี cookie (Server Action หลัง session หาย) → ปล่อยผ่าน ไม่ redirect", () => {
    for (const path of ["/account/orders/new", "/account/mt5/new", "/admin"]) {
      const res = proxy(request(path, { method: "POST" }));
      expect(passedThrough(res)).toBe(true);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});
