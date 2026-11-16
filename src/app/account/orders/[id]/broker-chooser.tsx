"use client";

import { useActionState } from "react";
import { chooseBrokerAction, type BrokerState } from "@/app/actions/purchase";
import { Notice } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";

const initialState: BrokerState = { ok: false };

/** เลือกโบรกเกอร์พาร์ตเนอร์ 1 ราย — ส่งเฉพาะ code เซิร์ฟเวอร์ตรวจกับรายชื่อใน src/content/brokers.ts ซ้ำ */
export function BrokerChooser({
  orderId,
  brokers,
  selectedCode,
  submitLabel = "เลือกโบรกเกอร์นี้",
}: {
  orderId: string;
  brokers: { code: string; name: string }[];
  selectedCode: string | null;
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState(chooseBrokerAction.bind(null, orderId), initialState);

  return (
    <form className="mt-3 space-y-3" action={formAction}>
      {state.formError ? <Notice tone="error">{state.formError}</Notice> : null}
      <fieldset>
        <legend className="sr-only">โบรกเกอร์พาร์ตเนอร์</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {brokers.map((b) => (
            <label
              key={b.code}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-rule bg-surface px-4 py-3 has-[:checked]:border-ink"
            >
              <input type="radio" name="brokerCode" value={b.code} required defaultChecked={b.code === selectedCode} />
              <span className="text-[15.5px] font-medium text-ink">{b.name}</span>
            </label>
          ))}
        </div>
        {state.fieldErrors?.brokerCode ? (
          <span role="alert" className="mt-1 block text-[13px] text-put">
            {state.fieldErrors.brokerCode}
          </span>
        ) : null}
      </fieldset>
      <SubmitButton variant="outline-ink" pendingLabel="กำลังบันทึก…">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
