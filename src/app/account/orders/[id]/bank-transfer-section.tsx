import { Notice } from "@/components/form";
import { LineLink } from "@/components/line-link";
import type { PaymentInfo } from "@/lib/purchase/config";
import { formatThb } from "@/lib/purchase/format";
import { purchaseMessages } from "@/lib/purchase/messages";
import { SlipUploadForm } from "./slip-upload-form";

/**
 * โอนเงิน/PromptPay + แนบสลิป (ขั้นตอนรอบก่อน) — แสดงเฉพาะเมื่อ PAYMENT_BANK_TRANSFER_ENABLED=true
 * ค่าเริ่มต้นซ่อนจากลูกค้า: บัตรเป็นช่องทางเดียวที่เห็น และรอบนี้ยังไม่มีขั้นตอนยืนยันสลิป
 */
export function BankTransferSection({
  orderId,
  amountThb,
  payment,
  slipUploadEnabled,
}: {
  orderId: string;
  amountThb: number;
  payment: PaymentInfo | null;
  slipUploadEnabled: boolean;
}) {
  return (
    <div className="mt-8">
      <h3 className="text-[17px] font-semibold text-ink">หรือโอนเงินผ่านธนาคาร</h3>
      {payment ? (
        <dl className="mt-3 divide-y divide-rule rounded-lg border border-rule bg-surface text-[15px]">
          <Row label="ธนาคาร">{payment.bankName}</Row>
          <Row label="ชื่อบัญชี">{payment.accountName}</Row>
          <Row label="เลขที่บัญชี">
            <span className="tabular font-medium text-ink">{payment.accountNumber}</span>
          </Row>
          {payment.promptPayId ? (
            <Row label="PromptPay">
              <span className="tabular font-medium text-ink">{payment.promptPayId}</span>
            </Row>
          ) : null}
          <Row label="ยอดที่ต้องโอน">
            <span className="tabular font-semibold text-ink">{formatThb(amountThb)}</span>
          </Row>
        </dl>
      ) : (
        <div className="mt-3">
          <Notice tone="warn">
            กรุณาสอบถามบัญชีสำหรับโอนเงินจากทีมงาน{" "}
            <LineLink>
              ทาง LINE
            </LineLink>{" "}
            แล้วกลับมาแนบสลิปที่หน้านี้
          </Notice>
        </div>
      )}
      <h3 className="mt-6 text-[17px] font-semibold text-ink">แนบสลิปโอนเงิน</h3>
      {slipUploadEnabled ? (
        <SlipUploadForm orderId={orderId} hasPromptPay={Boolean(payment?.promptPayId)} />
      ) : (
        <div className="mt-3">
          <Notice tone="warn">
            {purchaseMessages.slip_upload_unavailable}{" "}
            <LineLink>
              เปิด LINE
            </LineLink>
          </Notice>
        </div>
      )}
    </div>
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
