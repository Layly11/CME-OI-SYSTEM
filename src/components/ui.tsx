import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type ButtonVariant = "gold" | "outline-ink" | "outline-light" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-[15px] font-medium transition-colors disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  gold: "bg-gold text-ink hover:bg-[#d8b23a]",
  "outline-ink": "border border-ink/30 text-ink hover:border-ink hover:bg-ink/5",
  "outline-light": "border border-white/30 text-on-ink hover:border-white/70 hover:bg-white/5",
  ghost: "text-ink hover:bg-ink/5",
};

export function ButtonLink({
  href,
  variant = "gold",
  className = "",
  children,
  ...rest
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </Link>
  );
}

export function Button({
  variant = "gold",
  className = "",
  children,
  ...rest
}: { variant?: ButtonVariant; className?: string; children: ReactNode } & ComponentProps<"button">) {
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Container({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`mx-auto w-full max-w-[1120px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function SectionTitle({
  title,
  lead,
  id,
  onInk = false,
}: {
  title: string;
  lead?: string;
  id?: string;
  onInk?: boolean;
}) {
  return (
    <div className="max-w-[640px]">
      <h2
        id={id}
        className={`scroll-mt-24 text-[28px] sm:text-[34px] ${onInk ? "text-on-ink" : "text-ink"}`}
      >
        {title}
      </h2>
      {lead ? (
        <p className={`mt-3 text-[17px] ${onInk ? "text-on-ink-muted" : "text-muted"}`}>{lead}</p>
      ) : null}
    </div>
  );
}

export function Logo({ onInk = false }: { onInk?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <rect x="3" y="17" width="4" height="10" rx="1" fill={onInk ? "#C9A227" : "#0E1F3D"} />
        <rect x="10" y="12" width="4" height="15" rx="1" fill={onInk ? "#C9A227" : "#0E1F3D"} />
        <rect x="17" y="7" width="4" height="20" rx="1" fill={onInk ? "#C9A227" : "#0E1F3D"} />
        <path
          d="M4 11 L13 6 L19 9 L27 3"
          fill="none"
          stroke={onInk ? "#E9EDF5" : "#C9A227"}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={`text-[17px] font-semibold tracking-tight ${onInk ? "text-on-ink" : "text-ink"}`}>
        CME OI SYSTEM
      </span>
    </span>
  );
}
