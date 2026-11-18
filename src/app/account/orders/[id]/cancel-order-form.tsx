"use client";

import { useActionState } from "react";
import { cancelOrderAction, type SimpleActionState } from "@/app/actions/purchase";
import { Notice } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";

const initialState: SimpleActionState = { ok: false };

/**
 * ยกเลิกคำสั่งซื้อแบบ 2 จังหวะ (กดเปิด → ยืนยัน) กันกดพลาด — เซิร์ฟเวอร์ตรวจเจ้าของและสถานะซ้ำเสมอ
 * ใช้ <details> แทน state ของ React: ฟอร์มยืนยันอยู่ใน HTML ตั้งแต่แรก จึงใช้ได้แม้ JavaScript ยังไม่โหลด
 * (และ scripts/e2e.mjs ส่งฟอร์มนี้ผ่าน HTTP ได้จริง)
 */
export function CancelOrderForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(cancelOrderAction.bind(null, orderId), initialState);

  return (
    <div className="mt-3 space-y-3">
      {state.formError ? <Notice tone="error">{state.formError}</Notice> : null}
      <details>
        <summary className="inline-flex cursor-pointer list-none items-center justify-center rounded-md border border-ink/30 px-5 py-2.5 text-[15px] font-medium text-ink hover:border-ink hover:bg-ink/5 [&::-webkit-details-marker]:hidden">
          ยกเลิกคำสั่งซื้อนี้
        </summary>
        <form action={formAction} data-testid="cancel-order" className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-[14.5px] text-text">ยืนยันยกเลิกคำสั่งซื้อนี้?</span>
          <SubmitButton variant="outline-ink" pendingLabel="กำลังยกเลิก…">
            ยืนยันยกเลิก
          </SubmitButton>
        </form>
      </details>
    </div>
  );
}
