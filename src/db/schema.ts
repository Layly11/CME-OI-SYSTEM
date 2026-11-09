/**
 * โครงสร้างฐานข้อมูลของ CME OI SYSTEM web (Drizzle ORM + PostgreSQL)
 *
 * หลักการสำคัญ
 * - ไม่เก็บรหัสผ่าน MT5 ของลูกค้าเด็ดขาด เก็บเฉพาะเลขบัญชี + Broker Server
 * - license ผูกกับ "บัญชี MT5" ไม่ใช่ผูกกับ user โดยตรง เพราะ indicator เช็คจากเลขบัญชี
 * - ทุกครั้งที่เผยแพร่ไฟล์ license จะเก็บสำเนาไว้ใน license_file_publications เพื่อย้อนกลับได้
 */
import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
]);

export const orderStatus = pgEnum("order_status", [
  "pending_payment", // สร้างคำสั่งซื้อแล้ว ยังไม่จ่าย
  "awaiting_review", // ลูกค้าอัปโหลดสลิปแล้ว รอแอดมินตรวจ
  "paid", // ยืนยันการชำระเงินแล้ว
  "rejected", // สลิปไม่ถูกต้อง / ยอดไม่ตรง
  "cancelled",
  "refunded",
]);

export const paymentMethod = pgEnum("payment_method", [
  "bank_transfer",
  "promptpay",
  "card",
]);

export const licenseStatus = pgEnum("license_status", [
  "pending", // รอตรวจการชำระเงิน/IB
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

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"), // null ได้ถ้าล็อกอินผ่าน Google/LINE
  name: text("name"),
  phone: text("phone"),
  lineId: text("line_id"),
  role: userRole("role").notNull().default("customer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mt5Accounts = pgTable(
  "mt5_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountNumber: text("account_number").notNull(), // เช่น 766232 (เก็บเป็น text กันเลขนำหน้าด้วย 0)
    brokerServer: text("broker_server").notNull(), // เช่น InterStellarFinancial-Server
    label: text("label"), // ชื่อเล่นที่ลูกค้าตั้งเอง
    ibStatus: ibStatus("ib_status").notNull().default("unverified"),
    ibVerifiedAt: timestamp("ib_verified_at", { withTimezone: true }),
    ibVerifiedBy: uuid("ib_verified_by").references(() => users.id),
    ibNote: text("ib_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mt5_accounts_number_server_idx").on(t.accountNumber, t.brokerServer),
  ],
);

export const packages = pgTable("packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: packageCode("code").notNull().unique(),
  nameTh: text("name_th").notNull(),
  description: text("description"),
  durationDays: integer("duration_days"), // null = ตลอดชีพ
  priceThb: integer("price_thb"), // null = ยังไม่กำหนดราคา (แสดง "สอบถามราคา")
  maxAccounts: integer("max_accounts").notNull().default(1), // จำนวนบัญชี MT5 ต่อ 1 license
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  packageId: uuid("package_id")
    .notNull()
    .references(() => packages.id),
  mt5AccountId: uuid("mt5_account_id").references(() => mt5Accounts.id),
  amountThb: integer("amount_thb").notNull(),
  status: orderStatus("status").notNull().default("pending_payment"),
  paymentMethod: paymentMethod("payment_method"),
  slipUrl: text("slip_url"), // สลิปโอนเงินที่ลูกค้าอัปโหลด (เก็บใน private storage)
  customerNote: text("customer_note"),
  adminNote: text("admin_note"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const licenses = pgTable("licenses", {
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
});

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
export type Mt5Account = typeof mt5Accounts.$inferSelect;
export type Package = typeof packages.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type License = typeof licenses.$inferSelect;
export type LicenseFilePublication = typeof licenseFilePublications.$inferSelect;
export type DownloadAsset = typeof downloadAssets.$inferSelect;
