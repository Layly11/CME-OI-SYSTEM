import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Notice, StatusBadge } from "@/components/form";
import { ButtonLink, Container } from "@/components/ui";
import { partnerBrokers } from "@/content/brokers";
import { LineLink } from "@/components/line-link";
import { requireUser } from "@/lib/auth/dal";
import { getActivationBlock, getPaymentBlock } from "@/lib/license/activation-block";
import { isBankTransferEnabled, REFERRAL_PAYMENT_PROVIDER } from "@/lib/payment/config";
import { getPaymentProvider } from "@/lib/payment/provider";
import { findPartnerBroker } from "@/lib/purchase/brokers";
import { getPaymentInfo, safeExternalUrl } from "@/lib/purchase/config";
import { activationView } from "@/lib/license/published-state";
import { getLatestPublishedEntries } from "@/lib/license/publish-sync";
import { formatOrderNo, formatThaiDate, todayInBangkok } from "@/lib/purchase/format";
import { purchaseMessages } from "@/lib/purchase/messages";
import { orderBadgeStatus, orderStep } from "@/lib/purchase/order-progress";
import { canCancelOrder, canUploadSlip, OPEN_ORDER_STATUSES } from "@/lib/purchase/order-rules";
import { isFreeReferralPackage, orderAmountText } from "@/lib/purchase/packages";
import { getOrder, listMt5AccountsWithLicense } from "@/lib/purchase/repo";
import { resolveSlipStorage } from "@/lib/purchase/slip-storage-config";
import { AttachAccountForm } from "./attach-account-form";
import { BankTransferSection } from "./bank-transfer-section";
import { BrokerChooser } from "./broker-chooser";
import { CancelOrderForm } from "./cancel-order-form";
import { PayByCardForm } from "./pay-by-card-form";
import { RetryActivationForm } from "./retry-activation-form";

export const metadata: Metadata = { title: "คำสั่งซื้อ", robots: { index: false, follow: false } };

/** โครงหน้าแบบ static ไม่มีข้อมูลคำสั่งซื้อ — เนื้อหาอยู่ใน <Suspense> หลังตรวจ session และความเป็นเจ้าของ */
export default function OrderPage(props: PageProps<"/account/orders/[id]">) {
  return (
    <section className="py-12">
      <Container>
        <div className="mx-auto max-w-[640px]">
          <Suspense fallback={<p className="text-[15px] text-muted" aria-busy="true">กำลังโหลดคำสั่งซื้อ…</p>}>
            <OrderContent params={props.params} searchParams={props.searchParams} />
          </Suspense>
        </div>
      </Container>
    </section>
  );
}

