import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Notice } from "@/components/form";
import { ButtonLink, Container } from "@/components/ui";
import { requireUser } from "@/lib/auth/dal";
import { pathWithQuery } from "@/lib/auth/validation";
import { findPartnerBroker } from "@/lib/purchase/brokers";
import { formatOrderNo } from "@/lib/purchase/format";
import { canSubmitAccount } from "@/lib/purchase/order-rules";
import { getOrder } from "@/lib/purchase/repo";
import { Mt5AccountForm } from "./mt5-account-form";

export const metadata: Metadata = { title: "กรอกเลขบัญชี MT5", robots: { index: false, follow: false } };

/** โครงหน้าแบบ static — ฟอร์มอยู่ใน <Suspense> หลังตรวจ session */
export default function NewMt5AccountPage(props: PageProps<"/account/mt5/new">) {
  return (
    <section className="py-12">
      <Container>
        <div className="mx-auto max-w-[520px]">
          <h1 className="text-[28px] text-ink">กรอกเลขบัญชี MT5</h1>
          <p className="mt-1 text-[15px] text-muted">
            license ผูกกับเลขบัญชี MT5 กรอกเลขให้ตรงกับบัญชีที่จะติดตั้ง indicator
          </p>
          <Suspense fallback={<p className="mt-6 text-[15px] text-muted" aria-busy="true">กำลังโหลด…</p>}>
            <NewMt5AccountContent searchParams={props.searchParams} />
          </Suspense>
        </div>
      </Container>
    </section>
  );
}

/**
 * ฟอร์มแสดงเฉพาะเมื่อมี ?order=<uuid> ของคำสั่งซื้อตัวเองที่ชำระแล้ว เลือกโบรกเกอร์แล้ว และยังไม่มีบัญชี
 * (กรอกเลขบัญชีโดยไม่มีคำสั่งซื้อไม่ได้ — เซิร์ฟเวอร์ตรวจซ้ำใน addMt5AccountAction/submitAccountForOrder)
 */
async function NewMt5AccountContent({
  searchParams,
}: {
  searchParams: PageProps<"/account/mt5/new">["searchParams"];
}) {
  const sp = await searchParams;
  // ยังไม่ล็อกอิน → ล็อกอินแล้วกลับมาพร้อม ?order= เดิม
  const user = await requireUser(pathWithQuery("/account/mt5/new", sp, ["order"]));

  const orderParam = z.uuid().safeParse(sp.order);
  const order = orderParam.success ? await getOrder(user.id, orderParam.data) : null;
  const broker = order ? findPartnerBroker(order.partnerBrokerCode) : null;

  if (!order) {
    return (
      <>
        <div className="mt-6">
          <Notice tone="warn">
            ต้องสั่งซื้อแพ็กเกจและชำระเงินก่อน จึงจะกรอกเลขบัญชี MT5 ได้ ระบบจะพาเลือกโบรกเกอร์และกรอกเลขบัญชีในหน้าคำสั่งซื้อ
          </Notice>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <ButtonLink href="/account/orders/new">สั่งซื้อแพ็กเกจ</ButtonLink>
          <ButtonLink href="/account" variant="outline-ink">
            บัญชีของฉัน
          </ButtonLink>
        </div>
      </>
    );
  }

  if (!canSubmitAccount(order) || !broker) {
    return (
      <>
        <div className="mt-6">
          <Notice tone="warn">
            {order.mt5AccountId !== null
              ? "คำสั่งซื้อนี้ระบุบัญชี MT5 แล้ว"
              : order.status !== "paid"
                ? "คำสั่งซื้อนี้ยังไม่พร้อมรับเลขบัญชี MT5 กรุณาชำระเงินในหน้าคำสั่งซื้อก่อน"
                : "กรุณาเลือกโบรกเกอร์ในหน้าคำสั่งซื้อก่อนกรอกเลขบัญชี MT5"}
          </Notice>
        </div>
        <div className="mt-4">
          <ButtonLink href={`/account/orders/${order.id}`}>ไปหน้าคำสั่งซื้อ {formatOrderNo(order.orderNo)}</ButtonLink>
        </div>
      </>
    );
  }

  return (
    <>
      <dl className="mt-4 space-y-1 rounded-md bg-ink/5 px-4 py-3 text-[14px] text-text">
        <div className="flex gap-2">
          <dt className="text-muted">คำสั่งซื้อ:</dt>
          <dd>
            <Link href={`/account/orders/${order.id}`} className="text-link underline underline-offset-4">
              {formatOrderNo(order.orderNo)}
            </Link>{" "}
            ({order.packageName})
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">โบรกเกอร์ที่เลือก:</dt>
          <dd className="font-medium text-ink">{broker.name}</dd>
        </div>
      </dl>
      <Mt5AccountForm orderId={order.id} />
      <p className="mt-6 text-[14px]">
        <Link href={`/account/orders/${order.id}`} className="text-link underline underline-offset-4">
          กลับหน้าคำสั่งซื้อ
        </Link>
      </p>
    </>
  );
}
