import type { Metadata } from "next";
import Link from "next/link";
import { Field, Input } from "@/components/form";
import { Button, Container } from "@/components/ui";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

/** TODO (เฟสถัดไป): เชื่อมระบบล็อกอินจริง (แนะนำ Auth.js: อีเมล/รหัสผ่าน + Google + LINE) */
export default function LoginPage() {
  return (
    <section className="py-16">
      <Container>
        <div className="mx-auto max-w-[400px]">
          <h1 className="text-[28px] text-ink">เข้าสู่ระบบ</h1>
          <p className="mt-1 text-[15px] text-muted">ดูสถานะ license ต่ออายุ และดาวน์โหลดไฟล์ติดตั้ง</p>
          <form className="mt-6 space-y-4" action="#" method="post">
            <Field label="อีเมล">
              <Input name="email" type="email" autoComplete="email" required />
            </Field>
            <Field label="รหัสผ่าน">
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <Button type="submit" className="w-full" disabled title="ระบบล็อกอินจะเปิดใช้งานในเฟสถัดไป">
              เข้าสู่ระบบ
            </Button>
          </form>
          <div className="mt-5 flex flex-col gap-1.5 text-[14px] text-muted">
            <Link href="#" className="text-link underline underline-offset-4">
              ลืมรหัสผ่าน
            </Link>
            <span>
              ยังไม่มีบัญชี?{" "}
              <Link href="/register" className="text-link underline underline-offset-4">
                สมัครใช้งาน
              </Link>
            </span>
          </div>
          <p className="mt-8 text-[13px] text-muted">
            ตัวอย่างหน้าจอหลังล็อกอิน:{" "}
            <Link href="/account" className="text-link underline underline-offset-4">
              หน้าบัญชีสมาชิก
            </Link>{" "}
            และ{" "}
            <Link href="/admin" className="text-link underline underline-offset-4">
              หน้าแอดมิน
            </Link>
          </p>
        </div>
      </Container>
    </section>
  );
}
