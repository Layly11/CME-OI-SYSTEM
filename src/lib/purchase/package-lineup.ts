import { getDb, schema } from "@/db";
import type { PackageCode } from "./packages";

/**
 * รายการแพ็กเกจที่ขาย (ยืนยันโดยผู้ว่าจ้าง 18 พ.ย. 2569) — ข้อมูลตั้งต้นของตาราง packages
 * `npm run db:seed` นำรายการนี้ไปเขียนลงฐานข้อมูล (scripts/seed.ts) หลังจากนั้นทุกส่วนของเว็บ
 * (หน้าแรก หน้าแพ็กเกจ หน้าสั่งซื้อ ยอดเงินของคำสั่งซื้อ อายุ license) อ่านจากตาราง packages ที่เดียว ไม่ได้อ่านไฟล์นี้
 * — แก้ราคา/วันแถม: แก้ที่นี่แล้วรัน `npm run db:seed` อีกครั้ง
 *
 * ไฟล์นี้ไม่ import "server-only" เพราะสคริปต์ seed (นอก Next) เรียกใช้
 *
 * อายุ license = durationDays + bonusDays: 3 เดือน 90+15 = 105 วัน, 6 เดือน 180+30 = 210 วัน, 1 ปี 365+60 = 425 วัน
 * (1 เดือน = 30 วัน, 1 ปี = 365 วัน — เป็นข้อสมมติของทีมพัฒนา รอผู้ว่าจ้างยืนยัน)
 */
type LineupRow = {
  code: PackageCode;
  nameTh: string;
  description: string | null;
  durationDays: number | null;
  bonusDays: number;
  /** undefined = ไม่แตะราคาที่มีอยู่ในฐานข้อมูล (แพ็กเกจที่เลิกขาย) — แถวใหม่ได้ราคา null */
  priceThb?: number | null;
  isActive: boolean;
  sortOrder: number;
};

export const PACKAGE_LINEUP: readonly LineupRow[] = [
  // ---- ขายอยู่ 4 แพ็กเกจ ----
  {
    code: "free_referral",
    nameTh: "ฟรี 1 เดือน",
    // เงื่อนไขที่แสดงให้ลูกค้า — จำนวนเพื่อนที่โค้ดตรวจจริงคือ REFERRALS_REQUIRED_FOR_FREE (ต้องแก้คู่กัน)
    description: "ชวนเพื่อนสมัครสมาชิก 1 คน",
    durationDays: 30,
    bonusDays: 0,
    priceThb: 0,
    isActive: true,
    sortOrder: 1,
  },
  { code: "three_months", nameTh: "3 เดือน", description: null, durationDays: 90, bonusDays: 15, priceThb: 3000, isActive: true, sortOrder: 2 },
  { code: "six_months", nameTh: "6 เดือน", description: null, durationDays: 180, bonusDays: 30, priceThb: 6000, isActive: true, sortOrder: 3 },
  { code: "yearly", nameTh: "1 ปี", description: null, durationDays: 365, bonusDays: 60, priceThb: 11000, isActive: true, sortOrder: 4 },
  // ---- เลิกขาย: ปิดไว้ (is_active = false) ไม่ลบแถว — คำสั่งซื้อ/license เดิมยังอ้างแพ็กเกจเหล่านี้ และ license ตลอดชีพเดิมใช้งานต่อได้ตามปกติ ----
  { code: "monthly", nameTh: "รายเดือน", description: null, durationDays: 30, bonusDays: 0, isActive: false, sortOrder: 90 },
  { code: "lifetime", nameTh: "ตลอดชีพ", description: null, durationDays: null, bonusDays: 0, isActive: false, sortOrder: 91 },
  {
    code: "ib",
    nameTh: "สำหรับลูกค้า IB",
    description: "สำหรับบัญชีที่เปิดผ่าน IB ของผู้ให้บริการ (เงื่อนไขรอยืนยัน)",
    durationDays: 30,
    bonusDays: 0,
    priceThb: 0,
    isActive: false,
    sortOrder: 92,
  },
];

/**
 * เขียน PACKAGE_LINEUP ลงตาราง packages แบบ upsert ตาม code — รันซ้ำกี่ครั้งก็ได้ผลเท่าเดิม (idempotent)
 * แตะเฉพาะตาราง packages: ไม่ลบแถว ไม่เปลี่ยน id ของแถวเดิม (คำสั่งซื้อ/license ที่อ้างอยู่ไม่กระทบ)
 * คำสั่งซื้อที่สร้างไว้แล้วเก็บยอดของตัวเอง (orders.amount_thb) จึงไม่เปลี่ยนตามราคาใหม่
 * แต่อายุ license อ่านจากแพ็กเกจตอนเปิด — คำสั่งซื้อที่ยังไม่ได้เปิด license จะได้อายุตามค่าปัจจุบันของแพ็กเกจ
 */
export async function applyPackageLineup(db: ReturnType<typeof getDb> = getDb()): Promise<number> {
  await db.transaction(async (tx) => {
    for (const row of PACKAGE_LINEUP) {
      const shared = {
        nameTh: row.nameTh,
        description: row.description,
        durationDays: row.durationDays,
        bonusDays: row.bonusDays,
        isActive: row.isActive,
        sortOrder: row.sortOrder,
        maxAccounts: 1,
        ...(row.priceThb !== undefined ? { priceThb: row.priceThb } : {}),
      };
      await tx
        .insert(schema.packages)
        .values({ code: row.code, ...shared })
        .onConflictDoUpdate({ target: schema.packages.code, set: shared });
    }
  });
  return PACKAGE_LINEUP.length;
}
