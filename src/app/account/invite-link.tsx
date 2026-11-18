"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui";

const noSubscribe = () => () => {};

/**
 * ลิงก์ชวนเพื่อนของผู้ใช้ + ปุ่มคัดลอก
 * `path` คือ /register?ref=CODE — URL เต็มใช้ origin ของหน้าที่เปิดอยู่จริง (หลัง hydrate)
 * ยังไม่มี JavaScript: ใช้ `siteOrigin` จาก NEXT_PUBLIC_SITE_URL ถ้าตั้งไว้ ไม่ได้ตั้งก็แสดง path เฉยๆ
 */
export function InviteLink({ path, siteOrigin }: { path: string; siteOrigin: string | null }) {
  const browserOrigin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => null,
  );
  const url = (browserOrigin ?? siteOrigin ?? "") + path;
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("done");
    } catch {
      // เบราว์เซอร์ไม่ให้เขียน clipboard (เช่นไม่ใช่ https) → ให้ผู้ใช้คัดลอกจากช่องเอง
      setCopied("failed");
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <input
        readOnly
        value={url}
        aria-label="ลิงก์ชวนเพื่อนของคุณ"
        data-testid="invite-link"
        onFocus={(e) => e.currentTarget.select()}
        className="tabular min-w-0 flex-1 rounded-md border border-rule bg-surface px-3 py-2.5 text-[14.5px] text-text focus:border-ink"
      />
      <Button type="button" variant="outline-ink" onClick={copy}>
        {copied === "done" ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
      </Button>
      <span role="status" className="basis-full text-[13px] text-muted">
        {copied === "failed" ? "คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความในช่องแล้วคัดลอกเอง" : ""}
      </span>
    </div>
  );
}
