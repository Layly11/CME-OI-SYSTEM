"use client";

import { useActionState, useState } from "react";
import { deleteMt5AccountAction, type SimpleActionState } from "@/app/actions/purchase";

const initialState: SimpleActionState = { ok: false };
const linkClass = "text-link underline underline-offset-4 disabled:opacity-50";

/**
 * ลบบัญชี MT5 ที่ยังไม่มี license (เช่นกรอกเลขผิด) แบบ 2 จังหวะ กันกดพลาด
 * เซิร์ฟเวอร์ตรวจเจ้าของ และปฏิเสธถ้าบัญชีมี license หรือคำสั่งซื้อที่ชำระแล้ว/รอตรวจ
 */
export function DeleteMt5AccountButton({ accountId, accountNumber }: { accountId: string; accountNumber: string }) {
  const [state, formAction, pending] = useActionState(deleteMt5AccountAction.bind(null, accountId), initialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <span className="inline-block">
      {confirming ? (
        <form action={formAction} className="inline-flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <span className="text-text">ลบเลข {accountNumber}?</span>
          <button type="submit" className={linkClass} disabled={pending}>
            {pending ? "กำลังลบ…" : "ยืนยันลบ"}
          </button>
          <button type="button" className={linkClass} disabled={pending} onClick={() => setConfirming(false)}>
            ไม่ลบ
          </button>
        </form>
      ) : (
        <button type="button" className={linkClass} onClick={() => setConfirming(true)}>
          ลบ
        </button>
      )}
      {state.formError ? (
        <span role="alert" className="mt-1 block max-w-[280px] text-[13px] text-put">
          {state.formError}
        </span>
      ) : null}
    </span>
  );
}
