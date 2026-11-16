import { describe, expect, it } from "vitest";
import { isUniqueViolation, safeErrorSummary } from "./db-errors";

const pgError = (code: string, constraint_name?: string) => Object.assign(new Error("pg"), { code, constraint_name });

describe("isUniqueViolation", () => {
  it("error ตรงจาก driver", () => {
    expect(isUniqueViolation(pgError("23505"))).toBe(true);
  });

  it("error ที่ drizzle ห่อไว้ใน cause", () => {
    const wrapped = new Error("Failed query", { cause: pgError("23505", "users_email_unique") });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(wrapped, "users_email_unique")).toBe(true);
  });

  it("เทียบชื่อ constraint", () => {
    expect(isUniqueViolation(pgError("23505", "a_idx"), "a_idx")).toBe(true);
    expect(isUniqueViolation(pgError("23505", "a_idx"), "b_idx")).toBe(false);
    expect(isUniqueViolation(pgError("23505"), "a_idx")).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error("x"), { code: "23505", constraint: "a_idx" }), "a_idx")).toBe(true);
  });

  it("error อื่นไม่นับ", () => {
    expect(isUniqueViolation(pgError("23514"))).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(new Error("x", { cause: new Error("y") }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });

  it("cause วนกลับหาตัวเองก็ไม่ค้าง", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(isUniqueViolation(a)).toBe(false);
  });
});

describe("safeErrorSummary", () => {
  it("ไม่เอาข้อความของ error (ที่อาจมีพารามิเตอร์ของ query) ออกมา", () => {
    const wrapped = new Error("Failed query: insert ... params: secret@example.com", { cause: pgError("23505") });
    const summary = safeErrorSummary(wrapped);
    expect(summary).toBe("Error (code 23505)");
    expect(summary).not.toContain("secret@example.com");
  });

  it("ไม่มีรหัสก็คืนแค่ชื่อชนิด", () => {
    expect(safeErrorSummary(new TypeError("secret"))).toBe("TypeError");
    expect(safeErrorSummary("secret text")).toBe("Error");
    expect(safeErrorSummary(null)).toBe("null");
  });
});
