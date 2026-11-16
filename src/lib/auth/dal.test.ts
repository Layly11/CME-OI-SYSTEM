import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirectTarget } from "@/test/next-redirect";

vi.mock("server-only", () => ({}));
vi.mock("./session", () => ({ readSessionToken: vi.fn() }));
vi.mock("./session-store", () => ({ findUserBySessionToken: vi.fn() }));

import { getSessionUser, getSessionUserOrNull, requireAdmin, requireUser } from "./dal";
import { readSessionToken } from "./session";
import { findUserBySessionToken } from "./session-store";

const TOKEN = "t".repeat(43);
const customer = { id: "u1", email: "c@example.com", name: "ลูกค้า", role: "customer" as const };
const admin = { id: "u2", email: "a@example.com", name: "แอดมิน", role: "admin" as const };

const signedInAs = (user: typeof customer | typeof admin | null) => {
  vi.mocked(readSessionToken).mockResolvedValue(TOKEN);
  vi.mocked(findUserBySessionToken).mockResolvedValue(user);
};

beforeEach(() => {
  vi.mocked(readSessionToken).mockReset();
  vi.mocked(findUserBySessionToken).mockReset();
});

describe("getSessionUser", () => {
  it("ไม่มี cookie / cookie ผิดรูปแบบ → null โดยไม่แตะฐานข้อมูล", async () => {
    vi.mocked(readSessionToken).mockResolvedValue(null);
    expect(await getSessionUser()).toBeNull();
    expect(findUserBySessionToken).not.toHaveBeenCalled();
  });

  it("มี token → หาผู้ใช้จาก token นั้น", async () => {
    signedInAs(customer);
    expect(await getSessionUser()).toEqual(customer);
    expect(findUserBySessionToken).toHaveBeenCalledWith(TOKEN);
  });
});

describe("requireUser", () => {
  it("ไม่ได้ล็อกอิน (ไม่มี cookie หรือ session ไม่มีในฐานข้อมูล) → ไป /login พร้อม next", async () => {
    vi.mocked(readSessionToken).mockResolvedValue(null);
    expect(await redirectTarget(() => requireUser())).toBe("/login?next=%2Faccount");

    signedInAs(null);
    expect(await redirectTarget(() => requireUser("/account/orders/new?package=yearly"))).toBe(
      "/login?next=%2Faccount%2Forders%2Fnew%3Fpackage%3Dyearly",
    );
  });

  it("ล็อกอินอยู่ → คืนผู้ใช้", async () => {
    signedInAs(customer);
    expect(await requireUser()).toEqual(customer);
  });

  it("ฐานข้อมูลล้ม → throw (ไม่ถือว่าเป็นผู้เยี่ยมชม และไม่ปล่อยผ่าน)", async () => {
    vi.mocked(readSessionToken).mockResolvedValue(TOKEN);
    vi.mocked(findUserBySessionToken).mockRejectedValue(new Error("db down"));
    await expect(requireUser()).rejects.toThrow("db down");
  });
});

describe("requireAdmin", () => {
  it("ไม่ได้ล็อกอิน → ไป /login แล้วกลับมา /admin", async () => {
    vi.mocked(readSessionToken).mockResolvedValue(null);
    expect(await redirectTarget(() => requireAdmin())).toBe("/login?next=%2Fadmin");
  });

  it("ลูกค้าทั่วไป → ถูกพากลับ /account ไม่ได้ผู้ใช้กลับไป", async () => {
    signedInAs(customer);
    expect(await redirectTarget(() => requireAdmin())).toBe("/account");
  });

  it("แอดมิน → ผ่าน", async () => {
    signedInAs(admin);
    expect(await requireAdmin()).toEqual(admin);
  });
});

describe("getSessionUserOrNull", () => {
  it("ฐานข้อมูลล้ม → null (ใช้กับ header เท่านั้น ไม่ใช่ด่านตรวจสิทธิ์)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(readSessionToken).mockResolvedValue(TOKEN);
    vi.mocked(findUserBySessionToken).mockRejectedValue(new Error("db down"));
    expect(await getSessionUserOrNull()).toBeNull();
    log.mockRestore();
  });
});
