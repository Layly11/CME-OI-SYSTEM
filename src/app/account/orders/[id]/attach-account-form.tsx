"use client";

import { useActionState } from "react";
import { attachAccountAction, type AttachState } from "@/app/actions/purchase";
import { Field, Notice, Select } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";

const initialState: AttachState = { ok: false };

export function AttachAccountForm({
  orderId,
  accounts,
}: {
  orderId: string;
  accounts: { id: string; accountNumber: string; brokerServer: string }[];
}) {
  const [state, formAction] = useActionState(attachAccountAction.bind(null, orderId), initialState);

  return (
    <form className="mt-3 space-y-3" action={formAction}>
      {state.formError ? <Notice tone="error">{state.formError}</Notice> : null}
      <Field label="เลือกบัญชี MT5 ที่ลงทะเบียนไว้แล้ว" error={state.fieldErrors?.mt5AccountId}>
        <Select name="mt5AccountId" required defaultValue="">
          <option value="" disabled>
            เลือกบัญชี
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountNumber} · {a.brokerServer}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton variant="outline-ink" pendingLabel="กำลังบันทึก…">
        ใช้บัญชีนี้และเปิด license ทันที
      </SubmitButton>
    </form>
  );
}
