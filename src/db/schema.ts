/**
 * โครงสร้างฐานข้อมูลของ CME OI SYSTEM web (Drizzle ORM + PostgreSQL)
 *
 * หลักการสำคัญ
 * - ไม่เก็บรหัสผ่าน MT5 ของลูกค้าเด็ดขาด เก็บเฉพาะเลขบัญชี + Broker Server
 * - license ผูกกับ "บัญชี MT5" ไม่ใช่ผูกกับ user โดยตรง เพราะ indicator เช็คจากเลขบัญชี
 * - ทุกครั้งที่เผยแพร่ไฟล์ license จะเก็บสำเนาไว้ใน license_file_publications เพื่อย้อนกลับได้
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["customer", "admin"]);

export const packageCode = pgEnum("package_code", [
  "monthly",
  "six_months",
  "yearly",
  "lifetime",
  "ib", // สำหรับลูกค้าที่เปิดบัญชีผ่าน IB ของผู้ว่าจ้าง (เงื่อนไขรอยืนยัน)
  // เพิ่ม 18 พ.ย. 2569 (ต่อท้ายเสมอ — ALTER TYPE ... ADD VALUE): รายการที่ขายจริงดู PACKAGE_LINEUP ใน src/lib/purchase/package-lineup.ts
  "three_months",
  "free_referral", // ฟรี 1 เดือน เมื่อชวนเพื่อนสมัครสมาชิก 1 คน — ราคา 0 และรับได้ผ่านเงื่อนไขใน src/lib/purchase/referral.ts เท่านั้น
]);

export const orderStatus = pgEnum("order_status", [
  "pending_payment", // สร้างคำสั่งซื้อแล้ว ยังไม่จ่าย
  // ลูกค้าอัปโหลดสลิปแล้ว — เกิดได้เฉพาะเมื่อเปิดโอนเงิน (PAYMENT_BANK_TRANSFER_ENABLED=true) และรอบนี้ยังไม่มีขั้นตอนยืนยันสลิป
  "awaiting_review",
  // ชำระเงินแล้ว — ตั้งโดย markOrderPaid() เท่านั้น (src/lib/payment/mark-paid.ts) ไม่มีขั้นแอดมินอนุมัติ
  // หลังจากนี้ status ไม่เปลี่ยนอีก ขั้นถัดไป (เลือกโบรกเกอร์ → กรอกเลข MT5 → เปิด license) ดูที่ orderStep()
  "paid",
  "rejected", // สลิปไม่ถูกต้อง / ยอดไม่ตรง (ข้อมูลเดิมจากขั้นตอนโอนเงิน — ชำระด้วยบัตรต่อได้)
  "cancelled",
  "refunded",
]);

export const paymentMethod = pgEnum("payment_method", [
  "bank_transfer",
  "promptpay",
  "card",
]);

export const licenseStatus = pgEnum("license_status", [
  "pending", // ข้อมูลเดิม/สำรอง — ขั้นตอนเปิด license อัตโนมัติไม่สร้างสถานะนี้ (สร้างเป็น active ทันที)
  "active",
  "expired",
  "suspended",
]);

export const licenseSource = pgEnum("license_source", [
  "web", // ซื้อผ่านเว็บ
  "ib", // ได้สิทธิ์จากการเปิดบัญชีผ่าน IB
  "admin", // แอดมินเพิ่มให้เอง (ทดลองใช้, โปรโมชัน)
  "import", // นำเข้าจากไฟล์ license เดิม
]);

export const ibStatus = pgEnum("ib_status", [
  "unverified",
  "verified",
  "not_under_ib",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(), // เก็บตัวพิมพ์เล็กเสมอ (ดู normalizeEmail)
    passwordHash: text("password_hash"), // null ได้ถ้าล็อกอินผ่าน Google/LINE
    name: text("name"),
    phone: text("phone"),
    lineId: text("line_id"),
    role: userRole("role").notNull().default("customer"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    /**
     * รหัสชวนเพื่อนของผู้ใช้ (ลิงก์ /register?ref=CODE) — ฐานข้อมูลสุ่มให้เองทุกแถว: เลขฐานสิบหกตัวพิมพ์ใหญ่ 10 ตัว (40 บิต)
     * จาก gen_random_uuid() ผู้ใช้เดิมได้รหัสตอน migrate (ADD COLUMN ... DEFAULT ที่เป็น volatile ถูกคำนวณแยกทุกแถว)
     * ไม่ใช่ความลับ: รู้รหัสของคนอื่นทำได้แค่สมัครสมาชิกใต้คนนั้น
     */
    referralCode: text("referral_code")
      .notNull()
      .unique()
      .default(sql`upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))`),
    /** ผู้ที่ชวนมาสมัคร — ตั้งได้ครั้งเดียวตอนสร้างแถว (createUser) ไม่มีโค้ดส่วนใดแก้ค่านี้ภายหลัง */
    referredByUserId: uuid("referred_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("users_email_lowercase", sql`${t.email} = lower(${t.email})`),
    check("users_not_self_referred", sql`${t.referredByUserId} is null or ${t.referredByUserId} <> ${t.id}`),
    index("users_referred_by_idx").on(t.referredByUserId),
  ],
);

