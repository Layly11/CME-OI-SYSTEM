import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/dal", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/purchase/repo", () => ({ findSlipForViewer: vi.fn() }));
vi.mock("@/lib/slip-storage", () => ({ getSlipStorage: vi.fn() }));

import { getSessionUser } from "@/lib/auth/dal";
import { findSlipForViewer } from "@/lib/purchase/repo";
import { getSlipStorage } from "@/lib/slip-storage";
import { GET } from "./route";

const ORDER = "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f";
const KEY = `${ORDER}/0b7e1c52-1111-4222-8333-444455556666.png`;
const customer = { id: "u1", email: "c@example.com", name: null, role: "customer" as const };
const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const storageGet = vi.fn();
const call = (id: string) =>
  GET(new NextRequest(`http://localhost:3000/api/orders/${id}/slip`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.mocked(getSessionUser).mockReset();
  vi.mocked(findSlipForViewer).mockReset();
  storageGet.mockReset();
  vi.mocked(getSlipStorage).mockReset();
  vi.mocked(getSlipStorage).mockReturnValue({ get: storageGet, put: vi.fn(), delete: vi.fn() });
});

describe("GET /api/orders/[id]/slip", () => {
  it("ไม่ได้ล็อกอิน → 401 และไม่ค้นคำสั่งซื้อหรืออ่านไฟล์เลย", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const res = await call(ORDER);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(findSlipForViewer).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("ตรวจ session ไม่ได้ (ฐานข้อมูลล้ม) → 503 ไม่ปล่อยไฟล์", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getSessionUser).mockRejectedValue(new Error("db down"));
    expect((await call(ORDER)).status).toBe(503);
    expect(findSlipForViewer).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("id ผิดรูปแบบ → 404 โดยไม่แตะฐานข้อมูล", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(customer);
    expect((await call("not-a-uuid")).status).toBe(404);
    expect(findSlipForViewer).not.toHaveBeenCalled();
  });

  it("ไม่ใช่เจ้าของ/ไม่มีสลิป (repo คืน null) → 404 และไม่อ่านไฟล์ — สิทธิ์ตัดสินจาก session ไม่ใช่จากคำขอ", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(customer);
    vi.mocked(findSlipForViewer).mockResolvedValue(null);
    const res = await call(ORDER);
    expect(res.status).toBe(404);
    expect(findSlipForViewer).toHaveBeenCalledWith(ORDER, { id: "u1", role: "customer" });
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("ชนิดไฟล์ที่บันทึกไว้ไม่อยู่ในรายการ / ไฟล์หาย / ที่เก็บสลิปปิดอยู่ → 404", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(customer);

    vi.mocked(findSlipForViewer).mockResolvedValue({ key: KEY, mime: "text/html" });
    expect((await call(ORDER)).status).toBe(404);
    expect(storageGet).not.toHaveBeenCalled();

    vi.mocked(findSlipForViewer).mockResolvedValue({ key: KEY, mime: "image/png" });
    storageGet.mockResolvedValue(null);
    expect((await call(ORDER)).status).toBe(404);

    vi.mocked(getSlipStorage).mockReturnValue(null);
    expect((await call(ORDER)).status).toBe(404);
  });

  it("เจ้าของ → 200 พร้อม header ที่ปิดการ cache และการรันสคริปต์", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(customer);
    vi.mocked(findSlipForViewer).mockResolvedValue({ key: KEY, mime: "image/png" });
    storageGet.mockResolvedValue(bytes);

    const res = await call(ORDER);
    expect(res.status).toBe(200);
    expect(storageGet).toHaveBeenCalledWith(KEY);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(bytes));
  });

  it("PDF → บังคับดาวน์โหลด", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(customer);
    vi.mocked(findSlipForViewer).mockResolvedValue({ key: KEY.replace(".png", ".pdf"), mime: "application/pdf" });
    storageGet.mockResolvedValue(bytes);
    const res = await call(ORDER);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });
});
