import { io } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { cache, Suspense } from "react";
import { Notice } from "@/components/form";
import { LineLink } from "@/components/line-link";
import { ButtonLink } from "@/components/ui";
import { packageCopy, referralCopy } from "@/content/site";
import { safeErrorSummary } from "@/lib/db-errors";
import {
  isFreeReferralPackage,
  packageDisplayName,
  packagePeriodText,
  packagePriceText,
} from "@/lib/purchase/packages";
import { listActivePackages, type PackageDto } from "@/lib/purchase/repo";

/**
 * รายการแพ็กเกจและราคาบนหน้าบ้าน (หน้าแรก / หน้าแพ็กเกจ) — อ่านจากตาราง packages ที่เดียวกับหน้าสั่งซื้อและขั้นคิดเงิน
 * จึงไม่มีทางที่หน้าบ้านโชว์ราคาหนึ่งแล้วคำสั่งซื้อคิดอีกราคา
 *
 * cacheComponents: ข้อมูลนี้เปลี่ยนได้โดยไม่ build ใหม่ จึงอ่านตอนมีคำขอ ภายใน <Suspense> —
 * `await io()` หยุดการ prerender ตรงนี้ (เอกสาร Next: api-reference/functions/io) โครงหน้าที่เหลือยัง prerender ได้
 * และ `next build` ไม่แตะฐานข้อมูล (build ผ่านแม้ไม่ได้ตั้ง DATABASE_URL)
 * อ่านฐานข้อมูลไม่ได้ตอนมีคำขอ → แสดงข้อความให้ลองใหม่/สอบถามทาง LINE ไม่มีราคาสำรองในโค้ด
 */
/**
 * อ่านรายการแพ็กเกจที่เปิดขาย — cache() ของ React = อ่านฐานข้อมูลครั้งเดียวต่อคำขอ แม้หน้ามีหลายส่วนที่ใช้ (ไม่ cache ข้ามคำขอ)
 * อ่านไม่ได้คืน [] (ผู้เรียกแสดงข้อความแทน) — ต้องเรียกหลัง `await io()` เท่านั้น
 */
const loadActivePackages = cache(async (): Promise<PackageDto[]> => {
  try {
    return await listActivePackages();
  } catch (err) {
    unstable_rethrow(err);
    console.error("[packages] โหลดรายการแพ็กเกจไม่ได้:", safeErrorSummary(err));
    return [];
  }
});

export function PackageCards({ variant }: { variant: "pricing" | "home" }) {
  return (
    <Suspense fallback={<PackageCardsMessage busy>กำลังโหลดรายการแพ็กเกจ…</PackageCardsMessage>}>
      <PackageCardsContent variant={variant} />
    </Suspense>
  );
}

function PackageCardsMessage({ busy = false, children }: { busy?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-rule bg-surface px-5 py-6 text-[15px] text-muted" aria-busy={busy || undefined}>
      {children}
    </div>
  );
}

async function PackageCardsContent({ variant }: { variant: "pricing" | "home" }) {
  await io();
  const packages = await loadActivePackages();
  if (packages.length === 0) {
    return (
      <div data-testid="packages-unavailable">
        <Notice tone="warn">
          ยังแสดงรายการแพ็กเกจและราคาไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือ <LineLink>สอบถามทาง LINE</LineLink>
        </Notice>
      </div>
    );
  }

  const pricing = variant === "pricing";
  return (
    <div
      className="grid gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4"
      data-testid="package-cards"
    >
      {packages.map((p) => {
        const copy = packageCopy[p.code] ?? {};
        const free = isFreeReferralPackage(p);
        const Heading = pricing ? "h2" : "h3";
        return (
          <div
            key={p.id}
            className={`flex flex-col bg-surface p-6 ${copy.highlight ? "bg-gold-soft" : ""}`}
            data-package={p.code}
          >
            <Heading className={pricing ? "text-[22px] text-ink" : "text-[20px] text-ink"}>{packageDisplayName(p)}</Heading>
            <p className="text-[14px] text-muted">ใช้งาน {packagePeriodText(p)}</p>
            <p className={`tabular mt-5 font-semibold text-ink ${pricing ? "text-[28px]" : "text-[26px]"}`}>
              {packagePriceText(p)}
            </p>
            {free && p.description ? (
              <p className="mt-2 text-[14.5px] font-medium text-ink">เงื่อนไข: {p.description}</p>
            ) : null}
            {copy.note ? <p className="mt-2 text-[14px] text-muted">{copy.note}</p> : null}
            {pricing ? (
              <div className="mt-auto pt-6">
                <ButtonLink
                  href={`/register?package=${p.code}`}
                  variant={copy.highlight ? "gold" : "outline-ink"}
                  className="w-full"
                >
                  {free ? "สมัครและรับลิงก์ชวนเพื่อน" : `เลือก ${p.nameTh}`}
                </ButtonLink>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * คำอธิบายการชวนเพื่อนบนหน้าแพ็กเกจ — แสดงเฉพาะเมื่อแพ็กเกจฟรีจากการชวนเพื่อนเปิดให้รับอยู่ในตาราง packages
 * (ปิดแพ็กเกจฟรีในฐานข้อมูล = ส่วนนี้หายไปเอง ไม่มีข้อความชวนเพื่อนค้างบนหน้าเว็บ)
 */
export function FreePackageInfo() {
  return (
    <Suspense fallback={null}>
      <FreePackageInfoContent />
    </Suspense>
  );
}

async function FreePackageInfoContent() {
  await io();
  const free = (await loadActivePackages()).find((p) => p.orderable && isFreeReferralPackage(p));
  if (!free) return null;
  return (
    <div className="mt-12 max-w-[72ch]" data-testid="referral-info">
      <h2 className="text-[22px] text-ink">{referralCopy.title}</h2>
      <p className="mt-2 text-[15.5px] text-text">
        แพ็กเกจ{packageDisplayName(free)} ใช้งาน {packagePeriodText(free)}
        {free.description ? ` · เงื่อนไข: ${free.description}` : ""}
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15.5px] text-text">
        {referralCopy.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="mt-3 text-[14.5px] text-muted">{referralCopy.limits}</p>
    </div>
  );
}
