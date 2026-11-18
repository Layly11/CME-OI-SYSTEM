import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { REFERRAL_PAYMENT_PROVIDER } from "@/lib/payment/config";
import { markOrderPaidInTx } from "@/lib/payment/mark-paid-tx";
import { referralPaymentRef } from "@/lib/payment/provider";
import type { PurchaseReason } from "./messages";
import { isPartnerBrokerCode } from "./brokers";
import { removeMt5AccountInTx, type Tx } from "./mt5-release";
import { isFreeReferralPackage, packageDisplayName, packagePeriodText, packageTotalDays } from "./packages";
import {
  type FreeClaimBlock,
  findFreeClaimByUser,
  freeClaimBlockInTx,
  hasAccountReceivedFree,
  hasEnoughReferrals,
} from "./referral";
import {
  canAttachAccount,
  canOrderOnline,
  canUploadSlip,
  MAX_MT5_ACCOUNTS_PER_USER,
  MAX_OPEN_ORDERS_PER_USER,
  OPEN_ORDER_STATUSES,
  type OrderStatus,
  type SlipPaymentMethod,
} from "./order-rules";

/**
 * ชั้นฐานข้อมูลของขั้นตอนสั่งซื้อ
 * - ทุกฟังก์ชันรับ userId ตรงๆ และกรองด้วย userId เสมอ (ผู้เรียกต้องได้ userId จาก session ฝั่ง server)
 * - คืน DTO เฉพาะช่องที่หน้าเว็บใช้ และคืน reason code สำหรับกรณีที่คาดไว้ ไม่ throw
 * - ราคาอ่านจากตาราง packages เท่านั้น ไม่รับราคาจากฝั่ง client
 */

type Fail<R extends PurchaseReason> = { ok: false; reason: R };
type Db = ReturnType<typeof getDb>;

const OPEN = [...OPEN_ORDER_STATUSES];
const ATTACHABLE: OrderStatus[] = ["pending_payment", "awaiting_review", "rejected", "paid"];

export type PackageDto = {
  id: string;
  code: string;
  nameTh: string;
  /** แพ็กเกจฟรีจากการชวนเพื่อน: เงื่อนไขการรับสิทธิ์ที่แสดงให้ลูกค้า */
  description: string | null;
  /** อายุหลัก ไม่รวมวันแถม (null = ตลอดชีพ) */
  durationDays: number | null;
  bonusDays: number;
  /** อายุ license ที่ได้จริง = อายุหลัก + วันแถม (null = ตลอดชีพ) */
  totalDays: number | null;
  priceThb: number | null;
  /** สั่งผ่านเว็บได้ (ยังไม่ดูสิทธิ์ของผู้ใช้ — แพ็กเกจฟรีต้องผ่านเงื่อนไขชวนเพื่อนอีกชั้นใน createOrder) */
  orderable: boolean;
};

export type LicenseDto = {
  status: "pending" | "active" | "expired" | "suspended";
  expiresAt: string; // YYYY-MM-DD
  /** ชื่อที่แสดงของแพ็กเกจล่าสุดของ license รวมวันแถม เช่น "3 เดือน แถม 15 วัน" (packageDisplayName) */
  packageName: string | null;
};

export type Mt5AccountDto = {
  id: string;
  accountNumber: string;
  brokerServer: string;
  label: string | null;
  /** โบรกเกอร์พาร์ตเนอร์ที่ลูกค้าเลือกตอนสั่งซื้อ (code จาก src/content/brokers.ts) — ไม่ได้ยืนยันว่าอยู่ใต้ IB จริง */
  partnerBrokerCode: string | null;
  license: LicenseDto | null;
};

export type OrderDto = {
  id: string;
  orderNo: number;
  status: OrderStatus;
  amountThb: number;
  /**
   * ชื่อที่แสดงของแพ็กเกจ รวมวันแถม เช่น "3 เดือน แถม 15 วัน" (packageDisplayName) — ชื่อเดียวกับที่หน้าแพ็กเกจ/ฟอร์มสั่งซื้อใช้
   * อ่านจากแถวแพ็กเกจ "ปัจจุบัน" เหมือนอายุ license ที่จะได้ (ยังไม่มีการเก็บสำเนาไว้ที่คำสั่งซื้อ — ดูข้อจำกัดใน activation.ts)
   */
  packageName: string;
  /** ระยะเวลาที่แพ็กเกจให้ เช่น "90 วัน + แถม 15 วัน (รวม 105 วัน)" (packagePeriodText) — ค่าปัจจุบันของแพ็กเกจเช่นกัน */
  packagePeriod: string;
  /** code ของแพ็กเกจ — "free_referral" = แพ็กเกจฟรีจากการชวนเพื่อน (ไม่มีขั้นชำระเงิน) */
  packageCode: string;
  createdAt: Date;
  mt5AccountId: string | null;
  accountNumber: string | null;
  brokerServer: string | null;
  paymentMethod: "bank_transfer" | "promptpay" | "card" | null;
  adminNote: string | null;
  hasSlip: boolean;
  slipUploadedAt: Date | null;
  /** โบรกเกอร์ที่เลือกหลังชำระเงิน (null = ยังไม่เลือก) */
  partnerBrokerCode: string | null;
  paidAt: Date | null;
  /**
   * ผู้ให้บริการที่บันทึกการชำระ (เช่น "mock") — ใช้ฝั่งเซิร์ฟเวอร์ตัดสินว่าคำสั่งซื้อจำลองเปิด license ได้หรือไม่ ไม่ต้องแสดงให้ลูกค้า
   * "referral" = รับสิทธิ์แพ็กเกจฟรีจากการชวนเพื่อน (ไม่ใช่การชำระเงิน)
   */
  paymentProvider: string | null;
  /**
   * license ที่คำสั่งซื้อนี้เปิด/ต่ออายุให้ (null = ยังไม่ได้เปิด) — สถานะและวันหมดอายุ "ปัจจุบัน" ของ license นั้น
   * หมายเหตุ: นี่คือสถานะในฐานข้อมูล จะถึงมือบอทจริงเมื่อรายการอยู่ในรายชื่อที่เผยแพร่แล้ว (ดู src/lib/license/published-state.ts)
   */
  activatedLicense: { status: LicenseDto["status"]; expiresAt: string } | null;
};

