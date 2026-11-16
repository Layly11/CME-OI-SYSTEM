import { describe, expect, it } from "vitest";
import { DEFAULT_TEST_LICENSE_PATH } from "./firebase-rtdb";
import { isDevOrTestEnv, LIVE_FIREBASE_LICENSE_PATH, resolveLicenseStorageConfig, targetsLiveLicenseList } from "./license-storage-config";

const FIREBASE = {
  LICENSE_STORAGE: "firebase",
  FIREBASE_DATABASE_URL: "https://example-default-rtdb.asia-southeast1.firebasedatabase.app",
  FIREBASE_SERVICE_ACCOUNT_JSON: "/run/secrets/firebase.json",
};

describe("resolveLicenseStorageConfig", () => {
  it.each(["development", "test"])("ไม่ตั้ง LICENSE_STORAGE ตอน NODE_ENV=%s → local (ค่าเริ่มต้นของเครื่องพัฒนา)", (NODE_ENV) => {
    expect(resolveLicenseStorageConfig({ NODE_ENV })).toEqual({ ok: true, kind: "local" });
    expect(resolveLicenseStorageConfig({ NODE_ENV, LICENSE_STORAGE: "   " })).toEqual({ ok: true, kind: "local" });
  });

  // ล้มแบบปิด: production (และ NODE_ENV อื่นที่ไม่ใช่ development/test รวมไม่ตั้ง) ต้องระบุปลายทางเอง ไม่ถอยไปเขียนไฟล์ในเครื่อง
  it.each(["production", undefined, "", "staging", "Production", "Development"])(
    "ไม่ตั้ง LICENSE_STORAGE ตอน NODE_ENV=%j → ผิด พร้อมข้อความไทยที่บอกชื่อตัวแปร",
    (NODE_ENV) => {
      const config = resolveLicenseStorageConfig({ NODE_ENV });
      expect(config.ok).toBe(false);
      expect(config.ok === false && config.error).toContain("LICENSE_STORAGE");
      expect(config.ok === false && config.error).toMatch(/[฀-๿]/);
    },
  );

  it.each(["Firebase", "FIREBASE", "firebas", "fire base", "s3", "local2", "true"])(
    "LICENSE_STORAGE=%j ไม่รู้จัก → ผิดทุก NODE_ENV (ไม่ถอยไป local)",
    (value) => {
      for (const NODE_ENV of ["development", "test", "production", undefined]) {
        const config = resolveLicenseStorageConfig({ ...FIREBASE, NODE_ENV, LICENSE_STORAGE: value });
        expect(config.ok, `${value} / ${NODE_ENV}`).toBe(false);
      }
    },
  );

  it("local ตั้งชัดเจน → ใช้ได้ทุก NODE_ENV (ตัดช่องว่างหัวท้าย)", () => {
    for (const NODE_ENV of ["development", "production", undefined, "staging"]) {
      expect(resolveLicenseStorageConfig({ NODE_ENV, LICENSE_STORAGE: " local " })).toEqual({ ok: true, kind: "local" });
    }
  });

  it("firebase: ต้องมี FIREBASE_DATABASE_URL และ FIREBASE_SERVICE_ACCOUNT_JSON — ขาดตัวไหนบอกตัวนั้น", () => {
    const none = resolveLicenseStorageConfig({ NODE_ENV: "production", LICENSE_STORAGE: "firebase" });
    expect(none.ok === false && none.error).toContain("FIREBASE_DATABASE_URL");
    expect(none.ok === false && none.error).toContain("FIREBASE_SERVICE_ACCOUNT_JSON");
    const noKey = resolveLicenseStorageConfig({ ...FIREBASE, NODE_ENV: "development", FIREBASE_SERVICE_ACCOUNT_JSON: "  " });
    expect(noKey.ok === false && noKey.error).toContain("FIREBASE_SERVICE_ACCOUNT_JSON");
    expect(noKey.ok === false && noKey.error).not.toContain("FIREBASE_DATABASE_URL");
  });

  it("firebase ครบ: ไม่ตั้ง path = ทดสอบ (licensePath null, live false); path จริง = live; ข้อความ error/ผลไม่มีค่า credential", () => {
    expect(resolveLicenseStorageConfig({ ...FIREBASE, NODE_ENV: "production" })).toEqual({
      ok: true,
      kind: "firebase",
      licensePath: null,
      live: false,
    });
    expect(resolveLicenseStorageConfig({ ...FIREBASE, LICENSE_STORAGE: "firebase ", FIREBASE_LICENSE_PATH: DEFAULT_TEST_LICENSE_PATH })).toEqual({
      ok: true,
      kind: "firebase",
      licensePath: DEFAULT_TEST_LICENSE_PATH,
      live: false,
    });
    const live = resolveLicenseStorageConfig({ ...FIREBASE, FIREBASE_LICENSE_PATH: ` ${LIVE_FIREBASE_LICENSE_PATH} ` });
    expect(live).toEqual({ ok: true, kind: "firebase", licensePath: LIVE_FIREBASE_LICENSE_PATH, live: true });
    expect(JSON.stringify(live)).not.toContain("secrets");
  });
});

describe("targetsLiveLicenseList / isDevOrTestEnv", () => {
  it("path จริงและทุก path ใต้มัน = ของจริง เฉพาะเมื่อ LICENSE_STORAGE=firebase", () => {
    const at = (FIREBASE_LICENSE_PATH: string, LICENSE_STORAGE = "firebase") => targetsLiveLicenseList({ LICENSE_STORAGE, FIREBASE_LICENSE_PATH });
    expect(at(LIVE_FIREBASE_LICENSE_PATH)).toBe(true);
    expect(at(`${LIVE_FIREBASE_LICENSE_PATH}/test`)).toBe(true);
    expect(at(`//${LIVE_FIREBASE_LICENSE_PATH}//test//`)).toBe(true);
    expect(at(DEFAULT_TEST_LICENSE_PATH)).toBe(false);
    expect(at("")).toBe(false);
    expect(at(LIVE_FIREBASE_LICENSE_PATH, "local")).toBe(false);
  });

  it("development/test ตรงตัวเท่านั้น", () => {
    expect(isDevOrTestEnv({ NODE_ENV: "development" })).toBe(true);
    expect(isDevOrTestEnv({ NODE_ENV: "test" })).toBe(true);
    for (const NODE_ENV of [undefined, "", "production", "Development", "test ", "staging"]) {
      expect(isDevOrTestEnv({ NODE_ENV }), String(NODE_ENV)).toBe(false);
    }
  });
});
