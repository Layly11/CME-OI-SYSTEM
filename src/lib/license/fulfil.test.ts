import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const auditValues = vi.fn();
vi.mock("@/db", () => ({
  getDb: () => ({ insert: () => ({ values: auditValues }) }),
  schema: { auditLogs: {} },
}));
vi.mock("./activation", () => ({ activateOrderIfReady: vi.fn() }));
vi.mock("./publish-sync", () => ({ publishLicensesSerialized: vi.fn() }));

import { activateOrderIfReady } from "./activation";
import { fulfilOrder } from "./fulfil";
import { publishLicensesSerialized } from "./publish-sync";

const ORDER = "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f";
const LICENSE = "9c9c9c9c-3333-4444-8555-666677778888";
const published = { status: "published", publicationId: "p1", entryCount: 3 } as const;

beforeEach(() => {
  auditValues.mockReset().mockResolvedValue(undefined);
  vi.mocked(activateOrderIfReady).mockReset();
  vi.mocked(publishLicensesSerialized).mockReset().mockResolvedValue(published);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("fulfilOrder", () => {
  it("เปิด license สำเร็จ → เผยแพร่รายชื่อ 1 ครั้ง หลังเปิดเสร็จ", async () => {
    const activation = { status: "activated", licenseId: LICENSE, expiresAt: "2027-01-01", kind: "new" } as const;
    const order: string[] = [];
    vi.mocked(activateOrderIfReady).mockImplementation(async () => {
      order.push("activate");
      return activation;
    });
    vi.mocked(publishLicensesSerialized).mockImplementation(async () => {
      order.push("publish");
      return published;
    });
    expect(await fulfilOrder(ORDER, { trigger: "payment" })).toEqual({ activation, publish: published });
    expect(order).toEqual(["activate", "publish"]);
    expect(activateOrderIfReady).toHaveBeenCalledWith(ORDER, { today: undefined });
    expect(publishLicensesSerialized).toHaveBeenCalledWith({ trigger: "payment", orderId: ORDER });
  });

  it("เปิดไปแล้ว (already_activated) → เผยแพร่อีกรอบ (ทางลองใหม่ของการเผยแพร่ที่เคยล้ม)", async () => {
    const activation = { status: "already_activated", licenseId: LICENSE, expiresAt: "2027-01-01" } as const;
    vi.mocked(activateOrderIfReady).mockResolvedValue(activation);
    vi.mocked(publishLicensesSerialized).mockResolvedValue({ status: "unchanged", entryCount: 3 });
    expect(await fulfilOrder(ORDER, { trigger: "retry" })).toEqual({
      activation,
      publish: { status: "unchanged", entryCount: 3 },
    });
    expect(publishLicensesSerialized).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: "not_ready", reason: "order_not_found" },
    { status: "not_ready", reason: "not_paid" },
    { status: "not_ready", reason: "no_account" },
    { status: "blocked", reason: "license_suspended" },
    { status: "blocked", reason: "lifetime_active" },
  ] as const)("ยังไม่ได้ license ($status/$reason) → ไม่เผยแพร่", async (activation) => {
    vi.mocked(activateOrderIfReady).mockResolvedValue(activation);
    expect(await fulfilOrder(ORDER, { trigger: "account" })).toEqual({ activation, publish: null });
    expect(publishLicensesSerialized).not.toHaveBeenCalled();
    expect(auditValues).not.toHaveBeenCalled();
  });

  it("การเปิด license throw → ไม่ throw ต่อ, บันทึก audit license.activate_failed แบบไม่มีข้อความดิบ, ไม่เผยแพร่", async () => {
    vi.mocked(activateOrderIfReady).mockRejectedValue(
      Object.assign(new Error("insert failed params: 97058698,secret@example.com"), { code: "57P01" }),
    );
    expect(await fulfilOrder(ORDER, { trigger: "payment" })).toEqual({ activation: { status: "error" }, publish: null });
    expect(publishLicensesSerialized).not.toHaveBeenCalled();
    expect(auditValues).toHaveBeenCalledTimes(1);
    const row = auditValues.mock.calls[0][0];
    expect(row).toMatchObject({
      actorUserId: null,
      action: "license.activate_failed",
      entity: "order",
      entityId: ORDER,
      data: { orderId: ORDER, trigger: "payment", error: "Error (code 57P01)" },
    });
    expect(JSON.stringify(row)).not.toContain("97058698");
  });

  it("บันทึก audit ไม่ได้ด้วย (ฐานข้อมูลล่ม) → ยังไม่ throw", async () => {
    vi.mocked(activateOrderIfReady).mockRejectedValue(new Error("db down"));
    auditValues.mockRejectedValue(new Error("db down"));
    expect(await fulfilOrder(ORDER, { trigger: "account" })).toEqual({ activation: { status: "error" }, publish: null });
  });

  it("เผยแพร่รายงานว่าล้ม/คิวไม่ว่าง → ส่งผลกลับตามนั้น ไม่ throw", async () => {
    const activation = { status: "activated", licenseId: LICENSE, expiresAt: "2027-01-01", kind: "extended" } as const;
    vi.mocked(activateOrderIfReady).mockResolvedValue(activation);
    vi.mocked(publishLicensesSerialized).mockResolvedValue({ status: "failed", error: "ENOTDIR" });
    expect((await fulfilOrder(ORDER, { trigger: "payment" })).publish).toEqual({ status: "failed", error: "ENOTDIR" });
    vi.mocked(publishLicensesSerialized).mockResolvedValue({ status: "busy" });
    expect((await fulfilOrder(ORDER, { trigger: "payment" })).publish).toEqual({ status: "busy" });
  });

  it("การเผยแพร่ throw (ผิดสัญญา) → ยังไม่ throw และรายงาน failed", async () => {
    vi.mocked(activateOrderIfReady).mockResolvedValue({ status: "activated", licenseId: LICENSE, expiresAt: "2027-01-01", kind: "new" });
    vi.mocked(publishLicensesSerialized).mockRejectedValue(new Error("unexpected"));
    expect((await fulfilOrder(ORDER, { trigger: "payment" })).publish).toMatchObject({ status: "failed" });
  });
});
