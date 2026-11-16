/**
 * เผยแพร่รายชื่อ license จากฐานข้อมูลไปยังที่ที่บอทอ่าน — ทางซ่อมเมื่อการเผยแพร่อัตโนมัติล้ม/ค้าง และงานประจำวัน (cron)
 * รัน: npm run license:publish                  เขียนปลายทางเสมอ แม้รายชื่อเหมือนครั้งล่าสุด (ค่าเริ่มต้น)
 *      npm run license:publish -- --if-changed   เขียนเฉพาะเมื่อรายชื่อ (หรือปลายทาง) ต่างจากครั้งล่าสุดในประวัติ
 *      (ต้องมี DATABASE_URL และ LICENSE_STORAGE ใน .env.local หรือใน environment — ไม่ตั้ง LICENSE_STORAGE สคริปต์ไม่เดาให้)
 *
 * ทำไมค่าเริ่มต้นคือ "เขียนเสมอ": การข้ามเมื่อ "ไม่มีอะไรเปลี่ยน" ตัดสินจากประวัติในฐานข้อมูลเท่านั้น ไม่ได้อ่านปลายทางจริง
 * ถ้าปลายทางถูกแก้มือใน Firebase Console / ถูก restore / ไฟล์ในเครื่องหาย การข้ามจะรายงานว่าเรียบร้อยทั้งที่ปลายทางผิด
 * คนที่รันสคริปต์ซ่อมจึงต้องได้การเขียนจริงทุกครั้ง (ด่านกันพลาดของ Firebase ยังทำงานทุกครั้งตามเดิม)
 * --if-changed เหมาะกับ cron ที่รันถี่: ไม่เพิ่มแถวประวัติเมื่อไม่มีอะไรเปลี่ยน แต่ไม่ซ่อมปลายทางที่ถูกแก้จากข้างนอก
 * (--force ของรุ่นก่อนยังรับได้ มีผลเท่ากับค่าเริ่มต้น)
 *
 * ทำ 2 อย่างตามลำดับ และรันซ้ำกี่ครั้งก็ได้ (license ไม่ถูกเปิด/ต่ออายุซ้ำ):
 * 1) เก็บตกคำสั่งซื้อที่ชำระแล้วและมีบัญชี MT5 แต่ยังไม่ได้เปิด license (1 คำสั่งซื้อเปิดได้ครั้งเดียว)
 * 2) สร้างรายชื่อทั้งก้อนจาก license ที่ active และยังไม่หมดอายุ (ตามวันที่ไทย) → ตรวจ → เขียนทับ → เก็บสำเนาใน
 *    license_file_publications ผ่าน publishLicenseFile() ตัวเดียวกับที่เว็บใช้ และเข้าคิวเดียวกับเว็บ
 *
 * ต้องรันอย่างน้อยวันละครั้งเมื่อปลายทางเป็น Firebase (ดู README "ก่อนเปิดระบบจริง"): license ที่หมดอายุถูกตัดจากรายชื่อเฉพาะตอนเผยแพร่
 * ถ้าปล่อยให้สะสมเกิน FIREBASE_MAX_REMOVED_ENTRIES ด่านกันพลาดจะปฏิเสธทุกการเผยแพร่ = ลูกค้าใหม่ทุกคนค้างที่ "กำลังเปิดใช้งาน"
 *
 * หมายเหตุเรื่องการชำระเงินจำลอง: สคริปต์รันโดยไม่มี NODE_ENV — คำสั่งซื้อที่ชำระด้วย mock จะถูกเก็บตกได้เฉพาะเมื่อ environment
 * ของสคริปต์อนุญาต mock เหมือนเซิร์ฟเวอร์ทดสอบ (PAYMENT_PROVIDER=mock + PAYMENT_MOCK_ALLOW_IN_PRODUCTION=true หรือ NODE_ENV=development)
 * ไม่เช่นนั้นถูกนับเป็น "ถูกกัน" และไม่มีอะไรเสียหาย
 *
 * สคริปต์พิมพ์ชนิดและ path ของปลายทางเท่านั้น ไม่พิมพ์ credential
 * ใช้ node --conditions=react-server เพราะโมดูลที่เรียกมี import "server-only"
 * exit code: 0 = เขียนปลายทางแล้ว (หรือ --if-changed และไม่มีอะไรเปลี่ยน), 1 = ไม่สำเร็จหรือคิวไม่ว่าง (ลองใหม่ได้)
 */