async function audit(tx: Db | Tx, actorUserId: string, action: string, entity: string, entityId: string, data?: object) {
  // เก็บเฉพาะ id และค่าที่ไม่อ่อนไหว — ไม่ใส่อีเมล ชื่อไฟล์ของผู้ใช้ หรือเนื้อหาสลิป
  await tx.insert(schema.auditLogs).values({ actorUserId, action, entity, entityId, data: data ?? null });
}

/**
 * ล็อกแถว user เพื่อให้การเช็คเพดาน (จำนวนบัญชี/คำสั่งซื้อค้าง) และการรับ/คืนสิทธิ์แพ็กเกจฟรีของ user เดียวกันทำทีละรายการ
 *
 * ใช้ FOR NO KEY UPDATE (ไม่ใช่ FOR UPDATE): ยังกันกันเองระหว่างผู้เรียก lockUser ได้เหมือนเดิม
 * แต่ไม่ขวาง FOR KEY SHARE ที่ PostgreSQL ขอเองตอน INSERT แถวที่มี foreign key ชี้มาที่ users (เช่น licenses.user_id ในขั้นเปิด license)
 * FOR UPDATE ตรงนี้เคยทำให้ deadlock (40P01) จริง: ยกเลิกคำสั่งซื้อฟรีพร้อมกับการเปิด license ของคำสั่งซื้อเดียวกัน
 * (ฝั่งนี้ถือ users รอ orders, ขั้นเปิด license ถือ orders รอ KEY SHARE ของ users) — ดูเทส "ไม่ deadlock" ใน referral.itest.ts
 */
async function lockUser(tx: Tx, userId: string) {
  await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).for("no key update");
}

export async function listActivePackages(): Promise<PackageDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.packages)
    .where(eq(schema.packages.isActive, true))
    .orderBy(asc(schema.packages.sortOrder));
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    nameTh: p.nameTh,
    description: p.description,
    durationDays: p.durationDays,
    bonusDays: p.bonusDays,
    totalDays: packageTotalDays(p),
    priceThb: p.priceThb,
    orderable: canOrderOnline(p),
  }));
}

export async function listMt5AccountsWithLicense(userId: string): Promise<Mt5AccountDto[]> {
  const db = getDb();
  const accounts = await db
    .select({
      id: schema.mt5Accounts.id,
      accountNumber: schema.mt5Accounts.accountNumber,
      brokerServer: schema.mt5Accounts.brokerServer,
      label: schema.mt5Accounts.label,
      partnerBrokerCode: schema.mt5Accounts.partnerBrokerCode,
    })
    .from(schema.mt5Accounts)
    .where(eq(schema.mt5Accounts.userId, userId))
    .orderBy(asc(schema.mt5Accounts.createdAt));
  if (accounts.length === 0) return [];

  const licenses = await db
    .select({
      mt5AccountId: schema.licenses.mt5AccountId,
      status: schema.licenses.status,
      expiresAt: schema.licenses.expiresAt,
      packageNameTh: schema.packages.nameTh,
      packageDurationDays: schema.packages.durationDays,
      packageBonusDays: schema.packages.bonusDays,
    })
    .from(schema.licenses)
    .leftJoin(schema.packages, eq(schema.licenses.packageId, schema.packages.id))
    .where(
      inArray(
        schema.licenses.mt5AccountId,
        accounts.map((a) => a.id),
      ),
    )
    // ใช้งานอยู่มาก่อน แล้วเรียงตามวันหมดอายุล่าสุด — แถวแรกของแต่ละบัญชีคือ license ที่แสดง
    .orderBy(sql`(${schema.licenses.status} = 'active') desc`, desc(schema.licenses.expiresAt));

  const latest = new Map<string, LicenseDto>();
  for (const l of licenses) {
    if (!latest.has(l.mt5AccountId)) {
      latest.set(l.mt5AccountId, {
        status: l.status,
        expiresAt: l.expiresAt,
        // license ที่ไม่มีแพ็กเกจ (เช่นรายชื่อเดิมที่ import มา) → null
        packageName:
          l.packageNameTh === null
            ? null
            : packageDisplayName({
                nameTh: l.packageNameTh,
                durationDays: l.packageDurationDays,
                bonusDays: l.packageBonusDays ?? 0,
              }),
      });
    }
  }
  return accounts.map((a) => ({ ...a, license: latest.get(a.id) ?? null }));
}

const orderColumns = {
  id: schema.orders.id,
  orderNo: schema.orders.orderNo,
  status: schema.orders.status,
  amountThb: schema.orders.amountThb,
  packageNameTh: schema.packages.nameTh,
  packageDurationDays: schema.packages.durationDays,
  packageBonusDays: schema.packages.bonusDays,
  packageCode: schema.packages.code,
  createdAt: schema.orders.createdAt,
  mt5AccountId: schema.orders.mt5AccountId,
  accountNumber: schema.mt5Accounts.accountNumber,
  brokerServer: schema.mt5Accounts.brokerServer,
  paymentMethod: schema.orders.paymentMethod,
  adminNote: schema.orders.adminNote,
  slipKey: schema.orders.slipKey,
  slipUploadedAt: schema.orders.slipUploadedAt,
  partnerBrokerCode: schema.orders.partnerBrokerCode,
  paidAt: schema.orders.paidAt,
  paymentProvider: schema.orders.paymentProvider,
  activatedLicenseStatus: schema.licenses.status,
  activatedLicenseExpiresAt: schema.licenses.expiresAt,
};

type OrderRow = Omit<OrderDto, "hasSlip" | "activatedLicense" | "packageName" | "packagePeriod"> & {
  slipKey: string | null;
  packageNameTh: string;
  packageDurationDays: number | null;
  packageBonusDays: number;
  activatedLicenseStatus: LicenseDto["status"] | null;
  activatedLicenseExpiresAt: string | null;
};

function toOrderDto({
  slipKey,
  packageNameTh,
  packageDurationDays,
  packageBonusDays,
  activatedLicenseStatus,
  activatedLicenseExpiresAt,
  ...row
}: OrderRow): OrderDto {
  const pkg = { nameTh: packageNameTh, durationDays: packageDurationDays, bonusDays: packageBonusDays };
  return {
    ...row,
    packageName: packageDisplayName(pkg),
    packagePeriod: packagePeriodText(pkg),
    // slipKey ไม่ออกไปถึงหน้าเว็บ — ส่งแค่ว่ามีสลิปหรือไม่
    hasSlip: slipKey !== null,
    activatedLicense:
      activatedLicenseStatus !== null && activatedLicenseExpiresAt !== null
        ? { status: activatedLicenseStatus, expiresAt: activatedLicenseExpiresAt }
        : null,
  };
}

