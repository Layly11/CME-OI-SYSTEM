import Image from "next/image";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Ladder } from "@/components/ladder";
import { ButtonLink, Container, SectionTitle } from "@/components/ui";
import {
  facts,
  faqs,
  features,
  packages,
  screenshots,
  site,
  steps,
} from "@/content/site";

export default function HomePage() {
  return (
    <>
      {/* Hero: ส่วนมืด = หน้าจอเทรด */}
      <section className="on-ink bg-ink text-on-ink">
        <Container className="grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-[7fr_5fr] lg:gap-16 lg:py-24">
          <div>
            <p className="text-[15px] text-on-ink-muted">เครื่องมือวิเคราะห์ทองคำบน MetaTrader 5</p>
            <h1 className="mt-3 text-[34px] leading-[1.2] text-on-ink sm:text-[42px] lg:text-[46px]">
              เห็นว่าสถาบันวางเงินไว้ที่ราคาไหน ก่อนที่กราฟจะวิ่งไปถึง
            </h1>
            <p className="mt-5 max-w-[52ch] text-[17px] text-on-ink-muted sm:text-[18px]">
              CME OI SYSTEM ดึง Open Interest, Option Flow และ Volume ของตลาดฟิวเจอร์สทองคำจาก CME Group
              มาวางบนกราฟ XAUUSD ใน MT5 ของคุณ ระดับราคาที่มีสัญญาค้างมากจึงเห็นได้ทันที
              โดยไม่ต้องเปิดเว็บ CME แยกต่างหาก
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/pricing">ดูแพ็กเกจ</ButtonLink>
              <ButtonLink href={site.lineUrl} variant="outline-light">
                สอบถามทาง LINE
              </ButtonLink>
            </div>
            <p className="mt-6 text-[13.5px] text-on-ink-muted">
              ใช้กับบัญชี MT5 ของคุณเอง เราไม่ขอรหัสผ่านบัญชีเทรด
            </p>
          </div>
          <Ladder />
        </Container>
      </section>

      {/* ข้อเท็จจริง 4 ข้อ */}
      <section className="border-b border-rule bg-surface">
        <Container className="grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
          {facts.map((f) => (
            <div key={f.title}>
              <h2 className="text-[16px] font-semibold text-ink">{f.title}</h2>
              <p className="mt-1.5 text-[14.5px] text-muted">{f.body}</p>
            </div>
          ))}
        </Container>
      </section>

      {/* วิธีใช้ 5 ขั้น */}
      <section className="py-20">
        <Container>
          <SectionTitle
            id="how-it-works"
            title="เช็กให้ครบ 5 ข้อ ก่อนเข้าออเดอร์"
            lead="ลำดับการอ่านข้อมูลที่ผู้พัฒนาใช้จริง เริ่มจากโซนราคา ไปจนถึงการยืนยันด้วยแรงซื้อ–ขาย"
          />
          <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_380px] lg:items-start">
            <ol className="divide-y divide-rule border-y border-rule">
              {steps.map((s, i) => (
                <li key={s.title} className="grid gap-2 py-6 sm:grid-cols-[56px_1fr]">
                  <span className="tabular text-[28px] font-semibold leading-none text-gold-deep">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-[19px] text-ink">{s.title}</h3>
                    <p className="mt-1.5 max-w-[64ch] text-[15.5px] text-muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <figure className="overflow-hidden rounded-lg border border-rule bg-surface">
              <Image
                src="/images/checklist-5-steps.webp"
                alt="อินโฟกราฟิก Checklist 5 ข้อ ก่อนเข้าออเดอร์ของ CME OI SYSTEM"
                width={853}
                height={1280}
                sizes="(min-width: 1024px) 380px, 100vw"
                className="h-auto w-full"
              />
              <figcaption className="px-4 py-3 text-[13px] text-muted">
                Checklist ฉบับเต็ม ดาวน์โหลดได้ในหน้าบัญชีของสมาชิก
              </figcaption>
            </figure>
          </div>
        </Container>
      </section>

      {/* เครื่องมือ */}
      <section className="border-y border-rule bg-surface py-20">
        <Container>
          <SectionTitle
            id="features"
            title="เครื่องมือทั้งหมดอยู่บนกราฟเดียว"
            lead="ข้อมูลที่ปกติต้องเปิดดูหลายหน้าจอ ถูกจัดเป็นตารางซ้อนบนกราฟ XAUUSD แต่ละแถวคือระดับราคา"
          />
          <dl className="mt-10 grid gap-x-12 sm:grid-cols-2">
            {features.map((f) => (
              <div key={f.name} className="border-t border-rule py-4">
                <dt className="text-[16px] font-semibold text-ink">{f.name}</dt>
                <dd className="mt-1 text-[14.5px] text-muted">{f.body}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      {/* ภาพหน้าจอ */}
      <section className="py-20">
        <Container>
          <SectionTitle
            title="หน้าตาตอนใช้งานจริง"
            lead="ภาพจาก MT5 ของผู้พัฒนา ตารางทางขวาคือข้อมูลจาก CME ส่วนซ้ายคือกราฟราคาปกติ"
          />
          <div className="mt-10 space-y-12">
            {screenshots.map((s) => (
              <figure key={s.src}>
                <div className="overflow-hidden rounded-lg border border-rule bg-ink-deep">
                  <Image
                    src={s.src}
                    alt={s.alt}
                    width={s.width}
                    height={s.height}
                    sizes="(min-width: 1120px) 1056px, 100vw"
                    className="h-auto w-full"
                  />
                </div>
                <figcaption className="mt-3 max-w-[80ch] text-[14.5px] text-muted">{s.caption}</figcaption>
              </figure>
            ))}
          </div>
        </Container>
      </section>

      {/* แพ็กเกจ */}
      <section className="border-y border-rule bg-surface py-20">
        <Container>
          <SectionTitle
            id="pricing"
            title="แพ็กเกจ"
            lead="ทุกแพ็กเกจได้เครื่องมือครบชุดและอัปเดตฟรีตลอดอายุ license ต่างกันที่ระยะเวลา"
          />
          <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
            {packages.map((p) => (
              <div key={p.code} className={`bg-surface p-6 ${p.highlight ? "bg-gold-soft" : ""}`}>
                <h3 className="text-[20px] text-ink">{p.name}</h3>
                <p className="text-[14px] text-muted">{p.period}</p>
                <p className="tabular mt-5 text-[26px] font-semibold text-ink">
                  {p.priceThb === null ? "สอบถามราคา" : `${p.priceThb.toLocaleString("th-TH")} บาท`}
                </p>
                {p.note ? <p className="mt-2 text-[14px] text-muted">{p.note}</p> : null}
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <ButtonLink href="/pricing">ดูรายละเอียดและสมัคร</ButtonLink>
            <p className="text-[14px] text-muted">
              ลูกค้าที่เปิดบัญชีผ่านพาร์ตเนอร์ของเรามีเงื่อนไขพิเศษ สอบถามได้ทาง LINE
            </p>
          </div>
        </Container>
      </section>

      {/* ผู้พัฒนา */}
      <section className="py-20">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <SectionTitle title="คนที่อยู่เบื้องหลังระบบ" />
            <p className="mt-5 text-[17px] text-text">
              <span className="font-semibold">{site.developer.name}</span> ({site.developer.nameEn}){" "}
              {site.developer.title}
            </p>
            <ul className="mt-4 space-y-1.5 text-[15.5px] text-muted">
              {site.developer.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <Link href="/about" className="mt-6 inline-block text-[15px] text-link underline underline-offset-4">
              อ่านเรื่องราวของระบบและผู้พัฒนา
            </Link>
          </div>
          <figure className="overflow-hidden rounded-lg border border-rule">
            <Image
              src="/images/about-developer.webp"
              alt="อ.ธวัช ไชยศิริ ผู้พัฒนา CME OI SYSTEM"
              width={1536}
              height={1024}
              sizes="(min-width: 1024px) 540px, 100vw"
              className="h-auto w-full"
            />
          </figure>
        </Container>
      </section>

      {/* FAQ */}
      <section className="border-t border-rule bg-surface py-20">
        <Container className="grid gap-10 lg:grid-cols-[320px_1fr]">
          <SectionTitle title="คำถามที่พบบ่อย" />
          <div className="divide-y divide-rule border-y border-rule">
            {faqs.slice(0, 5).map((f) => (
              <details key={f.q} className="group py-4">
                <summary className="flex items-center justify-between gap-4 text-[17px] font-medium text-ink">
                  {f.q}
                  <ChevronDown className="faq-chevron shrink-0 text-muted" size={20} aria-hidden="true" />
                </summary>
                <p className="mt-3 max-w-[70ch] text-[15.5px] text-muted">{f.a}</p>
              </details>
            ))}
            <div className="py-4">
              <Link href="/faq" className="text-[15px] text-link underline underline-offset-4">
                ดูคำถามทั้งหมด
              </Link>
            </div>
          </div>
        </Container>
      </section>

      {/* ปิดท้าย */}
      <section className="on-ink bg-ink py-20 text-on-ink">
        <Container>
          <div className="max-w-[640px]">
            <h2 className="text-[28px] text-on-ink sm:text-[34px]">เริ่มจากดูว่าเงินก้อนใหญ่อยู่ตรงไหน</h2>
            <p className="mt-4 max-w-[48ch] text-[17px] text-on-ink-muted">
              สมัคร เลือกแพ็กเกจ ลงทะเบียนเลขบัญชี MT5 แล้วรับไฟล์ติดตั้งทางอีเมล ใช้เวลาติดตั้งไม่เกิน 10 นาที
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/pricing">ดูแพ็กเกจ</ButtonLink>
              <ButtonLink href="/install" variant="outline-light">
                ดูวิธีติดตั้ง
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
