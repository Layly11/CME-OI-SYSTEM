import { describe, expect, it } from "vitest";
import { authMessages } from "./messages";
import {
  firstFieldErrors,
  isPackageCode,
  loginPathForPackage,
  loginSchema,
  normalizeEmail,
  pathWithQuery,
  postRegisterPath,
  registerSchema,
  safeNextPath,
} from "./validation";

const valid = {
  name: "สมชาย ตัวอย่าง",
  email: "somchai@example.com",
  password: "ทองคำขึ้นลง2569",
  phone: "",
  lineId: "",
  accept: "on",
  package: "",
};

function errorsOf(input: Record<string, unknown>) {
  const r = registerSchema.safeParse(input);
  if (r.success) throw new Error("ควรไม่ผ่าน");
  return firstFieldErrors(r.error);
}

describe("normalizeEmail", () => {
  it("ตัดช่องว่างแล้วแปลงเป็นตัวพิมพ์เล็ก", () => {
    expect(normalizeEmail("  Test@Example.COM \n")).toBe("test@example.com");
    expect(normalizeEmail("a@b.co")).toBe("a@b.co");
  });
});

describe("registerSchema", () => {
  it("ข้อมูลครบผ่าน และ normalise ค่า", () => {
    const r = registerSchema.safeParse({ ...valid, name: "  สมชาย  ", email: " Test@Example.com " });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.name).toBe("สมชาย");
    expect(r.data.email).toBe("test@example.com");
    expect(r.data.phone).toBeUndefined();
    expect(r.data.lineId).toBeUndefined();
    expect(r.data.package).toBeUndefined();
  });

  it("ช่องไม่บังคับ", () => {
    const r = registerSchema.safeParse({ ...valid, phone: " 081-234-5678 ", lineId: " somchai.line ", package: "yearly" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.phone).toBe("081-234-5678");
    expect(r.data.lineId).toBe("somchai.line");
    expect(r.data.package).toBe("yearly");
  });

  it("ชื่อ", () => {
    expect(errorsOf({ ...valid, name: "   " }).name).toBe(authMessages.nameRequired);
    expect(errorsOf({ ...valid, name: "ก".repeat(101) }).name).toBe(authMessages.nameTooLong);
    expect(registerSchema.safeParse({ ...valid, name: "ก".repeat(100) }).success).toBe(true);
  });

  it("อีเมล", () => {
    for (const bad of ["", "not-an-email", "a@", "@b.com", "a b@c.com", `${"a".repeat(250)}@example.com`]) {
      expect(errorsOf({ ...valid, email: bad }).email).toBe(authMessages.emailInvalid);
    }
  });

  it("รหัสผ่านตามนโยบาย โดยเทียบกับอีเมลที่ normalise แล้ว", () => {
    expect(errorsOf({ ...valid, password: "short" }).password).toBe(authMessages.passwordTooShort);
    expect(errorsOf({ ...valid, password: "x".repeat(129) }).password).toBe(authMessages.passwordTooLong);
    expect(errorsOf({ ...valid, password: "password123" }).password).toBe(authMessages.passwordTooCommon);
    expect(errorsOf({ ...valid, email: " Somchai99@Example.com", password: "somchai99" }).password).toBe(
      authMessages.passwordSameAsEmail,
    );
    expect(errorsOf({ ...valid, email: "Somchai@Example.com", password: "SOMCHAI@example.com" }).password).toBe(
      authMessages.passwordSameAsEmail,
    );
  });

  it("เบอร์โทร", () => {
    for (const bad of ["12345", "08x-234-5678", "0".repeat(21), "๐๘๑๒๓๔๕๖๗๘"]) {
      expect(errorsOf({ ...valid, phone: bad }).phone).toBe(authMessages.phoneInvalid);
    }
    expect(registerSchema.safeParse({ ...valid, phone: "+66 81 234 5678" }).success).toBe(true);
  });

  it("LINE ID ยาวเกิน", () => {
    expect(errorsOf({ ...valid, lineId: "a".repeat(51) }).lineId).toBe(authMessages.lineIdTooLong);
  });

  it("ต้องยอมรับข้อตกลง", () => {
    expect(errorsOf({ ...valid, accept: "" }).accept).toBe(authMessages.acceptRequired);
    expect(errorsOf({ ...valid, accept: "true" }).accept).toBe(authMessages.acceptRequired);
    const { accept: _accept, ...withoutAccept } = valid;
    void _accept;
    expect(errorsOf(withoutAccept).accept).toBe(authMessages.acceptRequired);
  });

  it("แพ็กเกจที่ไม่รู้จักถูกทิ้ง ไม่ใช่ข้อผิดพลาด", () => {
    for (const pkg of ["ib", "free", "../x", "YEARLY"]) {
      const r = registerSchema.safeParse({ ...valid, package: pkg });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.package).toBeUndefined();
    }
  });

  it("ผิดหลายช่อง ได้ข้อความแรกของแต่ละช่อง และไม่มีช่องอื่นปน", () => {
    const errors = errorsOf({ ...valid, name: "", email: "x", password: "1", accept: "" });
    expect(Object.keys(errors).sort()).toEqual(["accept", "email", "name"]);
    // รหัสผ่านตรวจหลังช่องอื่นผ่านรูปแบบแล้ว (superRefine ทำงานเมื่อ object ถูกต้อง)
    expect(errorsOf({ ...valid, password: "1" })).toEqual({ password: authMessages.passwordTooShort });
  });

  it("ค่าที่ไม่ใช่ string ไม่ทำให้พัง", () => {
    expect(registerSchema.safeParse({ ...valid, name: 123 }).success).toBe(false);
    expect(registerSchema.safeParse({}).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("normalise อีเมล", () => {
    const r = loginSchema.safeParse({ email: " Test@Example.com ", password: "x" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ email: "test@example.com", password: "x" });
  });

  it("ไม่ตรวจนโยบายรหัสผ่านตอนล็อกอิน (รหัสเก่าที่สั้นยังล็อกอินได้)", () => {
    expect(loginSchema.safeParse({ email: "a@example.com", password: "1" }).success).toBe(true);
  });

  it("ค่าที่ไม่ถูกต้อง", () => {
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@example.com", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@example.com", password: "x".repeat(129) }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@example.com" }).success).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("ยอมเฉพาะ path ภายในใต้ /account และ /admin", () => {
    expect(safeNextPath("/account")).toBe("/account");
    expect(safeNextPath("/account/orders/x")).toBe("/account/orders/x");
    expect(safeNextPath("/account/orders/new?package=yearly")).toBe("/account/orders/new?package=yearly");
    expect(safeNextPath("/admin")).toBe("/admin");
    expect(safeNextPath("/admin/orders")).toBe("/admin/orders");
  });

  it("อย่างอื่นกลับไป /account", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil",
      "https://x",
      "http://example.com/account",
      "/pricing",
      "/",
      "",
      undefined,
      null,
      42,
      "/accountant",
      "/administrator",
      "account",
      "/account//evil.com",
      "/account\\evil",
      "/account/../pricing://x",
      "javascript:alert(1)",
      "/account?next=https://evil.com",
      "/account\n/x",
      " /account",
      "/account/" + "a".repeat(600),
    ]) {
      expect(safeNextPath(bad)).toBe("/account");
    }
  });
});