function selectOrders() {
  return getDb()
    .select(orderColumns)
    .from(schema.orders)
    .innerJoin(schema.packages, eq(schema.orders.packageId, schema.packages.id))
    .leftJoin(schema.mt5Accounts, eq(schema.orders.mt5AccountId, schema.mt5Accounts.id))
    // license_activations.order_id เป็น unique → คำสั่งซื้อละไม่เกิน 1 แถว ไม่ทำให้รายการซ้ำ
    .leftJoin(schema.licenseActivations, eq(schema.licenseActivations.orderId, schema.orders.id))
    .leftJoin(schema.licenses, eq(schema.licenses.id, schema.licenseActivations.licenseId));
}

export async function listOrders(userId: string): Promise<OrderDto[]> {
  const rows = await selectOrders().where(eq(schema.orders.userId, userId)).orderBy(desc(schema.orders.createdAt));
  return rows.map(toOrderDto);
}

/** คำสั่งซื้อของ user นี้เท่านั้น — ของคนอื่นหรือไม่มี คืน null เหมือนกัน */
export async function getOrder(userId: string, orderId: string): Promise<OrderDto | null> {
  const rows = await selectOrders()
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId)))
    .limit(1);
  return rows[0] ? toOrderDto(rows[0]) : null;
}

/**
 * เลขบัญชีนี้ว่างหรือไม่ (ขั้นทวนก่อนบันทึก)
 * คำตอบ "taken" บอกได้ว่าเลขไหนเป็นของลูกค้าในระบบ จึงบันทึก audit ทุกครั้ง (อ้าง id ของแถวที่ชน ไม่เก็บเลขบัญชี)
 * และผู้เรียก (Server Action) ต้องจำกัดจำนวนครั้งต่อผู้ใช้ด้วย RATE_LIMITS.mt5Check
 *
 * ข้อจำกัดที่ยังเปิดอยู่ (รับทราบแล้ว ยังไม่แก้): ตรวจเฉพาะตาราง mt5_accounts — เลขของลูกค้าเดิมที่มี license อยู่แต่ใน Firebase
 * ยังไม่ถูก import จึงยังไม่ถูกกัน (CLAUDE.md ข้อ 5) ต้อง import ให้เสร็จก่อนเปิดรับสมัครจริง
 * เพราะตอนนี้เลขที่ผ่านด่านนี้และชำระเงินแล้วจะได้ license ทันทีโดยไม่มีแอดมินตรวจ
 */
export async function checkAccountNumber(
  userId: string,
  accountNumber: string,
): Promise<"free" | "duplicate_own" | "taken"> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.mt5Accounts.id, userId: schema.mt5Accounts.userId })
    .from(schema.mt5Accounts)
    .where(eq(schema.mt5Accounts.accountNumber, accountNumber))
    .limit(1);
  if (!rows[0]) return "free";
  if (rows[0].userId === userId) return "duplicate_own";
  await audit(db, userId, "mt5_account.taken_attempt", "mt5_account", rows[0].id, { step: "check" });
  return "taken";
}

export type InsertMt5AccountResult =
  | { ok: true; id: string; attached: boolean }
  | Fail<"taken" | "duplicate_own" | "too_many_accounts">;

/** เลขซ้ำตอนบันทึก: ของตัวเอง → duplicate_own, ของคนอื่น → taken พร้อม audit (เหมือน checkAccountNumber) */
async function takenOrOwn(
  tx: Tx,
  userId: string,
  existing: { id: string; userId: string },
): Promise<Fail<"taken" | "duplicate_own">> {
  if (existing.userId === userId) return { ok: false, reason: "duplicate_own" };
  await audit(tx, userId, "mt5_account.taken_attempt", "mt5_account", existing.id, { step: "confirm" });
  return { ok: false, reason: "taken" };
}

/**
 * หมายเหตุ: หน้าเว็บไม่เรียกฟังก์ชันนี้แล้ว — ลูกค้ากรอกเลขบัญชีได้เฉพาะผ่าน submitAccountForOrder
 * (ต้องมีคำสั่งซื้อที่ชำระแล้วและเลือกโบรกเกอร์แล้ว กันการจองเลขบัญชีโดยไม่ซื้อ)
 * คงไว้สำหรับเทสและสคริปต์ import รายชื่อเดิมในอนาคต
 *
 * เพิ่มบัญชี MT5 ให้ user — เลขบัญชีซ้ำกับของใครก็ตามในระบบจะไม่ถูกสร้าง
 * ถ้าส่ง attachToOrderId มาด้วย และคำสั่งซื้อนั้นเป็นของ user และยังผูกบัญชีได้ จะผูกให้ใน transaction เดียวกัน
 * (ผูกไม่ได้ไม่ทำให้การเพิ่มบัญชีล้ม — คืน attached: false)
 */
export async function insertMt5Account(
  userId: string,
  input: { accountNumber: string; brokerServer: string; label?: string },
  attachToOrderId?: string | null,
): Promise<InsertMt5AccountResult> {
  return getDb().transaction(async (tx): Promise<InsertMt5AccountResult> => {
    await lockUser(tx, userId);

    const [{ n }] = await tx
      .select({ n: count() })
      .from(schema.mt5Accounts)
      .where(eq(schema.mt5Accounts.userId, userId));
    if (n >= MAX_MT5_ACCOUNTS_PER_USER) {
      // เลขที่ซ้ำอยู่แล้วให้บอกว่าซ้ำก่อน (ตรงกับสิ่งที่ผู้ใช้ต้องแก้) ไม่ใช่บอกว่าเต็ม
      const [dup] = await tx
        .select({ id: schema.mt5Accounts.id, userId: schema.mt5Accounts.userId })
        .from(schema.mt5Accounts)
        .where(eq(schema.mt5Accounts.accountNumber, input.accountNumber))
        .limit(1);
      if (dup) return takenOrOwn(tx, userId, dup);
      return { ok: false, reason: "too_many_accounts" };
    }

    const inserted = await tx
      .insert(schema.mt5Accounts)
      .values({
        userId,
        accountNumber: input.accountNumber,
        brokerServer: input.brokerServer,
        label: input.label ?? null,
      })
      // เลขซ้ำ (unique index ตัวใดก็ตาม) → ไม่ insert และไม่ทำให้ transaction ล้ม
      .onConflictDoNothing()
      .returning({ id: schema.mt5Accounts.id });

    if (!inserted[0]) {
      const [existing] = await tx
        .select({ id: schema.mt5Accounts.id, userId: schema.mt5Accounts.userId })
        .from(schema.mt5Accounts)
        .where(eq(schema.mt5Accounts.accountNumber, input.accountNumber))
        .limit(1);
      if (!existing) return { ok: false, reason: "taken" };
      return takenOrOwn(tx, userId, existing);
    }

    const id = inserted[0].id;
    let attached = false;
    if (attachToOrderId) {
      const updated = await tx
        .update(schema.orders)
        .set({ mt5AccountId: id })
        .where(
          and(
            eq(schema.orders.id, attachToOrderId),
            eq(schema.orders.userId, userId),
            isNull(schema.orders.mt5AccountId),
            inArray(schema.orders.status, ATTACHABLE),
          ),
        )
        .returning({ id: schema.orders.id });
      attached = updated.length > 0;
      if (attached) await audit(tx, userId, "order.attach_account", "order", attachToOrderId, { mt5AccountId: id });
    }
    await audit(tx, userId, "mt5_account.create", "mt5_account", id);
    return { ok: true, id, attached };
  });
}

