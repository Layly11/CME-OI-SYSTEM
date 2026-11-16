import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSlipStorage, LocalSlipStorage } from "./slip-storage";

const ORDER = "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f";
const KEY = `${ORDER}/0b7e1c52-1111-4222-8333-444455556666.png`;
const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

// ไม่ใช้ฐานข้อมูล — รันเสมอ
describe("LocalSlipStorage", () => {
  let dir: string;
  let storage: LocalSlipStorage;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "cme-slips-"));
    storage = new LocalSlipStorage(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("put → get → delete และไม่เหลือไฟล์ .tmp", async () => {
    expect(await storage.get(KEY)).toBeNull();
    await storage.put(KEY, data);
    expect(Array.from((await storage.get(KEY))!)).toEqual(Array.from(data));
    expect(await readdir(path.join(dir, ORDER))).toEqual([path.basename(KEY)]);

    await storage.delete(KEY);
    expect(await storage.get(KEY)).toBeNull();
    await expect(storage.delete(KEY)).resolves.toBeUndefined(); // ลบซ้ำไม่ error
  });

  it("เขียนทับ key เดิมได้", async () => {
    await storage.put(KEY, data);
    await storage.put(KEY, new Uint8Array([9, 9]));
    expect(Array.from((await storage.get(KEY))!)).toEqual([9, 9]);
  });

  it.each([
    `../${KEY}`,
    `${ORDER}/../../escape.png`,
    `${ORDER}/../../../../etc/passwd`,
    "/etc/passwd",
    `${ORDER}/slip.png`,
    `${ORDER}/0b7e1c52-1111-4222-8333-444455556666.html`,
    "",
  ])("ปฏิเสธ key %j ทั้ง put/get/delete และไม่เขียนอะไรนอกโฟลเดอร์", async (key) => {
    await expect(storage.put(key, data)).rejects.toThrow();
    await expect(storage.get(key)).rejects.toThrow();
    await expect(storage.delete(key)).rejects.toThrow();
    expect((await readdir(path.dirname(dir))).includes("escape.png")).toBe(false);
  });

  it("getSlipStorage: local เป็นค่าเริ่มต้น, disabled คืน null, ค่าอื่นโยน error", () => {
    const prev = process.env.SLIP_STORAGE;
    try {
      delete process.env.SLIP_STORAGE;
      expect(getSlipStorage()).toBeInstanceOf(LocalSlipStorage);
      process.env.SLIP_STORAGE = "s3";
      expect(() => getSlipStorage()).toThrow(/SLIP_STORAGE/);
      process.env.SLIP_STORAGE = "disabled";
      expect(getSlipStorage()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.SLIP_STORAGE;
      else process.env.SLIP_STORAGE = prev;
    }
  });
});
