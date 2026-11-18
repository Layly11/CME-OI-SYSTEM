/**
 * ล้างข้อมูลจากการชำระเงินจำลอง (PAYMENT_PROVIDER=mock) ก่อนเปิดระบบจริง — ดูรายละเอียดใน src/lib/license/mock-purge.ts
 * รัน: npm run license:purge-mock              แสดงว่าจะทำอะไร (ไม่เขียนฐานข้อมูล)
 *      npm run license:purge-mock -- --apply   ทำจริง
 *      (ต้องมี DATABASE_URL ใน .env.local หรือใน environment)
 *
 * ทำไมต้องมี: ระหว่างทดสอบ การชำระเงินจำลองเปิด license ให้ฟรี ถ้าใช้ฐานข้อมูลเดิมต่อกับรายชื่อ license จริง
 * license เหล่านั้นจะถูกเขียนลงรายชื่อที่บอทอ่าน ระบบจึงปฏิเสธการเผยแพร่ไปรายชื่อจริงตราบที่ยังมี license ที่ active
 * จากคำสั่งซื้อจำลอง — สคริปต์นี้คือทางเคลียร์ (หรือเริ่มระบบจริงด้วยฐานข้อมูลใหม่ ซึ่งง่ายและปลอดภัยกว่า)
 *
 * หลัง --apply: รัน `npm run license:publish` เพื่อเขียนรายชื่อใหม่ (สคริปต์นี้ไม่เขียนรายชื่อเอง)
 * exit code: 0 = เรียบร้อย, 1 = ล้ม หรือมี license ที่ต้องจัดการเอง
 */
import { closeDb } from "../src/db";
import { purgeMockData } from "../src/lib/license/mock-purge";

async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  const report = await purgeMockData({ apply });
  console.log(apply ? "ล้างข้อมูลการชำระเงินจำลองแล้ว:" : "ทดลอง (ยังไม่เขียนฐานข้อมูล) — ถ้ารันด้วย --apply จะ:");
  console.log(`  ยกเลิกคำสั่งซื้อจำลองที่สถานะชำระแล้ว: ${report.ordersCancelled} รายการ`);
  console.log(`  ลบแถวสมุดบันทึกการเปิด license ของคำสั่งซื้อจำลอง: ${report.activationsRemoved} แถว (สำเนาอยู่ใน audit_logs)`);
  console.log(`  license ที่สร้างจากการชำระจำลอง → หมดอายุ: ${report.licensesExpired} ใบ`);
  console.log(`  license เดิมที่ถูกต่ออายุด้วยการชำระจำลอง → คืนวันหมดอายุเดิม: ${report.licensesRestored} ใบ`);
  if (report.skippedLicenseIds.length > 0) {
    console.error(
      `  ข้าม ${report.skippedLicenseIds.length} ใบ: มีการต่ออายุจากรายการจริง (ชำระจริง หรือแพ็กเกจฟรีจากการชวนเพื่อน) หลังการชำระจำลอง ต้องแก้วันหมดอายุเอง (license id ด้านล่าง)`,
    );
    for (const id of report.skippedLicenseIds) console.error(`    ${id}`);
    console.error("  การเผยแพร่ไปรายชื่อ license จริงจะยังถูกปฏิเสธจนกว่าจะจัดการ license เหล่านี้");
  }
  if (apply) console.log("ขั้นถัดไป: npm run license:publish เพื่อเขียนรายชื่อใหม่");
  else console.log("ยังไม่ได้เปลี่ยนอะไร — รันอีกครั้งพร้อม --apply เพื่อทำจริง");
  return report.skippedLicenseIds.length > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.name : "error", "— ล้างข้อมูลไม่สำเร็จ ตรวจ DATABASE_URL และการเชื่อมต่อฐานข้อมูล");
    return 1;
  })
  .then(async (code) => {
    await closeDb().catch(() => {});
    process.exit(code);
  });