export type ChooseBrokerResult =
  | { ok: true }
  | Fail<"order_not_found" | "order_not_paid" | "order_has_account" | "broker_invalid">;

/**
 * บันทึกโบรกเกอร์พาร์ตเนอร์ที่ลูกค้าเลือกหลังชำระเงิน — เลือกใหม่ทับได้จนกว่าจะกรอกเลขบัญชี MT5
 * เป็นแค่ "ลูกค้าเลือกอะไร": โบรกเกอร์ไม่แจ้งกลับมา และรอบนี้ไม่มีอะไรตรวจว่าเปิดบัญชีใต้ IB จริง
 */
export async function chooseBrokerForOrder(
  userId: string,
  orderId: string,
  brokerCode: string,
): Promise<ChooseBrokerResult> {
  if (!isPartnerBrokerCode(brokerCode)) return { ok: false, reason: "broker_invalid" };
  return getDb().transaction(async (tx): Promise<ChooseBrokerResult> => {
    const [order] = await tx
      .select({ id: schema.orders.id, status: schema.orders.status, mt5AccountId: schema.orders.mt5AccountId })
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId)))
      .for("update");
    if (!order) return { ok: false, reason: "order_not_found" };
    if (order.status !== "paid") return { ok: false, reason: "order_not_paid" };
    if (order.mt5AccountId !== null) return { ok: false, reason: "order_has_account" };

    await tx.update(schema.orders).set({ partnerBrokerCode: brokerCode }).where(eq(schema.orders.id, order.id));
    await audit(tx, userId, "order.choose_broker", "order", order.id, { brokerCode });
    return { ok: true };
  });
}

export type SubmitAccountResult =
  | { ok: true; accountId: string }
  | Fail<
      | "order_not_found"
      | "order_not_paid"
      | "order_has_account"
      | "broker_required"
      | "taken"
      | "duplicate_own"
      | "too_many_accounts"
    >;

/**
 * ลูกค้ากรอกเลขบัญชี MT5 ให้คำสั่งซื้อ — ทางเดียวที่หน้าเว็บสร้างบัญชี MT5 ได้
 * ต้องเป็นคำสั่งซื้อของตัวเองที่ชำระแล้ว เลือกโบรกเกอร์แล้ว และยังไม่มีบัญชี
 * ทำทั้งหมดใน transaction เดียว: สร้างบัญชี (คัดลอกโบรกเกอร์จากคำสั่งซื้อ) + ผูกกับคำสั่งซื้อ — ไม่ผ่านข้อใด ไม่มีแถวบัญชีถูกสร้าง
 * ib_status ของบัญชีคงเป็น unverified (ไม่มีอะไรตรวจ IB ในรอบนี้)
 *
 * ฟังก์ชันนี้ไม่เปิด license เอง — ผู้เรียกต้องเรียกขั้นเปิด license หลัง transaction นี้ commit (fulfilOrder ใน src/lib/license/fulfil.ts — ดู actions/purchase.ts)
 *
 * ข้อจำกัดที่รับทราบแล้ว (ยังไม่แก้ — ต้องปิดก่อนเปิดระบบจริง ดู README "ก่อนเปิดระบบจริง" ข้อ 3):
 * สัญญาณ "ใครเป็นเจ้าของเลข" มีแค่ unique index ของ mt5_accounts — ใครกรอกก่อนได้เลขนั้น และคำสั่งซื้อแพ็กเกจฟรีจากการชวนเพื่อน
 * เป็น "ชำระแล้ว" โดยไม่เสียเงิน จึงใช้จองเลขของคนอื่นได้ฟรี (รวมเลขของลูกค้าเดิมที่ยังไม่ถูก import จาก Firebase)
 * เจ้าของจริงจะได้ "taken" และยังไม่มีเครื่องมือคืนเลข: deleteMt5Account / admin:release-mt5 ปฏิเสธบัญชีที่มีแถว license ทุกสถานะ
 */
export async function submitAccountForOrder(
  userId: string,
  orderId: string,
  input: { accountNumber: string; brokerServer: string; label?: string },
): Promise<SubmitAccountResult> {
  return getDb().transaction(async (tx): Promise<SubmitAccountResult> => {
    await lockUser(tx, userId);

    const [order] = await tx
      .select({
        id: schema.orders.id,
        status: schema.orders.status,
        mt5AccountId: schema.orders.mt5AccountId,
        partnerBrokerCode: schema.orders.partnerBrokerCode,
      })
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId)))
      .for("update");
    if (!order) return { ok: false, reason: "order_not_found" };
    if (order.status !== "paid") return { ok: false, reason: "order_not_paid" };
    if (order.mt5AccountId !== null) return { ok: false, reason: "order_has_account" };
    if (order.partnerBrokerCode === null) return { ok: false, reason: "broker_required" };

    const findByNumber = async () => {
      const [row] = await tx
        .select({ id: schema.mt5Accounts.id, userId: schema.mt5Accounts.userId })
        .from(schema.mt5Accounts)
        .where(eq(schema.mt5Accounts.accountNumber, input.accountNumber))
        .limit(1);
      return row ?? null;
    };

    const [{ n }] = await tx
      .select({ n: count() })
      .from(schema.mt5Accounts)
      .where(eq(schema.mt5Accounts.userId, userId));
    if (n >= MAX_MT5_ACCOUNTS_PER_USER) {
      // เลขที่ซ้ำอยู่แล้วให้บอกว่าซ้ำก่อน (ตรงกับสิ่งที่ผู้ใช้ต้องแก้) ไม่ใช่บอกว่าเต็ม
      const dup = await findByNumber();
      if (dup) return takenOrOwn(tx, userId, dup);
      return { ok: false, reason: "too_many_accounts" };
    }

    const inserted = await tx
      .insert(schema.mt5Accounts)
      .values({
        userId,
        accountNumber: input.accountNumber,
        brokerServer: input.brokerServer,
        label: input.label ?? null,
        partnerBrokerCode: order.partnerBrokerCode,
      })
      // เลขซ้ำ (unique index ตัวใดก็ตาม) → ไม่ insert และไม่ทำให้ transaction ล้ม
      .onConflictDoNothing()
      .returning({ id: schema.mt5Accounts.id });
    if (!inserted[0]) {
      const existing = await findByNumber();
      if (!existing) return { ok: false, reason: "taken" };
      return takenOrOwn(tx, userId, existing);
    }

    const accountId = inserted[0].id;
    await tx.update(schema.orders).set({ mt5AccountId: accountId }).where(eq(schema.orders.id, order.id));
    // audit เก็บเฉพาะ id ไม่มีเลขบัญชี
    await audit(tx, userId, "mt5_account.create", "mt5_account", accountId, { orderId: order.id });
    await audit(tx, userId, "order.attach_account", "order", order.id, { mt5AccountId: accountId });
    return { ok: true, accountId };
  });
}

