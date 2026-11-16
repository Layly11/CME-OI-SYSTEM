import type { Metadata } from "next";
import Image from "next/image";
import { Container, SectionTitle } from "@/components/ui";
import { LineLink } from "@/components/line-link";

export const metadata: Metadata = {
  title: "วิธีติดตั้งบน MT5",
  description: "ขั้นตอนติดตั้ง CME OI SYSTEM บน MetaTrader 5 ตั้งแต่รับไฟล์ติดตั้งจนถึงเปิดใช้งานบนกราฟ XAUUSD",
};

// TODO: ยืนยันกับลูกค้า — URL ของไฟล์ license และชื่อไฟล์ indicator จริง
const LICENSE_HOST = process.env.NEXT_PUBLIC_LICENSE_HOST ?? "https://license.example.com";

const installSteps = [
  {
    title: "ติดตั้ง MetaTrader 5 และล็อกอินบัญชีเทรด",
    body: "ดาวน์โหลด MT5 จากเว็บโบรกเกอร์ของคุณ ล็อกอินด้วยบัญชีที่ลงทะเบียน license ไว้ เลขบัญชีต้องตรงกับที่แจ้งในระบบ",
  },
  {
    // ยังไม่มีอีเมลลิงก์ดาวน์โหลดและหน้าดาวน์โหลดในบัญชีสมาชิก — เขียนตามที่ทำได้จริงตอนนี้
    title: "รับไฟล์ติดตั้งจากทีมงาน",
    body: "หลังหน้าคำสั่งซื้อขึ้นว่า license เปิดใช้งานแล้ว ติดต่อทีมงานทาง LINE พร้อมเลขที่คำสั่งซื้อหรือเลขบัญชี MT5 เพื่อรับไฟล์ติดตั้งและคู่มือ",
  },
  {
    title: "วางไฟล์ในโฟลเดอร์ Indicators",
    body: "ใน MT5 ไปที่ File → Open Data Folder → MQL5 → Indicators แล้ววางไฟล์ .ex5 ที่ได้รับมา จากนั้นปิดและเปิด MT5 ใหม่ หรือคลิกขวาที่ Navigator แล้วเลือก Refresh",
  },
  {
    title: "อนุญาตให้ indicator เชื่อมต่ออินเทอร์เน็ต",
    body: `ไปที่ Tools → Options → Expert Advisors ติ๊ก "Allow WebRequest for listed URL" แล้วเพิ่ม ${LICENSE_HOST} ลงในรายการ ขั้นตอนนี้จำเป็น เพราะ indicator ต้องอ่านข้อมูลจากเซิร์ฟเวอร์ของเรา`,
  },
  {
    title: "ลาก indicator ลงกราฟ XAUUSD",
    body: "เปิดกราฟ XAUUSD ไทม์เฟรมที่ต้องการ (แนะนำ M5–M30) ลาก CME OI SYSTEM จาก Navigator ลงกราฟ กด OK ตารางข้อมูลจะปรากฏทางขวาของกราฟภายในไม่กี่วินาที",
  },
  {
    title: "เปิด Algo Trading ถ้าจะใช้ Trader Panel",
    body: "ถ้าต้องการส่งคำสั่งผ่าน Trader Panel ให้กดปุ่ม Algo Trading บนแถบเครื่องมือของ MT5 ให้เป็นสีเขียว ถ้าใช้ดูข้อมูลอย่างเดียวไม่ต้องเปิด",
  },
];

const troubleshooting = [
  {
    q: "ตารางไม่ขึ้น หรือขึ้นว่าไม่พบ license",
    a: "ตรวจว่าเลขบัญชีที่ล็อกอินอยู่ตรงกับที่ลงทะเบียน และ license ยังไม่หมดอายุ (ดูได้ในหน้าบัญชี) ถ้าเพิ่งชำระเงินและกรอกเลขบัญชี ให้ดูว่าหน้าคำสั่งซื้อขึ้นว่าเปิดใช้งานแล้ว",
  },
  {
    q: "ขึ้นข้อความเกี่ยวกับ WebRequest",
    a: "ยังไม่ได้เพิ่ม URL ในขั้นตอนที่ 4 หรือพิมพ์ไม่ตรง ให้ตรวจตัวสะกดและกด OK แล้วลาก indicator ลงกราฟใหม่",
  },
  {
    q: "ตัวเลขไม่อัปเดต",
    a: "ดูเวลา Next Update ที่มุมแผงข้อมูล ข้อมูลจาก CME อัปเดตเป็นรอบ ไม่ใช่ทุกวินาที ถ้าเกินรอบแล้วยังไม่เปลี่ยน ให้ตรวจการเชื่อมต่ออินเทอร์เน็ตของเครื่อง",
  },
];

export default function InstallPage() {
  return (
    <>
      <section className="border-b border-rule bg-surface py-14">
        <Container>
          <SectionTitle
            title="วิธีติดตั้งบน MetaTrader 5"
            lead="ใช้เวลาประมาณ 10 นาที ทำครั้งเดียวต่อเครื่อง ถ้าติดขัดตรงไหนทักทีมงานทาง LINE ได้ตลอด"
          />
        </Container>
      </section>

      <section className="py-14">
        <Container className="grid gap-12 lg:grid-cols-[1fr_420px] lg:items-start">
          <ol className="divide-y divide-rule border-y border-rule">
            {installSteps.map((s, i) => (
              <li key={s.title} className="grid gap-2 py-6 sm:grid-cols-[56px_1fr]">
                <span className="tabular text-[28px] font-semibold leading-none text-gold-deep">{i + 1}</span>
                <div>
                  <h2 className="text-[19px] text-ink">{s.title}</h2>
                  <p className="mt-1.5 max-w-[64ch] text-[15.5px] text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <aside className="space-y-8">
            <figure className="overflow-hidden rounded-lg border border-rule bg-ink-deep">
              <Image
                src="/images/screen-m30-oct30.webp"
                alt="หน้าจอ MT5 เมื่อติดตั้ง CME OI SYSTEM สำเร็จ ตารางข้อมูลปรากฏทางขวาของกราฟ"
                width={1280}
                height={639}
                sizes="(min-width: 1024px) 420px, 100vw"
                className="h-auto w-full"
              />
              <figcaption className="bg-surface px-4 py-3 text-[13px] text-muted">
                เมื่อติดตั้งสำเร็จ ตารางจะปรากฏทางขวาของกราฟ พร้อมปุ่มสลับมุมมองด้านล่าง
              </figcaption>
            </figure>

            <div>
              <h2 className="text-[20px] text-ink">ถ้าเจอปัญหา</h2>
              <dl className="mt-3 divide-y divide-rule border-y border-rule">
                {troubleshooting.map((t) => (
                  <div key={t.q} className="py-3.5">
                    <dt className="text-[15.5px] font-semibold text-ink">{t.q}</dt>
                    <dd className="mt-1 text-[14.5px] text-muted">{t.a}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-[14.5px] text-muted">
                ยังไม่ได้ ส่งภาพหน้าจอมาทาง{" "}
                <LineLink>
                  LINE
                </LineLink>{" "}
                ทีมงานช่วยดูให้
              </p>
            </div>
          </aside>
        </Container>
      </section>
    </>
  );
}
