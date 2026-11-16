"use client";

import { useActionState, useState } from "react";
import { uploadSlipAction, type SlipState } from "@/app/actions/purchase";
import { Field, Notice } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import { purchaseMessages } from "@/lib/purchase/messages";
import { MAX_SLIP_BYTES, SLIP_MIMES } from "@/lib/purchase/slip-file";

const initialState: SlipState = { ok: false };

export function SlipUploadForm({ orderId, hasPromptPay }: { orderId: string; hasPromptPay: boolean }) {
  const [state, formAction] = useActionState(uploadSlipAction.bind(null, orderId), initialState);
  // ตรวจขนาดในเบราว์เซอร์ก่อนส่ง (ช่วยผู้ใช้เท่านั้น — เซิร์ฟเวอร์ตรวจซ้ำทั้งขนาดและชนิดไฟล์จริง)
  const [tooLarge, setTooLarge] = useState(false);
  const slipError = tooLarge ? purchaseMessages.too_large : state.fieldErrors?.slip;

  return (
    <form className="mt-3 space-y-4" action={formAction}>
      {state.formError ? <Notice tone="error">{state.formError}</Notice> : null}
      <fieldset>
        <legend className="text-[14.5px] font-medium text-ink">วิธีชำระเงิน</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
          <label className="flex items-center gap-2">
            <input type="radio" name="paymentMethod" value="bank_transfer" defaultChecked required /> โอนผ่านบัญชีธนาคาร
          </label>
          {hasPromptPay ? (
            <label className="flex items-center gap-2">
              <input type="radio" name="paymentMethod" value="promptpay" /> PromptPay
            </label>
          ) : null}
        </div>
        {state.fieldErrors?.paymentMethod ? (
          <span role="alert" className="mt-1 block text-[13px] text-put">
            {state.fieldErrors.paymentMethod}
          </span>
        ) : null}
      </fieldset>
      <Field label="ไฟล์สลิปโอนเงิน" hint="JPG, PNG, WebP หรือ PDF ขนาดไม่เกิน 4 MB" error={slipError}>
        <input
          type="file"
          name="slip"
          required
          accept={SLIP_MIMES.join(",")}
          className="mt-1.5 block w-full text-[14.5px] text-text file:mr-3 file:rounded-md file:border file:border-rule file:bg-surface file:px-3 file:py-2 file:text-[14px] file:text-ink"
          onChange={(e) => setTooLarge((e.currentTarget.files?.[0]?.size ?? 0) > MAX_SLIP_BYTES)}
        />
      </Field>
      <SubmitButton disabled={tooLarge} pendingLabel="กำลังอัปโหลด…">
        ส่งสลิป
      </SubmitButton>
    </form>
  );
}
