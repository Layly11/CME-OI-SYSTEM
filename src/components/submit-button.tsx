"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "./ui";

/** ปุ่ม submit ที่ปิดตัวเองระหว่างส่งฟอร์ม (ต้องอยู่ภายใน <form>) */
export function SubmitButton({
  pendingLabel,
  children,
  disabled,
  ...rest
}: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" {...rest} disabled={pending || disabled} aria-busy={pending || undefined}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
