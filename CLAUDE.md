# CME OI SYSTEM — เว็บขายและจัดการ license (Handoff สำหรับ Claude Code)

เอกสารนี้สรุปบริบท requirement และการตัดสินใจทั้งหมดจากการคุยกับลูกค้า (8–16 พ.ย. 2569)
เอกสาร requirement ฉบับเต็ม (แก้ไขได้): https://claude.ai/artifact/CB4Pn6SPBkkGjMMVYBVvkT

## 1. บริบทโปรเจกต์

- ผู้ว่าจ้าง: อ.ธวัช ไชยศิริ (Tawat Chaisiri) ผู้พัฒนา "CME OI SYSTEM" — indicator/EA วิเคราะห์ทองคำ (XAUUSD) บน MetaTrader 5 (ชื่อภายใน AJTawat OI System Pro V.3.2) ดึง Open Interest / Option Flow / Volume / COT จาก CME Group มาแสดงบนกราฟ
- งานของเรา: **เว็บไซต์ + ระบบสมาชิก + ระบบ license + หลังบ้านแอดมิน + SEO** ภาษาไทย
- **นอกขอบเขต (ห้ามแตะ):** โค้ด indicator/MQL5, เซิร์ฟเวอร์ดึงข้อมูล CME, ข้อมูลตลาดใน Firebase (`CME_Data/GOLD`, `fxssi`, `fxssi_web`), เนื้อหาวิเคราะห์เทรด
- ขายแพ็กเกจ license: Monthly / 6 Months / Yearly / Lifetime (ราคายังไม่ยืนยัน — แสดง "สอบถามราคา") + เงื่อนไขพิเศษสำหรับลูกค้าที่เปิดบัญชีผ่าน IB ของผู้ว่าจ้าง (กติการอยืนยัน)
- การส่งมอบโปรแกรม (เป้าหมาย): หลัง license เปิด ระบบส่ง **อีเมลลิงก์ดาวน์โหลด** (ไม่แนบไฟล์) + ดาวน์โหลดซ้ำได้ใน Member Area
  — **ยังไม่ได้ทำทั้งคู่** ตอนนี้หน้าเว็บบอกลูกค้าให้รับไฟล์จากทีมงานทาง LINE (ห้ามเขียน copy ว่าส่งทางอีเมลจนกว่าจะทำจริง)
- เว็บ reference ที่ลูกค้าชอบ: kuytrade.com (ขายสมาชิก + บอทบน MT5, ไม่ได้เทรดในเว็บ)

## 2. โค้ดที่มีอยู่แล้ว (repo `cme-oi-web`, ส่งมอบ 9 พ.ย.)

Stack: **Next.js 16 (App Router, TS, Tailwind v4) + Drizzle ORM + PostgreSQL** · Node 20+ · vitest
ไม่แยก backend — ฝั่ง server ใช้ route handlers / server actions ของ Next (รันบน Node.js) ฐานข้อมูลแนะนำ Neon (Singapore)

