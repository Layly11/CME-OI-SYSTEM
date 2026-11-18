"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { RATE_LIMITS } from "@/lib/auth/constants";
import { getSessionUser, type SessionUser } from "@/lib/auth/dal";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { userKey } from "@/lib/auth/rate-limit-core";
import { firstFieldErrors } from "@/lib/auth/validation";
import { safeErrorSummary } from "@/lib/db-errors";
import type { FormState } from "@/lib/form-state";
import { fulfilOrder } from "@/lib/license/fulfil";
import { isBankTransferEnabled, REFERRAL_PAYMENT_PROVIDER } from "@/lib/payment/config";
import { isPartnerBrokerCode } from "@/lib/purchase/brokers";
import { purchaseMessages, purchaseSystemError } from "@/lib/purchase/messages";
import { mt5AccountSchema, pickMt5Fields, type Mt5Field } from "@/lib/purchase/mt5";
import { canSubmitAccount, canUploadSlip, createOrderSchema, isSlipPaymentMethod } from "@/lib/purchase/order-rules";
import {
  attachMt5AccountToOrder,
  cancelOrder,
  checkAccountNumber,
  chooseBrokerForOrder,
  createOrder,
  deleteMt5Account,
  getOrder,
  recordSlip,
  submitAccountForOrder,
} from "@/lib/purchase/repo";
import { buildSlipKey, MAX_SLIP_BYTES, validateSlip } from "@/lib/purchase/slip-file";
import { getSlipStorage } from "@/lib/slip-storage";

/**
 * Server Actions ของขั้นตอนสั่งซื้อ
 * ทุก action ตรวจ session เองทุกครั้ง (ไม่เชื่อว่าหน้าเว็บตรวจมาแล้ว) และส่ง userId จาก session ให้ชั้น repo
 * ซึ่งกรองความเป็นเจ้าของใน SQL — ค่า id ที่มากับฟอร์มหรือ bind ถือเป็นข้อมูลจากผู้ใช้ ต้องตรวจรูปแบบก่อนใช้
 */

export type Mt5FormState = FormState<Mt5Field> & { step: "edit" | "review" };
export type OrderFormState = FormState<"packageId" | "mt5AccountId">;
export type AttachState = FormState<"mt5AccountId">;
export type BrokerState = FormState<"brokerCode">;
export type SlipState = FormState<"slip" | "paymentMethod">;
export type SimpleActionState = FormState<never>;

const uuid = z.uuid();

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

/** ผู้ใช้จาก session — ไม่ได้ล็อกอินจะถูกพาไปหน้าเข้าสู่ระบบ, ฐานข้อมูลมีปัญหาคืน null (ผู้เรียกตอบ systemError) */
async function sessionUser(): Promise<SessionUser | null> {
  let user: SessionUser | null;
  try {
    user = await getSessionUser();
  } catch (err) {
    unstable_rethrow(err);
    console.error("[purchase] session lookup failed:", safeErrorSummary(err));
    return null;
  }
  if (!user) redirect("/login");
  return user;
}

/**
 * ข้อความเมื่อเลขบัญชีที่กรอกให้คำสั่งซื้อมีอยู่ในระบบแล้ว
 * เลขของตัวเอง (ลูกค้าเดิมต่ออายุ/ซื้อเพิ่ม) ไม่ใช่ทางตัน: บอกทางไปต่อ — เลือกบัญชีนั้นจากหน้าคำสั่งซื้อ (attachAccountAction)
 */
function accountNumberMessage(status: "taken" | "duplicate_own"): string {
  return status === "duplicate_own" ? purchaseMessages.duplicate_own_use_existing : purchaseMessages.taken;
}

/**
 * กรอกเลขบัญชี MT5 ให้คำสั่งซื้อ (2 ขั้น: ทวน → ยืนยัน)
 * ต้องมีคำสั่งซื้อของตัวเองที่ชำระแล้ว เลือกโบรกเกอร์แล้ว และยังไม่มีบัญชี — ไม่มีคำสั่งซื้อ กรอกเลขไม่ได้
 * (กันการจองเลขบัญชีโดยไม่ซื้อ และเลขที่ยืนยันแล้วจะได้ license ทันที)
 */
