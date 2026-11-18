import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Container } from "@/components/ui";
import { getSessionUserOrNull } from "@/lib/auth/dal";
import { isPackageCode, loginPathForPackage, parseReferralCode, postRegisterPath } from "@/lib/auth/validation";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "สมัครสมาชิก" };

/** สมัครสมาชิกเว็บ (อีเมล + รหัสผ่านเว็บ) — เลือกแพ็กเกจ ชำระเงิน แล้วกรอกเลขบัญชี MT5 หลังสมัคร */
export default function RegisterPage(props: PageProps<"/register">) {
  return (
    <section className="py-14">
      <Container className="grid gap-12 lg:grid-cols-[1fr_360px]">
        <div className="max-w-[560px]">
          <h1 className="text-[30px] text-ink">สมัครสมาชิก</h1>
          <p className="mt-2 text-[15.5px] text-muted">
            ใช้เวลา 2 นาที สมัครแล้วเลือกแพ็กเกจและชำระเงินได้ในหน้าบัญชีของคุณ
            ยังไม่มีบัญชีเทรดก็สมัครก่อนได้
          </p>

          <RegisterForm>
            <Suspense fallback={null}>
              <RegisterPackage searchParams={props.searchParams} />
            </Suspense>
          </RegisterForm>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-lg border border-rule bg-surface p-5">
            <h2 className="text-[16px] font-semibold text-ink">หลังจากสมัคร</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[14.5px] text-muted">
              <li>เลือกแพ็กเกจและชำระเงินด้วยบัตร</li>
              <li>เลือกโบรกเกอร์และเปิดบัญชีเทรด</li>
              <li>กรอกเลขบัญชี MT5 ระบบเปิด license ให้อัตโนมัติ</li>
              <li>
                ติดตั้งตาม{" "}
                <Link href="/install" className="text-link underline underline-offset-4">
                  คู่มือติดตั้ง
                </Link>
              </li>
            </ol>
          </div>
          <p className="mt-4 text-[14px] text-muted">
            มีบัญชีแล้ว?{" "}
            {/* มีแพ็กเกจที่เลือกมา → ล็อกอินแล้วไปหน้าสั่งซื้อแพ็กเกจนั้นต่อ (query อ่านได้เฉพาะใน <Suspense>) */}
            <Suspense fallback={<LoginLink href="/login" />}>
              <LoginLinkForPackage searchParams={props.searchParams} />
            </Suspense>
          </p>
        </aside>
      </Container>
    </section>
  );
}

/**
 * อ่าน ?package= ?ref= และ session (runtime API) จึงอยู่ใน <Suspense> — ล็อกอินอยู่แล้วไม่ต้องสมัครซ้ำ
 * ช่องซ่อนทั้งสองอยู่ในฟอร์มตลอด (URL ไม่เปลี่ยนเมื่อกรอกผิด) แพ็กเกจที่เลือกและรหัสชวนเพื่อนจึงไม่หายระหว่างแก้ฟอร์ม
 * ?ref= ตรวจแค่รูปแบบที่นี่ และไม่แสดงอะไรให้เห็น: หน้านี้ไม่บอกว่ารหัสมีอยู่จริงหรือไม่ (registerAction ค้นตอนสมัคร)
 * เพื่อนที่เปิดลิงก์ชวนแล้วไปหน้าอื่นก่อน (แพ็กเกจ / เข้าสู่ระบบ) กลับมาที่นี่โดยไม่มี ?ref= แล้ว: รหัสยังอยู่ใน cookie ที่ src/proxy.ts
 * ตั้งไว้ตอนเปิดลิงก์ครั้งแรก และ registerAction ใช้ cookie นั้นเมื่อฟอร์มไม่มีรหัส — หน้านี้จึงไม่ต้องส่งต่อ ?ref= ไปกับลิงก์อื่น
 */
async function RegisterPackage({ searchParams }: { searchParams: PageProps<"/register">["searchParams"] }) {
  const sp = await searchParams;
  const pkg = isPackageCode(sp.package) ? sp.package : undefined;
  const ref = parseReferralCode(sp.ref);
  const user = await getSessionUserOrNull();
  if (user) redirect(postRegisterPath(pkg));
  return (
    <>
      {pkg ? <input type="hidden" name="package" value={pkg} /> : null}
      {ref ? <input type="hidden" name="ref" value={ref} /> : null}
    </>
  );
}

function LoginLink({ href }: { href: string }) {
  return (
    <Link href={href} className="text-link underline underline-offset-4">
      เข้าสู่ระบบ
    </Link>
  );
}

async function LoginLinkForPackage({ searchParams }: { searchParams: PageProps<"/register">["searchParams"] }) {
  const sp = await searchParams;
  return <LoginLink href={loginPathForPackage(sp.package)} />;
}
