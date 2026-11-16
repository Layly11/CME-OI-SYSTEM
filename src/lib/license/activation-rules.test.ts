import { describe, expect, it } from "vitest";
import { planActivation } from "./activation-rules";

const today = "2026-11-16";

describe("planActivation", () => {
  it("ไม่มี license เดิม → new นับจากวันนี้", () => {
    expect(planActivation({ durationDays: 30, current: null, today })).toEqual({
      ok: true,
      kind: "new",
      startsAt: today,
      expiresAt: "2026-12-16",
      previousExpiresAt: null,
    });
  });

  it("ต่ออายุก่อนหมด → extended ต่อจากวันหมดอายุเดิม วันเริ่มไม่เปลี่ยน", () => {
    expect(planActivation({ durationDays: 30, current: { expiresAt: "2026-12-01" }, today })).toEqual({
      ok: true,
      kind: "extended",
      startsAt: null,
      expiresAt: "2026-12-31",
      previousExpiresAt: "2026-12-01",
    });
  });

  it("หมดอายุวันนี้พอดี ยังถือว่าใช้ได้ → extended ต่อจากวันนี้", () => {
    expect(planActivation({ durationDays: 365, current: { expiresAt: today }, today })).toMatchObject({
      kind: "extended",
      expiresAt: "2027-11-16",
      previousExpiresAt: today,
    });
  });

  it("เลยวันหมดอายุแล้ว (แถวยัง active) → reactivated นับใหม่จากวันนี้ ไม่ใช่จากวันหมดอายุเก่า", () => {
    expect(planActivation({ durationDays: 30, current: { expiresAt: "2026-11-15" }, today })).toEqual({
      ok: true,
      kind: "reactivated",
      startsAt: today,
      expiresAt: "2026-12-16",
      previousExpiresAt: "2026-11-15",
    });
  });

  it("แพ็กเกจตลอดชีพ (durationDays = null) → 9999-01-01 ทั้งกรณีใหม่ ต่ออายุ และหมดแล้ว", () => {
    expect(planActivation({ durationDays: null, current: null, today })).toMatchObject({ kind: "new", expiresAt: "9999-01-01" });
    expect(planActivation({ durationDays: null, current: { expiresAt: "2027-01-01" }, today })).toMatchObject({
      kind: "extended",
      expiresAt: "9999-01-01",
      previousExpiresAt: "2027-01-01",
    });
    expect(planActivation({ durationDays: null, current: { expiresAt: "2020-01-01" }, today })).toMatchObject({
      kind: "reactivated",
      startsAt: today,
      expiresAt: "9999-01-01",
    });
  });

  it.each(["9999-01-01", "2099-12-29", "2100-12-30", "2099-01-01"])(
    "license เดิมเป็นตลอดชีพ (%s) → ไม่ต่อ ไม่ว่าแพ็กเกจใด",
    (expiresAt) => {
      expect(planActivation({ durationDays: 30, current: { expiresAt }, today })).toEqual({ ok: false, reason: "lifetime_active" });
      expect(planActivation({ durationDays: null, current: { expiresAt }, today })).toEqual({ ok: false, reason: "lifetime_active" });
    },
  );

  it("2098-12-31 ยังไม่ใช่ตลอดชีพ → ต่อได้", () => {
    expect(planActivation({ durationDays: 1, current: { expiresAt: "2098-12-30" }, today })).toMatchObject({
      ok: true,
      expiresAt: "2098-12-31",
    });
  });

  it("ข้ามสิ้นเดือน/ปีอธิกสุรทิน", () => {
    expect(planActivation({ durationDays: 30, current: null, today: "2028-01-31" })).toMatchObject({ expiresAt: "2028-03-01" });
    expect(planActivation({ durationDays: 1, current: { expiresAt: "2028-02-28" }, today: "2028-02-01" })).toMatchObject({
      expiresAt: "2028-02-29",
    });
    expect(planActivation({ durationDays: 365, current: null, today: "2027-12-31" })).toMatchObject({ expiresAt: "2028-12-30" });
    expect(planActivation({ durationDays: 180, current: { expiresAt: "2026-12-31" }, today })).toMatchObject({
      expiresAt: "2027-06-29",
    });
  });
});