```
src/
  app/            หน้าแรก, pricing, install, about, faq, legal/{terms,privacy,refund,risk}
                  register, login, account, admin  ← โครง UI + ข้อมูล demo, ปุ่ม disabled
                  api/license-file/route.ts        ← endpoint สำรอง (จะเลิกใช้ เปลี่ยนเป็น Firebase)
  components/     ui.tsx, site-header, site-footer, ladder (ตาราง Option Flow ใน hero), form, legal-page
  content/site.ts ← ข้อความทั้งเว็บรวมที่เดียว (แก้ copy ที่นี่)
  db/schema.ts    users, mt5_accounts, packages, orders, licenses,
                  license_file_publications (เก็บทุกเวอร์ชันของ string ไว้ rollback), download_assets, audit_logs
  lib/license-file.ts     ← หัวใจของระบบ: format/parse/validate/diff (round-trip กับข้อมูลจริงได้เป๊ะ)
  lib/license-publish.ts  ← collectActiveEntries → buildLicenseFile → storage.put → บันทึกประวัติ + rollback
  lib/license-storage.ts  ← interface LicenseStorage { put(content): Promise<url> } มี LocalFileStorage + FirebaseRtdbStorage
  lib/firebase-rtdb.ts    ← เขียน/อ่าน Firebase RTDB ผ่าน REST + service account พร้อมด่านกันพลาด (เทสด้วย fetch ปลอม ยังไม่ได้ลองกับ Firebase จริง)
  lib/license-storage-config.ts ← กติกา LICENSE_STORAGE (ผิด/หาย = ไม่ให้บริการ) + targetsLiveLicenseList
  lib/payment/            ← PaymentProvider (ตอนนี้มีแต่ mock) + markOrderPaid (จุดเดียวที่ตั้ง "ชำระแล้ว"; webhook ในอนาคตเรียกตัวนี้) + ด่านของ mock
  lib/license/            ← เปิด license อัตโนมัติ (activation, 1 คำสั่งซื้อเปิดครั้งเดียวด้วย license_activations) + เผยแพร่แบบเรียงคิว (publish-sync)
                            + สถานะที่ลูกค้าเห็น (published-state, activation-block) + ล้างข้อมูล mock (mock-purge)
  lib/purchase/, lib/auth/ ← คำสั่งซื้อ/บัญชี MT5/โบรกเกอร์พาร์ตเนอร์ · สมาชิก/session
drizzle/0000_init.sql     ← migration พร้อมรัน · scripts/seed.ts ← แพ็กเกจตั้งต้น
public/images/            ← สื่อการตลาดลูกค้า (webp, ตัดแถบ title bar MT5 ที่มีเลขบัญชีออกแล้ว)
```

คำสั่ง: `npm run dev` / `npm test` / `npm run test:db` / `npm run test:e2e` / `npm run build` / `db:generate` / `db:migrate` / `db:seed`
/ `license:publish` (เขียนรายชื่อไปปลายทาง — งานซ่อมและ cron รายวัน) / `license:purge-mock` (ล้างข้อมูลการชำระเงินจำลองก่อนเปิดระบบจริง)

## 3. ข้อเท็จจริงที่คอนเฟิร์มแล้ว — ระบบ license (สำคัญที่สุด)

**ที่เก็บจริง (เห็นกับตา 16 พ.ย.):** Firebase Realtime Database โปรเจกต์ `cme-oi-system-dashborad`
(สะกด dashborad จริงๆ — อย่า "แก้" เป็น dashboard), region `asia-southeast1`, แพ็กเกจฟรี Spark
URL: `https://cme-oi-system-dashborad-default-rtdb.asia-southeast1.firebasedatabase.app`
Path: **`CME_Data/Customer Data/Data`** (มีเว้นวรรค → REST ต้อง encode `CME_Data/Customer%20Data/Data.json`)

ค่าใน path นั้นเป็น **string ก้อนเดียว** รูปแบบ:

```
id34442017.2099.12.29,id26763436.2100.12.30,id24676562.2028.01.01,id97058698.9999.01.01,...
```

กติกา format (implement + เทสไว้แล้วใน `src/lib/license-file.ts`):
- รายการ = `id` + เลขบัญชี MT5 (ตัวเลขล้วน) + `.` + `YYYY.MM.DD` วันหมดอายุ, คั่นด้วย `,` ไม่มีช่องว่าง/บรรทัดใหม่
- Lifetime: ข้อมูลเดิมมีปน `2099.12.29` / `2100.12.30` / `9999.01.01` — ระบบอ่านได้ทุกแบบ, รายการใหม่ใช้ `9999-01-01` (ปี ≥ 2099 ถือเป็น lifetime)
- **ลูกค้ายืนยัน: บอททำงานก็ต่อเมื่อเลขบัญชีอยู่ในรายการและยังไม่หมดอายุ** — ข้อมูลนี้คือสวิตช์ของบอทลูกค้าทุกคน พังคอมมาเดียว = ลูกค้าหลุดทั้งระบบ

