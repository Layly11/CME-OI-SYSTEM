"use client";

import { useActionState } from "react";
import { startCheckoutAction } from "@/app/actions/payment";
import { Notice } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/form-state";

const initialState: FormState<never> = { ok: false };

/**
 * ปุ่มเริ่มชำระเงินด้วยบัตร — ฟอร์มนี้ไม่มีช่องกรอกใดๆ: ข้อมูลบัตรกรอกที่หน้าของผู้ให้บริการรับชำระเท่านั้น
 * ยอดเงินและคำสั่งซื้อถูกอ่านจากฐานข้อมูลฝั่งเซิร์ฟเวอร์
 */
export function PayByCardForm({ orderId, testMode }: { orderId: string; testMode: boolean }) {
  const [state, formAction] = useActionState(startCheckoutAction.bind(null, orderId), initialState);

  return (
    <form className="mt-3 space-y-3" action={formAction} data-testid="pay-by-card">
      {state.formError ? <Notice tone="error">{state.formError}</Notice> : null}
      <SubmitButton pendingLabel="กำลังไปหน้าชำระเงิน…">ชำระเงินด้วยบัตรเครดิต/เดบิต</SubmitButton>
      {testMode ? (
        <p className="text-[13.5px] text-muted">โหมดทดสอบ: ขั้นถัดไปเป็นการจำลองการชำระเงิน ไม่มีการตัดเงินจริง</p>
      ) : null}
    </form>
  );
}
