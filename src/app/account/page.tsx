import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Notice, StatusBadge } from "@/components/form";
import { LineLink } from "@/components/line-link";
import { ButtonLink, Container } from "@/components/ui";
import { referralCopy } from "@/content/site";
import { requireUser } from "@/lib/auth/dal";
import { referralInvitePath } from "@/lib/auth/validation";
import { getActivationBlock } from "@/lib/license/activation-block";
import { activationView, isLicensePublished } from "@/lib/license/published-state";
import { getLatestPublishedEntries } from "@/lib/license/publish-sync";
import { REFERRAL_PAYMENT_PROVIDER } from "@/lib/payment/config";
import { findPartnerBroker } from "@/lib/purchase/brokers";
import { siteOriginFromEnv } from "@/lib/purchase/config";
import { formatOrderNo, formatThaiDate, licenseView, todayInBangkok } from "@/lib/purchase/format";
import { orderBadgeStatus, orderStep, type OrderStep } from "@/lib/purchase/order-progress";
import {
  FREE_REFERRAL_PACKAGE_CODE,
  freeClaimState,
  isFreeReferralPackage,
  orderAmountText,
  packageDisplayName,
  referralProgressText,
} from "@/lib/purchase/packages";
import { getReferralSummary } from "@/lib/purchase/referral";
import { listActivePackages, listMt5AccountsWithLicense, listOrders } from "@/lib/purchase/repo";
import { DeleteMt5AccountButton } from "./delete-mt5-account-button";
import { InviteLink } from "./invite-link";

export const metadata: Metadata = { title: "บัญชีของฉัน", robots: { index: false, follow: false } };

/** โครงหน้าแบบ static (ไม่มีข้อมูลผู้ใช้) — เนื้อหาจริงอยู่ใน <Suspense> หลังตรวจ session */
export default function AccountPage() {
  return (
    <section className="py-12">
      <Container>
        <Suspense fallback={<AccountSkeleton />}>
          <AccountContent />
        </Suspense>
      </Container>
    </section>
  );
}

function AccountSkeleton() {
  return (
    <div aria-busy="true">
      <h1 className="text-[28px] text-ink">บัญชีของฉัน</h1>
      <p className="text-[15px] text-muted">กำลังโหลดข้อมูล…</p>
    </div>
  );
}

