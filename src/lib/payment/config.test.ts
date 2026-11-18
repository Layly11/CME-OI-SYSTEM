import { describe, expect, it } from "vitest";
import { DEFAULT_TEST_LICENSE_PATH, LICENSE_PATH_PREFIX } from "@/lib/firebase-rtdb";
import { DEFAULT_TEST_LICENSE_PATH as TEST_PATH, encodeLicensePath } from "@/lib/firebase-rtdb";
import {
  assertMockPaymentAllowed,
  isBankTransferEnabled,
  isMockPaymentBlocked,
  LIVE_FIREBASE_LICENSE_PATH,
  PAID_VIA_IDS,
  PAYMENT_PROVIDER_IDS,
  REFERRAL_PAYMENT_PROVIDER,
  resolvePaymentConfig,
  targetsLiveLicenseList,
} from "./config";

const LIVE = "CME_Data/Customer Data/Data";

describe("resolvePaymentConfig", () => {
  it("ไม่ตั้ง PAYMENT_PROVIDER (หรือมีแต่ช่องว่าง) → ยังไม่เปิดรับชำระ", () => {
    expect(resolvePaymentConfig({})).toEqual({ ok: true, provider: null });
    expect(resolvePaymentConfig({ PAYMENT_PROVIDER: "   " })).toEqual({ ok: true, provider: null });
    expect(resolvePaymentConfig({ NODE_ENV: "production" })).toEqual({ ok: true, provider: null });
  });

  it.each(["development", "test"])("mock ตอน NODE_ENV=%s → ใช้ได้", (NODE_ENV) => {
    expect(resolvePaymentConfig({ PAYMENT_PROVIDER: "mock", NODE_ENV })).toEqual({ ok: true, provider: "mock" });
    expect(resolvePaymentConfig({ PAYMENT_PROVIDER: " mock ", NODE_ENV })).toEqual({ ok: true, provider: "mock" });
  });

  // ค่าเริ่มต้นคือปิด: `next start` ใช้ NODE_ENV ที่ผู้รันส่งมา — ค่าแปลก/ไม่ตั้ง ต้องไม่เปิด mock ด้วย PAYMENT_PROVIDER=mock อย่างเดียว
  it.each([undefined, "", "staging", "Production", "PRODUCTION", "prod", "Development", "TEST", " development", "test ", "preview"])(
    "mock ตอน NODE_ENV=%j โดยไม่มี flag → ถูกปฏิเสธ; มี flag true ตรงตัว → ใช้ได้",
    (NODE_ENV) => {
      const refused = resolvePaymentConfig({ PAYMENT_PROVIDER: "mock", NODE_ENV });
      expect(refused).toMatchObject({ ok: false, provider: null });
      expect(refused.ok === false && refused.error).toContain("PAYMENT_MOCK_ALLOW_IN_PRODUCTION");
      expect(resolvePaymentConfig({ PAYMENT_PROVIDER: "mock", NODE_ENV, PAYMENT_MOCK_ALLOW_IN_PRODUCTION: "TRUE" }).ok).toBe(false);
      expect(resolvePaymentConfig({ PAYMENT_PROVIDER: "mock", NODE_ENV, PAYMENT_MOCK_ALLOW_IN_PRODUCTION: "true" })).toEqual({
        ok: true,
        provider: "mock",
      });
    },
  );

  it("mock ใน production โดยไม่ตั้ง PAYMENT_MOCK_ALLOW_IN_PRODUCTION → ถูกปฏิเสธ พร้อมข้อความไทย", () => {
    const config = resolvePaymentConfig({ PAYMENT_PROVIDER: "mock", NODE_ENV: "production" });
    expect(config).toMatchObject({ ok: false, provider: null });
    expect(config.ok === false && config.error).toMatch(/[฀-๿]/);
    expect(config.ok === false && config.error).toContain("PAYMENT_MOCK_ALLOW_IN_PRODUCTION");
  });

  it.each(["TRUE", "True", "1", "yes", "on", " true", "true ", ""])(
    "production: PAYMENT_MOCK_ALLOW_IN_PRODUCTION=%j ไม่ใช่ true ตรงตัว → ถูกปฏิเสธ",
    (flag) => {
      expect(
        resolvePaymentConfig({ PAYMENT_PROVIDER: "mock", NODE_ENV: "production", PAYMENT_MOCK_ALLOW_IN_PRODUCTION: flag }).ok,
      ).toBe(false);
    },
  );

  it("production + flag true + เก็บรายชื่อในเครื่อง → ใช้ได้", () => {
    const base = { PAYMENT_PROVIDER: "mock", NODE_ENV: "production", PAYMENT_MOCK_ALLOW_IN_PRODUCTION: "true" };
    expect(resolvePaymentConfig(base)).toEqual({ ok: true, provider: "mock" });
    expect(resolvePaymentConfig({ ...base, LICENSE_STORAGE: "local" })).toEqual({ ok: true, provider: "mock" });
    // FIREBASE_LICENSE_PATH ชี้ของจริงแต่ storage ไม่ใช่ firebase → ไม่มีการเขียนไป Firebase
    expect(resolvePaymentConfig({ ...base, LICENSE_STORAGE: "local", FIREBASE_LICENSE_PATH: LIVE })).toEqual({
      ok: true,
      provider: "mock",
    });
  });

  describe("รายชื่อ license จริงใน Firebase → mock ถูกปฏิเสธทุก NODE_ENV", () => {
    const paths = [LIVE, `/${LIVE}`, `${LIVE}/`, `//${LIVE}//`, `  ${LIVE}  `, ` /${LIVE}/ `];
    const envs = ["development", "test", "production", undefined];
    it.each(envs.flatMap((e) => paths.map((p) => [e, p] as const)))("NODE_ENV=%s path=%j", (NODE_ENV, path) => {
      const config = resolvePaymentConfig({
        PAYMENT_PROVIDER: "mock",
        NODE_ENV,
        PAYMENT_MOCK_ALLOW_IN_PRODUCTION: "true",
        LICENSE_STORAGE: "firebase",
        FIREBASE_LICENSE_PATH: path,
      });
      expect(config.ok).toBe(false);
      expect(config.ok === false && config.error).toContain("LICENSE_STORAGE=firebase");
    });

    it("LICENSE_STORAGE มีช่องว่างหัวท้ายก็ยังถูกจับ", () => {
      expect(
        resolvePaymentConfig({ PAYMENT_PROVIDER: "mock", LICENSE_STORAGE: " firebase ", FIREBASE_LICENSE_PATH: LIVE }).ok,
      ).toBe(false);
    });

    // path ใต้ node รายชื่อจริง: เขียนลูกของ node ที่เก็บ string = รายชื่อจริงทั้งก้อนถูกแทนด้วย object
    it.each([`${LIVE}/test`, `${LIVE}/a/b`, `/${LIVE}/test/`, `${LIVE}//test`, ` ${LIVE} / test `])(
      "path ใต้รายชื่อจริง %j → ถือเป็นของจริง mock ถูกปฏิเสธ (และ firebase-rtdb ไม่ยอมเขียน path นี้อยู่แล้ว)",
      (path) => {
        const env = {
          PAYMENT_PROVIDER: "mock",
          NODE_ENV: "production",
          PAYMENT_MOCK_ALLOW_IN_PRODUCTION: "true",
          LICENSE_STORAGE: "firebase",
          FIREBASE_LICENSE_PATH: path,
        };
        expect(targetsLiveLicenseList(env)).toBe(true);
        expect(resolvePaymentConfig(env).ok).toBe(false);
        expect(() => encodeLicensePath(path)).toThrow();
      },
    );

    it("path ที่แค่ขึ้นต้นคล้ายกัน (Data_test, Database) ไม่ใช่ของจริง", () => {
      for (const path of [TEST_PATH, "CME_Data/Customer Data/Database", "CME_Data/Customer Data/Data2", ""]) {
        expect(targetsLiveLicenseList({ LICENSE_STORAGE: "firebase", FIREBASE_LICENSE_PATH: path }), path).toBe(false);
      }
      expect(targetsLiveLicenseList({ LICENSE_STORAGE: "local", FIREBASE_LICENSE_PATH: LIVE })).toBe(false);
      expect(targetsLiveLicenseList({ FIREBASE_LICENSE_PATH: LIVE })).toBe(false);
    });
  });

  it("firebase แต่เป็น path ทดสอบ (เว้นว่าง = Data_test) → mock ใช้ได้", () => {
    const base = { PAYMENT_PROVIDER: "mock", NODE_ENV: "development", LICENSE_STORAGE: "firebase" };
    expect(resolvePaymentConfig(base)).toEqual({ ok: true, provider: "mock" });
    expect(resolvePaymentConfig({ ...base, FIREBASE_LICENSE_PATH: "" })).toEqual({ ok: true, provider: "mock" });
    expect(resolvePaymentConfig({ ...base, FIREBASE_LICENSE_PATH: DEFAULT_TEST_LICENSE_PATH })).toEqual({
      ok: true,
      provider: "mock",
    });
  });

  it.each(["Mock", "MOCK", "stripe", "opn", "true", "mock2"])("PAYMENT_PROVIDER=%j ไม่รู้จัก → ปิด (fail closed)", (value) => {
    const config = resolvePaymentConfig({ PAYMENT_PROVIDER: value, NODE_ENV: "development" });
    expect(config).toMatchObject({ ok: false, provider: null });
  });
});

