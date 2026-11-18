import "server-only";
import { and, count, eq, isNotNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Tx } from "./mt5-release";
import { REFERRALS_REQUIRED_FOR_FREE } from "./packages";

/**
 * ชวนเพื่อน + สิทธิ์แพ็กเกจฟรี 1 เดือน (packages.code = 'free_referral') — ชั้นฐานข้อมูล
 *
 * กติกา (ตรวจฝั่งเซิร์ฟเวอร์ทั้งตอนสร้างคำสั่งซื้อ — createOrder และอีกครั้งตอนเปิด license — activateInTx):
 * 1) มีเพื่อนที่สมัครสมาชิกผ่านลิงก์ชวนของผู้ใช้แล้วอย่างน้อย REFERRALS_REQUIRED_FOR_FREE คน (users.referred_by_user_id)
 * 2) ผู้ใช้ยังไม่เคยใช้สิทธิ์ — ฐานข้อมูลบังคับด้วย referral_claims.user_id unique
 * 3) บัญชี MT5 ปลายทางยังไม่เคยได้แพ็กเกจฟรี — ฐานข้อมูลบังคับด้วย referral_claims.mt5_account_id unique
 *
 * ข้อจำกัดที่รับทราบแล้ว (ยังไม่แก้ในรอบนี้): ยังไม่มีการยืนยันอีเมล "เพื่อน" จึงเป็นบัญชีที่สมัครทิ้งไว้เฉยๆ ได้
 * สิ่งที่จำกัดการใช้ช่องนี้คือข้อ 2 และ 3 (1 คนได้ฟรีครั้งเดียว, 1 บัญชี MT5 ได้ฟรีครั้งเดียว) กับ rate limit ของการสมัครสมาชิก
 * (RATE_LIMITS.registerIp) — เมื่อมีระบบอีเมลแล้วควรนับเฉพาะเพื่อนที่ยืนยันอีเมล (แก้ที่ countReferredUsers ที่เดียว)
 * เพื่อนที่ถูกชวนไม่ได้สิทธิ์พิเศษอะไรในรอบนี้
 */
type Db = ReturnType<typeof getDb>;

/** id ของเจ้าของรหัสชวนเพื่อน — ไม่มีรหัสนี้คืน null (ผู้เรียกต้องส่งรหัสที่ผ่าน parseReferralCode มาแล้ว) */
export async function findReferrerIdByCode(code: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.referralCode, code))
    .limit(1);
  return row?.id ?? null;
}

/** จำนวนเพื่อนที่สมัครสมาชิกผ่านลิงก์ชวนของผู้ใช้นี้ ("สมัครแล้ว" = มีแถว users — ยังไม่มีการยืนยันอีเมล) */
export async function countReferredUsers(db: Db | Tx, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.users)
    .where(eq(schema.users.referredByUserId, userId));
  return row?.n ?? 0;
}

export async function hasEnoughReferrals(db: Db | Tx, userId: string): Promise<boolean> {
  return (await countReferredUsers(db, userId)) >= REFERRALS_REQUIRED_FOR_FREE;
}

export type FreeClaimRow = { id: string; userId: string; orderId: string; activated: boolean };

const claimColumns = {
  id: schema.referralClaims.id,
  userId: schema.referralClaims.userId,
  orderId: schema.referralClaims.orderId,
  activatedAt: schema.referralClaims.activatedAt,
};
const toClaim = (r: { id: string; userId: string; orderId: string; activatedAt: Date | null }): FreeClaimRow => ({
  id: r.id,
  userId: r.userId,
  orderId: r.orderId,
  activated: r.activatedAt !== null,
});

/** สิทธิ์แพ็กเกจฟรีที่ผู้ใช้นี้ถืออยู่ (มีได้แถวเดียว) — null = ยังไม่เคยรับ หรือรับแล้วยกเลิกก่อนเปิด license */
export async function findFreeClaimByUser(db: Db | Tx, userId: string): Promise<FreeClaimRow | null> {
  const [row] = await db.select(claimColumns).from(schema.referralClaims).where(eq(schema.referralClaims.userId, userId)).limit(1);
  return row ? toClaim(row) : null;
}