/** Member Area — บัญชี MT5 / license / คำสั่งซื้อ ของผู้ใช้ที่ล็อกอินเท่านั้น (ทุก query กรองด้วย user.id) */
async function AccountContent() {
  const user = await requireUser("/account");
  const [accounts, orders, referral, packages] = await Promise.all([
    listMt5AccountsWithLicense(user.id),
    listOrders(user.id),
    getReferralSummary(user.id),
    listActivePackages(),
  ]);
  // แพ็กเกจฟรีจากการชวนเพื่อน (ถ้าเปิดให้รับอยู่) — สถานะสิทธิ์ที่แสดงเป็นแค่การอ่าน ด่านจริงอยู่ที่ createOrder/ขั้นเปิด license
  const freePackage = packages.find((p) => p.orderable && isFreeReferralPackage(p)) ?? null;
  const freeState = referral ? freeClaimState(referral) : null;
  // รายชื่อ license ที่เผยแพร่ล่าสุด (สิ่งที่บอทอ่าน) — license ที่ active ในฐานข้อมูลแต่ยังไม่อยู่ในรายชื่อนี้ แสดงเป็น "กำลังเปิดใช้งาน"
  const published = accounts.some((a) => a.license) ? await getLatestPublishedEntries() : new Map<string, string>();
  // เรียกเวลาปัจจุบันหลัง await requireUser เท่านั้น (ไม่อยู่ในส่วนที่ prerender)
  const today = todayInBangkok(new Date());

  // ขั้นของแต่ละคำสั่งซื้อ — "เปิดใช้งานแล้ว" เมื่อ license ของคำสั่งซื้ออยู่ในรายชื่อที่เผยแพร่แล้วเท่านั้น
  // คำสั่งซื้อที่ชำระแล้ว มีบัญชี แต่ยังไม่มี license (ปกติไม่มีเลย) ถูกถามเพิ่มว่าถูกกันหรือแค่รอ
  const orderViews = await Promise.all(
    orders.map(async (o) => {
      const activation = activationView(o.activatedLicense, o.accountNumber, published, today);
      const blocked = (await getActivationBlock(o)) !== null;
      const step = orderStep(o, activation.kind === "none" ? null : { published: activation.kind !== "pending" }, blocked);
      // แพ็กเกจฟรีจากการชวนเพื่อน: ไม่มีการชำระเงิน ข้อความ/ป้ายใช้ "รับสิทธิ์แล้ว" แทน "ชำระแล้ว"
      const freeClaim = o.paymentProvider === REFERRAL_PAYMENT_PROVIDER;
      const badge = orderBadgeStatus(
        { status: o.status, freeClaim },
        activation.kind === "ended" ? activation.status : null,
        step,
      );
      return { order: o, step, badge, freeClaim };
    }),
  );
  // คำสั่งซื้อที่ชำระแล้วและยังต้องให้ลูกค้าทำต่อ (เลือกโบรกเกอร์ / กรอกเลขบัญชี / กดตรวจสอบสถานะ / ติดต่อทีมงาน)
  // ลูกค้าที่ออกไปเปิดบัญชีเทรดแล้วล็อกอินกลับมา ต้องเห็นทางไปต่อที่หัวหน้า ไม่ใช่ปุ่ม "สั่งซื้อแพ็กเกจ" อีกรอบ
  const nextSteps: Partial<Record<OrderStep, { text: string; action: string }>> = {
    choose_broker: { text: "ชำระแล้ว ขั้นถัดไป: เลือกโบรกเกอร์และกรอกเลขบัญชี MT5", action: "เลือกโบรกเกอร์" },
    submit_account: { text: "ชำระแล้ว ขั้นถัดไป: กรอกเลขบัญชี MT5 เพื่อเปิด license", action: "กรอกเลขบัญชี MT5" },
    activating: { text: "ชำระแล้ว แต่ license ยังเปิดใช้งานไม่เสร็จ", action: "ตรวจสอบสถานะ" },
    blocked: { text: "ชำระแล้ว แต่ระบบเปิดใช้งานอัตโนมัติไม่ได้ กรุณาติดต่อทีมงาน", action: "ดูรายละเอียด" },
  };
  const unfinished = orderViews.filter((v) => nextSteps[v.step] !== undefined);
  // มี license ที่บอทใช้ได้จริงแล้วอย่างน้อย 1 บัญชี (active ยังไม่หมดอายุ และอยู่ในรายชื่อที่เผยแพร่)
  const hasActiveLicense = accounts.some(
    (a) =>
      a.license !== null &&
      licenseView(a.license, today).status === "active" &&
      isLicensePublished(published, a.accountNumber, a.license.expiresAt),
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] text-ink">บัญชีของฉัน</h1>
          <p className="text-[15px] text-muted">
            {user.name ? `${user.name} · ` : ""}
            {user.email}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {/* มีคำสั่งซื้อที่ชำระแล้วรอทำต่อ: ปุ่มนี้เป็นรอง ทางหลักคือประกาศด้านล่าง */}
          <ButtonLink href="/account/orders/new" variant={unfinished.length > 0 ? "outline-ink" : "gold"}>
            สั่งซื้อแพ็กเกจ
          </ButtonLink>
        </div>
      </div>

      {unfinished.length > 0 ? (
        <div className="mt-6 space-y-3" data-testid="unfinished-orders">
          {unfinished.map(({ order: o, step, freeClaim }) => (
            <Notice key={o.id} tone={step === "blocked" ? "warn" : "success"}>
              <span className="tabular font-semibold">คำสั่งซื้อ {formatOrderNo(o.orderNo)}</span> ({o.packageName}):{" "}
              {freeClaim ? nextSteps[step]?.text.replace(/^ชำระแล้ว/, "รับสิทธิ์แพ็กเกจฟรีแล้ว") : nextSteps[step]?.text}{" "}
              <Link href={`/account/orders/${o.id}`} className="font-semibold text-link underline underline-offset-4">
                {nextSteps[step]?.action}
              </Link>
            </Notice>
          ))}
        </div>
      ) : null}

      {/* ชวนเพื่อน */}
      {referral ? (
        <section className="mt-10 rounded-lg border border-rule bg-surface px-5 py-5" data-testid="referral">
          <h2 className="text-[20px] text-ink">ชวนเพื่อน</h2>
          <p className="mt-1 text-[14.5px] text-muted">{referralCopy.inviteHint}</p>
          <InviteLink
            path={referralInvitePath(referral.code)}
            siteOrigin={siteOriginFromEnv(process.env.NEXT_PUBLIC_SITE_URL)}
          />
          <p className="mt-1 text-[15px] text-text">
            เพื่อนที่สมัครผ่านลิงก์ของคุณแล้ว:{" "}
            <span className="tabular font-semibold text-ink" data-testid="referred-count">
              {referral.referredCount}
            </span>{" "}
            คน
          </p>
          {freePackage && freeState ? (
            <p className="mt-2 text-[14.5px] text-text" data-testid="free-package-status" data-state={freeState}>
              <span className="font-medium text-ink">แพ็กเกจ{packageDisplayName(freePackage)}:</span>{" "}
              {freeState === "claimed" ? (
                "คุณใช้สิทธิ์แล้ว (รับได้ 1 ครั้งต่อผู้ใช้)"
              ) : freeState === "claim_open" && referral.claim ? (
                <>
                  คุณรับสิทธิ์ไว้แล้ว ยังทำขั้นถัดไปไม่เสร็จ{" "}
                  <Link
                    href={`/account/orders/${referral.claim.orderId}`}
                    className="font-semibold text-link underline underline-offset-4"
                  >
                    ไปที่คำสั่งซื้อ
                  </Link>
                </>
              ) : freeState === "eligible" ? (
                <>
                  {referralProgressText(referral.referredCount)} ครบเงื่อนไขแล้ว{" "}
                  <Link
                    href={`/account/orders/new?package=${FREE_REFERRAL_PACKAGE_CODE}`}
                    className="font-semibold text-link underline underline-offset-4"
                  >
                    รับแพ็กเกจฟรี
                  </Link>{" "}
                  (ไม่มีขั้นชำระเงิน)
                </>
              ) : (
                <>
                  {referralProgressText(referral.referredCount)}
                  {freePackage.description ? ` · เงื่อนไข: ${freePackage.description}` : ""}
                </>
              )}
              <span className="block text-[13.5px] text-muted">{referralCopy.limits}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {/* License */}
      <h2 className="mt-10 text-[20px] text-ink">License และบัญชี MT5</h2>
      {accounts.length === 0 && unfinished.length > 0 ? (
        // มีคำสั่งซื้อที่ชำระแล้วรออยู่: ไม่ชวนสั่งซื้อใหม่ (กดแล้วจะได้คำสั่งซื้อที่สองและจ่ายซ้ำ)
        <div className="mt-3 rounded-lg border border-rule bg-surface px-5 py-6">
          <p className="text-[15px] text-text">ยังไม่มีบัญชี MT5 ในระบบ</p>
          <p className="mt-1 text-[14px] text-muted">
            {unfinished.every((v) => v.freeClaim) ? "คุณรับสิทธิ์แพ็กเกจฟรีแล้ว" : "คุณชำระเงินแล้ว"} ไม่ต้องสั่งซื้อใหม่
            ทำขั้นถัดไปของคำสั่งซื้อด้านบนให้เสร็จ บัญชี MT5 และ license
            จะแสดงที่นี่ (ไม่ต้องใส่รหัสผ่าน MT5)
          </p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="mt-3 rounded-lg border border-rule bg-surface px-5 py-6">
          <p className="text-[15px] text-text">ยังไม่มีบัญชี MT5 ในระบบ</p>
          <p className="mt-1 text-[14px] text-muted">
            เริ่มจากสั่งซื้อแพ็กเกจและชำระเงิน จากนั้นเลือกโบรกเกอร์ แล้วกรอกเลขบัญชี MT5 ในหน้าคำสั่งซื้อ
            (ไม่ต้องใส่รหัสผ่าน MT5) ยังไม่มีบัญชีเทรดก็สั่งซื้อก่อนได้
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href="/account/orders/new">สั่งซื้อแพ็กเกจ</ButtonLink>
          </div>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="tabular w-full min-w-[640px] text-left text-[14.5px]">
            <thead className="border-b border-rule text-[13px] text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">เลขบัญชี MT5</th>
                <th className="px-4 py-3 font-medium">Broker Server</th>
                <th className="px-4 py-3 font-medium">แพ็กเกจ</th>
                <th className="px-4 py-3 font-medium">หมดอายุ</th>
                <th className="px-4 py-3 font-medium">สถานะ</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const view = a.license ? licenseView(a.license, today) : null;
                // license ตลอดชีพที่ใช้งานอยู่ไม่มีอะไรให้ต่ออายุ (createOrder ปฏิเสธซ้ำอีกชั้น)
                const lifetimeActive = view !== null && view.lifetime && view.status === "active";
                const awaitingPublish =
                  a.license !== null &&
                  view?.status === "active" &&
                  !isLicensePublished(published, a.accountNumber, a.license.expiresAt);
                return (
                  <tr key={a.id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">
                      {a.accountNumber}
                      {a.label ? <span className="block text-[13px] font-normal text-muted">{a.label}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      {a.brokerServer}
                      {findPartnerBroker(a.partnerBrokerCode) ? (
                        <span className="block text-[13px] text-muted">
                          พาร์ตเนอร์: {findPartnerBroker(a.partnerBrokerCode)?.name}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{a.license?.packageName ?? "—"}</td>
                    <td className="px-4 py-3">
                      {a.license && view ? (
                        view.lifetime ? (
                          "ตลอดชีพ"
                        ) : (
                          <>
                            {formatThaiDate(a.license.expiresAt)}{" "}
                            {view.status === "active" ? (
                              <span className="text-muted">(อีก {view.daysRemaining} วัน)</span>
                            ) : null}
                          </>
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {view ? (
                        <StatusBadge status={awaitingPublish ? "activating" : view.status} />
                      ) : (
                        <span className="text-muted">ยังไม่มี license</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex flex-wrap items-start justify-end gap-x-4 gap-y-1">
                        {lifetimeActive ? null : (
                          <Link
                            href={`/account/orders/new?account=${a.id}`}
                            className="text-link underline underline-offset-4"
                          >
                            {view ? "ต่ออายุ" : "สั่งซื้อ"}
                          </Link>
                        )}
                        {/* ลบได้เฉพาะบัญชีที่ยังไม่มี license — เซิร์ฟเวอร์ตรวจซ้ำ รวมถึงคำสั่งซื้อที่ชำระแล้ว/รอตรวจ */}
                        {a.license === null ? (
                          <DeleteMt5AccountButton accountId={a.id} accountNumber={a.accountNumber} />
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[13.5px] text-muted">
        กรอกเลขบัญชีผิด? ยังเปลี่ยนเลขบัญชีหลังเปิดใช้งานเองไม่ได้ การแก้เลขบัญชีที่มี license แล้ว หรือย้าย license
        ไปบัญชี MT5 อื่น ติดต่อทีมงานทาง LINE
      </p>

      {/* Orders */}
      <h2 className="mt-10 text-[20px] text-ink">ประวัติคำสั่งซื้อ</h2>
      {orders.length === 0 ? (
        <div className="mt-3 rounded-lg border border-rule bg-surface px-5 py-6">
          <p className="text-[15px] text-text">ยังไม่มีคำสั่งซื้อ</p>
          <div className="mt-4">
            <ButtonLink href="/account/orders/new">สั่งซื้อแพ็กเกจ</ButtonLink>
          </div>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="tabular w-full min-w-[620px] text-left text-[14.5px]">
            <thead className="border-b border-rule text-[13px] text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">เลขที่</th>
                <th className="px-4 py-3 font-medium">วันที่</th>
                <th className="px-4 py-3 font-medium">แพ็กเกจ</th>
                <th className="px-4 py-3 font-medium">บัญชี MT5</th>
                <th className="px-4 py-3 font-medium">ยอด</th>
                <th className="px-4 py-3 font-medium">สถานะ</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {orderViews.map(({ order: o, badge }) => {
                return (
                <tr key={o.id} className="border-b border-rule last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{formatOrderNo(o.orderNo)}</td>
                  <td className="px-4 py-3">{formatThaiDate(o.createdAt)}</td>
                  <td className="px-4 py-3">{o.packageName}</td>
                  <td className="px-4 py-3">{o.accountNumber ?? <span className="text-muted">ยังไม่ระบุ</span>}</td>
                  <td className="px-4 py-3">{orderAmountText(o.amountThb)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={badge} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/account/orders/${o.id}`} className="text-link underline underline-offset-4">
                      ดูรายละเอียด
                    </Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Downloads */}
      <h2 className="mt-10 text-[20px] text-ink">ดาวน์โหลด</h2>
      {/* ยังไม่มีระบบดาวน์โหลด (download_assets) และยังไม่ส่งอีเมล — บอกวิธีรับไฟล์ที่ใช้ได้จริงตอนนี้ */}
      <p className="mt-1 text-[14.5px] text-muted" data-testid="downloads">
        {hasActiveLicense ? (
          <>
            license ของคุณเปิดใช้งานแล้ว รับไฟล์ติดตั้งและคู่มือได้โดยติดต่อทีมงาน <LineLink>ทาง LINE</LineLink>{" "}
            แจ้งเลขบัญชี MT5 หรือเลขที่คำสั่งซื้อ (หน้านี้ยังดาวน์โหลดเองไม่ได้ และระบบยังไม่ส่งไฟล์ทางอีเมล) จากนั้น{" "}
            <Link href="/install" className="text-link underline underline-offset-4">
              ดูวิธีติดตั้ง
            </Link>
          </>
        ) : (
          <>
            เมื่อ license เปิดใช้งานแล้ว รับไฟล์ติดตั้งและคู่มือได้โดยติดต่อทีมงาน <LineLink>ทาง LINE</LineLink>{" "}
            (หน้านี้ยังดาวน์โหลดเองไม่ได้ และระบบยังไม่ส่งไฟล์ทางอีเมล)
          </>
        )}
      </p>
    </>
  );
}
