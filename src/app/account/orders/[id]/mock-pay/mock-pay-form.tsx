"use client";

import { useActionState } from "react";
import { confirmMockPaymentAction } from "@/app/actions/payment";
import { Notice } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/form-state";

const initialState: FormState<never> = { ok: false };

/**
 * ปุ่มยืนยันการชำระเงินจำลอง — ฟอร์มนี้ต้องไม่มีช่องกรอกใดๆ (โดยเฉพาะข้อมูลบัตร)
 * มีเทสอ่านซอร์สไฟล์นี้กันคนเพิ่มช่องกรอกโดยไม่ตั้งใจ (no-card-fields.test.ts)
 */
export function MockPayForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(confirmMockPaymentAction.bind(null, orderId), initialState);

  return (
    <form className="mt-6 space-y-3" action={formAction} data-testid="mock-pay">
      {state.formError ? <Notice tone="error">{state.formError}</Notice> : null}
      <SubmitButton pendingLabel="กำลังบันทึก…">ยืนยันการชำระเงิน (จำลอง)</SubmitButton>
    </form>
  );
}
