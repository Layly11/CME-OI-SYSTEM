"use client";

import { useActionState, type ReactNode } from "react";
import { loginAction, type LoginState } from "@/app/actions/auth";
import { Field, Input, Notice } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";

const initialState: LoginState = { ok: false };

/** `children` = ช่องซ่อน `next` ที่ server component ส่งเข้ามา (อ่านจาก query ใน <Suspense>) */
export function LoginForm({ children }: { children?: ReactNode }) {
  const [state, formAction] = useActionState(loginAction, initialState);

  return (
    <form className="mt-6 space-y-4" action={formAction}>
      {state.formError ? <Notice tone="error">{state.formError}</Notice> : null}
      <Field label="อีเมล">
        <Input name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
      </Field>
      <Field label="รหัสผ่าน">
        <Input name="password" type="password" autoComplete="current-password" required maxLength={128} />
      </Field>
      {children}
      <SubmitButton className="w-full" pendingLabel="กำลังเข้าสู่ระบบ…">
        เข้าสู่ระบบ
      </SubmitButton>
    </form>
  );
}
