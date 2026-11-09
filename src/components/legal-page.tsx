import type { ReactNode } from "react";
import Link from "next/link";
import { Container } from "./ui";
import { legalLinks } from "@/content/site";

/** TODO: ให้ลูกค้ายืนยันชื่อนิติบุคคล/ผู้ให้บริการที่จะใช้ในเอกสารทางกฎหมาย */
export const PROVIDER_NAME = process.env.NEXT_PUBLIC_PROVIDER_NAME ?? "[ชื่อผู้ให้บริการ / บริษัท]";
export const LEGAL_UPDATED = "9 พฤศจิกายน 2569";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <section className="border-b border-rule bg-surface py-12">
        <Container>
          <h1 className="text-[30px] text-ink sm:text-[34px]">{title}</h1>
          <p className="mt-2 text-[14px] text-muted">ปรับปรุงล่าสุด {LEGAL_UPDATED}</p>
        </Container>
      </section>
      <section className="py-12">
        <Container className="grid gap-12 lg:grid-cols-[1fr_240px]">
          <article className="prose-th text-[15.5px]">{children}</article>
          <nav aria-label="เอกสารอื่น" className="lg:sticky lg:top-24 lg:self-start">
            <h2 className="text-[14px] font-semibold text-ink">เอกสารทั้งหมด</h2>
            <ul className="mt-2 space-y-1.5 text-[14.5px]">
              {legalLinks.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-link underline-offset-4 hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-6 rounded-md bg-gold-soft p-3 text-[13px] text-text">
              เอกสารฉบับร่าง รอผู้ให้บริการและที่ปรึกษากฎหมายตรวจก่อนเผยแพร่จริง
            </p>
          </nav>
        </Container>
      </section>
    </>
  );
}