**วิธีเชื่อม (ตัดสินใจแล้ว):** เว็บเขียน string ทั้งก้อนทับที่ path นี้ผ่าน service account → ไม่ต้องแก้ indicator เลย ไม่ต้องมี endpoint ของตัวเอง
- ห้าม append ตรงๆ — ทุกครั้ง rebuild ทั้งก้อนจาก licenses ที่ active ใน PostgreSQL → validate → เขียนทับ → เก็บสำเนาใน `license_file_publications`
- ก่อนแตะข้อมูลจริง: import string ปัจจุบันเข้า DB (`parseLicenseFile` ใช้ได้เลย) และทดสอบกับบอทจริง ≥ 1 บัญชี
- เขียนเฉพาะ path `Customer Data` เท่านั้น — path อื่นในฐานเดียวกันเป็นข้อมูลตลาดที่บอทใช้
- ค่าเริ่มต้นของโค้ดเขียน path ทดสอบ `CME_Data/Customer Data/Data_test` จนกว่าจะตั้ง `FIREBASE_LICENSE_PATH`

## 4. Flow ลูกค้าปลายทาง

(เปลี่ยนตามเจ้าของงาน 16 พ.ย.: อัตโนมัติทั้งเส้น **ไม่มีขั้นแอดมินอนุมัติ**)
เลือกแพ็กเกจ → สมัครสมาชิกเว็บ (อีเมล+รหัสผ่านเว็บ) → สร้างคำสั่งซื้อ → **ชำระด้วยบัตรเครดิต/เดบิต** (ยังไม่ได้เลือก gateway: ตอนนี้เป็น
"จำลองการชำระเงิน (โหมดทดสอบ)" ไม่มีช่องกรอกข้อมูลบัตร) → **เลือกโบรกเกอร์พาร์ตเนอร์ 1 ใน 6** (`src/content/brokers.ts`) แล้วไปเปิดบัญชีเทรดเอง
(โบรกเกอร์ไม่แจ้งกลับ) → กลับมา**กรอกเลขบัญชี MT5** ของคำสั่งซื้อนั้น (หรือเลือกบัญชีที่ลงทะเบียนไว้แล้ว) → เมื่อคำสั่งซื้อ "ชำระแล้ว" และ "มีบัญชี MT5" ครบทั้งคู่
(อย่างไหนเกิดทีหลังก็ได้) **ระบบเปิด/ต่อ license เองและเผยแพร่รายชื่อทันที** → ลูกค้ารับไฟล์จากทีมงานทาง LINE (ยังไม่มีอีเมล/หน้าดาวน์โหลด) → ติดตั้งใน MT5
(ต้อง Allow WebRequest URL ของ Firebase) → ใช้งาน/ต่ออายุ

- โอนเงิน + แนบสลิป (รอบก่อน) ยังอยู่ในโค้ด แต่ซ่อนจากลูกค้า (`PAYMENT_BANK_TRANSFER_ENABLED`) และไม่มีขั้นยืนยันสลิป — อย่าสร้างขั้นแอดมินอนุมัติกลับมาโดยไม่ถามเจ้าของงาน
- ข้อมูลบัตรต้องไม่ผ่านและไม่ถูกเก็บในระบบเรา (hosted checkout ของ gateway + webhook เรียก `markOrderPaid`)
- ไม่มีอะไรตรวจ IB: บันทึกแค่โบรกเกอร์ที่ลูกค้าเลือก (`partner_broker_code`), `ib_status` เป็น `unverified`