describe("postRegisterPath", () => {
  it("มีแพ็กเกจที่รู้จัก → หน้าสั่งซื้อ", () => {
    expect(postRegisterPath("yearly")).toBe("/account/orders/new?package=yearly");
    expect(postRegisterPath("six_months")).toBe("/account/orders/new?package=six_months");
  });

  it("ไม่มีหรือไม่รู้จัก → หน้าบัญชี", () => {
    for (const v of [undefined, "", "ib", "x&y=1", ["yearly"], 1]) {
      expect(postRegisterPath(v)).toBe("/account");
    }
  });

  it("isPackageCode", () => {
    expect(isPackageCode("monthly")).toBe(true);
    expect(isPackageCode("lifetime")).toBe(true);
    expect(isPackageCode("ib")).toBe(false);
    expect(isPackageCode(undefined)).toBe(false);
  });
});

describe("pathWithQuery", () => {
  const UUID = "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f";

  it("ต่อเฉพาะ key ที่อนุญาต และผลลัพธ์ผ่าน safeNextPath", () => {
    const path = pathWithQuery("/account/orders/new", { package: "yearly", account: UUID, evil: "x" }, ["package", "account"]);
    expect(path).toBe(`/account/orders/new?package=yearly&account=${UUID}`);
    expect(safeNextPath(path)).toBe(path);
    expect(pathWithQuery("/account/mt5/new", { order: UUID }, ["order"])).toBe(`/account/mt5/new?order=${UUID}`);
  });

  it("ไม่มีค่า / ค่าว่าง / ค่าซ้ำหลายตัว / ยาวผิดปกติ → ไม่ต่อ query", () => {
    expect(pathWithQuery("/account/orders/new", {}, ["package"])).toBe("/account/orders/new");
    expect(pathWithQuery("/account/orders/new", { package: "" }, ["package"])).toBe("/account/orders/new");
    expect(pathWithQuery("/account/orders/new", { package: ["a", "b"] }, ["package"])).toBe("/account/orders/new");
    expect(pathWithQuery("/account/orders/new", { package: "x".repeat(101) }, ["package"])).toBe("/account/orders/new");
  });

  it("ค่าที่มีอักขระอันตรายถูก encode — ยังเป็น path ภายในที่ปลอดภัย", () => {
    const path = pathWithQuery("/account/orders/new", { package: "https://evil.example//x" }, ["package"]);
    expect(path).not.toContain("//");
    expect(path).not.toContain(":");
    expect(safeNextPath(path)).toBe(path);
  });
});

describe("loginPathForPackage", () => {
  it("มีแพ็กเกจที่รู้จัก → ล็อกอินแล้วกลับไปหน้าสั่งซื้อแพ็กเกจนั้น", () => {
    const href = loginPathForPackage("yearly");
    expect(href).toBe("/login?next=%2Faccount%2Forders%2Fnew%3Fpackage%3Dyearly");
    const next = new URL(href, "http://localhost").searchParams.get("next");
    expect(safeNextPath(next)).toBe("/account/orders/new?package=yearly");
  });

  it("ไม่มี/ไม่รู้จัก → /login", () => {
    for (const v of [undefined, "", "gold", ["yearly"], "//evil.com"]) {
      expect(loginPathForPackage(v)).toBe("/login");
    }
  });
});