async function OrderContent({
  params,
  searchParams,
}: {
  params: PageProps<"/account/orders/[id]">["params"];
  searchParams: PageProps<"/account/orders/[id]">["searchParams"];
}) {
  const { id: rawId } = await params;
  const parsedId = z.uuid().safeParse(rawId);
  const user = await requireUser(parsedId.success ? `/account/orders/${parsedId.data}` : "/account");
  if (!parsedId.success) notFound();

  // getOrder กรองด้วย user.id — คำสั่งซื้อของคนอื่นได้ 404 เหมือนไม่มีอยู่
  const order = await getOrder(user.id, parsedId.data);
  if (!order) notFound();

  /**
   * ขั้นของลูกค้า: ชำระเงิน → เลือกโบรกเกอร์ → กรอกเลขบัญชี MT5 → กำลังเปิดใช้งาน → เปิดใช้งานแล้ว
   * (หรือ "ชำระแล้ว แต่เปิดใช้งานอัตโนมัติไม่ได้" เมื่อขั้นเปิด license ถูกกัน — ไม่ใช่ "กำลังเปิดใช้งาน" ที่รอแล้วไม่มีอะไรเกิด)
   * "เปิดใช้งานแล้ว" ตัดสินจากรายชื่อ license ที่เผยแพร่ล่าสุด (สิ่งที่บอทอ่าน) ไม่ใช่แค่แถวในฐานข้อมูล:
   * license เปิดในฐานข้อมูลแล้วแต่รายชื่อยังไม่มีรายการนี้ (เผยแพร่ล้ม/รอคิว) → ยังเป็น "กำลังเปิดใช้งาน"
   */
  const licensed = order.status === "paid" && order.activatedLicense !== null;
  // เรียกเวลาปัจจุบันหลัง await requireUser เท่านั้น (ไม่อยู่ในส่วนที่ prerender)
  const activation = activationView(
    order.activatedLicense,
    order.accountNumber,
    licensed ? await getLatestPublishedEntries() : new Map(),
    todayInBangkok(new Date()),
  );
  // ชำระแล้ว มีบัญชีแล้ว แต่ยังไม่มี license: ถูกกันอยู่หรือแค่รอ (null = ไม่ได้ถูกกัน)
  const activationBlock = await getActivationBlock(order);
  const step = orderStep(
    order,
    activation.kind === "none" ? null : { published: activation.kind !== "pending" },
    activationBlock !== null,
  );
  // เลือกบัญชีที่มีอยู่แล้ว (ต่ออายุ/ใช้บัญชีเดิม) ได้ทั้งก่อนและหลังเลือกโบรกเกอร์ — จนกว่าคำสั่งซื้อจะมีบัญชี
  // (ลูกค้าเดิมที่กดเลือกโบรกเกอร์ไปก่อนต้องยังใช้เลขเดิมได้: ฟอร์มกรอกเลขใหม่ปฏิเสธเลขที่ตัวเองลงทะเบียนไว้แล้ว)
  const accounts =
    step === "choose_broker" || step === "submit_account" ? await listMt5AccountsWithLicense(user.id) : [];
  // แพ็กเกจฟรีจากการชวนเพื่อน: ไม่มีขั้นชำระเงิน (รับสิทธิ์ตอนสร้างคำสั่งซื้อ) ข้อความจึงใช้ "รับสิทธิ์" แทน "ชำระเงิน"
  const freePackage = isFreeReferralPackage({ code: order.packageCode });
  const freeClaim = order.paymentProvider === REFERRAL_PAYMENT_PROVIDER;
  // ยกเลิกเองได้: ยังรอชำระ หรือแพ็กเกจฟรีที่ยังไม่ได้เปิด license (ยกเลิก = คืนสิทธิ์) — cancelOrder ตรวจซ้ำ
  const cancellable = canCancelOrder(order);
  // ก่อนรับเงิน: บัญชี MT5 ที่ผูกไว้ยังรับการเปิด/ต่ออายุได้หรือไม่ (เปลี่ยนได้หลังสร้างคำสั่งซื้อ) — action ตรวจซ้ำ
  const paymentBlock = step === "pay" ? await getPaymentBlock(order) : null;

  // ช่องทางชำระ: บัตรผ่านผู้ให้บริการ (null = ยังไม่เปิด) — โอนเงิน + สลิปแสดงเฉพาะเมื่อเปิด PAYMENT_BANK_TRANSFER_ENABLED
  const provider = step === "pay" ? getPaymentProvider(process.env) : null;
  const bankTransfer = step === "pay" && canUploadSlip(order.status) && isBankTransferEnabled(process.env);
  const payment = bankTransfer ? getPaymentInfo(process.env) : null;
  // SLIP_STORAGE=disabled → ไม่แสดงฟอร์มอัปโหลด ให้ส่งสลิปทาง LINE (ค่าตั้งผิดถือว่าใช้ไม่ได้เช่นกัน)
  const slipStorage = resolveSlipStorage(process.env);
  const slipUploadEnabled = slipStorage.ok && slipStorage.kind !== "disabled";

  const brokerOptions = partnerBrokers.map((b) => ({ code: b.code, name: b.name }));
  const broker = findPartnerBroker(order.partnerBrokerCode);
  const brokerUrl = broker ? safeExternalUrl(broker.registerUrl) : null;

  // ?notice= มาจาก createOrderAction เมื่อบัญชีนี้มีคำสั่งซื้อค้างอยู่แล้ว จึงพามาที่รายการเดิมแทนการสร้างใหม่
  const { notice } = await searchParams;
  const reusedNotice =
    OPEN_ORDER_STATUSES.includes(order.status) && (notice === "existing" || notice === "other-package") ? notice : null;

  return (
    <>
      <p className="text-[14px]">
        <Link href="/account" className="text-link underline underline-offset-4">
          บัญชีของฉัน
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="tabular text-[28px] text-ink">คำสั่งซื้อ {formatOrderNo(order.orderNo)}</h1>
        <StatusBadge
          status={orderBadgeStatus(
            { status: order.status, freeClaim },
            activation.kind === "ended" ? activation.status : null,
            step,
          )}
        />
      </div>

      <dl className="mt-5 divide-y divide-rule rounded-lg border border-rule bg-surface text-[15px]">
        <Row label="แพ็กเกจ">
          {order.packageName}
          {/* ก่อนเปิด license: บอกจำนวนวันที่จะได้ (อายุหลัก + วันแถม) ให้ตรงกับหน้าแพ็กเกจ — เปิดแล้วดูวันหมดอายุจริงจากประกาศด้านล่าง */}
          {order.activatedLicense === null && order.status !== "cancelled" && order.status !== "refunded" ? (
            <span className="tabular block text-[13.5px] text-muted" data-testid="order-package-period">
              {order.packagePeriod}
            </span>
          ) : null}
        </Row>
        <Row label="ยอดชำระ">
          <span className="tabular font-semibold text-ink">{orderAmountText(order.amountThb)}</span>
        </Row>
        <Row label="วันที่สั่งซื้อ">{formatThaiDate(order.createdAt)}</Row>
        {order.paidAt ? (
          <Row label={freeClaim ? "รับสิทธิ์เมื่อ" : "ชำระเงินเมื่อ"}>{formatThaiDate(order.paidAt)}</Row>
        ) : null}
        <Row label="บัญชี MT5">
          {order.accountNumber ? (
            <>
              <span className="tabular font-medium text-ink">{order.accountNumber}</span>
              <span className="text-muted"> · {order.brokerServer}</span>
            </>
          ) : (
            <span className="text-muted">ยังไม่ได้ระบุ</span>
          )}
        </Row>
        {broker ? <Row label="โบรกเกอร์ที่เลือก">{broker.name}</Row> : null}
      </dl>

      {reusedNotice ? (
        <div className="mt-5">
          <Notice tone="warn">
            {reusedNotice === "other-package" ? (
              <>
                ยังไม่ได้สร้างคำสั่งซื้อใหม่ เพราะบัญชี MT5 นี้มีคำสั่งซื้อที่รอดำเนินการอยู่แล้ว คือรายการนี้ (แพ็กเกจ{" "}
                {order.packageName} ยอด {orderAmountText(order.amountThb)}) ซึ่งไม่ใช่แพ็กเกจที่คุณเพิ่งเลือก{" "}
                {cancellable
                  ? "หากต้องการเปลี่ยนแพ็กเกจ ให้ยกเลิกคำสั่งซื้อนี้ด้านล่าง แล้วสั่งซื้อใหม่"
                  : "หากต้องการเปลี่ยนแพ็กเกจ กรุณาติดต่อทีมงานทาง LINE"}
              </>
            ) : (
              <>บัญชี MT5 นี้มีคำสั่งซื้อที่รอดำเนินการอยู่แล้ว ระบบจึงเปิดรายการเดิมให้ ไม่ได้สร้างรายการใหม่</>
            )}
          </Notice>
        </div>
      ) : null}

      {order.status === "rejected" ? (
        <div className="mt-5">
          <Notice tone="error">
            สลิปไม่ผ่านการตรวจสอบ{order.adminNote ? `: ${order.adminNote}` : ""} กรุณาชำระเงินใหม่ด้านล่าง
          </Notice>
        </div>
      ) : null}
      {step === "legacy_review" ? (
        <div className="mt-5">
          <Notice tone="success">ได้รับสลิปแล้ว ทีมงานกำลังตรวจสอบ ระบบจะเปิด license ให้หลังตรวจสอบเรียบร้อย</Notice>
        </div>
      ) : null}

      {step === "pay" && freePackage ? (
        // ปกติไม่เกิด: แพ็กเกจฟรีถูกบันทึกเป็น "รับสิทธิ์แล้ว" ใน transaction เดียวกับการสร้างคำสั่งซื้อ — ไม่มีปุ่มชำระเงินให้รายการแบบนี้เด็ดขาด
        <div className="mt-6" data-testid="free-order-unclaimed">
          <Notice tone="warn">
            คำสั่งซื้อนี้เป็นแพ็กเกจฟรีจากการชวนเพื่อน ไม่มีขั้นชำระเงิน แต่ระบบยังไม่ได้บันทึกสิทธิ์ให้
            {cancellable ? " ยกเลิกคำสั่งซื้อนี้ด้านล่าง แล้วรับสิทธิ์ใหม่ในหน้าสั่งซื้อ" : null} หรือติดต่อทีมงาน{" "}
            <LineLink>ทาง LINE</LineLink>
          </Notice>
        </div>
      ) : null}
      {step === "pay" && !freePackage ? (
        <section className="mt-8">
          <h2 className="text-[20px] text-ink">ชำระเงิน</h2>
          {paymentBlock === null ? (
            <p className="mt-1 text-[14.5px] text-muted">
              {order.mt5AccountId
                ? "เมื่อชำระเงินแล้ว ระบบจะเปิดหรือต่ออายุ license ให้บัญชี MT5 ด้านบนโดยอัตโนมัติ"
                : "ชำระเงินก่อน แล้วเลือกโบรกเกอร์และกรอกเลขบัญชี MT5 ในขั้นถัดไป ยังไม่มีบัญชีเทรดก็ชำระได้"}
            </p>
          ) : null}
          {paymentBlock !== null ? (
            <div className="mt-3" data-testid="payment-blocked">
              <Notice tone="warn">
                ยังชำระเงินให้คำสั่งซื้อนี้ไม่ได้: {purchaseMessages[paymentBlock]}{" "}
                {cancellable ? "ถ้าไม่ต้องการคำสั่งซื้อนี้แล้ว ยกเลิกได้ด้านล่าง" : null}
              </Notice>
            </div>
          ) : provider ? (
            <PayByCardForm orderId={order.id} testMode={provider.testMode} />
          ) : (
            <div className="mt-3">
              <Notice tone="warn">
                ระบบชำระเงินยังไม่เปิดให้บริการ{" "}
                <LineLink>
                  สอบถามทาง LINE
                </LineLink>
              </Notice>
            </div>
          )}
          {bankTransfer && paymentBlock === null ? (
            <BankTransferSection
              orderId={order.id}
              amountThb={order.amountThb}
              payment={payment}
              slipUploadEnabled={slipUploadEnabled}
            />
          ) : null}
        </section>
      ) : null}

      {step === "choose_broker" ? (
        <section className="mt-8">
          <Notice tone="success">
            {freeClaim
              ? "รับสิทธิ์แพ็กเกจฟรีแล้ว ไม่ต้องชำระเงิน ขั้นถัดไป: เลือกโบรกเกอร์ที่จะเปิดบัญชีเทรด"
              : "ชำระเงินแล้ว ขั้นถัดไป: เลือกโบรกเกอร์ที่จะเปิดบัญชีเทรด"}
          </Notice>
          <h2 className="mt-6 text-[20px] text-ink">เลือกโบรกเกอร์</h2>
          <p className="mt-1 text-[14.5px] text-muted">
            เลือก 1 ราย แล้วระบบจะแสดงลิงก์เปิดบัญชีเทรด เปิดบัญชีเสร็จจึงกลับมากรอกเลขบัญชี MT5
          </p>
          <BrokerChooser orderId={order.id} brokers={brokerOptions} selectedCode={null} />
          <PartnerNote />
          {accounts.length > 0 ? (
            <div className="mt-8 border-t border-rule pt-6">
              <h3 className="text-[17px] font-semibold text-ink">หรือใช้บัญชี MT5 ที่ลงทะเบียนไว้แล้ว</h3>
              <AttachAccountForm orderId={order.id} accounts={accounts} />
            </div>
          ) : null}
        </section>
      ) : null}

      {step === "submit_account" && broker ? (
        <section className="mt-8">
          <h2 className="text-[20px] text-ink">เปิดบัญชีเทรด แล้วกรอกเลขบัญชี MT5</h2>
          <ol className="mt-3 space-y-5 text-[15px] text-text">
            <li>
              <p>
                1. เปิดบัญชีเทรดกับ <span className="font-semibold text-ink">{broker.name}</span>{" "}
                <span className="text-muted">(มีบัญชีกับโบรกเกอร์นี้อยู่แล้วข้ามได้)</span>
              </p>
              {brokerUrl ? (
                <a
                  href={brokerUrl}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="mt-2 inline-flex items-center gap-2 rounded-md border border-ink/30 px-4 py-2 text-[14.5px] font-medium text-ink hover:border-ink hover:bg-ink/5"
                >
                  เปิดบัญชีเทรดกับ {broker.name} <ExternalLink size={15} aria-hidden="true" />
                </a>
              ) : null}
            </li>
            <li>
              <p>2. โบรกเกอร์ไม่ส่งเลขบัญชีมาให้ระบบ เปิดบัญชีเสร็จแล้วกลับมากรอกเลขบัญชี MT5 ที่นี่</p>
              <div className="mt-2">
                <ButtonLink href={`/account/mt5/new?order=${order.id}`}>กรอกเลขบัญชี MT5</ButtonLink>
              </div>
            </li>
          </ol>
          <PartnerNote />
          {accounts.length > 0 ? (
            <div className="mt-8 border-t border-rule pt-6">
              <h3 className="text-[17px] font-semibold text-ink">หรือใช้บัญชี MT5 ที่ลงทะเบียนไว้แล้ว</h3>
              <p className="mt-1 text-[14.5px] text-muted">
                ถ้าจะใช้เลขบัญชีที่เคยลงทะเบียนกับเราแล้ว ไม่ต้องกรอกใหม่ เลือกจากรายการนี้
              </p>
              <AttachAccountForm orderId={order.id} accounts={accounts} />
            </div>
          ) : null}
          <details className="mt-6 text-[14.5px]">
            <summary className="cursor-pointer text-link underline underline-offset-4">เปลี่ยนโบรกเกอร์</summary>
            <BrokerChooser
              orderId={order.id}
              brokers={brokerOptions}
              selectedCode={broker.code}
              submitLabel="เปลี่ยนเป็นโบรกเกอร์นี้"
            />
          </details>
        </section>
      ) : null}
      {step === "submit_account" && !broker ? (
        // code ที่บันทึกไว้ไม่อยู่ในรายชื่อแล้ว (รายชื่อถูกแก้ภายหลัง) → ให้เลือกใหม่
        <section className="mt-8">
          <h2 className="text-[20px] text-ink">เลือกโบรกเกอร์</h2>
          <BrokerChooser orderId={order.id} brokers={brokerOptions} selectedCode={null} />
        </section>
      ) : null}

      {step === "activating" ? (
        <div className="mt-6">
          {/* โทนข้อมูล ไม่ใช่ error: เงินและเลขบัญชีบันทึกแล้ว — ไม่มีงานเบื้องหลังที่ลองใหม่เอง จึงไม่สัญญาเวลา บอกสิ่งที่ลูกค้าทำได้ */}
          <Notice>
            {freeClaim
              ? "ระบบบันทึกสิทธิ์แพ็กเกจฟรีและเลขบัญชี MT5 ของคุณแล้ว ไม่ต้องทำรายการใหม่"
              : "ระบบบันทึกการชำระเงินและเลขบัญชี MT5 ของคุณแล้ว ไม่ต้องชำระซ้ำ"}{" "}
            แต่การเปิดใช้งาน license ยังไม่เสร็จ กด
            &quot;ตรวจสอบสถานะอีกครั้ง&quot; ด้านล่างเพื่อให้ระบบลองเปิดใช้งานอีกรอบ หากยังไม่สำเร็จ ติดต่อทีมงาน{" "}
            <LineLink>ทาง LINE</LineLink> พร้อมเลขที่คำสั่งซื้อ {formatOrderNo(order.orderNo)}
          </Notice>
          <RetryActivationForm orderId={order.id} />
        </div>
      ) : null}

      {step === "blocked" && activationBlock !== null ? (
        <div className="mt-6" data-testid="activation-blocked">
          {/* ถูกกัน: กดลองใหม่ไม่ช่วย จึงไม่มีปุ่ม และไม่ใช้คำว่า "กำลังเปิดใช้งาน" */}
          <Notice tone="warn">
            {freeClaim ? "รับสิทธิ์แพ็กเกจฟรีแล้ว" : "ชำระเงินแล้ว"} แต่ระบบเปิดใช้งาน license
            ให้คำสั่งซื้อนี้โดยอัตโนมัติไม่ได้: {purchaseMessages[activationBlock]}{" "}
            {freeClaim ? (
              cancellable ? (
                "ยกเลิกคำสั่งซื้อนี้ด้านล่างเพื่อคืนสิทธิ์ แล้วรับใหม่ได้ หรือ"
              ) : null
            ) : (
              "ไม่ต้องชำระซ้ำ"
            )}{" "}
            กรุณาติดต่อทีมงาน <LineLink>ทาง LINE</LineLink> พร้อมเลขที่คำสั่งซื้อ {formatOrderNo(order.orderNo)}
          </Notice>
        </div>
      ) : null}

      {activation.kind === "active" ? (
        <div className="mt-6">
          <Notice tone="success">
            license เปิดใช้งานแล้ว · บัญชี MT5 <span className="tabular font-semibold">{order.accountNumber}</span> ·{" "}
            {activation.lifetime ? (
              "ใช้ได้ตลอดชีพ"
            ) : (
              <>
                ใช้ได้ถึง {formatThaiDate(activation.expiresAt)} (อีก {activation.daysRemaining} วัน)
              </>
            )}
          </Notice>
          {/* ยังไม่มีระบบดาวน์โหลด/อีเมล: บอกวิธีรับไฟล์ที่ใช้ได้จริงตอนนี้ ไม่ให้ลูกค้ารออีเมลที่ไม่มา */}
          <ol className="mt-3 space-y-1.5 text-[14.5px] text-text" data-testid="after-activation">
            <li>
              1. รับไฟล์ติดตั้ง indicator: ติดต่อทีมงาน <LineLink>ทาง LINE</LineLink> แจ้งเลขที่คำสั่งซื้อ{" "}
              {formatOrderNo(order.orderNo)} (ระบบยังไม่ส่งไฟล์ทางอีเมล)
            </li>
            <li>
              2.{" "}
              <Link href="/install" className="text-link underline underline-offset-4">
                ดูวิธีติดตั้ง indicator ใน MT5
              </Link>
            </li>
          </ol>
          <p className="mt-2 text-[13.5px] text-muted">
            บอทอ่านรายชื่อเป็นรอบ อาจใช้เวลาสักครู่ก่อนเริ่มทำงาน ต้องการเปลี่ยนเลขบัญชี ติดต่อทีมงานทาง LINE
          </p>
        </div>
      ) : null}
      {activation.kind === "ended" ? (
        <div className="mt-6">
          <Notice tone="warn">
            {activation.status === "suspended"
              ? "license ของบัญชี MT5 นี้ถูกระงับอยู่ กรุณาติดต่อทีมงานทาง LINE"
              : "license ที่เปิดจากคำสั่งซื้อนี้หมดอายุแล้ว ต่ออายุได้จากหน้าบัญชีของฉัน"}
          </Notice>
        </div>
      ) : null}

      {order.hasSlip ? (
        <p className="mt-6 text-[14.5px]">
          <a
            href={`/api/orders/${order.id}/slip`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link underline underline-offset-4"
          >
            ดูสลิปที่อัปโหลด
          </a>
          {order.slipUploadedAt ? (
            <span className="text-muted"> · อัปโหลดเมื่อ {formatThaiDate(order.slipUploadedAt)}</span>
          ) : null}
        </p>
      ) : null}

      {cancellable ? (
        <section className="mt-10 border-t border-rule pt-6">
          <h2 className="text-[17px] font-semibold text-ink">ยกเลิกคำสั่งซื้อ</h2>
          <p className="mt-1 text-[14.5px] text-muted" data-testid={freeClaim ? "cancel-free-claim" : undefined}>
            {freeClaim
              ? "ยังไม่ได้เปิด license จึงยกเลิกได้ ยกเลิกแล้วสิทธิ์แพ็กเกจฟรีจะกลับมาให้รับใหม่ได้ (เช่น ต้องการใช้กับบัญชี MT5 อื่น) เมื่อเปิด license แล้วจะยกเลิกไม่ได้"
              : "เลือกแพ็กเกจผิดหรือไม่ต้องการแล้ว ยกเลิกได้ตราบที่ยังไม่ได้ชำระเงิน หากชำระเงินไปแล้วอย่ายกเลิก ให้ติดต่อทีมงานทาง LINE"}
          </p>
          <CancelOrderForm orderId={order.id} />
        </section>
      ) : null}
    </>
  );
}

/** ข้อความกลางเรื่องลิงก์พาร์ตเนอร์ — ไม่ชวนเชื่อ และชี้ไปคำเตือนความเสี่ยง */
function PartnerNote() {
  return (
    <p className="mt-4 text-[13.5px] text-muted">
      ลิงก์เปิดบัญชีเป็นลิงก์พาร์ตเนอร์ของผู้ให้บริการ การเปิดบัญชีและการเทรดเป็นข้อตกลงระหว่างคุณกับโบรกเกอร์โดยตรง{" "}
      <Link href="/legal/risk" className="text-link underline underline-offset-4">
        อ่านคำเตือนความเสี่ยง
      </Link>
    </p>
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
