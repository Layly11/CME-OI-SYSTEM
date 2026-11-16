"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, Container } from "@/components/ui";

/**
 * หน้า error ภาษาไทยของทุก route (แทนหน้า "This page couldn't load" ของ Next)
 * แสดงเมื่อ render ฝั่งเซิร์ฟเวอร์ล้ม (เช่นฐานข้อมูลขัดข้องตอนตรวจ session) หรือ Server Action ล้มโดยไม่ได้คาดไว้
 * ไม่แสดง error.message — ใน production เป็นข้อความกลางๆ ภาษาอังกฤษ และอาจมีรายละเอียดภายใน
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : null;

  return (
    <section className="py-20">
      <Container>
        <div className="mx-auto max-w-[520px]" role="alert">
          <h1 className="text-[28px] text-ink">ระบบขัดข้องชั่วคราว</h1>
          <p className="mt-2 text-[15.5px] text-muted">
            โหลดหน้านี้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง ข้อมูลที่บันทึกสำเร็จไปแล้วยังอยู่ครบ
            หากยังพบปัญหา กรุณาติดต่อทีมงานทาง LINE
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button type="button" onClick={() => retry()}>
              ลองใหม่อีกครั้ง
            </Button>
            {/* ลิงก์ธรรมดา (โหลดทั้งหน้า) — ออกจากสถานะ error ได้แน่นอน */}
            <a href="/account" className="text-link underline underline-offset-4">
              บัญชีของฉัน
            </a>
            <Link href="/" className="text-link underline underline-offset-4">
              กลับหน้าแรก
            </Link>
          </div>
          {digest ? <p className="tabular mt-6 text-[12.5px] text-muted">รหัสอ้างอิง: {digest}</p> : null}
        </div>
      </Container>
    </section>
  );
}
