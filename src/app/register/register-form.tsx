"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import { registerAction, type RegisterState } from "@/app/actions/auth";
import { Field, Input, Notice } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";

const initialState: RegisterState = { ok: false };

/** `children` = ช่องซ่อน `package` และ `ref` (รหัสชวนเพื่อน) ที่ server component ส่งเข้ามา (อ่านจาก query ใน <Suspense>) */
export function RegisterForm({ children }: { children?: ReactNode }) {
  const [state, formAction] = useActionState(registerAction, initialState);
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};

  return (
    <form className="mt-8 space-y-6" action={formAction}>
      {state.formError ? <Notice tone="error">{state.formError}</Notice> : null}

      <fieldset className="space-y-4">
        <legend className="text-[17px] font-semibold text-ink">ข้อมูลผู้ใช้</legend>
        <Field label="ชื่อ–นามสกุล" error={errors.name}>
          <Input name="name" autoComplete="name" required maxLength={100} defaultValue={values.name} />
        </Field>
        <Field label="อีเมล" hint="ใช้เข้าสู่ระบบเว็บไซต์" error={errors.email}>
          <Input name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={values.email} />
        </Field>
        <Field
          label="รหัสผ่านสำหรับเว็บไซต์"
          hint="อย่างน้อย 8 ตัวอักษร (ไม่ใช่รหัสผ่าน MT5)"
          error={errors.password}
        >
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
        </Field>
        <Field label="เบอร์โทร (ไม่บังคับ)" hint="ใช้ติดต่อกรณีมีปัญหาการติดตั้ง" error={errors.phone}>
          <Input name="phone" type="tel" autoComplete="tel" maxLength={20} defaultValue={values.phone} />
        </Field>
        <Field label="LINE ID (ไม่บังคับ)" error={errors.lineId}>
          <Input name="lineId" maxLength={50} defaultValue={values.lineId} />
        </Field>
      </fieldset>

      <div>
        <label className="flex items-start gap-3 text-[14.5px] text-text">
          <input type="checkbox" name="accept" required className="mt-1.5" />
          <span>
            ฉันได้อ่านและยอมรับ{" "}
            <Link href="/legal/terms" className="text-link underline underline-offset-4">
              ข้อตกลงการใช้งาน
            </Link>
            ,{" "}
            <Link href="/legal/privacy" className="text-link underline underline-offset-4">
              นโยบายความเป็นส่วนตัว
            </Link>{" "}
            และ{" "}
            <Link href="/legal/risk" className="text-link underline underline-offset-4">
              คำเตือนความเสี่ยง
            </Link>
          </span>
        </label>
        {errors.accept ? (
          <span role="alert" className="mt-1 block text-[13px] text-put">
            {errors.accept}
          </span>
        ) : null}
      </div>

      {children}

      <SubmitButton className="w-full sm:w-auto" pendingLabel="กำลังสมัคร…">
        สมัครสมาชิก
      </SubmitButton>
    </form>
  );
}
