/**
 * ปล่อยเลขบัญชี MT5 ที่ถูกลงทะเบียนไว้ (เช่นมีคนกรอกเลขของลูกค้าคนอื่น) ให้เจ้าของจริงลงทะเบียนใหม่ได้
 * รัน: npm run admin:release-mt5 -- <เลขบัญชี MT5>   (ต้องมี DATABASE_URL ใน .env.local)
 *
 * ทำไม่ได้ (exit code 1) เมื่อบัญชีนั้นมี license หรือมีคำสั่งซื้อที่ชำระแล้ว/รอตรวจ/คืนเงินผูกอยู่ —
 * กรณีนั้นเลขอาจอยู่ในรายชื่อ license ที่บอทอ่าน ต้องย้าย/ระงับ license ผ่านขั้นตอน license ก่อน
 * คำสั่งซื้อที่ยังรอชำระของบัญชีนี้ไม่ถูกลบ แค่กลับเป็น "ยังไม่ระบุบัญชี"
 */
import { closeDb } from "../src/db";
import { releaseMt5AccountByNumber } from "../src/lib/purchase/mt5-release";

async function main(): Promise<number> {
  const accountNumber = (process.argv[2] ?? "").trim();
  if (!/^[1-9][0-9]{0,19}$/.test(accountNumber)) {
    console.error("วิธีใช้: npm run admin:release-mt5 -- <เลขบัญชี MT5 (ตัวเลขล้วน ไม่ขึ้นต้นด้วย 0)>");
    return 2;
  }
  const result = await releaseMt5AccountByNumber(accountNumber, "scripts/release-mt5.ts");
  if (!result.ok) {
    console.error(
      result.reason === "account_not_found"
        ? "ไม่พบเลขบัญชีนี้ในระบบ"
        : "ปล่อยไม่ได้: บัญชีนี้มี license หรือมีคำสั่งซื้อที่ชำระแล้ว/รอตรวจ/คืนเงินผูกอยู่",
    );
    return 1;
  }
  console.log(`ปล่อยเลขบัญชีแล้ว (mt5 account id ${result.accountId}, ถอดออกจากคำสั่งซื้อ ${result.detachedOrders} รายการ)`);
  return 0;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.name : "error", "— ปล่อยเลขบัญชีไม่สำเร็จ ตรวจ DATABASE_URL และการเชื่อมต่อฐานข้อมูล");
    return 1;
  })
  .then(async (code) => {
    await closeDb().catch(() => {});
    process.exit(code);
  });
