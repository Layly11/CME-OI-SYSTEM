import type { ComponentProps, ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[14.5px] font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[13px] text-muted">{hint}</span> : null}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={`mt-1.5 block w-full rounded-md border border-rule bg-surface px-3 py-2.5 text-[15px] text-text placeholder:text-muted/70 focus:border-ink ${props.className ?? ""}`}
    />
  );
}

export function Select(props: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={`mt-1.5 block w-full rounded-md border border-rule bg-surface px-3 py-2.5 text-[15px] text-text focus:border-ink ${props.className ?? ""}`}
    />
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  const cls = tone === "warn" ? "bg-gold-soft text-text" : "bg-ink/5 text-text";
  return <div className={`rounded-md px-4 py-3 text-[14px] ${cls}`}>{children}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "ใช้งานได้", cls: "bg-call/10 text-call" },
    pending: { label: "รอตรวจสอบ", cls: "bg-gold-soft text-gold-deep" },
    expired: { label: "หมดอายุ", cls: "bg-put/10 text-put" },
    suspended: { label: "ระงับ", cls: "bg-put/10 text-put" },
    awaiting_review: { label: "รอตรวจสลิป", cls: "bg-gold-soft text-gold-deep" },
    paid: { label: "ชำระแล้ว", cls: "bg-call/10 text-call" },
    pending_payment: { label: "รอชำระ", cls: "bg-ink/5 text-muted" },
    rejected: { label: "ไม่ผ่าน", cls: "bg-put/10 text-put" },
    verified: { label: "ยืนยันแล้ว", cls: "bg-call/10 text-call" },
    unverified: { label: "ยังไม่ตรวจ", cls: "bg-ink/5 text-muted" },
    not_under_ib: { label: "ไม่ได้อยู่ใต้ IB", cls: "bg-ink/5 text-muted" },
  };
  const s = map[status] ?? { label: status, cls: "bg-ink/5 text-muted" };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[12.5px] font-medium ${s.cls}`}>{s.label}</span>
  );
}
