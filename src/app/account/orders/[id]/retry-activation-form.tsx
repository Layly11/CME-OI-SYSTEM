"use client";

import { useActionState } from "react";
import { retryActivationAction, type SimpleActionState } from "@/app/actions/purchase";
import { Notice } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";

const initialState: SimpleActionState = { ok: false };

/**
 * ปุ่ม "ตรวจสอบสถานะอีกครั้ง" ของคำสั่งซื้อที่กำลังเปิดใช้งาน — ฟอร์มไม่มีช่องกรอก
 * เซิร์ฟเวอร์ตรวจ session/เจ้าของ/สถานะเอง และกดซ้ำไม่เกิดผลซ้ำ (ไม่ตัดเงิน ไม่ต่ออายุเพิ่ม)
 * ข้อความที่ตอบกลับเป็นโทนแจ้งเตือน ไม่ใช่ error: เงินและเลขบัญชีถูกบันทึกแล้ว แค่ยังเปิดใช้งานไม่เสร็จ
 */
export function RetryActivationForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(retryActivationAction.bind(null, orderId), initialState);

  return (
    <form className="mt-3 space-y-3" action={formAction} data-testid="retry-activation">
      {state.formError ? <Notice tone="warn">{state.formError}</Notice> : null}
      <SubmitButton variant="outline-ink" pendingLabel="กำลังตรวจสอบ…">
        ตรวจสอบสถานะอีกครั้ง
      </SubmitButton>
    </form>
  );
}
