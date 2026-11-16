import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Container } from "@/components/ui";
import { requireUser } from "@/lib/auth/dal";
import { pathWithQuery } from "@/lib/auth/validation";
import { formatThb } from "@/lib/purchase/format";
import { listActivePackages, listMt5AccountsWithLicense } from "@/lib/purchase/repo";
import { OrderForm } from "./order-form";

export const metadata: Metadata = { title: "สั่งซื้อแพ็กเกจ", robots: { index: false, follow: false } };

export default function NewOrderPage(props: PageProps<"/account/orders/new">) {
  return (
    <section className="py-12">
      <Container>
        <div className="mx-auto max-w-[560px]">
          <h1 className="text-[28px] text-ink">สั่งซื้อแพ็กเกจ</h1>
          <p className="mt-1 text-[15px] text-muted">
            เลือกแพ็กเกจ สร้างคำสั่งซื้อ แล้วชำระเงินด้วยบัตรในขั้นถัดไป จากนั้นเลือกโบรกเกอร์และกรอกเลขบัญชี MT5
          </p>
          <Suspense fallback={<p className="mt-6 text-[15px] text-muted" aria-busy="true">กำลังโหลด…</p>}>
            <NewOrderContent searchParams={props.searchParams} />
          </Suspense>
        </div>
      </Container>
    </section>
  );
}

async function NewOrderContent({
  searchParams,
}: {
  searchParams: PageProps<"/account/orders/new">["searchParams"];
}) {
  const sp = await searchParams;
  // ยังไม่ล็อกอิน → ล็อกอินแล้วกลับมาพร้อมแพ็กเกจ/บัญชีที่เลือกไว้
  const user = await requireUser(pathWithQuery("/account/orders/new", sp, ["package", "account"]));
  const [packages, accounts] = await Promise.all([listActivePackages(), listMt5AccountsWithLicense(user.id)]);

  const wanted = typeof sp.package === "string" ? sp.package : null;
  const defaultPackage = packages.find((p) => p.orderable && p.code === wanted) ?? null;
  const wantedAccount = typeof sp.account === "string" ? sp.account : null;
  const defaultAccount = accounts.find((a) => a.id === wantedAccount) ?? null;

  return (
    <>
      {/* ส่งให้ client เฉพาะช่องที่ฟอร์มต้องแสดง */}
      <OrderForm
        packages={packages.map((p) => ({
          id: p.id,
          name: p.nameTh,
          period: p.durationDays === null ? "ไม่มีวันหมดอายุ" : `${p.durationDays} วัน`,
          price: p.orderable && p.priceThb !== null ? formatThb(p.priceThb) : null,
        }))}
        accounts={accounts.map((a) => ({
          id: a.id,
          accountNumber: a.accountNumber,
          brokerServer: a.brokerServer,
          label: a.label,
        }))}
        defaultPackageId={defaultPackage?.id ?? null}
        defaultAccountId={defaultAccount?.id ?? null}
      />
      <p className="mt-6 text-[14px]">
        <Link href="/account" className="text-link underline underline-offset-4">
          กลับหน้าบัญชีของฉัน
        </Link>
      </p>
    </>
  );
}