การออกแบบที่ตกลงแล้ว:
- ล็อกอินเว็บด้วยอีเมล ไม่ใช่เลขบัญชี MT5 (เลขบัญชีไม่ใช่ความลับ ใช้เป็น credential ไม่ได้) — 1 user มีหลายบัญชี MT5 ได้
- **ห้ามขอ/เก็บรหัสผ่าน MT5 เด็ดขาด** เก็บแค่เลขบัญชี + broker server
- ช่องกรอกเลขบัญชี: ตัวเลขล้วน, ให้ยืนยันซ้ำ/โชว์ทวนก่อน submit, กันเลขซ้ำกับ license คนอื่น (กรอกผิด = บอทไม่ทำงาน)
- ยังไม่มีบัญชีโบรกเกอร์ → มีลิงก์ "เปิดบัญชีกับพาร์ตเนอร์" (ลิงก์ IB ของลูกค้า) แล้วค่อยกลับมากรอกเลขเอง (โบรกเกอร์ไม่ส่งเลขกลับมาอัตโนมัติ; แอดมินยืนยัน IB ผ่าน `ib_status`)
- ต่ออายุก่อนหมด: นับต่อจากวันหมดเดิม (`computeNewExpiry` มีแล้ว)

## 5. งานถัดไปตามลำดับ

1. ~~FirebaseRtdbStorage~~ — เขียนแล้ว (16 พ.ย.) รอ service account key เพื่อลองกับ path ทดสอบจริง
2. ~~Auth (อีเมล+รหัสผ่าน)~~ — ทำแล้ว (Google/LINE login ทีหลัง; role admin มีแล้ว หน้าแอดมินยังเป็นโครง)
3. ~~สั่งซื้อ → ชำระด้วยบัตร (mock) → เลือกโบรกเกอร์ → กรอกเลข MT5 → เปิด license อัตโนมัติ + เผยแพร่~~ — ทำแล้ว (ไม่มีขั้นอนุมัติ)
4. **payment gateway จริง** (Opn/2C2P/GB Prime Pay/Stripe — รอเจ้าของงานเลือก): implement `PaymentProvider.createCheckout` + route webhook
   (ตรวจลายเซ็น + ยอด/สกุลเงินเทียบ `orders.amount_thb`) → `markOrderPaid(orderId, provider, providerRef)`
5. สคริปต์ import รายชื่อปัจจุบันจาก Firebase เข้า `licenses` (source=`import`) — **ต้องเสร็จก่อน publish ลง path จริง**
6. Cron รายวัน `npm run license:publish -- --if-changed` (ตัด expired ออกจากรายชื่อ) — **ต้องมีก่อนเปิดระบบจริง** ไม่เช่นนั้นรายที่หมดอายุสะสมจน
   ด่าน `FIREBASE_MAX_REMOVED_ENTRIES` ปฏิเสธทุกการเผยแพร่; แจ้งเตือน 7/3/1 วันก่อนหมดทำทีหลังได้
7. อีเมล (แนะนำ Resend) + ลิงก์ดาวน์โหลด (signed URL จาก `download_assets`) + หน้าดาวน์โหลดใน Member Area
8. หน้าแอดมินจริง (คำสั่งซื้อที่ชำระแล้วแต่เปิดไม่ได้, ระงับ/ย้าย license, เปลี่ยนเลขบัญชี), LINE OA, คูปอง/ใบเสร็จ

ก่อนชี้ `FIREBASE_LICENSE_PATH` ไปรายชื่อจริง ให้ทำตาม README หัวข้อ "ก่อนเปิดระบบจริง" ครบทุกข้อ (import รายชื่อเดิม,
ฐานข้อมูลใหม่หรือ `license:purge-mock`, ห้ามใช้ `DATABASE_URL` ร่วมกับระบบที่เปิด mock, cron รายวัน, แจ้งเตือน `license_file.publish_failed`)

## 6. Env ที่ใช้ (ดู .env.example)

