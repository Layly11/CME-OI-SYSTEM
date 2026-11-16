import { describe, expect, it } from "vitest";
import { purchaseMessages } from "./messages";
import { mt5AccountSchema, normalizeAccountNumber, normalizeBrokerServer, pickMt5Fields } from "./mt5";

const base = { accountNumber: "97058698", accountNumberConfirm: "97058698", brokerServer: "InterStellarFinancial-Server", label: "" };
const parse = (over: Partial<typeof base>) => mt5AccountSchema.safeParse({ ...base, ...over });
const errorOf = (r: ReturnType<typeof parse>, field: string) =>
  r.success ? undefined : r.error.issues.find((i) => i.path[0] === field)?.message;

describe("mt5AccountSchema: เลขบัญชี", () => {
  it("รับเลขล้วน และตัดช่องว่างหัวท้าย", () => {
    const r = parse({ accountNumber: " 97058698 ", accountNumberConfirm: "97058698\n" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.accountNumber).toBe("97058698");
      expect(r.data.label).toBeUndefined();
    }
  });

  it.each([
    ["ตัวอักษร", "97058a98"],
    ["ช่องว่างกลางเลข", "9705 8698"],
    ["เลขไทย", "๙๗๐๕๘๖๙๘"],
    ["เลขเต็มความกว้าง", "９７０５８６９８"],
    ["ขึ้นต้นด้วย 0", "07058698"],
    ["สั้นเกิน (3 หลัก)", "123"],
    ["ยาวเกิน (21 หลัก)", "1".repeat(21)],
    ["เครื่องหมายลบ", "-9705869"],
    ["ทศนิยม", "9705.8698"],
    ["ว่าง", ""],
  ])("ปฏิเสธ: %s", (_name, value) => {
    const r = parse({ accountNumber: value, accountNumberConfirm: value });
    expect(errorOf(r, "accountNumber")).toBe(purchaseMessages.account_number_invalid);
  });

  it("ขอบเขตความยาว 4 และ 20 หลักผ่าน", () => {
    expect(parse({ accountNumber: "1234", accountNumberConfirm: "1234" }).success).toBe(true);
    const twenty = "1".repeat(20);
    expect(parse({ accountNumber: twenty, accountNumberConfirm: twenty }).success).toBe(true);
  });

  it("สองช่องไม่ตรงกัน → error ที่ช่องยืนยัน", () => {
    const r = parse({ accountNumberConfirm: "97058699" });
    expect(errorOf(r, "accountNumberConfirm")).toBe(purchaseMessages.account_number_mismatch);
    expect(errorOf(r, "accountNumber")).toBeUndefined();
  });
});

describe("mt5AccountSchema: broker server และ label", () => {
  it("ตัดหัวท้ายและยุบช่องว่างซ้อน", () => {
    const r = parse({ brokerServer: "  Exness   MT5  Real8 " });
    expect(r.success && r.data.brokerServer).toBe("Exness MT5 Real8");
    expect(normalizeBrokerServer(" a \t b ")).toBe("a b");
  });

  it.each(["ICMarketsSC-MT5-2", "XM.COM-Real 12", "Broker_Live01", "abc"])("รับ: %s", (v) => {
    expect(parse({ brokerServer: v }).success).toBe(true);
  });

  it.each([
    ["อักขระไทย", "โบรกเกอร์-Server"],
    ["แท็ก HTML", "<script>x</script>"],
    ["ขึ้นต้นด้วยขีด", "-Server"],
    ["ลงท้ายด้วยจุด", "Server."],
    ["สั้นเกิน", "ab"],
    ["ยาวเกิน", "a".repeat(65)],
    ["มี slash", "Broker/Server"],
    ["ว่าง", "   "],
  ])("ปฏิเสธ: %s", (_n, v) => {
    expect(errorOf(parse({ brokerServer: v }), "brokerServer")).toBe(purchaseMessages.broker_server_invalid);
  });

  it("label ไม่บังคับ ยาวเกิน 40 ไม่ผ่าน", () => {
    const ok = parse({ label: "  บัญชีหลัก  " });
    expect(ok.success && ok.data.label).toBe("บัญชีหลัก");
    expect(errorOf(parse({ label: "ก".repeat(41) }), "label")).toBe(purchaseMessages.label_too_long);
  });
});

describe("pickMt5Fields / normalize", () => {
  it("normalizeAccountNumber ตัดแค่หัวท้าย ไม่แปลงเลข", () => {
    expect(normalizeAccountNumber("  12 34 ")).toBe("12 34");
    expect(normalizeAccountNumber("๑๒๓๔")).toBe("๑๒๓๔");
  });

  it("อ่านเฉพาะ 4 ช่องที่รู้จัก — ช่องที่มีคำว่า password ถูกทิ้ง", () => {
    const fd = new Map<string, unknown>([
      ["accountNumber", "97058698"],
      ["accountNumberConfirm", "97058698"],
      ["brokerServer", "X-Server"],
      ["label", "หลัก"],
      ["password", "secret"],
      ["mt5Password", "secret"],
      ["investor_password", "secret"],
    ]);
    const picked = pickMt5Fields((n) => fd.get(n));
    expect(Object.keys(picked).sort()).toEqual(["accountNumber", "accountNumberConfirm", "brokerServer", "label"]);
    expect(JSON.stringify(picked)).not.toContain("secret");
    expect(Object.keys(mt5AccountSchema.parse(picked)).some((k) => /password/i.test(k))).toBe(false);
  });

  it("ค่าที่ไม่ใช่ string นับเป็นค่าว่าง", () => {
    const picked = pickMt5Fields((n) => (n === "accountNumber" ? { evil: true } : null));
    expect(picked.accountNumber).toBe("");
    expect(picked.brokerServer).toBe("");
  });
});