describe("assertMockPaymentAllowed", () => {
  it("ผ่านเฉพาะเมื่อค่าตั้งคือ mock ที่อนุญาต", () => {
    expect(() => assertMockPaymentAllowed({ PAYMENT_PROVIDER: "mock", NODE_ENV: "test" })).not.toThrow();
    expect(() => assertMockPaymentAllowed({})).toThrow();
    expect(() => assertMockPaymentAllowed({ PAYMENT_PROVIDER: "stripe" })).toThrow();
    expect(() => assertMockPaymentAllowed({ PAYMENT_PROVIDER: "mock", NODE_ENV: "production" })).toThrow();
    expect(() => assertMockPaymentAllowed({ PAYMENT_PROVIDER: "mock" })).toThrow();
    expect(() => assertMockPaymentAllowed({ PAYMENT_PROVIDER: "mock", NODE_ENV: "staging" })).toThrow();
    expect(() =>
      assertMockPaymentAllowed({ PAYMENT_PROVIDER: "mock", LICENSE_STORAGE: "firebase", FIREBASE_LICENSE_PATH: LIVE }),
    ).toThrow();
  });
});

describe("isMockPaymentBlocked (ด่านตอนเปิด license: คำสั่งซื้อที่ชำระด้วย mock ในค่าตั้งที่ไม่อนุญาต mock)", () => {
  const mockOk = { PAYMENT_PROVIDER: "mock", NODE_ENV: "test" };
  it("คำสั่งซื้อที่ไม่ได้ชำระด้วย mock ไม่ถูกกัน ไม่ว่าค่าตั้งเป็นอย่างไร", () => {
    for (const provider of [null, undefined, "", "stripe", "Mock"]) {
      expect(isMockPaymentBlocked(provider, {}), String(provider)).toBe(false);
      expect(isMockPaymentBlocked(provider, mockOk), String(provider)).toBe(false);
    }
  });
  it("ชำระด้วย mock: ผ่านเฉพาะเมื่อค่าตั้งปัจจุบันยังอนุญาต mock", () => {
    expect(isMockPaymentBlocked("mock", mockOk)).toBe(false);
    // ปิด mock ไปแล้ว / production ไม่มี flag / NODE_ENV แปลก / ชี้รายชื่อจริง
    expect(isMockPaymentBlocked("mock", {})).toBe(true);
    expect(isMockPaymentBlocked("mock", { NODE_ENV: "production" })).toBe(true);
    expect(isMockPaymentBlocked("mock", { PAYMENT_PROVIDER: "mock", NODE_ENV: "production" })).toBe(true);
    expect(isMockPaymentBlocked("mock", { PAYMENT_PROVIDER: "mock", NODE_ENV: "staging" })).toBe(true);
    expect(
      isMockPaymentBlocked("mock", { ...mockOk, LICENSE_STORAGE: "firebase", FIREBASE_LICENSE_PATH: LIVE }),
    ).toBe(true);
    expect(
      isMockPaymentBlocked("mock", {
        NODE_ENV: "production",
        LICENSE_STORAGE: "firebase",
        FIREBASE_LICENSE_PATH: LIVE,
      }),
    ).toBe(true);
  });
});

