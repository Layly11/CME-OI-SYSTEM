# CME OI SYSTEM — เว็บไซต์และระบบจัดการ license

เว็บขายและจัดการ license ของ indicator "CME OI SYSTEM" บน MetaTrader 5
สร้างด้วย Next.js 16 (App Router, TypeScript, Tailwind v4) + PostgreSQL ผ่าน Drizzle ORM

เอกสาร requirement ฉบับเต็ม: https://claude.ai/artifact/CB4Pn6SPBkkGjMMVYBVvkT

## สถานะ (9 พ.ย. 2569)

ทำแล้ว

- หน้าบ้านครบ: หน้าแรก, แพ็กเกจ, วิธีติดตั้ง, เกี่ยวกับ, FAQ, ข้อตกลง/ความเป็นส่วนตัว/คืนเงิน/ความเสี่ยง (ฉบับร่าง)
- โครงสร้างฐานข้อมูล (`src/db/schema.ts`) + migration SQL (`drizzle/0000_init.sql`) + seed แพ็กเกจ
- โมดูลไฟล์ license (`src/lib/license-file.ts`) สร้าง/อ่าน/ตรวจ/เปรียบเทียบไฟล์รูปแบบเดิมของลูกค้า พร้อมเทส 18 ข้อ
- service เผยแพร่ไฟล์ license + เก็บประวัติ + ย้อนกลับ (`src/lib/license-publish.ts`)
- endpoint สำรอง `GET /api/license-file`
- โครงหน้า สมัคร / ล็อกอิน / บัญชีสมาชิก / แอดมิน (ข้อมูลตัวอย่าง ปุ่มปิดไว้)

ยังไม่ทำ (รอคำตอบลูกค้าหรือเป็นเฟสถัดไป)

- ระบบล็อกอินจริง (แนะนำ Auth.js: อีเมล/รหัสผ่าน + Google + LINE)
- server actions: สมัคร, สร้างคำสั่งซื้อ, อัปโหลดสลิป, แอดมินอนุมัติ → เปิด license → เผยแพร่ไฟล์ → ส่งอีเมล
- ส่งอีเมล (แนะนำ Resend) และ LINE OA
- บัตรเครดิตผ่าน payment gateway (Opn / 2C2P / Stripe)
- ตรวจ IB อัตโนมัติ
- อัปโหลดไฟล์ license ไป object storage จริง (R2/S3) — ตอนนี้มีแค่ local
- ราคาแพ็กเกจจริง, ลิงก์ LINE, ชื่อบริษัท, โดเมนของ license URL

## เริ่มพัฒนาในเครื่อง

ต้องมี Node.js 20 ขึ้นไป

```bash
npm install
cp .env.example .env.local      # แล้วเติมค่า
npm run dev                     # http://localhost:3000
npm test                        # เทสโมดูล license file
```

ฐานข้อมูล (ใช้ Neon หรือ Supabase ฟรี หรือ PostgreSQL ในเครื่อง)

```bash
npm run db:migrate              # สร้างตารางจาก drizzle/*.sql
npm run db:seed                 # ใส่แพ็กเกจตั้งต้น
npm run db:studio               # เปิด GUI ดูข้อมูล
```

แก้ schema แล้วให้รัน `npm run db:generate` เพื่อสร้างไฟล์ migration ใหม่ จากนั้น `npm run db:migrate`

## โครงสร้างโปรเจกต์

```
src/
  app/                 หน้าเว็บ (App Router)
    page.tsx           หน้าแรก
    pricing/ install/ about/ faq/ legal/*   หน้าบ้าน
    register/ login/ account/ admin/       โครงระบบสมาชิก/แอดมิน
    api/license-file/  endpoint สำรองให้ indicator อ่านไฟล์
  components/          header, footer, ladder (ตาราง Option Flow ใน hero), ฟอร์ม
  content/site.ts      ข้อความทั้งเว็บ แก้คำได้ที่นี่ที่เดียว
  db/                  schema + การเชื่อมต่อ (Drizzle)
  lib/
    license-file.ts    รูปแบบไฟล์ license (หัวใจของระบบ)
    license-publish.ts รวบรวม license ที่ active → สร้างไฟล์ → เผยแพร่ → เก็บประวัติ
    license-storage.ts ที่เก็บไฟล์ (local / s3)
drizzle/               migration SQL
scripts/seed.ts        ข้อมูลตั้งต้น
public/images/         สื่อการตลาดของลูกค้า (แปลงเป็น WebP และตัดแถบชื่อหน้าต่าง MT5 ออกแล้ว)
```

## รูปแบบไฟล์ license (สำคัญ)

indicator ของลูกค้าอ่านไฟล์ข้อความรูปแบบ

```
id766232.2027.07.02,id97086397.2027.07.01,id26763436.2100.12.30
```

- `id` + เลขบัญชี MT5 + `.` + ปี.เดือน.วัน ที่หมดอายุ คั่นด้วยคอมมา ไม่มีช่องว่าง
- ตลอดชีพใช้ `9999.01.01` (ไฟล์เดิมมี `2099.12.29` / `2100.12.30` ด้วย ระบบอ่านได้ทุกแบบ)
- บอทจะทำงานก็ต่อเมื่อเลขบัญชีอยู่ในไฟล์และยังไม่หมดอายุ (ลูกค้ายืนยัน)

ข้อควรระวังก่อนใช้จริง

1. ยังไม่เห็นโค้ดฝั่ง indicator — ต้องเอาไฟล์ที่ระบบสร้าง (`buildLicenseFile`) ไปทดสอบกับบอทจริงอย่างน้อย 1 บัญชี
2. ถาม URL ที่ indicator อ่านอยู่ตอนนี้ และความถี่ที่อ่าน ถ้าเปลี่ยนโดเมน ลูกค้าทุกคนต้องแก้ค่า WebRequest ใน MT5
3. URL ของไฟล์นี้ต้องไม่ล่ม — production ควรวางบน object storage + CDN แยกจากเว็บ ไม่ใช่ `/api/license-file`
4. นำเข้าลูกค้าเดิมจากไฟล์ปัจจุบันก่อนสลับระบบ (`parseLicenseFile` ใช้ได้เลย)

## Deploy

แนะนำ Vercel (เว็บ) + Neon (PostgreSQL) ทั้งคู่มีแพ็กเกจฟรี

1. push โค้ดขึ้น GitHub แล้ว import โปรเจกต์ใน Vercel
2. ตั้ง environment variables ตาม `.env.example`
3. รัน migration กับฐานข้อมูล production: `DATABASE_URL=... npm run db:migrate && npm run db:seed`
4. ตั้งโดเมนของลูกค้า และโดเมนแยกสำหรับไฟล์ license

ทุกบัญชี (Vercel, Neon, โดเมน, Google/Meta) ควรเปิดในชื่อของลูกค้า
