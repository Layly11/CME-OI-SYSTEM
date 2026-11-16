import type { Metadata } from "next";
import { ButtonLink, Container } from "@/components/ui";

export const metadata: Metadata = { title: "ไม่พบหน้านี้" };

/** หน้า 404 ภาษาไทย — ใช้ทั้งกับ URL ที่ไม่มีอยู่ และ notFound() (เช่นคำสั่งซื้อที่ไม่มีหรือไม่ใช่ของผู้ใช้) */
export default function NotFound() {
  return (
    <section className="py-20">
      <Container>
        <div className="mx-auto max-w-[520px]">
          <h1 className="text-[28px] text-ink">ไม่พบหน้านี้</h1>
          <p className="mt-2 text-[15.5px] text-muted">
            หน้าที่คุณเปิดอาจถูกย้าย ลบไปแล้ว หรือคุณไม่มีสิทธิ์ดูรายการนี้ ตรวจลิงก์อีกครั้ง หรือกลับไปเริ่มจากหน้าด้านล่าง
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/account">บัญชีของฉัน</ButtonLink>
            <ButtonLink href="/" variant="outline-ink">
              กลับหน้าแรก
            </ButtonLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
