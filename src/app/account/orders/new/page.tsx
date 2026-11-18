import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Container } from "@/components/ui";
import { requireUser } from "@/lib/auth/dal";
import { pathWithQuery } from "@/lib/auth/validation";
import {
  freeClaimState,
  isFreeReferralPackage,
  packageDisplayName,
  packagePeriodText,
  packagePriceText,
  referralProgressText,
  type FreeClaimState,
} from "@/lib/purchase/packages";
import { getReferralSummary } from "@/lib/purchase/referral";
import { listActivePackages, listMt5AccountsWithLicense } from "@/lib/purchase/repo";
import { OrderForm, type OrderFormPackage } from "./order-form";

export const metadata: Metadata = { title: "สั่งซื้อแพ็กเกจ", robots: { index: false, follow: false } };

export default function NewOrderPage(props: PageProps<"/account/orders/new">) {
  return (
    <section className="py-12">
      <Container>
        <div className="mx-auto max-w-[560px]">
          <h1 className="text-[28px] text-ink">สั่งซื้อแพ็กเกจ</h1>
          {/* ข้อความกลาง: ใช้ได้ทั้งแพ็กเกจที่ต้องชำระเงินและแพ็กเกจฟรีจากการชวนเพื่อน (ซึ่งไม่มีขั้นชำระเงิน) */}
          <p className="mt-1 text-[15px] text-muted">
            เลือกแพ็กเกจแล้วสร้างคำสั่งซื้อ แพ็กเกจที่ต้องชำระเงินจะชำระด้วยบัตรในขั้นถัดไป ส่วนแพ็กเกจฟรีไม่มีขั้นชำระเงิน
            จากนั้นเลือกโบรกเกอร์และกรอกเลขบัญชี MT5
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
  const [packages, accounts, referral] = await Promise.all([
    listActivePackages(),
    listMt5AccountsWithLicense(user.id),
    getReferralSummary(user.id),
  ]);

  // แพ็กเกจฟรีจากการชวนเพื่อน: แสดงเงื่อนไข + ความคืบหน้า และปิดตัวเลือกไว้ถ้ายังรับไม่ได้
  // (เป็นแค่การแสดงผล — createOrder ตรวจสิทธิ์ซ้ำ คำขอที่สร้างเองจึงถูกปฏิเสธเหมือนกัน)
  const freeState: FreeClaimState = referral ? freeClaimState(referral) : "need_referral";
  const freeNotes: Record<FreeClaimState, string> = {
    need_referral: "ครบแล้วกลับมารับสิทธิ์ที่นี่",
    eligible: "ครบเงื่อนไขแล้ว รับสิทธิ์ได้ ไม่มีขั้นชำระเงิน",
    claim_open: "คุณรับสิทธิ์ไว้แล้ว ทำขั้นถัดไปต่อในคำสั่งซื้อเดิม",
    claimed: "คุณใช้สิทธิ์แล้ว รับได้ 1 ครั้งต่อผู้ใช้",
  };
  // ทางไปต่อของแต่ละสถานะ: ยังชวนไม่ครบ → หน้าบัญชีของฉัน (ลิงก์ชวนเพื่อนอยู่ที่นั่น), รับไว้แล้วยังไม่เสร็จ → คำสั่งซื้อนั้น
  const claimOrderId = referral?.claim?.orderId ?? null;
  const freeLinks: Record<FreeClaimState, { href: string; label: string } | null> = {
    need_referral: { href: "/account", label: "ดูลิงก์ชวนเพื่อนในหน้าบัญชีของฉัน" },
    eligible: null,
    claim_open: claimOrderId ? { href: `/account/orders/${claimOrderId}`, label: "ไปที่คำสั่งซื้อ" } : null,
    claimed: null,
  };
  const formPackages: OrderFormPackage[] = packages.map((p) => {
    const base = { id: p.id, name: packageDisplayName(p), period: packagePeriodText(p) };
    if (!p.orderable) return { ...base, price: null };
    if (!isFreeReferralPackage(p)) return { ...base, price: packagePriceText(p) };
    return {
      ...base,
      price: packagePriceText(p),
      free: {
        condition: p.description,
        progress: referralProgressText(referral?.referredCount ?? 0),
        note: freeNotes[freeState],
        selectable: freeState === "eligible",
        link: freeLinks[freeState],
      },
    };
  });
  const selectable = new Set(formPackages.filter((p) => p.price !== null && (p.free?.selectable ?? true)).map((p) => p.id));

  const wanted = typeof sp.package === "string" ? sp.package : null;
  const defaultPackage = packages.find((p) => selectable.has(p.id) && p.code === wanted) ?? null;
  const wantedAccount = typeof sp.account === "string" ? sp.account : null;
  const defaultAccount = accounts.find((a) => a.id === wantedAccount) ?? null;

  return (
    <>
      {/* ส่งให้ client เฉพาะช่องที่ฟอร์มต้องแสดง */}
      <OrderForm
        packages={formPackages}
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