export type CreateOrderResult =
  /**
   * freeClaim: true = แพ็กเกจฟรีจากการชวนเพื่อน — คำสั่งซื้อถูกบันทึกเป็น "ชำระแล้ว" (provider "referral") ใน transaction เดียวกันแล้ว
   * ผู้เรียกต้องเรียก fulfilOrder หลัง commit (เปิด license ทันทีถ้าคำสั่งซื้อมีบัญชี MT5 มาแต่แรก)
   */
  | { ok: true; id: string; existing: false; freeClaim?: true }
  /**
   * ไม่ได้สร้างรายการใหม่ — samePackage บอกว่ารายการเดิมเป็นแพ็กเกจเดียวกับที่เพิ่งเลือกหรือไม่
   * (บัญชีนี้มีคำสั่งซื้อค้างอยู่แล้ว หรือผู้ใช้รับสิทธิ์แพ็กเกจฟรีไว้แล้วแต่ยังเปิด license ไม่เสร็จ)
   */
  | { ok: true; id: string; existing: true; samePackage: boolean }
  | Fail<
      | "package_unavailable"
      | "account_not_found"
      | "too_many_open_orders"
      | "lifetime_active"
      | "license_suspended"
      | "free_referral_required"
      | "free_already_claimed"
      | "free_account_used"
    >;

