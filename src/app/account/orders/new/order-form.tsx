"use client";

import { useActionState } from "react";
import { createOrderAction, type OrderFormState } from "@/app/actions/purchase";
import { Field, Notice, Select } from "@/components/form";
import { LineLink } from "@/components/line-link";
import { SubmitButton } from "@/components/submit-button";

export type OrderFormPackage = {
  id: string;
  name: string;
  period: string;
  /** null = ยังไม่เปิดขายออนไลน์ (แสดง "สอบถามราคา") */
  price: string | null;
};

export type OrderFormAccount = { id: string; accountNumber: string; brokerServer: string; label: string | null };

const initialState: OrderFormState = { ok: false };

export function OrderForm({
  packages,
  accounts,
  defaultPackageId,
  defaultAccountId,
}: {
  packages: OrderFormPackage[];
  accounts: OrderFormAccount[];
  defaultPackageId: string | null;
  defaultAccountId: string | null;
}) {
  const [state, formAction] = useActionState(createOrderAction, initialState);
  const errors = state.fieldErrors ?? {};
  const anyOrderable = packages.some((p) => p.price !== null);
  const selectedPackage = state.values?.packageId || defaultPackageId || "";
  const selectedAccount = state.values?.mt5AccountId ?? defaultAccountId ?? "";

  return (
    <form className="mt-6 space-y-6" action={formAction}>
      {state.formError ? <Notice tone="error">{state.formError}</Notice> : null}

      <fieldset>
        <legend className="text-[17px] font-semibold text-ink">1. เลือกแพ็กเกจ</legend>
        <div className="mt-3 space-y-2">
          {packages.map((p) => (
            <label
              key={p.id}
              className={`flex items-center gap-3 rounded-lg border border-rule bg-surface px-4 py-3 ${p.price === null ? "opacity-70" : "cursor-pointer has-[:checked]:border-ink"}`}
            >
              <input
                type="radio"
                name="packageId"
                value={p.id}
                required
                disabled={p.price === null}
                defaultChecked={p.price !== null && p.id === selectedPackage}
              />
              <span className="flex-1">
                <span className="block text-[15.5px] font-medium text-ink">{p.name}</span>
                <span className="block text-[13.5px] text-muted">{p.period}</span>
              </span>
              <span className="tabular text-[15px] font-medium text-ink">{p.price ?? "สอบถามราคา"}</span>
            </label>
          ))}
        </div>
        {errors.packageId ? (
          <span role="alert" className="mt-1 block text-[13px] text-put">
            {errors.packageId}
          </span>
        ) : null}
        {packages.some((p) => p.price === null) ? (
          <p className="mt-2 text-[13.5px] text-muted">
            แพ็กเกจที่แสดง &quot;สอบถามราคา&quot; ยังไม่เปิดขายออนไลน์{" "}
            <LineLink>
              สอบถามราคาทาง LINE
            </LineLink>
          </p>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="text-[17px] font-semibold text-ink">2. ซื้อให้บัญชี MT5 ไหน</legend>
        <div className="mt-2">
          <Field
            label="บัญชี MT5"
            hint="บัญชีใหม่: ชำระเงินก่อน แล้วเลือกโบรกเกอร์และกรอกเลขบัญชีในหน้าคำสั่งซื้อ · ต่ออายุ: เลือกบัญชีเดิม ชำระแล้ว license ต่ออายุทันที"
            error={errors.mt5AccountId}
          >
            <Select name="mt5AccountId" defaultValue={selectedAccount}>
              <option value="">บัญชีใหม่ (กรอกเลขบัญชีหลังชำระเงิน)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountNumber} · {a.brokerServer}
                  {a.label ? ` (${a.label})` : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </fieldset>

      {anyOrderable ? (
        <SubmitButton pendingLabel="กำลังสร้างคำสั่งซื้อ…">สร้างคำสั่งซื้อ</SubmitButton>
      ) : (
        <Notice tone="warn">
          ขณะนี้ยังไม่มีแพ็กเกจที่เปิดขายออนไลน์ กรุณา{" "}
          <LineLink>
            สอบถามราคาทาง LINE
          </LineLink>
        </Notice>
      )}
    </form>
  );
}
