import type { Metadata } from "next";
import { Check } from "lucide-react";
import { ButtonLink, Container, SectionTitle } from "@/components/ui";
import { packageIncludes, packages, riskNotice, site } from "@/content/site";

export const metadata: Metadata = {
  title: "แพ็กเกจและราคา",
  description: "เลือกระยะเวลาใช้งาน CME OI SYSTEM รายเดือน 6 เดือน รายปี หรือตลอดชีพ ทุกแพ็กเกจได้เครื่องมือครบชุด",
};

const buySteps = [
  { title: "เลือกแพ็กเกจ", body: "รายเดือน 6 เดือน รายปี หรือตลอดชีพ" },
  { title: "สมัครและลงทะเบียนเลขบัญชี MT5", body: "ใส่เลขบัญชีและชื่อเซิร์ฟเวอร์โบรกเกอร์ ไม่ต้องใส่รหัสผ่าน" },
  { title: "ชำระเงิน", body: "โอนผ่านธนาคารหรือ PromptPay แล้วแนบสลิป (บัตรเครดิตจะเปิดให้ใช้เร็วๆ นี้)" },
  { title: "รับไฟล์ติดตั้งทางอีเมล", body: "เมื่อทีมงานยืนยันการชำระเงิน license จะเปิดใช้และส่งลิงก์ดาวน์โหลดพร้อมคู่มือให้ทันที" },
];

export default function PricingPage() {
  return (
    <>
      <section className="border-b border-rule bg-surface py-14">
        <Container>
          <SectionTitle
            title="แพ็กเกจและราคา"
            lead="ทุกแพ็กเกจได้เครื่องมือครบชุดเหมือนกัน ต่างกันเฉพาะระยะเวลาใช้งาน 1 license ใช้กับบัญชี MT5 ที่ลงทะเบียน 1 บัญชี"
          />
        </Container>
      </section>

      <section className="py-14">
        <Container>
          <div className="grid gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
            {packages.map((p) => (
              <div key={p.code} className={`flex flex-col bg-surface p-6 ${p.highlight ? "bg-gold-soft" : ""}`}>
                <h2 className="text-[22px] text-ink">{p.name}</h2>
                <p className="text-[14px] text-muted">{p.period}</p>
                <p className="tabular mt-5 text-[28px] font-semibold text-ink">
                  {p.priceThb === null ? "สอบถามราคา" : `${p.priceThb.toLocaleString("th-TH")} บาท`}
                </p>
                {p.note ? <p className="mt-2 text-[14px] text-muted">{p.note}</p> : null}
                <div className="mt-6 pt-2">
                  <ButtonLink
                    href={`/register?package=${p.code}`}
                    variant={p.highlight ? "gold" : "outline-ink"}
                    className="w-full"
                  >
                    เลือก{p.name}
                  </ButtonLink>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 grid gap-12 lg:grid-cols-2">
            <div>
              <h2 className="text-[22px] text-ink">ทุกแพ็กเกจรวม</h2>
              <ul className="mt-4 space-y-2.5">
                {packageIncludes.map((item) => (
                  <li key={item} className="flex gap-3 text-[15.5px] text-text">
                    <Check className="mt-1 shrink-0 text-call" size={18} aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-[14.5px] text-muted">
                ลูกค้าที่เปิดบัญชีเทรดผ่านพาร์ตเนอร์ของเรามีเงื่อนไขพิเศษ สอบถามรายละเอียดได้ทาง{" "}
                <a href={site.lineUrl} className="text-link underline underline-offset-4">
                  LINE
                </a>
              </p>
            </div>
            <div>
              <h2 className="text-[22px] text-ink">ขั้นตอนการสั่งซื้อ</h2>
              <ol className="mt-4 divide-y divide-rule border-y border-rule">
                {buySteps.map((s, i) => (
                  <li key={s.title} className="grid grid-cols-[40px_1fr] gap-2 py-3.5">
                    <span className="tabular text-[20px] font-semibold leading-none text-gold-deep">{i + 1}</span>
                    <div>
                      <h3 className="text-[16px] font-semibold text-ink">{s.title}</h3>
                      <p className="mt-0.5 text-[14.5px] text-muted">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <p className="mt-12 max-w-[90ch] border-t border-rule pt-6 text-[13.5px] text-muted">{riskNotice}</p>
        </Container>
      </section>
    </>
  );
}