/** บัญชีนี้มี license ตลอดชีพที่ใช้งานอยู่หรือไม่ (ปี ≥ 2099 = ตลอดชีพ ตรงกับ isLifetimeExpiry) */
async function hasActiveLifetimeLicense(db: Db | Tx, mt5AccountId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.licenses.id })
    .from(schema.licenses)
    .where(
      and(
        eq(schema.licenses.mt5AccountId, mt5AccountId),
        eq(schema.licenses.status, "active"),
        gte(schema.licenses.expiresAt, "2099-01-01"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * บัญชีนี้มี license ที่ถูกระงับหรือไม่ — การเปิด license เป็นอัตโนมัติ ไม่มีแอดมินตรวจ
 * จึงต้องไม่รับเงิน/ไม่ผูกคำสั่งซื้อกับบัญชีที่ถูกระงับ (การชำระเงินต้องไม่ปลดการระงับเอง)
 */
async function hasSuspendedLicense(db: Db | Tx, mt5AccountId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.licenses.id })
    .from(schema.licenses)
    .where(and(eq(schema.licenses.mt5AccountId, mt5AccountId), eq(schema.licenses.status, "suspended")))
    .limit(1);
  return rows.length > 0;
}

/**
 * บัญชี MT5 นี้รับการซื้อ/ต่ออายุอัตโนมัติไม่ได้เพราะอะไร (null = รับได้) — กติกาเดียวกับ createOrder / attach / ขั้นเปิด license
 * ใช้ตรวจซ้ำก่อนพาลูกค้าไปชำระเงิน (สถานะของบัญชีเปลี่ยนได้หลังสร้างคำสั่งซื้อ) และใช้อธิบายคำสั่งซื้อที่ชำระแล้วแต่เปิดไม่ได้
 * ผู้เรียกต้องได้ mt5AccountId จากคำสั่งซื้อที่ตรวจความเป็นเจ้าของแล้ว (getOrder)
 */
export async function getAccountLicenseBlock(mt5AccountId: string): Promise<"license_suspended" | "lifetime_active" | null> {
  const db = getDb();
  if (await hasSuspendedLicense(db, mt5AccountId)) return "license_suspended";
  if (await hasActiveLifetimeLicense(db, mt5AccountId)) return "lifetime_active";
  return null;
}

async function isFreeOrderPackage(db: Db | Tx, packageId: string): Promise<boolean> {
  const [pkg] = await db
    .select({ code: schema.packages.code })
    .from(schema.packages)
    .where(eq(schema.packages.id, packageId))
    .limit(1);
  return pkg !== undefined && isFreeReferralPackage(pkg);
}

/**
 * คำสั่งซื้อแพ็กเกจฟรีที่รับสิทธิ์แล้วและมีบัญชี MT5 แล้ว: กติกาของแพ็กเกจฟรียังผ่านหรือไม่ (null = ผ่าน)
 * อ่านเพื่อแสดงผลเท่านั้น (ไม่ล็อกแถว) — ด่านจริงอยู่ในขั้นเปิด license (activateInTx) ซึ่งใช้ freeClaimBlockInTx ตัวเดียวกัน
 * ผู้เรียกต้องส่งคำสั่งซื้อที่ตรวจความเป็นเจ้าของแล้ว (getOrder / listOrders)
 */
export async function getFreeClaimBlock(order: { id: string; mt5AccountId: string }): Promise<FreeClaimBlock | null> {
  const db = getDb();
  const [row] = await db
    .select({ userId: schema.orders.userId })
    .from(schema.orders)
    .where(eq(schema.orders.id, order.id))
    .limit(1);
  if (!row) return "free_claim_invalid";
  const result = await freeClaimBlockInTx(db, { id: order.id, userId: row.userId }, order.mt5AccountId);
  return result.block;
}

async function findOpenOrderForAccount(
  db: Db | Tx,
  userId: string,
  mt5AccountId: string,
): Promise<{ id: string; packageId: string } | null> {
  const rows = await db
    .select({ id: schema.orders.id, packageId: schema.orders.packageId })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.userId, userId),
        eq(schema.orders.mt5AccountId, mt5AccountId),
        inArray(schema.orders.status, OPEN),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * สร้างคำสั่งซื้อ — ยอดเงินคือราคาในฐานข้อมูล ณ ตอนสั่ง
 * mt5AccountId ไม่ส่งมาก็ได้ (ซื้อก่อน เปิดบัญชีโบรกเกอร์ทีหลัง แล้วค่อยผูกเลขบัญชี)
 * บัญชีที่มีคำสั่งซื้อค้างอยู่แล้ว → คืนคำสั่งซื้อเดิม (existing: true) ไม่สร้างซ้ำ — ผู้เรียกต้องบอกผู้ใช้เสมอ
 * โดยเฉพาะเมื่อ samePackage เป็น false (เลือกแพ็กเกจใหม่ แต่ได้คำสั่งซื้อเดิมของอีกแพ็กเกจ)
 * บัญชีที่มี license ตลอดชีพใช้งานอยู่ → lifetime_active (ไม่มีอะไรให้ต่ออายุ)
 * บัญชีที่มี license ถูกระงับ → license_suspended (ต้องผ่านทีมงาน)
 *
 * แพ็กเกจฟรีจากการชวนเพื่อน (code free_referral, ราคา 0): ไม่มีขั้นชำระเงิน — ตรวจสิทธิ์ที่นี่ (ดูกติกาใน ./referral.ts)
 * แล้วสร้างคำสั่งซื้อ + แถว referral_claims + บันทึก "ชำระแล้ว" ด้วย provider "referral" (markOrderPaidInTx) ใน transaction เดียว
 * - ยังไม่มีเพื่อนสมัคร → free_referral_required, ใช้สิทธิ์ไปแล้ว → free_already_claimed, บัญชีนี้เคยได้ฟรีแล้ว → free_account_used
 * - รับสิทธิ์ไว้แล้วแต่ยังไม่ได้เปิด license (กดซ้ำ / กลับมาใหม่) → คืนคำสั่งซื้อเดิม (existing: true) ไม่สร้างซ้ำ
 * คำขอที่สร้างเอง (ไม่ผ่านฟอร์ม) ผ่านด่านเดียวกันนี้ — หน้าเว็บแค่ปิดตัวเลือกไว้ล่วงหน้า
 */
export async function createOrder(
  userId: string,
  input: { packageId: string; mt5AccountId?: string },
): Promise<CreateOrderResult> {
  try {
    return await getDb().transaction(async (tx): Promise<CreateOrderResult> => {
      await lockUser(tx, userId);

      const [pkg] = await tx.select().from(schema.packages).where(eq(schema.packages.id, input.packageId)).limit(1);
      if (!pkg || !canOrderOnline(pkg) || pkg.priceThb === null) return { ok: false, reason: "package_unavailable" };

      if (input.mt5AccountId) {
        const [account] = await tx
          .select({ id: schema.mt5Accounts.id })
          .from(schema.mt5Accounts)
          .where(and(eq(schema.mt5Accounts.id, input.mt5AccountId), eq(schema.mt5Accounts.userId, userId)))
          .limit(1);
        if (!account) return { ok: false, reason: "account_not_found" };
        if (await hasSuspendedLicense(tx, account.id)) return { ok: false, reason: "license_suspended" };
        if (await hasActiveLifetimeLicense(tx, account.id)) return { ok: false, reason: "lifetime_active" };
        const open = await findOpenOrderForAccount(tx, userId, account.id);
        if (open) return { ok: true, id: open.id, existing: true, samePackage: open.packageId === pkg.id };
      }

      if (isFreeReferralPackage(pkg)) {
        // lockUser ด้านบนทำให้คำขอของผู้ใช้เดียวกันเข้ามาทีละรายการ — กดซ้ำ/สองแท็บจึงเห็นแถวสิทธิ์ของคำขอแรกเสมอ
        // (referral_claims.user_id unique เป็นด่านสุดท้ายของฐานข้อมูล)
        const claim = await findFreeClaimByUser(tx, userId);
        if (claim) {
          if (claim.activated) return { ok: false, reason: "free_already_claimed" };
          return { ok: true, id: claim.orderId, existing: true, samePackage: true };
        }
        if (!(await hasEnoughReferrals(tx, userId))) return { ok: false, reason: "free_referral_required" };
        if (input.mt5AccountId && (await hasAccountReceivedFree(tx, input.mt5AccountId))) {
          return { ok: false, reason: "free_account_used" };
        }

        // ไม่นับเพดานคำสั่งซื้อค้าง: รายการนี้ไม่ค้าง "รอชำระ" (เป็นชำระแล้วใน transaction นี้เลย)
        const [order] = await tx
          .insert(schema.orders)
          .values({ userId, packageId: pkg.id, mt5AccountId: input.mt5AccountId ?? null, amountThb: 0 })
          .returning({ id: schema.orders.id });
        await tx.insert(schema.referralClaims).values({ userId, orderId: order.id });
        await audit(tx, userId, "order.create", "order", order.id, { packageId: pkg.id, amountThb: 0, freeClaim: true });
        const paid = await markOrderPaidInTx(tx, order.id, REFERRAL_PAYMENT_PROVIDER, referralPaymentRef(order.id));
        // เพิ่งสร้างใน transaction นี้เอง จึงต้องบันทึกได้เสมอ — ไม่ได้ = ยกเลิกทั้ง transaction (ไม่มีคำสั่งซื้อฟรีที่ค้างรอชำระ)
        if (!paid.ok) throw new Error("createOrder: บันทึกสิทธิ์แพ็กเกจฟรีไม่สำเร็จ (" + paid.reason + ")");
        return { ok: true, id: order.id, existing: false, freeClaim: true };
      }

      const [{ n }] = await tx
        .select({ n: count() })
        .from(schema.orders)
        .where(and(eq(schema.orders.userId, userId), inArray(schema.orders.status, OPEN)));
      if (n >= MAX_OPEN_ORDERS_PER_USER) return { ok: false, reason: "too_many_open_orders" };

      const [order] = await tx
        .insert(schema.orders)
        .values({
          userId,
          packageId: pkg.id,
          mt5AccountId: input.mt5AccountId ?? null,
          amountThb: pkg.priceThb,
        })
        .returning({ id: schema.orders.id });
      await audit(tx, userId, "order.create", "order", order.id, { packageId: pkg.id, amountThb: pkg.priceThb });
      return { ok: true, id: order.id, existing: false };
    });
  } catch (err) {
    // ชนกับ unique index (สองคำขอพร้อมกัน) → คืนคำสั่งซื้อที่ค้างอยู่ของบัญชีนั้น
    if (input.mt5AccountId && isUniqueViolation(err, "orders_open_per_account_idx")) {
      const open = await findOpenOrderForAccount(getDb(), userId, input.mt5AccountId);
      if (open) return { ok: true, id: open.id, existing: true, samePackage: open.packageId === input.packageId };
    }
    // ด่านสุดท้ายของ "แพ็กเกจฟรีครั้งเดียวต่อผู้ใช้": ฐานข้อมูลปฏิเสธแถวสิทธิ์ที่สอง (transaction นี้ถูกยกเลิกทั้งก้อน)
    if (isUniqueViolation(err, "referral_claims_user_id_unique")) {
      const claim = await findFreeClaimByUser(getDb(), userId);
      if (claim && !claim.activated) return { ok: true, id: claim.orderId, existing: true, samePackage: true };
      return { ok: false, reason: "free_already_claimed" };
    }
    throw err;
  }
}

export type AttachResult =
  | { ok: true }
  | Fail<
      | "order_not_found"
      | "order_not_attachable"
      | "account_not_found"
      | "account_has_open_order"
      | "lifetime_active"
      | "license_suspended"
      | "free_account_used"
    >;

/**
 * ผูกบัญชี MT5 ที่ลูกค้ามีอยู่แล้วเข้ากับคำสั่งซื้อ (ต่ออายุ/ใช้บัญชีเดิม)
 * คำสั่งซื้อแพ็กเกจฟรี: บัญชีที่เคยได้แพ็กเกจฟรีแล้วผูกไม่ได้ (free_account_used) — ขั้นเปิด license ตรวจซ้ำเป็นด่านจริง
 * ไม่เปิด license เอง — ถ้าคำสั่งซื้อชำระแล้ว ผู้เรียกต้องเรียกขั้นเปิด license หลัง commit (fulfilOrder ใน src/lib/license/fulfil.ts — ดู actions/purchase.ts)
 */
export async function attachMt5AccountToOrder(
  userId: string,
  orderId: string,
  mt5AccountId: string,
): Promise<AttachResult> {
  try {
    return await getDb().transaction(async (tx): Promise<AttachResult> => {
      await lockUser(tx, userId);

      const [order] = await tx
        .select({
          id: schema.orders.id,
          status: schema.orders.status,
          mt5AccountId: schema.orders.mt5AccountId,
          packageId: schema.orders.packageId,
        })
        .from(schema.orders)
        .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId)))
        .for("update");
      if (!order) return { ok: false, reason: "order_not_found" };
      if (!canAttachAccount(order)) return { ok: false, reason: "order_not_attachable" };

      const [account] = await tx
        .select({ id: schema.mt5Accounts.id })
        .from(schema.mt5Accounts)
        .where(and(eq(schema.mt5Accounts.id, mt5AccountId), eq(schema.mt5Accounts.userId, userId)))
        .limit(1);
      if (!account) return { ok: false, reason: "account_not_found" };
      if (await hasSuspendedLicense(tx, account.id)) return { ok: false, reason: "license_suspended" };
      if (await hasActiveLifetimeLicense(tx, account.id)) return { ok: false, reason: "lifetime_active" };
      if ((await isFreeOrderPackage(tx, order.packageId)) && (await hasAccountReceivedFree(tx, account.id))) {
        return { ok: false, reason: "free_account_used" };
      }

      if (OPEN.includes(order.status)) {
        const [other] = await tx
          .select({ id: schema.orders.id })
          .from(schema.orders)
          .where(
            and(
              eq(schema.orders.mt5AccountId, mt5AccountId),
              inArray(schema.orders.status, OPEN),
              ne(schema.orders.id, orderId),
            ),
          )
          .limit(1);
        if (other) return { ok: false, reason: "account_has_open_order" };
      }

      await tx.update(schema.orders).set({ mt5AccountId }).where(eq(schema.orders.id, orderId));
      await audit(tx, userId, "order.attach_account", "order", orderId, { mt5AccountId });
      return { ok: true };
    });
  } catch (err) {
    if (isUniqueViolation(err, "orders_open_per_account_idx")) return { ok: false, reason: "account_has_open_order" };
    throw err;
  }
}