/** session ล็อกอินเว็บ — เก็บเฉพาะ SHA-256 ของ token (ตัว token จริงอยู่ใน cookie ของผู้ใช้เท่านั้น) */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** ตัวนับ rate limit แบบ fixed window — key เป็น hash ของอีเมล/IP ไม่เก็บค่าดิบ */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const mt5Accounts = pgTable(
  "mt5_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountNumber: text("account_number").notNull(), // เช่น 766232 (เก็บเป็น text เพราะยาวได้ถึง 20 หลัก; ห้ามมี 0 นำหน้า)
    brokerServer: text("broker_server").notNull(), // เช่น InterStellarFinancial-Server
    label: text("label"), // ชื่อเล่นที่ลูกค้าตั้งเอง
    ibStatus: ibStatus("ib_status").notNull().default("unverified"),
    ibVerifiedAt: timestamp("ib_verified_at", { withTimezone: true }),
    ibVerifiedBy: uuid("ib_verified_by").references(() => users.id),
    ibNote: text("ib_note"),
    /**
     * โบรกเกอร์พาร์ตเนอร์ที่ลูกค้าเลือกตอนสั่งซื้อ — code จาก src/content/brokers.ts (ตรวจในแอป ไม่มี CHECK)
     * เป็นแค่สิ่งที่ลูกค้าเลือก ไม่ได้พิสูจน์ว่าเปิดบัญชีใต้ IB จริง (ib_status ยังเป็น unverified ไม่มีอะไรตรวจ IB ในรอบนี้)
     */
    partnerBrokerCode: text("partner_broker_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mt5_accounts_number_server_idx").on(t.accountNumber, t.brokerServer),
    // รายชื่อ license ใน Firebase อ้างด้วยเลขบัญชีอย่างเดียว → เลขเดียวกันมีเจ้าของได้คนเดียวทั้งระบบ
    uniqueIndex("mt5_accounts_number_idx").on(t.accountNumber),
    index("mt5_accounts_user_idx").on(t.userId),
    // ตัวเลขล้วน ไม่ขึ้นต้นด้วย 0: login ของ MT5 เป็นจำนวนเต็ม "0123456" กับ "123456" คือบัญชีเดียวกัน
    // ถ้ายอมให้มีเลข 0 นำหน้า unique index ด้านบนจะกันเจ้าของซ้ำไม่ได้ (ทุกทางเขียน รวม import/สคริปต์แอดมิน ต้องตัด 0 นำหน้าก่อน)
    // ความยาวขั้นต่ำยังเป็น 1 หลัก (ฟอร์มเว็บบังคับ 4 หลัก) จนกว่าจะรู้เลขที่สั้นที่สุดในรายชื่อเดิม
    check("mt5_accounts_number_digits", sql`${t.accountNumber} ~ '^[1-9][0-9]{0,19}$'`),
  ],
);

