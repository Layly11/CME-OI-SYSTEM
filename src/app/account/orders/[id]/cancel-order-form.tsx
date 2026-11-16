"use client";

import { useActionState, useState } from "react";
import { cancelOrderAction, type SimpleActionState } from "@/app/actions/purchase";
import { Notice } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui";

const initialState: SimpleActionState = { ok: false };

/** ยกเลิกคำสั่งซื้อแบบ 2 จังหวะ (กด → ยืนยัน) กันกดพลาด — เซิร์ฟเวอร์ตรวจเจ้าของและสถานะซ้ำเสมอ */
export function CancelOrderForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(cancelOrderAction.bind(null, orderId), initialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="mt-3 space-y-3">
      {state.formError ? <Notice tone="error">{state.formError}</Notice> : null}
      {confirming ? (
        <form action={formAction} className="flex flex-wrap items-center gap-3">
          <span className="text-[14.5px] text-text">ยืนยันยกเลิกคำสั่งซื้อนี้?</span>
          <SubmitButton variant="outline-ink" pendingLabel="กำลังยกเลิก…">
            ยืนยันยกเลิก
          </SubmitButton>
          <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
            ไม่ยกเลิก
          </Button>
        </form>
      ) : (
        <Button type="button" variant="outline-ink" onClick={() => setConfirming(true)}>
          ยกเลิกคำสั่งซื้อนี้
        </Button>
      )}
    </div>
  );
}