export async function addMt5AccountAction(
  orderId: string | null,
  _prev: Mt5FormState,
  formData: FormData,
): Promise<Mt5FormState> {
  // อ่านเฉพาะ 4 ช่องที่รู้จัก — ไม่มีช่องรหัสผ่าน MT5 และค่าอื่นในฟอร์มถูกทิ้ง
  const raw = pickMt5Fields((name) => formData.get(name));
  const intent = text(formData, "intent");

  const user = await sessionUser();
  if (!user) return { ok: false, step: "edit", formError: purchaseSystemError, values: raw };

  if (orderId === null || !uuid.safeParse(orderId).success) {
    return { ok: false, step: "edit", formError: purchaseMessages.order_required, values: raw };
  }

  if (intent === "edit") return { ok: false, step: "edit", values: raw };

  const parsed = mt5AccountSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, step: "edit", fieldErrors: firstFieldErrors<Mt5Field>(parsed.error), values: raw };
  }
  const input = parsed.data;
  const values: Record<Mt5Field, string> = {
    accountNumber: input.accountNumber,
    accountNumberConfirm: input.accountNumberConfirm,
    brokerServer: input.brokerServer,
    label: input.label ?? "",
  };

  try {
    // ทั้งขั้นทวนและขั้นยืนยันตอบได้ว่าเลขนี้มีคนลงทะเบียนแล้วหรือยัง — จำกัดจำนวนครั้งต่อผู้ใช้ กันไล่เดาเลขบัญชีของลูกค้า
    const limit = await consumeRateLimit(userKey(user.id), RATE_LIMITS.mt5Check);
    if (!limit.allowed) {
      return { ok: false, step: "edit", formError: purchaseMessages.mt5_check_rate_limited, values };
    }

    if (intent !== "confirm") {
      // ขั้นทวน: คำสั่งซื้อต้องพร้อมรับเลขบัญชี (ขั้นยืนยันตรวจซ้ำใน transaction) แล้วเช็คเลขซ้ำก่อนให้ผู้ใช้ยืนยัน
      const order = await getOrder(user.id, orderId);
      if (!order) return { ok: false, step: "edit", formError: purchaseMessages.order_not_found, values };
      if (!canSubmitAccount(order)) {
        const reason =
          order.status !== "paid" ? "order_not_paid" : order.mt5AccountId !== null ? "order_has_account" : "broker_required";
        return { ok: false, step: "edit", formError: purchaseMessages[reason], values };
      }
      const status = await checkAccountNumber(user.id, input.accountNumber);
      if (status !== "free") {
        return { ok: false, step: "edit", fieldErrors: { accountNumber: accountNumberMessage(status) }, values };
      }
      return { ok: false, step: "review", values };
    }

    const result = await submitAccountForOrder(user.id, orderId, {
      accountNumber: input.accountNumber,
      brokerServer: input.brokerServer,
      label: input.label,
    });
    if (!result.ok) {
      if (result.reason === "taken" || result.reason === "duplicate_own") {
        return { ok: false, step: "edit", fieldErrors: { accountNumber: accountNumberMessage(result.reason) }, values };
      }
      return { ok: false, step: "edit", formError: purchaseMessages[result.reason], values };
    }
    // บัญชีถูกผูกกับคำสั่งซื้อที่ชำระแล้วและ commit แล้ว → เปิด license + เผยแพร่รายชื่อทันที
    // fulfilOrder ไม่ throw: ผลเป็นอย่างไรก็ redirect ต่อ หน้าคำสั่งซื้อแสดง "เปิดใช้งานแล้ว" หรือ "กำลังเปิดใช้งาน" ตามความจริง
    await fulfilOrder(orderId, { trigger: "account" });
  } catch (err) {
    console.error("[purchase] add mt5 account failed:", safeErrorSummary(err));
    return { ok: false, step: "edit", formError: purchaseSystemError, values };
  }
  redirect(`/account/orders/${orderId}`);
}