export async function findFreeClaimByOrder(db: Db | Tx, orderId: string): Promise<FreeClaimRow | null> {
  const [row] = await db.select(claimColumns).from(schema.referralClaims).where(eq(schema.referralClaims.orderId, orderId)).limit(1);
  return row ? toClaim(row) : null;
}

/**
 * บัญชี MT5 นี้เคยได้แพ็กเกจฟรีแล้วหรือไม่ (จากสิทธิ์อื่นที่ไม่ใช่ exceptClaimId)
 * บัญชีถูกบันทึกลง referral_claims ตอนเปิด license เท่านั้น — ผู้เรียกใน activateInTx ถือ lock แถวบัญชีอยู่ การอ่านนี้จึงไม่แข่งกับการเปิดรายการอื่น
 */
export async function hasAccountReceivedFree(db: Db | Tx, mt5AccountId: string, exceptClaimId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.referralClaims.id })
    .from(schema.referralClaims)
    .where(
      and(
        eq(schema.referralClaims.mt5AccountId, mt5AccountId),
        isNotNull(schema.referralClaims.activatedAt),
        ...(exceptClaimId ? [ne(schema.referralClaims.id, exceptClaimId)] : []),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export type ReferralSummary = {
  /** รหัสชวนเพื่อนของผู้ใช้ (ลิงก์ /register?ref=CODE) */
  code: string;
  /** จำนวนเพื่อนที่สมัครสมาชิกผ่านลิงก์แล้ว */
  referredCount: number;
  /** สิทธิ์แพ็กเกจฟรีที่ถืออยู่: activated = เปิด license ไปแล้ว (ใช้สิทธิ์แล้ว), ยังไม่ activated = รับแล้วแต่ยังทำขั้นถัดไปไม่เสร็จ */
  claim: { orderId: string; activated: boolean } | null;
};

/** ข้อมูลชวนเพื่อนของผู้ใช้สำหรับหน้าสมาชิก — null เมื่อไม่พบผู้ใช้ */
export async function getReferralSummary(userId: string): Promise<ReferralSummary | null> {
  const db = getDb();
  const [user] = await db
    .select({ code: schema.users.referralCode })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return null;
  const [referredCount, claim] = await Promise.all([countReferredUsers(db, userId), findFreeClaimByUser(db, userId)]);
  return { code: user.code, referredCount, claim: claim ? { orderId: claim.orderId, activated: claim.activated } : null };
}

/**
 * สำหรับหน้าเว็บ (อ่านเพื่อแสดงผล ไม่ล็อกแถว): คำสั่งซื้อแพ็กเกจฟรีที่รับสิทธิ์แล้ว มีบัญชีแล้ว แต่ยังไม่มี license
 * ถูกกันด้วยกติกาของแพ็กเกจฟรีหรือไม่ — กติกาเดียวกับ freeClaimBlockInTx (ด่านจริงตอนเปิด license)
 */
export type FreeClaimBlock = "free_claim_invalid" | "free_referral_required" | "free_account_used";

export async function freeClaimBlockInTx(
  db: Db | Tx,
  order: { id: string; userId: string },
  mt5AccountId: string,
): Promise<{ block: FreeClaimBlock } | { block: null; claimId: string }> {
  const claim = await findFreeClaimByOrder(db, order.id);
  // ไม่มีแถวสิทธิ์ / เป็นของผู้ใช้อื่น / ถูกใช้ไปแล้วกับการเปิดครั้งอื่น → ไม่ใช่สิทธิ์ที่ใช้เปิด license ได้
  if (!claim || claim.userId !== order.userId || claim.activated) return { block: "free_claim_invalid" };
  if (!(await hasEnoughReferrals(db, order.userId))) return { block: "free_referral_required" };
  if (await hasAccountReceivedFree(db, mt5AccountId, claim.id)) return { block: "free_account_used" };
  return { block: null, claimId: claim.id };
}
