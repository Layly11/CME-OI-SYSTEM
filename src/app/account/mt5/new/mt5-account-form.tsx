"use client";

import { useActionState } from "react";
import { addMt5AccountAction, type Mt5FormState } from "@/app/actions/purchase";
import { Field, Input, Notice } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import { groupDigits } from "@/lib/purchase/format";
import { MT5_FIELDS } from "@/lib/purchase/mt5";

const initialState: Mt5FormState = { ok: false, step: "edit" };

/**
 * กรอกเลขบัญชี MT5 ให้คำสั่งซื้อที่ชำระแล้ว แบบ 2 ขั้น: กรอก (เลขบัญชี 2 ครั้ง) → ทวนเลขตัวใหญ่ → ยืนยัน
 * ยืนยันแล้ว license เปิดให้เลขนี้ทันที (ไม่มีขั้นแอดมินตรวจ) และยังเปลี่ยนเลขหลังเปิดใช้งานเองไม่ได้
 * ไม่มีช่องรหัสผ่าน MT5 — ระบบไม่ขอและไม่เก็บ
 */
export function Mt5AccountForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(addMt5AccountAction.bind(null, orderId), initialState);
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};

  if (state.step === "review") {
    const hidden = MT5_FIELDS.map((f) => <input key={f} type="hidden" name={f} value={values[f] ?? ""} />);
    return (
      <div className="mt-6 space-y-5">
        <div className="rounded-lg border border-rule bg-surface p-5">
          <p className="text-[14px] text-muted">ตรวจเลขบัญชีให้ตรงกับที่แสดงใน MT5 ของคุณ</p>
          <p className="tabular mt-2 text-[34px] font-semibold tracking-wide text-ink" data-testid="review-number">
            {groupDigits(values.accountNumber ?? "")}
          </p>
          <dl className="mt-3 space-y-1 text-[14.5px]">
            <div className="flex gap-2">
              <dt className="text-muted">Broker Server:</dt>
              <dd className="font-medium text-ink">{values.brokerServer}</dd>
            </div>
            {values.label ? (
              <div className="flex gap-2">
                <dt className="text-muted">ชื่อเรียก:</dt>
                <dd className="text-ink">{values.label}</dd>
              </div>
            ) : null}
          </dl>
        </div>
        <Notice tone="warn">
          เมื่อยืนยัน ระบบจะเปิด license ให้เลขบัญชีนี้ทันที และแก้เลขเองไม่ได้ ถ้าเลขผิดแม้หลักเดียว indicator จะไม่ทำงาน
        </Notice>
        <div className="flex flex-wrap gap-3">
          <form action={formAction}>
            {hidden}
            <input type="hidden" name="intent" value="confirm" />
            <SubmitButton pendingLabel="กำลังบันทึก…">ยืนยัน เปิด license ให้บัญชีนี้</SubmitButton>
          </form>
          <form action={formAction}>
            {hidden}
            <input type="hidden" name="intent" value="edit" />
            <SubmitButton variant="outline-ink">กลับไปแก้ไข</SubmitButton>
          </form>
        </div>
      </div>
    );
  }

  return (
    <form className="mt-6 space-y-4" action={formAction}>
      {state.formError ? <Notice tone="error">{state.formError}</Notice> : null}
      <input type="hidden" name="intent" value="review" />
      <Field label="เลขบัญชี MT5" hint="ตัวเลขล้วน ดูได้ที่มุมบนซ้ายของหน้าต่าง MT5" error={errors.accountNumber}>
        <Input
          name="accountNumber"
          inputMode="numeric"
          autoComplete="off"
          required
          maxLength={20}
          defaultValue={values.accountNumber}
        />
      </Field>
      <Field label="ยืนยันเลขบัญชี MT5 อีกครั้ง" error={errors.accountNumberConfirm}>
        <Input
          name="accountNumberConfirm"
          inputMode="numeric"
          autoComplete="off"
          required
          maxLength={20}
          defaultValue={values.accountNumberConfirm}
        />
      </Field>
      <Field
        label="Broker Server"
        hint="ชื่อเซิร์ฟเวอร์ที่ใช้ล็อกอิน MT5 เช่น InterStellarFinancial-Server"
        error={errors.brokerServer}
      >
        <Input name="brokerServer" autoComplete="off" required maxLength={64} defaultValue={values.brokerServer} />
      </Field>
      <Field label="ชื่อเรียก (ไม่บังคับ)" hint="ตั้งไว้ให้ตัวเองจำได้ เช่น บัญชีหลัก" error={errors.label}>
        <Input name="label" maxLength={40} defaultValue={values.label} />
      </Field>
      <Notice>ไม่ต้องใส่รหัสผ่าน MT5 — เราไม่ขอและไม่เก็บรหัสผ่านบัญชีเทรดของคุณ</Notice>
      <SubmitButton pendingLabel="กำลังตรวจสอบ…">ถัดไป: ตรวจทานเลขบัญชี</SubmitButton>
    </form>
  );
}