/** ลูกค้าเลือกโบรกเกอร์พาร์ตเนอร์หลังชำระเงิน — อ่านเฉพาะช่อง brokerCode */
export async function chooseBrokerAction(orderId: string, _prev: BrokerState, formData: FormData): Promise<BrokerState> {
  const user = await sessionUser();
  if (!user) return { ok: false, formError: purchaseSystemError };

  if (!uuid.safeParse(orderId).success) return { ok: false, formError: purchaseMessages.order_not_found };
  const brokerCode = text(formData, "brokerCode").slice(0, 64);
  if (!isPartnerBrokerCode(brokerCode)) return { ok: false, fieldErrors: { brokerCode: purchaseMessages.broker_invalid } };

  try {
    const result = await chooseBrokerForOrder(user.id, orderId, brokerCode);
    if (!result.ok) {
      if (result.reason === "broker_invalid") {
        return { ok: false, fieldErrors: { brokerCode: purchaseMessages.broker_invalid } };
      }
      return { ok: false, formError: purchaseMessages[result.reason] };
    }
  } catch (err) {
    console.error("[purchase] choose broker failed:", safeErrorSummary(err));
    return { ok: false, formError: purchaseSystemError };
  }
  // สำเร็จ → redirect กลับหน้าคำสั่งซื้อ (ไม่ใช้ refresh()): หน้าเปลี่ยนขั้นทั้งหน้า และฟอร์มที่ส่งแบบไม่มี JavaScript ได้ 303 ทันที
  // ทดสอบจริงกับ Next 16.4.5 (dev): action นี้ + refresh() ทำให้ POST แบบไม่มี JavaScript ค้างไม่ตอบ (ฟอร์มเดิมถูก render ซ้ำในขั้นถัดไป)
  // ทางที่มี JavaScript ไม่ค้าง และ action อื่นที่ใช้ refresh() (เช่นแนบสลิป) ไม่พบอาการนี้ — ยังไม่ได้หาสาเหตุในตัว framework
  redirect(`/account/orders/${orderId}`);
}

export async function createOrderAction(_prev: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const values: OrderFormState["values"] = {
    packageId: text(formData, "packageId").slice(0, 64),
    mt5AccountId: text(formData, "mt5AccountId").slice(0, 64),
  };

  const user = await sessionUser();
  if (!user) return { ok: false, formError: purchaseSystemError, values };

  // รับแค่ "แพ็กเกจไหน" กับ "บัญชีไหน" — ราคาอ่านจากฐานข้อมูลใน createOrder เท่านั้น
  const parsed = createOrderSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, fieldErrors: firstFieldErrors<"packageId" | "mt5AccountId">(parsed.error), values };
  }

  let destination: string;
  try {
    const result = await createOrder(user.id, parsed.data);
    if (!result.ok) {
      if (
        result.reason === "package_unavailable" ||
        // แพ็กเกจฟรีจากการชวนเพื่อน: ยังไม่มีเพื่อนสมัคร / ใช้สิทธิ์ไปแล้ว (ฟอร์มปิดตัวเลือกไว้แล้ว — นี่คือคำตอบของคำขอที่สร้างเอง)
        result.reason === "free_referral_required" ||
        result.reason === "free_already_claimed"
      ) {
        return { ok: false, fieldErrors: { packageId: purchaseMessages[result.reason] }, values };
      }
      if (
        result.reason === "account_not_found" ||
        result.reason === "lifetime_active" ||
        result.reason === "license_suspended" ||
        result.reason === "free_account_used"
      ) {
        return { ok: false, fieldErrors: { mt5AccountId: purchaseMessages[result.reason] }, values };
      }
      return { ok: false, formError: purchaseMessages[result.reason], values };
    }
    destination = `/account/orders/${result.id}`;
    // ไม่ได้สร้างรายการใหม่ → หน้าคำสั่งซื้อต้องบอกผู้ใช้ (โดยเฉพาะเมื่อแพ็กเกจไม่ตรงกับที่เพิ่งเลือก)
    if (result.existing) destination += `?notice=${result.samePackage ? "existing" : "other-package"}`;
    // แพ็กเกจฟรี: คำสั่งซื้อถูกบันทึกเป็น "รับสิทธิ์แล้ว" และ commit แล้ว (ไม่มีขั้นชำระเงิน) → ทำขั้นเปิด license ต่อทันที
    // มีบัญชี MT5 มาแต่แรกได้ license ตรงนี้ ยังไม่มีบัญชีได้ not_ready เอง (ไปเลือกโบรกเกอร์ต่อ) — fulfilOrder ไม่ throw
    else if (result.freeClaim) await fulfilOrder(result.id, { trigger: "payment" });
  } catch (err) {
    console.error("[purchase] create order failed:", safeErrorSummary(err));
    return { ok: false, formError: purchaseSystemError, values };
  }
  redirect(destination);
}