export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: packageCode("code").notNull().unique(),
    nameTh: text("name_th").notNull(),
    description: text("description"), // แพ็กเกจฟรี: เงื่อนไขการรับสิทธิ์ที่แสดงให้ลูกค้า
    durationDays: integer("duration_days"), // อายุหลัก (ไม่รวมวันแถม) — null = ตลอดชีพ
    /** วันแถม: license ที่เปิดได้อายุ duration_days + bonus_days (ดู packageTotalDays) — ไม่มีผลกับแพ็กเกจตลอดชีพ */
    bonusDays: integer("bonus_days").notNull().default(0),
    priceThb: integer("price_thb"), // null = ยังไม่กำหนดราคา (แสดง "สอบถามราคา")
    maxAccounts: integer("max_accounts").notNull().default(1), // จำนวนบัญชี MT5 ต่อ 1 license
    isActive: boolean("is_active").notNull().default(true), // false = เลิกขาย (ห้ามลบแถว: คำสั่งซื้อ/license เดิมอ้างอยู่)
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [check("packages_bonus_days_nonnegative", sql`${t.bonusDays} >= 0`)],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** เลขที่คำสั่งซื้อที่ลูกค้าเห็น (ORD-001001) */
    orderNo: integer("order_no").notNull().generatedAlwaysAsIdentity({ startWith: 1001 }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    mt5AccountId: uuid("mt5_account_id").references(() => mt5Accounts.id), // null ได้: ซื้อก่อน แล้วค่อยเพิ่มเลขบัญชี
    amountThb: integer("amount_thb").notNull(),
    status: orderStatus("status").notNull().default("pending_payment"),
    paymentMethod: paymentMethod("payment_method"),
    slipUrl: text("slip_url"), // ไม่ได้ใช้แล้ว — ใช้ slip_key แทน (คงคอลัมน์ไว้ ยังไม่ลบ)
    slipKey: text("slip_key"), // key ใน private storage (ดู src/lib/slip-storage.ts) ไม่ใช่ URL สาธารณะ
    slipMime: text("slip_mime"),
    slipSizeBytes: integer("slip_size_bytes"),
    slipUploadedAt: timestamp("slip_uploaded_at", { withTimezone: true }),
    customerNote: text("customer_note"),
    // 3 คอลัมน์ตรวจสลิปด้านล่างเป็นของขั้นตอนโอนเงินเดิม — การชำระด้วยบัตร (markOrderPaid) ไม่แตะ ปล่อยเป็น null
    adminNote: text("admin_note"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /**
     * ผู้ให้บริการรับชำระ (เช่น "mock") + เลขอ้างอิงรายการของผู้ให้บริการ — ไม่เก็บข้อมูลบัตรใดๆ
     * "referral" = แพ็กเกจฟรีจากการชวนเพื่อน (ยอด 0 บาท ไม่ผ่านขั้นชำระเงิน) เป็นคำสั่งซื้อจริง ไม่ใช่การชำระเงินจำลอง
     */
    paymentProvider: text("payment_provider"),
    paymentRef: text("payment_ref"),
    /** โบรกเกอร์ที่ลูกค้าเลือกหลังชำระเงิน (code จาก src/content/brokers.ts) — คัดลอกไปที่ mt5_accounts ตอนกรอกเลขบัญชี */
    partnerBrokerCode: text("partner_broker_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_order_no_idx").on(t.orderNo),
    index("orders_user_idx").on(t.userId),
    index("orders_status_idx").on(t.status),
    // 1 บัญชี MT5 มีคำสั่งซื้อที่ยังค้างได้ครั้งละ 1 รายการ
    uniqueIndex("orders_open_per_account_idx")
      .on(t.mt5AccountId)
      .where(sql`${t.status} in ('pending_payment','awaiting_review')`),
    // รายการชำระเงิน 1 รายการของผู้ให้บริการ ใช้กับคำสั่งซื้อได้รายการเดียว (webhook ส่งซ้ำ/ยิงผิดคำสั่งซื้อ)
    uniqueIndex("orders_payment_ref_idx")
      .on(t.paymentProvider, t.paymentRef)
      .where(sql`${t.paymentRef} is not null`),
  ],
);

export const licenses = pgTable(
  "licenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    mt5AccountId: uuid("mt5_account_id")
      .notNull()
      .references(() => mt5Accounts.id),
    packageId: uuid("package_id").references(() => packages.id),
    orderId: uuid("order_id").references(() => orders.id),
    startsAt: date("starts_at").notNull(),
    expiresAt: date("expires_at").notNull(), // ตลอดชีพ = 9999-01-01 (ตามรูปแบบไฟล์เดิม)
    status: licenseStatus("status").notNull().default("pending"),
    source: licenseSource("source").notNull().default("web"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 1 บัญชี MT5 มี license ที่ active ได้แถวเดียว — การต่ออายุแก้แถวเดิม ไม่สร้างแถว active ซ้อน
    uniqueIndex("licenses_active_per_account_idx")
      .on(t.mt5AccountId)
      .where(sql`${t.status} = 'active'`),
  ],
);