export type CancelOrderResult = { ok: true; freeClaimReleased: boolean } | Fail<"order_not_found" | "order_not_cancellable">;

/**
 * ลูกค้ายกเลิกคำสั่งซื้อของตัวเอง
 * - สถานะ pending_payment: เลือกแพ็กเกจผิด หรือมีคำสั่งซื้อค้างที่ไม่ใช้แล้วจนชนเพดาน 5 รายการ
 * - แพ็กเกจฟรีจากการชวนเพื่อนที่รับสิทธิ์แล้ว (paid ด้วย provider "referral") แต่ "ยังไม่ได้เปิด license": ไม่มีเงินเกี่ยวข้อง
 *   ยกเลิกแล้วลบแถว referral_claims = คืนสิทธิ์ให้รับใหม่ได้ (freeClaimReleased) เปิด license แล้วยกเลิกไม่ได้ — สิทธิ์ถูกใช้ไปแล้ว
 * คำสั่งซื้อที่ชำระเงินจริงแล้วยกเลิกเองไม่ได้ (มีเงินเกี่ยวข้อง ต้องผ่านทีมงาน)
 *
 * ล็อกแถวคำสั่งซื้อ (FOR UPDATE) — ขั้นเปิด license ล็อกแถวเดียวกันก่อนทำงาน การยกเลิกกับการเปิดจึงเกิดทีละอย่าง
 * (ฝั่งนี้ล็อก user ก่อนแล้วรอแถวคำสั่งซื้อ ขั้นเปิด license ถือแถวคำสั่งซื้อแล้ว INSERT licenses ซึ่งขอ KEY SHARE ของ user:
 * ไม่เป็นวงเพราะ lockUser ใช้ FOR NO KEY UPDATE — ดูคำอธิบายที่ lockUser)
 */