/**
 * ลูกค้ายกเลิกคำสั่งซื้อของตัวเอง: รายการที่ยังรอชำระ หรือแพ็กเกจฟรีที่รับสิทธิ์แล้วแต่ยังไม่ได้เปิด license (คืนสิทธิ์ให้รับใหม่ได้)
 * กติกาและการล็อกอยู่ใน cancelOrder — action นี้ไม่ตัดสินเอง (ใช้กับ useActionState — ไม่อ่าน state เดิมและข้อมูลฟอร์ม)
 */
export async function cancelOrderAction(orderId: string): Promise<SimpleActionState> {
  const user = await sessionUser();
  if (!user) return { ok: false, formError: purchaseSystemError };

  if (!uuid.safeParse(orderId).success) return { ok: false, formError: purchaseMessages.order_not_found };

  try {
    const result = await cancelOrder(user.id, orderId);
    if (!result.ok) return { ok: false, formError: purchaseMessages[result.reason] };
  } catch (err) {
    console.error("[purchase] cancel order failed:", safeErrorSummary(err));
    return { ok: false, formError: purchaseSystemError };
  }
  refresh();
  return { ok: true };
}

/** ลูกค้าลบบัญชี MT5 ของตัวเองที่ยังไม่มี license (ปล่อยเลขบัญชี) */
export async function deleteMt5AccountAction(accountId: string): Promise<SimpleActionState> {
  const user = await sessionUser();
  if (!user) return { ok: false, formError: purchaseSystemError };

  if (!uuid.safeParse(accountId).success) return { ok: false, formError: purchaseMessages.account_not_found };

  try {
    const result = await deleteMt5Account(user.id, accountId);
    if (!result.ok) return { ok: false, formError: purchaseMessages[result.reason] };
  } catch (err) {
    console.error("[purchase] delete mt5 account failed:", safeErrorSummary(err));
    return { ok: false, formError: purchaseSystemError };
  }
  refresh();
  return { ok: true };
}