/**
 * สมุดบันทึก "คำสั่งซื้อนี้เปิด/ต่อ license ไปแล้ว" — 1 คำสั่งซื้อมีได้แถวเดียว (unique ที่ order_id)
 * ฐานข้อมูลจึงเป็นตัวกันการเปิดซ้ำ: กดซ้ำ ลองใหม่ หรือสองคำขอพร้อมกัน ไม่มีทางได้ license สองใบหรือต่ออายุสองรอบ
 * duration_days / previous / new คือค่าที่ใช้จริงตอนเปิด (อายุแพ็กเกจอ่านตอนเปิด ไม่ได้เก็บไว้ที่คำสั่งซื้อ)
 * แถวถูกลบได้ทางเดียว: `npm run license:purge-mock` ลบแถวของคำสั่งซื้อที่ชำระแบบจำลอง (หลังคัดลอกลง audit_logs และยกเลิกคำสั่งซื้อนั้นแล้ว)
 * การเผยแพร่ไปรายชื่อจริงดูตารางนี้เพื่อหา license ที่มาจากคำสั่งซื้อจำลอง (payment_provider = 'mock')
 */
export const licenseActivations = pgTable(
  "license_activations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id)
      .unique(),
    licenseId: uuid("license_id")
      .notNull()
      .references(() => licenses.id),
    mt5AccountId: uuid("mt5_account_id")
      .notNull()
      .references(() => mt5Accounts.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    durationDays: integer("duration_days"), // จำนวนวันที่ให้จริง = อายุหลัก + วันแถม ณ ตอนเปิด; null = ตลอดชีพ
    previousExpiresAt: date("previous_expires_at"),
    newExpiresAt: date("new_expires_at").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("license_activations_license_idx").on(t.licenseId)],
);

/**
 * สิทธิ์แพ็กเกจฟรีจากการชวนเพื่อน (packages.code = 'free_referral') — ฐานข้อมูลเป็นตัวบังคับ "ครั้งเดียว":
 * - user_id unique        ผู้ใช้ 1 คนถือสิทธิ์ได้ครั้งละ 1 แถว = รับได้ครั้งเดียว
 * - mt5_account_id unique  บัญชี MT5 1 บัญชีรับแพ็กเกจฟรีได้ครั้งเดียว (ตั้งค่าตอนเปิด license พร้อม activated_at)
 * แถวถูกสร้างพร้อมคำสั่งซื้อ (createOrder) และถูกลบทางเดียว: ลูกค้ายกเลิกคำสั่งซื้อนั้น "ก่อน" เปิด license (cancelOrder)
 * = คืนสิทธิ์ให้รับใหม่ได้ เมื่อเปิด license แล้ว (activated_at ไม่ว่าง) แถวอยู่ถาวร = ใช้สิทธิ์แล้ว
 */
export const referralClaims = pgTable(
  "referral_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .unique(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id)
      .unique(),
    mt5AccountId: uuid("mt5_account_id")
      .references(() => mt5Accounts.id)
      .unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
  },
  (t) => [
    // บัญชี MT5 ถูกบันทึกเฉพาะตอนเปิด license (แถวบัญชีที่มี license ลบไม่ได้ จึงไม่มีทางปล่อยเลขแล้วรับซ้ำ)
    check("referral_claims_activation_consistent", sql`(${t.mt5AccountId} is null) = (${t.activatedAt} is null)`),
  ],
);

/** สำเนาไฟล์ license ทุกครั้งที่เผยแพร่ ใช้ย้อนกลับได้ถ้าไฟล์ใหม่มีปัญหา */
export const licenseFilePublications = pgTable("license_file_publications", {
  id: uuid("id").primaryKey().defaultRandom(),
  content: text("content").notNull(),
  entryCount: integer("entry_count").notNull(),
  checksum: text("checksum").notNull(), // sha256 ของ content
  storageUrl: text("storage_url"), // URL ที่ indicator อ่าน (CDN/object storage)
  publishedBy: uuid("published_by").references(() => users.id),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
});

/** ไฟล์ที่ให้ลูกค้าดาวน์โหลด (indicator, คู่มือ, set file) */
export const downloadAssets = pgTable("download_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  fileUrl: text("file_url").notNull(), // private storage; เว็บออก signed URL ให้ตอนดาวน์โหลด
  notes: text("notes"),
  isCurrent: boolean("is_current").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(), // เช่น license.activate, order.approve, license_file.publish
  entity: text("entity"),
  entityId: text("entity_id"),
  data: jsonb("data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Mt5Account = typeof mt5Accounts.$inferSelect;
export type Package = typeof packages.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type License = typeof licenses.$inferSelect;
export type LicenseActivation = typeof licenseActivations.$inferSelect;
export type ReferralClaim = typeof referralClaims.$inferSelect;
export type LicenseFilePublication = typeof licenseFilePublications.$inferSelect;
export type DownloadAsset = typeof downloadAssets.$inferSelect;