export async function cancelOrder(userId: string, orderId: string): Promise<CancelOrderResult> {
  return getDb().transaction(async (tx): Promise<CancelOrderResult> => {
    // ลำดับล็อก user → คำสั่งซื้อ (เหมือน createOrder): การรับสิทธิ์ใหม่ของผู้ใช้เดียวกันรอให้การยกเลิกนี้จบก่อน
    await lockUser(tx, userId);
    const [order] = await tx
      .select({ id: schema.orders.id, status: schema.orders.status, paymentProvider: schema.orders.paymentProvider })
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId)))
      .for("update");
    if (!order) return { ok: false, reason: "order_not_found" };

    const freeClaim = order.status === "paid" && order.paymentProvider === REFERRAL_PAYMENT_PROVIDER;
    if (order.status !== "pending_payment" && !freeClaim) return { ok: false, reason: "order_not_cancellable" };
    if (freeClaim) {
      const [activation] = await tx
        .select({ id: schema.licenseActivations.id })
        .from(schema.licenseActivations)
        .where(eq(schema.licenseActivations.orderId, order.id))
        .limit(1);
      if (activation) return { ok: false, reason: "order_not_cancellable" };
    }

    await tx.update(schema.orders).set({ status: "cancelled" }).where(eq(schema.orders.id, order.id));
    // คืนสิทธิ์: ลบได้เฉพาะแถวที่ยังไม่ถูกใช้เปิด license (activated_at ว่าง) — แถวที่ใช้แล้วไม่มีทางถูกลบจากที่นี่
    const released = await tx
      .delete(schema.referralClaims)
      .where(and(eq(schema.referralClaims.orderId, order.id), isNull(schema.referralClaims.activatedAt)))
      .returning({ id: schema.referralClaims.id });
    const freeClaimReleased = released.length > 0;
    await audit(tx, userId, "order.cancel", "order", order.id, freeClaimReleased ? { freeClaimReleased: true } : undefined);
    return { ok: true, freeClaimReleased };
  });
}

export type DeleteMt5AccountResult = { ok: true } | Fail<"account_not_found" | "account_in_use">;

/**
 * ลูกค้าลบบัญชี MT5 ของตัวเอง (กรอกเลขผิด/ไม่ใช้แล้ว) = ปล่อยเลขให้ลงทะเบียนใหม่ได้
 * ได้เฉพาะบัญชีที่ยังไม่มี license และไม่มีคำสั่งซื้อที่ชำระแล้ว/รอตรวจ/คืนเงิน — ดู removeMt5AccountInTx
 * คำสั่งซื้อที่ยังรอชำระของบัญชีนี้ไม่ถูกลบ แค่กลับเป็น "ยังไม่ระบุบัญชี"
 */
export async function deleteMt5Account(userId: string, accountId: string): Promise<DeleteMt5AccountResult> {
  return getDb().transaction(async (tx): Promise<DeleteMt5AccountResult> => {
    await lockUser(tx, userId);
    const [account] = await tx
      .select({ id: schema.mt5Accounts.id })
      .from(schema.mt5Accounts)
      .where(and(eq(schema.mt5Accounts.id, accountId), eq(schema.mt5Accounts.userId, userId)))
      .for("update");
    if (!account) return { ok: false, reason: "account_not_found" };

    const removed = await removeMt5AccountInTx(tx, account.id);
    if (!removed.ok) return removed;
    await audit(tx, userId, "mt5_account.delete", "mt5_account", account.id, { detachedOrders: removed.detachedOrders });
    return { ok: true };
  });
}

export type RecordSlipResult =
  | { ok: true; previousKey: string | null }
  | Fail<"order_not_found" | "slip_not_allowed" | "account_has_open_order">;

/**
 * บันทึกสลิปที่อัปโหลดแล้ว และเปลี่ยนสถานะเป็น awaiting_review
 * ทำได้เฉพาะคำสั่งซื้อของ user เองที่สถานะ pending_payment หรือ rejected (เงื่อนไขอยู่ใน WHERE ของ UPDATE ด้วย)
 */
export async function recordSlip(
  userId: string,
  orderId: string,
  slip: { key: string; mime: string; size: number; paymentMethod: SlipPaymentMethod },
): Promise<RecordSlipResult> {
  try {
    return await getDb().transaction(async (tx): Promise<RecordSlipResult> => {
      const [order] = await tx
        .select({ status: schema.orders.status, slipKey: schema.orders.slipKey })
        .from(schema.orders)
        .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId)))
        .for("update");
      if (!order) return { ok: false, reason: "order_not_found" };
      if (!canUploadSlip(order.status)) return { ok: false, reason: "slip_not_allowed" };

      const updated = await tx
        .update(schema.orders)
        .set({
          slipKey: slip.key,
          slipMime: slip.mime,
          slipSizeBytes: slip.size,
          slipUploadedAt: sql`now()`,
          paymentMethod: slip.paymentMethod,
          status: "awaiting_review",
        })
        .where(
          and(
            eq(schema.orders.id, orderId),
            eq(schema.orders.userId, userId),
            inArray(schema.orders.status, ["pending_payment", "rejected"]),
          ),
        )
        .returning({ id: schema.orders.id });
      if (!updated[0]) return { ok: false, reason: "slip_not_allowed" };

      await audit(tx, userId, "order.slip_upload", "order", orderId, {
        mime: slip.mime,
        size: slip.size,
        paymentMethod: slip.paymentMethod,
      });
      return { ok: true, previousKey: order.slipKey };
    });
  } catch (err) {
    // คำสั่งซื้อที่เคยถูกปฏิเสธกลับมา "ค้าง" อีกครั้ง แต่บัญชีเดียวกันมีคำสั่งซื้อค้างรายการอื่นอยู่แล้ว
    if (isUniqueViolation(err, "orders_open_per_account_idx")) return { ok: false, reason: "account_has_open_order" };
    throw err;
  }
}

/** สลิปของคำสั่งซื้อ — เห็นได้เฉพาะเจ้าของคำสั่งซื้อหรือแอดมิน กรณีอื่นทั้งหมดคืน null */
export async function findSlipForViewer(
  orderId: string,
  viewer: { id: string; role: "customer" | "admin" },
): Promise<{ key: string; mime: string } | null> {
  const [row] = await getDb()
    .select({ userId: schema.orders.userId, slipKey: schema.orders.slipKey, slipMime: schema.orders.slipMime })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);
  if (!row) return null;
  if (row.userId !== viewer.id && viewer.role !== "admin") return null;
  if (!row.slipKey || !row.slipMime) return null;
  return { key: row.slipKey, mime: row.slipMime };
}