export async function attachAccountAction(
  orderId: string,
  _prev: AttachState,
  formData: FormData,
): Promise<AttachState> {
  const user = await sessionUser();
  if (!user) return { ok: false, formError: purchaseSystemError };

  if (!uuid.safeParse(orderId).success) return { ok: false, formError: purchaseMessages.order_not_found };
  const accountId = uuid.safeParse(text(formData, "mt5AccountId"));
  if (!accountId.success) return { ok: false, fieldErrors: { mt5AccountId: purchaseMessages.account_required } };

  try {
    const result = await attachMt5AccountToOrder(user.id, orderId, accountId.data);
    if (!result.ok) {
      if (result.reason === "order_not_found" || result.reason === "order_not_attachable") {
        return { ok: false, formError: purchaseMessages[result.reason] };
      }
      return { ok: false, fieldErrors: { mt5AccountId: purchaseMessages[result.reason] } };
    }
    // ผูกบัญชีแล้วและ commit แล้ว → เปิด license ถ้าคำสั่งซื้อชำระแล้ว (ยังไม่ชำระได้ not_ready เอง รอ markOrderPaid)
    // fulfilOrder ไม่ throw: ผลเป็นอย่างไรก็ redirect ต่อ
    await fulfilOrder(orderId, { trigger: "account" });
  } catch (err) {
    console.error("[purchase] attach account failed:", safeErrorSummary(err));
    return { ok: false, formError: purchaseSystemError };
  }
  // redirect แทน refresh() แบบเดียวกับ chooseBrokerAction — หน้าคำสั่งซื้อเปลี่ยนขั้นทั้งหน้าหลังผูกบัญชี
  redirect(`/account/orders/${orderId}`);
}

/**
 * ปุ่ม "ตรวจสอบสถานะอีกครั้ง" ของคำสั่งซื้อที่ค้าง "กำลังเปิดใช้งาน" — ลองเปิด license + เผยแพร่รายชื่อใหม่
 * ปลอดภัยที่จะกดซ้ำ: ทุกขั้น idempotent (1 คำสั่งซื้อเปิดได้ครั้งเดียว, รายชื่อเหมือนเดิมไม่เขียนซ้ำ) และจำกัดจำนวนครั้งต่อผู้ใช้
 * (ใช้กับ useActionState — ไม่อ่าน state เดิมและข้อมูลฟอร์ม)
 */
export async function retryActivationAction(orderId: string): Promise<SimpleActionState> {
  const user = await sessionUser();
  if (!user) return { ok: false, formError: purchaseSystemError };

  if (!uuid.safeParse(orderId).success) return { ok: false, formError: purchaseMessages.order_not_found };

  try {
    const order = await getOrder(user.id, orderId);
    if (!order) return { ok: false, formError: purchaseMessages.order_not_found };
    if (order.status !== "paid") return { ok: false, formError: purchaseMessages.order_not_paid };
    if (order.mt5AccountId === null) return { ok: false, formError: purchaseMessages.account_required };

    const limit = await consumeRateLimit(userKey(user.id), RATE_LIMITS.activationRetry);
    if (!limit.allowed) return { ok: false, formError: purchaseMessages.activation_retry_rate_limited };

    const result = await fulfilOrder(orderId, { trigger: "retry" });
    // ถูกกัน (license ถูกระงับ / ตลอดชีพอยู่แล้ว / ชำระแบบจำลอง): ไม่ใช่ "กำลังเปิดใช้งาน" — กลับหน้าคำสั่งซื้อ
    // ซึ่งแสดงสถานะ "ชำระแล้ว แต่เปิดใช้งานอัตโนมัติไม่ได้" พร้อมเหตุผล แทนการต่อข้อความขัดกันใต้ประกาศเดิม
    const blocked = result.activation.status === "blocked";
    const published = result.publish?.status === "published" || result.publish?.status === "unchanged";
    if (!blocked && !published) {
      // แพ็กเกจฟรีจากการชวนเพื่อนไม่มีการชำระเงิน — ข้อความไม่พูดถึง "การชำระเงิน/ไม่ต้องชำระซ้ำ"
      const freeClaim = order.paymentProvider === REFERRAL_PAYMENT_PROVIDER;
      return { ok: false, formError: purchaseMessages[freeClaim ? "activation_pending_free" : "activation_pending"] };
    }
  } catch (err) {
    console.error("[purchase] retry activation failed:", safeErrorSummary(err));
    return { ok: false, formError: purchaseSystemError };
  }
  // สำเร็จหรือถูกกัน → redirect (ไม่ใช้ refresh()) แบบเดียวกับ chooseBrokerAction: หน้าเปลี่ยนสถานะทั้งหน้า
  redirect(`/account/orders/${orderId}`);
}

