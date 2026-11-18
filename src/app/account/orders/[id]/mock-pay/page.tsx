import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Container } from "@/components/ui";
import { requireUser } from "@/lib/auth/dal";
import { getPaymentBlock } from "@/lib/license/activation-block";
import { resolvePaymentConfig } from "@/lib/payment/config";
import { formatOrderNo, formatThb } from "@/lib/purchase/format";
import { canPayByCard } from "@/lib/purchase/order-rules";
import { isFreeReferralPackage } from "@/lib/purchase/packages";
import { getOrder } from "@/lib/purchase/repo";
import { MockPayForm } from "./mock-pay-form";

export const metadata: Metadata = { title: "จำลองการชำระเงิน", robots: { index: false, follow: false } };

/**
 * หน้าจำลองการชำระเงิน (โหมดทดสอบ) — ยืนแทนหน้าชำระของ payment gateway จนกว่าจะเลือกผู้ให้บริการจริง
 * เปิดได้เฉพาะเมื่อค่าตั้งอนุญาต mock (src/lib/payment/config.ts) ไม่เช่นนั้นเป็น 404
 * หน้านี้ไม่มีช่องกรอกข้อมูลใดๆ และไม่มีการตัดเงินจริง
 */
export default function MockPayPage(props: PageProps<"/account/orders/[id]/mock-pay">) {
  return (
    <section className="py-12">
      <Container>
        <div className="mx-auto max-w-[520px]">
          <Suspense fallback={<p className="text-[15px] text-muted" aria-busy="true">กำลังโหลด…</p>}>
            <MockPayContent params={props.params} />
          </Suspense>
        </div>
      </Container>
    </section>
  );
}

async function MockPayContent({ params }: { params: PageProps<"/account/orders/[id]/mock-pay">["params"] }) {
  const { id: rawId } = await params;
  const parsedId = z.uuid().safeParse(rawId);
  const user = await requireUser(parsedId.success ? `/account/orders/${parsedId.data}` : "/account");
  if (!parsedId.success) notFound();

  const config = resolvePaymentConfig(process.env);
  if (!config.ok || config.provider !== "mock") notFound();

  // getOrder กรองด้วย user.id — คำสั่งซื้อของคนอื่นได้ 404 เหมือนไม่มีอยู่
  const order = await getOrder(user.id, parsedId.data);
  if (!order) notFound();
  // แพ็กเกจฟรีจากการชวนเพื่อนไม่มีขั้นชำระเงิน — ไม่มีหน้าจำลองการชำระให้คำสั่งซื้อแบบนี้ไม่ว่าสถานะใด
  if (isFreeReferralPackage({ code: order.packageCode })) notFound();
  const orderPath = `/account/orders/${order.id}`;
  if (order.status === "paid") redirect(orderPath);
  if (!canPayByCard(order.status)) notFound();
  // บัญชี MT5 ของคำสั่งซื้อนี้รับการเปิด/ต่ออายุไม่ได้แล้ว (ตลอดชีพ/ถูกระงับ) → ไม่แสดงปุ่มยืนยัน หน้าคำสั่งซื้อบอกเหตุผล
  if ((await getPaymentBlock(order)) !== null) redirect(orderPath);

  return (
    <>
      <div className="rounded-lg border-2 border-dashed border-gold-deep bg-gold-soft px-5 py-4">
        <h1 className="text-[24px] text-ink">จำลองการชำระเงิน (โหมดทดสอบ)</h1>
        <p className="mt-1 text-[14.5px] text-text">
          ไม่มีการตัดเงินจริง และหน้านี้ไม่มีช่องกรอกข้อมูลบัตร ใช้สำหรับทดสอบขั้นตอนสั่งซื้อเท่านั้น
        </p>
      </div>

      <dl className="mt-6 divide-y divide-rule rounded-lg border border-rule bg-surface text-[15px]">
        <Row label="คำสั่งซื้อ">
          <span className="tabular">{formatOrderNo(order.orderNo)}</span>
        </Row>
        <Row label="แพ็กเกจ">
          {order.packageName}
          <span className="tabular block text-[13.5px] text-muted">{order.packagePeriod}</span>
        </Row>
        <Row label="ยอดชำระ">
          <span className="tabular font-semibold text-ink">{formatThb(order.amountThb)}</span>
        </Row>
      </dl>

      <MockPayForm orderId={order.id} />

      <p className="mt-6 text-[14px]">
        <Link href={orderPath} className="text-link underline underline-offset-4">
          กลับหน้าคำสั่งซื้อ (ยังไม่ชำระ)
        </Link>
      </p>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-4 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-text">{children}</dd>
    </div>
  );
}