describe("isBankTransferEnabled", () => {
  it("เปิดเฉพาะ true ตรงตัว — ค่าเริ่มต้นปิด", () => {
    expect(isBankTransferEnabled({})).toBe(false);
    expect(isBankTransferEnabled({ PAYMENT_BANK_TRANSFER_ENABLED: "true" })).toBe(true);
    for (const v of ["", "TRUE", "1", "yes", " true", "false"]) {
      expect(isBankTransferEnabled({ PAYMENT_BANK_TRANSFER_ENABLED: v }), v).toBe(false);
    }
  });
});

describe("ค่าคงที่", () => {
  it("path จริงตรงกับที่ตกลง อยู่ใต้ prefix ที่ firebase-rtdb ยอมเขียน และไม่ใช่ path ทดสอบ", () => {
    expect(LIVE_FIREBASE_LICENSE_PATH).toBe(LIVE);
    expect(LIVE_FIREBASE_LICENSE_PATH.startsWith(LICENSE_PATH_PREFIX)).toBe(true);
    expect(LIVE_FIREBASE_LICENSE_PATH).not.toBe(DEFAULT_TEST_LICENSE_PATH);
    expect(PAYMENT_PROVIDER_IDS).toEqual(["mock"]);
  });
});

describe("แพ็กเกจฟรีจากการชวนเพื่อน (provider \"referral\") ไม่ใช่การชำระเงินจำลอง", () => {
  const LIVE_ENV = { LICENSE_STORAGE: "firebase", FIREBASE_LICENSE_PATH: LIVE };

  it("ไม่ถูกด่านของ mock กัน ไม่ว่าค่าตั้งเป็นอย่างไร (ปิดการชำระเงิน / production / รายชื่อจริง)", () => {
    expect(REFERRAL_PAYMENT_PROVIDER).toBe("referral");
    for (const env of [{}, { NODE_ENV: "production" }, { PAYMENT_PROVIDER: "mock", NODE_ENV: "test" }, { NODE_ENV: "production", ...LIVE_ENV }]) {
      expect(isMockPaymentBlocked(REFERRAL_PAYMENT_PROVIDER, env), JSON.stringify(env)).toBe(false);
      // เทียบ: คำสั่งซื้อจำลองถูกกันทุกค่าตั้งที่ไม่อนุญาต mock
      expect(isMockPaymentBlocked("mock", env), JSON.stringify(env)).toBe(!(env.PAYMENT_PROVIDER === "mock" && env.NODE_ENV === "test"));
    }
  });

  it("ไม่ใช่ผู้ให้บริการรับชำระ: ตั้งผ่าน PAYMENT_PROVIDER ไม่ได้ และไม่อยู่ในรายชื่อ provider ของหน้าชำระเงิน", () => {
    expect(PAYMENT_PROVIDER_IDS as readonly string[]).not.toContain(REFERRAL_PAYMENT_PROVIDER);
    expect(resolvePaymentConfig({ PAYMENT_PROVIDER: "referral", NODE_ENV: "development" })).toMatchObject({ ok: false, provider: null });
    expect([...PAID_VIA_IDS].sort()).toEqual(["mock", "referral"]);
  });
});