export async function uploadSlipAction(orderId: string, _prev: SlipState, formData: FormData): Promise<SlipState> {
  const user = await sessionUser();
  if (!user) return { ok: false, formError: purchaseSystemError };

  // ช่องทางโอนเงินปิดเป็นค่าเริ่มต้น (PAYMENT_BANK_TRANSFER_ENABLED) — หน้าเว็บซ่อนฟอร์มแล้ว แต่คำขอที่สร้างเองต้องถูกปฏิเสธด้วย
  if (!isBankTransferEnabled(process.env)) return { ok: false, formError: purchaseMessages.bank_transfer_disabled };

  if (!uuid.safeParse(orderId).success) return { ok: false, formError: purchaseMessages.order_not_found };

  try {
    // 1) คำสั่งซื้อต้องเป็นของผู้ใช้นี้ และอยู่ในสถานะที่แนบสลิปได้ — ตรวจก่อนอ่านไฟล์
    const order = await getOrder(user.id, orderId);
    if (!order) return { ok: false, formError: purchaseMessages.order_not_found };
    if (!canUploadSlip(order.status)) return { ok: false, formError: purchaseMessages.slip_not_allowed };

    // ที่เก็บสลิปปิดอยู่ (SLIP_STORAGE=disabled) → บอกให้ส่งทาง LINE ก่อนอ่านไฟล์
    const storage = getSlipStorage();
    if (!storage) return { ok: false, formError: purchaseMessages.slip_upload_unavailable };

    const paymentMethod = text(formData, "paymentMethod");
    if (!isSlipPaymentMethod(paymentMethod)) {
      return { ok: false, fieldErrors: { paymentMethod: purchaseMessages.payment_method_invalid } };
    }

    // 2) ตรวจไฟล์: ขนาดก่อนอ่าน แล้วตรวจชนิดจากไบต์จริง (ไม่เชื่อชื่อไฟล์/ชนิดที่เบราว์เซอร์แจ้ง)
    const file = formData.get("slip");
    if (!(file instanceof File)) return { ok: false, fieldErrors: { slip: purchaseMessages.slip_required } };
    if (file.size === 0) return { ok: false, fieldErrors: { slip: purchaseMessages.slip_required } };
    if (file.size > MAX_SLIP_BYTES) return { ok: false, fieldErrors: { slip: purchaseMessages.too_large } };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateSlip(bytes);
    if (!checked.ok) return { ok: false, fieldErrors: { slip: purchaseMessages[checked.reason] } };

    // 3) เก็บใน private storage ด้วยชื่อสุ่ม แล้วบันทึกลงคำสั่งซื้อ
    const key = buildSlipKey(orderId, randomUUID(), checked.mime);
    await storage.put(key, bytes, checked.mime);

    let recorded: Awaited<ReturnType<typeof recordSlip>>;
    try {
      recorded = await recordSlip(user.id, orderId, {
        key,
        mime: checked.mime,
        size: bytes.length,
        paymentMethod,
      });
    } catch (err) {
      await storage.delete(key).catch(() => {});
      throw err;
    }
    // 4) บันทึกไม่ได้ → ลบไฟล์ที่เพิ่งเขียน, บันทึกได้ → ลบสลิปเก่า (พลาดก็ไม่กระทบผู้ใช้)
    if (!recorded.ok) {
      await storage.delete(key).catch(() => {});
      return { ok: false, formError: purchaseMessages[recorded.reason] };
    }
    if (recorded.previousKey && recorded.previousKey !== key) {
      await storage
        .delete(recorded.previousKey)
        .catch((err) => console.error("[purchase] delete old slip failed:", safeErrorSummary(err)));
    }
  } catch (err) {
    console.error("[purchase] slip upload failed:", safeErrorSummary(err));
    return { ok: false, formError: purchaseSystemError };
  }
  refresh();
  return { ok: true };
}