import { closeDb } from "../src/db";
import { DEFAULT_TEST_LICENSE_PATH } from "../src/lib/firebase-rtdb";
import { resolveLicenseStorageConfig } from "../src/lib/license-storage-config";
import { sweepPendingActivations } from "../src/lib/license/activation";
import { publishLicensesSerialized } from "../src/lib/license/publish-sync";

async function main(): Promise<number> {
  const ifChanged = process.argv.includes("--if-changed");
  const force = !ifChanged;

  const target = resolveLicenseStorageConfig(process.env);
  if (!target.ok) {
    console.error(`ปลายทางรายชื่อ license ตั้งค่าไม่ถูก: ${target.error}`);
    console.error("ยังไม่ได้แตะฐานข้อมูลหรือปลายทางใดๆ");
    return 1;
  }
  const where =
    target.kind === "firebase"
      ? `firebase (path: ${target.licensePath ?? DEFAULT_TEST_LICENSE_PATH}${target.live ? " — รายชื่อจริงที่บอทอ่าน" : " — path ทดสอบ"})`
      : "local (ไฟล์ในเครื่อง — บอทของลูกค้าไม่ได้อ่านจากที่นี่)";
  console.log(`ปลายทางรายชื่อ license: ${where}${ifChanged ? " · --if-changed" : " · เขียนเสมอ"}`);

  const sweep = await sweepPendingActivations();
  console.log(
    `เก็บตกคำสั่งซื้อที่ยังไม่ได้เปิด license: เปิดเพิ่ม ${sweep.activated} รายการ, ถูกกัน ${sweep.blocked} รายการ, ล้ม ${sweep.failed} รายการ`,
  );
  if (sweep.blocked > 0) {
    console.log(
      "  (ถูกกัน = license ถูกระงับ / เป็นตลอดชีพอยู่แล้ว / ชำระด้วยการชำระเงินจำลองใน environment ที่ไม่อนุญาต mock — ดู audit license.activate_blocked)",
    );
  }

  const outcome = await publishLicensesSerialized({ trigger: "script", waitMs: 30_000, force });
  switch (outcome.status) {
    case "published":
      console.log(`เขียนปลายทางแล้ว: ${outcome.entryCount} รายการ (publication ${outcome.publicationId})`);
      return sweep.failed > 0 ? 1 : 0;
    case "unchanged":
      console.log(
        `ไม่ได้เขียนปลายทาง (--if-changed): รายชื่อ ${outcome.entryCount} รายการเหมือนกับครั้งล่าสุดตามประวัติในฐานข้อมูล`,
      );
      console.log("  หมายเหตุ: ไม่ได้ตรวจปลายทางจริง — ถ้าสงสัยว่าปลายทางถูกแก้/หาย ให้รันอีกครั้งโดยไม่ใส่ --if-changed");
      return sweep.failed > 0 ? 1 : 0;
    case "busy":
      console.error("คิวเผยแพร่ไม่ว่าง (มีการเผยแพร่อื่นทำงานอยู่) — ลองใหม่อีกครั้ง");
      return 1;
    case "failed":
      console.error(`เผยแพร่ไม่สำเร็จ: ${outcome.error}`);
      console.error("license ในฐานข้อมูลไม่ถูกแตะ แก้สาเหตุแล้วรันคำสั่งนี้ซ้ำได้");
      return 1;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.name : "error", "— เผยแพร่ไม่สำเร็จ ตรวจ DATABASE_URL และการเชื่อมต่อฐานข้อมูล");
    return 1;
  })
  .then(async (code) => {
    await closeDb().catch(() => {});
    process.exit(code);
  });
