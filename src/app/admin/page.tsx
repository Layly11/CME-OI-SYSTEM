import type { Metadata } from "next";
import { Suspense } from "react";
import { Notice, StatusBadge } from "@/components/form";
import { Button, Container } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { buildLicenseFile, diffLicenseFiles } from "@/lib/license-file";

export const metadata: Metadata = { title: "แอดมิน", robots: { index: false, follow: false } };

/**
 * หลังบ้าน — ข้อมูลตัวอย่างเพื่อให้เห็นหน้าตาและขั้นตอนทำงานของแอดมิน
 * เข้าได้เฉพาะ role=admin (requireAdmin) — ลูกค้าทั่วไปถูกพากลับหน้าบัญชี
 * TODO (เฟสถัดไป): อ่าน/เขียนฐานข้อมูลจริง, ปุ่มอนุมัติเป็น server action
 *
 * ส่วน "ไฟล์ license" ด้านล่างใช้โมดูลจริง (src/lib/license-file.ts) สร้างตัวอย่างให้ดู
 */
const demoQueue = [
  { id: "ORD-2026-0007", user: "somchai@example.com", account: "97058698", pkg: "รายปี", amount: "—", slip: "slip-0007.jpg", ib: "unverified", status: "awaiting_review" },
  { id: "ORD-2026-0006", user: "mali@example.com", account: "766232", pkg: "6 เดือน", amount: "—", slip: "slip-0006.jpg", ib: "verified", status: "awaiting_review" },
];

const demoActive = [
  { accountNumber: "766232", expiresAt: "2027-07-02" },
  { accountNumber: "97086397", expiresAt: "2027-07-01" },
  { accountNumber: "26763436", expiresAt: "9999-01-01" },
];

const previousFile = "id766232.2027.07.02,id97086397.2027.01.01";

/** โครงหน้าแบบ static ไม่มีเนื้อหาแอดมิน — เนื้อหาทั้งหมดอยู่ใน <Suspense> หลังตรวจสิทธิ์ */
export default function AdminPage() {
  return (
    <section className="py-12">
      <Container>
        <Suspense fallback={<p className="text-[15px] text-muted" aria-busy="true">กำลังตรวจสอบสิทธิ์…</p>}>
          <AdminContent />
        </Suspense>
      </Container>
    </section>
  );
}

async function AdminContent() {
  await requireAdmin();

  const nextFile = buildLicenseFile(demoActive);
  const diff = diffLicenseFiles(previousFile, nextFile);

  return (
    <>
        <Notice tone="warn">หน้าตัวอย่างสำหรับแอดมิน ข้อมูลจำลอง ยังไม่เชื่อมฐานข้อมูล</Notice>

        <h1 className="mt-8 text-[28px] text-ink">หลังบ้าน</h1>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { label: "รอตรวจสลิป", value: "2" },
            { label: "license ใช้งานอยู่", value: "3" },
            { label: "หมดอายุใน 7 วัน", value: "0" },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-rule bg-surface px-5 py-4">
              <p className="text-[13.5px] text-muted">{k.label}</p>
              <p className="tabular mt-1 text-[28px] font-semibold text-ink">{k.value}</p>
            </div>
          ))}
        </div>

        {/* คิวตรวจสลิป */}
        <h2 className="mt-10 text-[20px] text-ink">คิวตรวจสลิปและ IB</h2>
        <p className="text-[14.5px] text-muted">
          กดอนุมัติเมื่อยอดโอนตรงและ (ถ้าเป็นแพ็กเกจ IB) ตรวจใน IB portal แล้วว่าบัญชีอยู่ใต้เรา
          เมื่ออนุมัติ ระบบจะเปิด license, สร้างไฟล์ใหม่ และส่งอีเมลให้ลูกค้าอัตโนมัติ
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="tabular w-full min-w-[820px] text-left text-[14.5px]">
            <thead className="border-b border-rule text-[13px] text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">คำสั่งซื้อ</th>
                <th className="px-4 py-3 font-medium">ลูกค้า</th>
                <th className="px-4 py-3 font-medium">บัญชี MT5</th>
                <th className="px-4 py-3 font-medium">แพ็กเกจ</th>
                <th className="px-4 py-3 font-medium">สลิป</th>
                <th className="px-4 py-3 font-medium">IB</th>
                <th className="px-4 py-3 font-medium">สถานะ</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {demoQueue.map((o) => (
                <tr key={o.id} className="border-b border-rule last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{o.id}</td>
                  <td className="px-4 py-3">{o.user}</td>
                  <td className="px-4 py-3">{o.account}</td>
                  <td className="px-4 py-3">{o.pkg}</td>
                  <td className="px-4 py-3">
                    <span className="text-link underline underline-offset-4">{o.slip}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.ib} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline-ink" className="!px-3 !py-1.5 !text-[13.5px]" disabled>
                        ไม่ผ่าน
                      </Button>
                      <Button className="!px-3 !py-1.5 !text-[13.5px]" disabled>
                        อนุมัติ
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ไฟล์ license */}
        <h2 className="mt-10 text-[20px] text-ink">ไฟล์ license</h2>
        <p className="text-[14.5px] text-muted">
          ไฟล์นี้คือสิ่งที่ indicator ของลูกค้าทุกคนอ่าน ระบบจะแสดงความต่างจากไฟล์ปัจจุบันให้ตรวจก่อนกดเผยแพร่
          และเก็บทุกเวอร์ชันไว้ย้อนกลับได้
        </p>
        <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-lg border border-rule bg-surface p-4">
            <p className="text-[13px] text-muted">ตัวอย่างไฟล์ที่จะเผยแพร่ ({demoActive.length} รายการ)</p>
            <pre className="tabular mt-2 overflow-x-auto rounded-md bg-ink-deep p-3 text-[13px] text-on-ink">
              {nextFile}
            </pre>
            <div className="mt-3 grid gap-2 text-[14px] sm:grid-cols-3">
              <div>
                <p className="text-muted">เพิ่ม</p>
                <p className="font-medium text-call">
                  {diff.added.length} รายการ
                  {diff.added.length ? ` (${diff.added.map((e) => e.accountNumber).join(", ")})` : ""}
                </p>
              </div>
              <div>
                <p className="text-muted">เปลี่ยนวันหมดอายุ</p>
                <p className="font-medium text-ink">
                  {diff.changed.length} รายการ
                  {diff.changed.length ? ` (${diff.changed.map((c) => c.accountNumber).join(", ")})` : ""}
                </p>
              </div>
              <div>
                <p className="text-muted">ตัดออก</p>
                <p className="font-medium text-put">{diff.removed.length} รายการ</p>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <Button className="w-full" disabled>
              เผยแพร่ไฟล์ใหม่
            </Button>
            <Button variant="outline-ink" className="w-full" disabled>
              ย้อนกลับเวอร์ชันก่อนหน้า
            </Button>
            <p className="text-[13px] text-muted">
              ก่อนใช้งานจริง ต้องทดสอบไฟล์ที่ระบบสร้างกับบอทของลูกค้าอย่างน้อย 1 บัญชี
            </p>
          </div>
        </div>
    </>
  );
}
