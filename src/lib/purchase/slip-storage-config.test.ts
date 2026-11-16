import { describe, expect, it } from "vitest";
import { ephemeralHostName, resolveSlipStorage } from "./slip-storage-config";

describe("resolveSlipStorage", () => {
  it("ค่าเริ่มต้นบนเครื่องที่ดิสก์ถาวร = local", () => {
    expect(resolveSlipStorage({})).toEqual({ ok: true, kind: "local" });
    expect(resolveSlipStorage({ SLIP_STORAGE: " local " })).toEqual({ ok: true, kind: "local" });
    expect(resolveSlipStorage({ SLIP_STORAGE: "" })).toEqual({ ok: true, kind: "local" });
  });

  it.each([
    [{ VERCEL: "1" }, "Vercel"],
    [{ AWS_LAMBDA_FUNCTION_NAME: "fn" }, "AWS Lambda"],
    [{ NETLIFY: "true" }, "Netlify"],
    [{ K_SERVICE: "web" }, "Cloud Run"],
  ])("โฮสต์ดิสก์ไม่ถาวร %j: ไม่ตั้ง หรือตั้ง local → ผิด พร้อมบอกทางแก้", (host, name) => {
    expect(ephemeralHostName(host)).toBe(name);
    for (const SLIP_STORAGE of [undefined, "", "local"]) {
      const result = resolveSlipStorage({ ...host, SLIP_STORAGE });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain(name);
      expect(result.error).toContain("SLIP_STORAGE=disabled");
    }
  });

  it("disabled ใช้ได้ทุกโฮสต์", () => {
    expect(resolveSlipStorage({ SLIP_STORAGE: "disabled" })).toEqual({ ok: true, kind: "disabled" });
    expect(resolveSlipStorage({ SLIP_STORAGE: "disabled", VERCEL: "1" })).toEqual({ ok: true, kind: "disabled" });
  });

  it("ค่าที่ไม่รู้จัก → ผิด", () => {
    const result = resolveSlipStorage({ SLIP_STORAGE: "s3" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('SLIP_STORAGE="s3"');
  });

  it("ตัวแปรแพลตฟอร์มที่ว่าง ไม่นับว่าเป็นโฮสต์นั้น", () => {
    expect(ephemeralHostName({ VERCEL: "", NETLIFY: " " })).toBeNull();
    expect(resolveSlipStorage({ VERCEL: "" })).toEqual({ ok: true, kind: "local" });
  });
});
