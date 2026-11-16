import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Container } from "@/components/ui";
import { LineLink } from "@/components/line-link";
import { getSessionUserOrNull } from "@/lib/auth/dal";
import { safeNextPath } from "@/lib/auth/validation";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <section className="py-16">
      <Container>
        <div className="mx-auto max-w-[400px]">
          <h1 className="text-[28px] text-ink">เข้าสู่ระบบ</h1>
          <p className="mt-1 text-[15px] text-muted">ดูสถานะ license คำสั่งซื้อ และต่ออายุ</p>
          <LoginForm>
            <Suspense fallback={null}>
              <LoginNext searchParams={props.searchParams} />
            </Suspense>
          </LoginForm>
          <div className="mt-5 flex flex-col gap-1.5 text-[14px] text-muted">
            <LineLink>
              ลืมรหัสผ่าน? ติดต่อทีมงานทาง LINE
            </LineLink>
            <span>
              ยังไม่มีบัญชี?{" "}
              <Link href="/register" className="text-link underline underline-offset-4">
                สมัครสมาชิก
              </Link>
            </span>
          </div>
        </div>
      </Container>
    </section>
  );
}

/** อ่าน ?next= และ session (runtime API) จึงอยู่ใน <Suspense> — ล็อกอินอยู่แล้วก็พาไปปลายทางเลย */
async function LoginNext({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);
  const user = await getSessionUserOrNull();
  if (user) redirect(next);
  return <input type="hidden" name="next" value={next} />;
}
