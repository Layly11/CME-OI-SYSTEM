import { and, count, eq, inArray, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ACCOUNT_LOCKING_ORDER_STATUSES } from "./order-rules";

/**
 * ลบบัญชี MT5 ออกจากระบบ = ปล่อยเลขบัญชีให้ลงทะเบียนใหม่ได้
 * ใช้ร่วมกันระหว่างลูกค้าลบบัญชีของตัวเอง (repo.deleteMt5Account) และสคริปต์แอดมิน
 * `npm run admin:release-mt5 -- <เลขบัญชี>` (ไฟล์นี้จึงไม่ import "server-only")
 *
 * ทำไม่ได้เมื่อบัญชีมี license (ทุกสถานะ) หรือมีคำสั่งซื้อที่ชำระแล้ว/รอตรวจ/คืนเงินผูกอยู่ —
 * กรณีนั้นเลขบัญชีอาจอยู่ในรายชื่อ license ที่บอทอ่าน ต้องแก้ผ่านขั้นตอน license ไม่ใช่ลบทิ้ง
 */

type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const LOCKING = [...ACCOUNT_LOCKING_ORDER_STATUSES];

export type RemoveMt5AccountResult = { ok: true; detachedOrders: number } | { ok: false; reason: "account_in_use" };

/** ต้องเรียกใน transaction และผู้เรียกต้องล็อกแถวบัญชี (FOR UPDATE) มาก่อน */
export async function removeMt5AccountInTx(tx: Tx, accountId: string): Promise<RemoveMt5AccountResult> {
  const [{ n: licenseCount }] = await tx
    .select({ n: count() })
    .from(schema.licenses)
    .where(eq(schema.licenses.mt5AccountId, accountId));
  if (licenseCount > 0) return { ok: false, reason: "account_in_use" };

  const [{ n: lockingOrders }] = await tx
    .select({ n: count() })
    .from(schema.orders)
    .where(and(eq(schema.orders.mt5AccountId, accountId), inArray(schema.orders.status, LOCKING)));
  if (lockingOrders > 0) return { ok: false, reason: "account_in_use" };

  // เงื่อนไขสถานะอยู่ใน WHERE ด้วย: ถ้ามีคำสั่งซื้อเปลี่ยนเป็นชำระแล้วพอดี แถวนั้นจะยังอ้างบัญชีอยู่
  // แล้ว DELETE ด้านล่างจะชน foreign key → ทั้ง transaction ถูกยกเลิก
  const detached = await tx
    .update(schema.orders)
    .set({ mt5AccountId: null })
    .where(and(eq(schema.orders.mt5AccountId, accountId), notInArray(schema.orders.status, LOCKING)))
    .returning({ id: schema.orders.id });

  await tx.delete(schema.mt5Accounts).where(eq(schema.mt5Accounts.id, accountId));
  return { ok: true, detachedOrders: detached.length };
}

export type ReleaseMt5AccountResult =
  | { ok: true; accountId: string; detachedOrders: number }
  | { ok: false; reason: "account_not_found" | "account_in_use" };

/** สำหรับแอดมิน: ปล่อยเลขบัญชีที่ถูกลงทะเบียนไว้ (เช่นมีคนกรอกเลขของคนอื่น) โดยอ้างจากเลขบัญชี */
export async function releaseMt5AccountByNumber(accountNumber: string, via: string): Promise<ReleaseMt5AccountResult> {
  return getDb().transaction(async (tx): Promise<ReleaseMt5AccountResult> => {
    const [account] = await tx
      .select({ id: schema.mt5Accounts.id, userId: schema.mt5Accounts.userId })
      .from(schema.mt5Accounts)
      .where(eq(schema.mt5Accounts.accountNumber, accountNumber))
      .for("update");
    if (!account) return { ok: false, reason: "account_not_found" };

    const removed = await removeMt5AccountInTx(tx, account.id);
    if (!removed.ok) return removed;

    // audit เก็บเฉพาะ id — actor เป็น null เพราะสั่งจากสคริปต์ ไม่ใช่ผู้ใช้ที่ล็อกอิน
    await tx.insert(schema.auditLogs).values({
      actorUserId: null,
      action: "mt5_account.release",
      entity: "mt5_account",
      entityId: account.id,
      data: { via, previousUserId: account.userId, detachedOrders: removed.detachedOrders },
    });
    return { ok: true, accountId: account.id, detachedOrders: removed.detachedOrders };
  });
}