- `DATABASE_URL` (PostgreSQL — Neon/Supabase)
- `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_LINE_URL`, `NEXT_PUBLIC_PROVIDER_NAME`, `NEXT_PUBLIC_LICENSE_HOST`
- `LICENSE_STORAGE=local|firebase`, `LICENSE_LOCAL_DIR`, `LICENSE_FILE_NAME`
  (`LICENSE_STORAGE` ต้องตั้งเองเสมอนอก `npm run dev`/เทส — ไม่ตั้งหรือพิมพ์ผิด = เซิร์ฟเวอร์ไม่ให้บริการ/สคริปต์ไม่ทำงาน ไม่ถอยไป local)
- `FIREBASE_DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT_JSON` (JSON หรือ path), `FIREBASE_LICENSE_PATH`, `FIREBASE_MAX_REMOVED_ENTRIES`
- `PAYMENT_PROVIDER` (เว้นว่าง = ยังไม่เปิดรับชำระ, `mock` = จำลอง), `PAYMENT_MOCK_ALLOW_IN_PRODUCTION` (ต้องเป็น `true` ตรงตัวเมื่อ NODE_ENV
  ไม่ใช่ development/test; mock ถูกปฏิเสธเสมอเมื่อชี้รายชื่อ license จริง), `PAYMENT_BANK_TRANSFER_ENABLED` (ค่าเริ่มต้นปิด)
- `NEXT_PUBLIC_LINE_URL` ต้องเป็น https และตั้งก่อน build (ไม่ตั้ง = ข้อความ "ติดต่อทาง LINE" ไม่มีลิงก์); ไม่มี `NEXT_PUBLIC_IB_URL` แล้ว

## 7. รอจากลูกค้า (อย่า hardcode เดาเอง)

- Service account key ของ Firebase (ขอแล้ว รอส่ง) + ภาพแท็บ Rules (เช็คว่าไม่เปิด write สาธารณะ)
- ความถี่ที่ indicator อ่านรายชื่อ และพฤติกรรมเมื่ออ่านไม่ได้ชั่วคราว
- ราคาแพ็กเกจ, จำนวนบัญชีต่อ license, นโยบายเปลี่ยนเลขบัญชี/คืนเงิน
- กติกา IB (ฟรีหรือลดราคา เช็คจากไหน; รายชื่อโบรกเกอร์ 6 เจ้าได้แล้ว อยู่ใน `src/content/brokers.ts` — รอยืนยันชื่อที่ใช้แสดง), ลิงก์ LINE OA, ชื่อบริษัทในหน้ากฎหมาย, ไฟล์ .ex5 + คู่มือจริง, จำนวน/รายชื่อลูกค้าเดิม

## 8. กฎเหล็ก

- ห้ามเก็บรหัสผ่าน MT5, เลขบัตร, ข้อมูลเกินจำเป็น (PDPA; มีหน้า privacy ร่างแล้ว)
- ห้ามมีคำการันตีกำไร / win rate / "รวยแน่นอน" ในทุก copy — มีคำเตือนความเสี่ยงอยู่แล้ว อย่าลบ
- ทุกการเขียน Firebase ต้อง validate ก่อน + เก็บเวอร์ชันใน `license_file_publications` + มี rollback — อย่าลดขั้นตอนนี้
- การชำระเงินจำลอง (mock) ต้องไม่มีทางกลายเป็น license ในรายชื่อจริง: อย่าถอดด่านใน `payment/config.ts`, `license/activation.ts`, `license/publish-sync.ts`
- ข้อมูลบัตร (เลขบัตร/วันหมดอายุ/CVV) ห้ามผ่านหรือถูกเก็บในระบบเรา — หน้า/ฟอร์มของเราห้ามมีช่องกรอกข้อมูลบัตร
- หลังเปิดระบบ แก้รายชื่อผ่านหน้าแอดมินเท่านั้น (บอกลูกค้าห้ามแก้มือใน Firebase Console)
- ทุกบัญชีบริการ (โดเมน, hosting, gateway, Firebase) เป็นชื่อลูกค้า
- commit ด้วยข้อความภาษาไทยสั้นๆ ได้ สไตล์เดิมใน git log
