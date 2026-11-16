/**
 * รันครั้งเดียวตอนเซิร์ฟเวอร์ Next เริ่ม (ก่อนรับคำขอแรก) — ใช้ตรวจค่าตั้งที่ถ้าผิดแล้วลูกค้าหรือผู้ให้บริการจะเสียหาย
 * ค่าตั้งผิด → เซิร์ฟเวอร์ไม่ให้บริการ พร้อมข้อความบอกทางแก้ใน log · เฉพาะ NODE_ENV=development/test (ตรงตัว) ที่แค่เตือนใน log
 * (ทดสอบจริงกับ Next 16.4.5 `next start`: process ไม่ออกเอง แต่ทุกคำขอได้ 500 "Failed to prepare server" — ไม่มีหน้าไหนใช้งานได้
 *  ระบบ deploy ที่ตรวจ health check จะเห็นว่าล้ม; ถ้าไม่มี health check ต้องดู log หลัง deploy เอง)
 * (`next start` ใช้ NODE_ENV ที่ผู้รันส่งมา: ค่าแปลกอย่าง "staging" ต้องถูกตรวจเข้มเท่า production ไม่ใช่ปล่อยผ่าน)
 *
 * - ที่เก็บสลิป (SLIP_STORAGE) เช่น local บน serverless
 * - การชำระเงิน (PAYMENT_PROVIDER) เช่น mock นอก development โดยไม่ได้ตั้งใจ หรือ mock คู่กับรายชื่อ license จริงใน Firebase
 * - ปลายทางรายชื่อ license (LICENSE_STORAGE) เช่นลืมตั้ง/พิมพ์ผิด แล้วระบบจะไปเขียนไฟล์ในเครื่องแทนรายชื่อที่บอทอ่าน
 * - ลิงก์ LINE (NEXT_PUBLIC_LINE_URL) ไม่ได้ตั้งตอน build → เตือน (ทุกจุด "ติดต่อทาง LINE" จะเป็นข้อความเปล่า ไม่มีลิงก์)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { resolveSlipStorage } = await import("@/lib/purchase/slip-storage-config");
  const { resolvePaymentConfig } = await import("@/lib/payment/config");
  const { isDevOrTestEnv, resolveLicenseStorageConfig } = await import("@/lib/license-storage-config");
  const { parseLineUrl } = await import("@/content/site");

  const errors: string[] = [];
  const slip = resolveSlipStorage(process.env);
  if (!slip.ok) errors.push(slip.error);
  const payment = resolvePaymentConfig(process.env);
  if (!payment.ok) errors.push(payment.error);
  const licenseStorage = resolveLicenseStorageConfig(process.env);
  if (!licenseStorage.ok) errors.push(licenseStorage.error);

  const strict = !isDevOrTestEnv(process.env);
  if (errors.length > 0) {
    if (strict) throw new Error(errors.join(" | "));
    for (const error of errors) console.warn("[config]", error);
  }
  if (payment.ok && payment.provider === "mock") {
    console.warn(
      "[config] *** PAYMENT_PROVIDER=mock: จำลองการชำระเงิน (โหมดทดสอบ) เปิดอยู่ — ไม่มีการตัดเงินจริง " +
        "ทุกคำสั่งซื้อที่กดยืนยันจะได้ license ห้ามใช้กับระบบที่ลูกค้าจริงใช้งาน และห้ามใช้ฐานข้อมูลนี้ร่วมกับระบบจริง ***",
    );
  }
  if (licenseStorage.ok && licenseStorage.kind === "local" && strict) {
    console.warn(
      "[config] LICENSE_STORAGE=local: รายชื่อ license ถูกเขียนเป็นไฟล์ในเครื่อง บอทของลูกค้าไม่ได้อ่านจากที่นี่ " +
        "— ใช้กับระบบทดสอบเท่านั้น ระบบจริงต้องเป็น firebase",
    );
  }
  // NEXT_PUBLIC_* ถูกฝังตอน build: ค่าที่เห็นตรงนี้คือค่าตอน build ซึ่งเป็นค่าที่หน้าเว็บใช้จริง
  if (strict && parseLineUrl(process.env.NEXT_PUBLIC_LINE_URL) === null) {
    console.warn(
      "[config] ยังไม่ได้ตั้ง NEXT_PUBLIC_LINE_URL (ต้องเป็น https://...) ตอน build — ข้อความ \"ติดต่อทีมงานทาง LINE\" ทุกจุด " +
        "(รวมกรณีระบบชำระเงินยังไม่เปิด และกรณีเปิด license ไม่สำเร็จ) จะไม่มีลิงก์ ตั้งค่าแล้วต้อง build ใหม่",
    );
  }
}
