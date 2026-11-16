import type { Metadata } from "next";
import { ChevronDown } from "lucide-react";
import { Container, SectionTitle } from "@/components/ui";
import { LineLink } from "@/components/line-link";
import { faqs } from "@/content/site";

export const metadata: Metadata = {
  title: "คำถามที่พบบ่อย",
  description: "คำตอบเรื่องการใช้งาน license การติดตั้ง และเงื่อนไขของ CME OI SYSTEM",
};

export default function FaqPage() {
  return (
    <>
      <section className="border-b border-rule bg-surface py-14">
        <Container>
          <SectionTitle title="คำถามที่พบบ่อย" lead="ถ้าไม่พบคำตอบที่ต้องการ ทักทีมงานทาง LINE ได้เลย" />
        </Container>
      </section>
      <section className="py-14">
        <Container>
          <div className="max-w-[760px] divide-y divide-rule border-y border-rule">
            {faqs.map((f) => (
              <details key={f.q} className="py-4">
                <summary className="flex items-center justify-between gap-4 text-[17px] font-medium text-ink">
                  {f.q}
                  <ChevronDown className="faq-chevron shrink-0 text-muted" size={20} aria-hidden="true" />
                </summary>
                <p className="mt-3 max-w-[70ch] text-[15.5px] text-muted">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-8 text-[15px] text-muted">
            ยังมีคำถาม? ติดต่อทีมงานทาง{" "}
            <LineLink>
              LINE
            </LineLink>
          </p>
        </Container>
      </section>
    </>
  );
}
