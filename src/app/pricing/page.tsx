import type { Metadata } from "next";
import { Check } from "lucide-react";
import { Container, SectionTitle } from "@/components/ui";
import { LineLink } from "@/components/line-link";
import { FreePackageInfo, PackageCards } from "@/components/package-cards";
import { packageIncludes, riskNotice } from "@/content/site";

// รายการแพ็กเกจ/ราคา/วันแถมมาจากตาราง packages (<PackageCards>) — ข้อความในไฟล์นี้จึงไม่ระบุชื่อแพ็กเกจหรือราคา
export const metadata: Metadata = {
  title: "แพ็กเกจและราคา",
  description: "เลือกระยะเวลาใช้งาน CME OI SYSTEM ทุกแพ็กเกจได้เครื่องมือครบชุด ดูราคาและวันแถมของแต่ละแพ็กเกจ",
};

// ลำดับตรงกับหน้าคำสั่งซื้อจริง: ชำระ → เลือกโบรกเกอร์ → กรอกเลขบัญชี MT5 → เปิด license อัตโนมัติ
// ระบบยังไม่ส่งอีเมลและยังไม่มีหน้าดาวน์โหลด — ไฟล์ติดตั้งรับจากทีมงานทาง LINE (อย่าเขียนว่าส่งทางอีเมลจนกว่าจะทำจริง)
const buySteps = [
  { title: "เลือกแพ็กเกจและสมัครสมาชิก", body: "เลือกระยะเวลาที่ต้องการ แล้วสมัครสมาชิกเว็บด้วยอีเมลและรหัสผ่านของเว็บ" },
  { title: "ชำระเงินด้วยบัตร", body: "ชำระด้วยบัตรเครดิต/เดบิต ยังไม่มีบัญชีเทรดก็ชำระก่อนได้" },
  {
    title: "เลือกโบรกเกอร์และเปิดบัญชีเทรด",
    body: "เลือกโบรกเกอร์พาร์ตเนอร์ 1 ราย เปิดบัญชีเทรดกับโบรกเกอร์โดยตรง ลูกค้าเดิมใช้บัญชี MT5 ที่ลงทะเบียนไว้แล้วได้",
  },
  {
    title: "กรอกเลขบัญชี MT5",
    body: "กลับมากรอกเลขบัญชี MT5 (ไม่ต้องใส่รหัสผ่าน MT5) ระบบเปิด license ให้อัตโนมัติ แล้วรับไฟล์ติดตั้งจากทีมงานทาง LINE",
  },
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
          <PackageCards variant="pricing" />

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
                <LineLink>
                  LINE
                </LineLink>
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

          {/* คำอธิบายการชวนเพื่อน — แสดงเฉพาะเมื่อแพ็กเกจฟรีเปิดให้รับอยู่ในฐานข้อมูล */}
          <FreePackageInfo />

          <p className="mt-12 max-w-[90ch] border-t border-rule pt-6 text-[13.5px] text-muted">{riskNotice}</p>
        </Container>
      </section>
    </>
  );
}
