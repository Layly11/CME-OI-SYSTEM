import type { Metadata } from "next";
import Link from "next/link";
import { Download, Mail } from "lucide-react";
import { Notice, StatusBadge } from "@/components/form";
import { ButtonLink, Container } from "@/components/ui";

export const metadata: Metadata = { title: "บัญชีของฉัน" };

/**
 * Member Area — ตอนนี้เป็นข้อมูลตัวอย่างเพื่อให้เห็นหน้าตาและ flow
 * TODO (เฟสถัดไป): อ่านข้อมูลจริงจากฐานข้อมูลตาม user ที่ล็อกอิน (ห่อด้วย <Suspense>)
 */
const demo = {
  user: { name: "สมชาย ตัวอย่าง", email: "somchai@example.com" },
  accounts: [
    {
      accountNumber: "97058698",
      brokerServer: "InterStellarFinancial-Server",
      license: { status: "active", package: "รายปี", expiresAt: "2027-11-09", daysLeft: 365 },
    },
  ],
  orders: [
    { id: "ORD-2026-0001", date: "9 พ.ย. 2569", package: "รายปี", amount: "—", status: "paid" },
  ],
  downloads: [
    { name: "CME OI SYSTEM Pro (indicator)", version: "3.2", date: "9 พ.ย. 2569" },
    { name: "คู่มือติดตั้งและใช้งาน (PDF)", version: "2026.11", date: "9 พ.ย. 2569" },
  ],
};

export default function AccountPage() {
  return (
    <section className="py-12">
      <Container>
        <Notice tone="warn">
          หน้านี้แสดงข้อมูลตัวอย่าง ยังไม่เชื่อมระบบล็อกอินและฐานข้อมูล (จะเชื่อมในเฟสถัดไป)
        </Notice>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] text-ink">บัญชีของฉัน</h1>
            <p className="text-[15px] text-muted">
              {demo.user.name} · {demo.user.email}
            </p>
          </div>
          <ButtonLink href="/pricing" variant="outline-ink">
            ซื้อ license เพิ่ม
          </ButtonLink>
        </div>

        {/* License */}
        <h2 className="mt-10 text-[20px] text-ink">License และบัญชี MT5</h2>
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
              {demo.accounts.map((a) => (
                <tr key={a.accountNumber} className="border-b border-rule last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{a.accountNumber}</td>
                  <td className="px-4 py-3">{a.brokerServer}</td>
                  <td className="px-4 py-3">{a.license.package}</td>
                  <td className="px-4 py-3">
                    {a.license.expiresAt}{" "}
                    <span className="text-muted">(อีก {a.license.daysLeft} วัน)</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={a.license.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href="/pricing" className="text-link underline underline-offset-4">
                      ต่ออายุ
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[13.5px] text-muted">
          ต้องการย้าย license ไปบัญชี MT5 อื่น ติดต่อทีมงานทาง LINE
        </p>

        {/* Downloads */}
        <h2 className="mt-10 text-[20px] text-ink">ดาวน์โหลด</h2>
        <p className="text-[14.5px] text-muted">
          ไฟล์ชุดเดียวกับที่ส่งให้ทางอีเมล ดาวน์โหลดซ้ำได้ตลอดช่วงที่ license ยังใช้งานได้
        </p>
        <ul className="mt-3 divide-y divide-rule rounded-lg border border-rule bg-surface">
          {demo.downloads.map((d) => (
            <li key={d.name} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <div>
                <p className="text-[15px] font-medium text-ink">{d.name}</p>
                <p className="text-[13.5px] text-muted">
                  เวอร์ชัน {d.version} · อัปเดต {d.date}
                </p>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-rule px-3 py-1.5 text-[14px] text-ink hover:bg-ink/5"
                disabled
              >
                <Download size={16} aria-hidden="true" /> ดาวน์โหลด
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex items-center gap-2 text-[13.5px] text-muted">
          <Mail size={15} aria-hidden="true" /> ไม่ได้รับอีเมล? ตรวจโฟลเดอร์สแปม หรือกดส่งอีเมลซ้ำได้ที่นี่ (เฟสถัดไป)
        </p>

        {/* Orders */}
        <h2 className="mt-10 text-[20px] text-ink">ประวัติคำสั่งซื้อ</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="tabular w-full min-w-[560px] text-left text-[14.5px]">
            <thead className="border-b border-rule text-[13px] text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">เลขที่</th>
                <th className="px-4 py-3 font-medium">วันที่</th>
                <th className="px-4 py-3 font-medium">แพ็กเกจ</th>
                <th className="px-4 py-3 font-medium">ยอด</th>
                <th className="px-4 py-3 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {demo.orders.map((o) => (
                <tr key={o.id} className="border-b border-rule last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{o.id}</td>
                  <td className="px-4 py-3">{o.date}</td>
                  <td className="px-4 py-3">{o.package}</td>
                  <td className="px-4 py-3">{o.amount}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Container>
    </section>
  );
}
