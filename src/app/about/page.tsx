import type { Metadata } from "next";
import Image from "next/image";
import { Container, SectionTitle } from "@/components/ui";
import { site } from "@/content/site";

export const metadata: Metadata = {
  title: "เกี่ยวกับระบบและผู้พัฒนา",
  description: "CME OI SYSTEM พัฒนาโดย อ.ธวัช ไชยศิริ เพื่อนำข้อมูลโครงสร้างตลาดทองคำจาก CME Group มาใช้ประกอบการตัดสินใจอย่างเป็นระบบ",
};

export default function AboutPage() {
  return (
    <>
      <section className="border-b border-rule bg-surface py-14">
        <Container>
          <SectionTitle
            title="เกี่ยวกับ CME OI SYSTEM"
            lead="ไม่ใช่แค่ดูกราฟราคา แต่ดูว่าเงินทุนกำลังสะสมที่ราคาไหน และมีแรงปะทะอย่างไร"
          />
        </Container>
      </section>

      <section className="py-14">
        <Container className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-start">
          <div className="prose-th">
            <h2 className="!mt-0">ระบบนี้คืออะไร</h2>
            <p>
              CME OI SYSTEM คือระบบวิเคราะห์ข้อมูลตลาด Gold Futures จาก CME Group (Chicago Mercantile Exchange)
              นำข้อมูล Open Interest, Volume, Options Flow และ Market Depth มาวิเคราะห์พฤติกรรมและโครงสร้างของตลาดทองคำ
              แล้วแสดงผลบนกราฟ XAUUSD ใน MetaTrader 5 โดยตรง
            </p>
            <p>
              แนวคิดการใช้งานมี 5 ขั้น: หาแนวรับ–แนวต้าน ตรวจ SL Clutches ประเมินแรงซื้อ–ขายจาก OI/Volume
              ดูแนวป้องกันของสถาบัน แล้วรอ Price Action ยืนยันก่อนเข้าออเดอร์
            </p>

            <h2>ผู้พัฒนา</h2>
            <p>
              <strong>{site.developer.name}</strong> ({site.developer.nameEn}) {site.developer.title}
            </p>
            <ul>
              {site.developer.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>

            <h2>สิ่งที่ระบบนี้ไม่ใช่</h2>
            <p>
              ไม่ใช่สัญญาณซื้อขายอัตโนมัติ ไม่ใช่คำแนะนำการลงทุน และไม่รับประกันผลกำไร
              ระบบช่วยให้เห็นข้อมูลที่สถาบันใช้ ส่วนการตัดสินใจและการบริหารความเสี่ยงเป็นของผู้ใช้เสมอ
            </p>
          </div>

          <div className="space-y-6">
            <figure className="overflow-hidden rounded-lg border border-rule">
              <Image
                src="/images/about-developer.webp"
                alt="อินโฟกราฟิกแนะนำ CME OI SYSTEM และผู้พัฒนา อ.ธวัช ไชยศิริ"
                width={1536}
                height={1024}
                sizes="(min-width: 1024px) 540px, 100vw"
                className="h-auto w-full"
              />
            </figure>
            <figure className="overflow-hidden rounded-lg border border-rule">
              <Image
                src="/images/features-17.webp"
                alt="อินโฟกราฟิกฟีเจอร์ 17 ข้อของ CME OI SYSTEM"
                width={852}
                height={1280}
                sizes="(min-width: 1024px) 540px, 100vw"
                className="h-auto w-full"
              />
            </figure>
          </div>
        </Container>
      </section>
    </>
  );
}
