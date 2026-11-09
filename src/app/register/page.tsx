import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Field, Input, Notice, Select } from "@/components/form";
import { Button, Container } from "@/components/ui";
import { packages } from "@/content/site";

export const metadata: Metadata = { title: "สมัครใช้งาน" };

/**
 * หน้าสมัครสมาชิก + ลงทะเบียนบัญชี MT5 + เลือกแพ็กเกจ
 * TODO (เฟสถัดไป): เชื่อม server action สร้าง user/mt5_account/order และหน้าแนบสลิป
 */
export default function RegisterPage(props: PageProps<"/register">) {
  return (
    <section className="py-14">
      <Container className="grid gap-12 lg:grid-cols-[1fr_360px]">
        <div className="max-w-[560px]">
          <h1 className="text-[30px] text-ink">สมัครใช้งาน</h1>
          <p className="mt-2 text-[15.5px] text-muted">
            ใช้เวลา 2 นาที หลังสมัครจะได้หน้าชำระเงินและแนบสลิป เมื่อทีมงานยืนยันแล้วจะส่งไฟล์ติดตั้งให้ทางอีเมล
          </p>

          <form className="mt-8 space-y-8" action="#" method="post">
            <fieldset className="space-y-4">
              <legend className="text-[17px] font-semibold text-ink">ข้อมูลผู้ใช้</legend>
              <Field label="ชื่อ–นามสกุล">
                <Input name="name" autoComplete="name" required />
              </Field>
              <Field label="อีเมล" hint="ใช้ล็อกอินและรับไฟล์ติดตั้ง">
                <Input name="email" type="email" autoComplete="email" required />
              </Field>
              <Field label="รหัสผ่านสำหรับเว็บไซต์" hint="อย่างน้อย 8 ตัวอักษร (ไม่ใช่รหัสผ่าน MT5)">
                <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
              </Field>
              <Field label="LINE ID หรือเบอร์โทร (ไม่บังคับ)" hint="ใช้ติดต่อกรณีมีปัญหาการติดตั้ง">
                <Input name="contact" />
              </Field>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="text-[17px] font-semibold text-ink">บัญชี MetaTrader 5 ที่จะใช้</legend>
              <Notice>
                เราใช้เฉพาะเลขบัญชีและชื่อเซิร์ฟเวอร์เพื่อเปิดสิทธิ <strong>ไม่ต้องใส่รหัสผ่าน MT5</strong>{" "}
                และทีมงานจะไม่ขอรหัสผ่านจากคุณในทุกกรณี
              </Notice>
              <Field label="เลขบัญชี MT5 (Login)" hint="ตัวเลขที่แสดงมุมบนซ้ายของ MT5 เช่น 97058698">
                <Input name="mt5Account" inputMode="numeric" pattern="[0-9]{1,20}" required />
              </Field>
              <Field label="Broker Server" hint="เช่น InterStellarFinancial-Server (ดูได้ตอนล็อกอิน MT5)">
                <Input name="brokerServer" required />
              </Field>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="text-[17px] font-semibold text-ink">แพ็กเกจ</legend>
              <Suspense fallback={<PackageSelect defaultValue="yearly" />}>
                <PackageSelectFromQuery searchParams={props.searchParams} />
              </Suspense>
            </fieldset>

            <label className="flex items-start gap-3 text-[14.5px] text-text">
              <input type="checkbox" name="accept" required className="mt-1.5" />
              <span>
                ฉันได้อ่านและยอมรับ{" "}
                <Link href="/legal/terms" className="text-link underline underline-offset-4">
                  ข้อตกลงการใช้งาน
                </Link>
                ,{" "}
                <Link href="/legal/privacy" className="text-link underline underline-offset-4">
                  นโยบายความเป็นส่วนตัว
                </Link>{" "}
                และ{" "}
                <Link href="/legal/risk" className="text-link underline underline-offset-4">
                  คำเตือนความเสี่ยง
                </Link>
              </span>
            </label>

            <Button type="submit" className="w-full sm:w-auto" disabled title="ระบบสมัครจะเปิดใช้งานในเฟสถัดไป">
              สมัครและไปหน้าชำระเงิน
            </Button>
            <p className="text-[13.5px] text-muted">
              ปุ่มนี้ยังปิดอยู่ระหว่างพัฒนา — ระหว่างนี้สมัครผ่าน LINE ได้
            </p>
          </form>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-lg border border-rule bg-surface p-5">
            <h2 className="text-[16px] font-semibold text-ink">หลังจากสมัคร</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[14.5px] text-muted">
              <li>โอนเงินตามยอดที่แสดง แล้วอัปโหลดสลิป</li>
              <li>ทีมงานตรวจสอบภายใน 24 ชั่วโมงในวันทำการ</li>
              <li>license เปิดใช้ และอีเมลส่งลิงก์ดาวน์โหลด + คู่มือ</li>
              <li>ติดตั้งบน MT5 ตาม{" "}
                <Link href="/install" className="text-link underline underline-offset-4">
                  คู่มือติดตั้ง
                </Link>
              </li>
            </ol>
          </div>
          <p className="mt-4 text-[14px] text-muted">
            มีบัญชีแล้ว?{" "}
            <Link href="/login" className="text-link underline underline-offset-4">
              เข้าสู่ระบบ
            </Link>
          </p>
        </aside>
      </Container>
    </section>
  );
}

function PackageSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <Field label="เลือกแพ็กเกจ">
      <Select name="package" defaultValue={defaultValue}>
        {packages.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name} ({p.period}){p.priceThb === null ? "" : ` — ${p.priceThb.toLocaleString("th-TH")} บาท`}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** อ่าน ?package= จาก URL (เช่น มาจากปุ่มในหน้าแพ็กเกจ) — เป็น runtime API จึงต้องอยู่ใน Suspense */
async function PackageSelectFromQuery({
  searchParams,
}: {
  searchParams: PageProps<"/register">["searchParams"];
}) {
  const sp = await searchParams;
  const requested = typeof sp.package === "string" ? sp.package : undefined;
  const valid = packages.some((p) => p.code === requested) ? (requested as string) : "yearly";
  return <PackageSelect defaultValue={valid} />;
}
