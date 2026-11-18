import type { ComponentProps, ReactNode } from "react";

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[14.5px] font-medium text-ink">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-[13px] text-put">
          {error}
        </span>
      ) : null}
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

type NoticeTone = "info" | "warn" | "error" | "success";

const noticeTones: Record<NoticeTone, string> = {
  info: "bg-ink/5 text-text",
  warn: "bg-gold-soft text-text",
  error: "bg-put/10 text-put",
  success: "bg-call/10 text-call",
};

export function Notice({ tone = "info", children }: { tone?: NoticeTone; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`rounded-md px-4 py-3 text-[14px] ${noticeTones[tone]}`}>
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "ใช้งานได้", cls: "bg-call/10 text-call" },
    pending: { label: "รอตรวจสอบ", cls: "bg-gold-soft text-gold-deep" },
    expired: { label: "หมดอายุ", cls: "bg-put/10 text-put" },
    suspended: { label: "ระงับ", cls: "bg-put/10 text-put" },
    // pending / awaiting_review: สถานะของขั้นตอนตรวจสลิปเดิม — ขั้นตอนบัตร + เปิด license อัตโนมัติไม่สร้างสถานะนี้ (คงไว้ให้ข้อมูลเดิม)
    awaiting_review: { label: "รอตรวจสลิป", cls: "bg-gold-soft text-gold-deep" },
    // ขั้นของคำสั่งซื้อที่ชำระแล้ว (orderStep ใน src/lib/purchase/order-progress.ts)
    choose_broker: { label: "ชำระแล้ว · รอเลือกโบรกเกอร์", cls: "bg-gold-soft text-gold-deep" },
    submit_account: { label: "ชำระแล้ว · รอเลขบัญชี MT5", cls: "bg-gold-soft text-gold-deep" },
    activating: { label: "กำลังเปิดใช้งาน", cls: "bg-gold-soft text-gold-deep" },
    // ชำระแล้ว มีบัญชีแล้ว แต่ระบบเปิด license เองไม่ได้ (license ถูกระงับ / ตลอดชีพอยู่แล้ว / ชำระแบบจำลอง)
    blocked: { label: "ชำระแล้ว · รอทีมงานตรวจสอบ", cls: "bg-put/10 text-put" },
    // แพ็กเกจฟรีจากการชวนเพื่อน: ไม่มีการชำระเงิน ป้ายจึงเป็น "รับสิทธิ์แล้ว" (orderBadgeStatus)
    free_choose_broker: { label: "รับสิทธิ์แล้ว · รอเลือกโบรกเกอร์", cls: "bg-gold-soft text-gold-deep" },
    free_submit_account: { label: "รับสิทธิ์แล้ว · รอเลขบัญชี MT5", cls: "bg-gold-soft text-gold-deep" },
    free_blocked: { label: "รับสิทธิ์แล้ว · รอทีมงานตรวจสอบ", cls: "bg-put/10 text-put" },
    // license ของคำสั่งซื้ออยู่ในรายชื่อที่เผยแพร่แล้ว (ขั้น active ของ orderStep — ใช้ key แยกจากสถานะ license "active")
    order_active: { label: "เปิดใช้งานแล้ว", cls: "bg-call/10 text-call" },
    paid: { label: "ชำระแล้ว", cls: "bg-call/10 text-call" },
    pending_payment: { label: "รอชำระ", cls: "bg-ink/5 text-muted" },
    rejected: { label: "ไม่ผ่าน", cls: "bg-put/10 text-put" },
    cancelled: { label: "ยกเลิก", cls: "bg-ink/5 text-muted" },
    refunded: { label: "คืนเงินแล้ว", cls: "bg-ink/5 text-muted" },
    verified: { label: "ยืนยันแล้ว", cls: "bg-call/10 text-call" },
    unverified: { label: "ยังไม่ตรวจ", cls: "bg-ink/5 text-muted" },
    not_under_ib: { label: "ไม่ได้อยู่ใต้ IB", cls: "bg-ink/5 text-muted" },
  };
  const s = map[status] ?? { label: status, cls: "bg-ink/5 text-muted" };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[12.5px] font-medium ${s.cls}`}>{s.label}</span>
  );
}
