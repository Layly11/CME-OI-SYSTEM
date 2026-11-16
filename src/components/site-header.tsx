"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { nav } from "@/content/site";
import { Container, Logo } from "./ui";

/**
 * ปุ่มเข้าสู่ระบบ/บัญชี มาจาก server component (ดู header-auth.tsx) ส่งเข้ามาเป็น slot
 * เพราะ header นี้เป็น client component จึงอ่าน session เองไม่ได้
 */
export function SiteHeader({ authDesktop, authMobile }: { authDesktop: ReactNode; authMobile: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-surface/95 backdrop-blur">
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" aria-label="CME OI SYSTEM หน้าแรก" onClick={() => setOpen(false)}>
          <Logo />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="เมนูหลัก">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[15px] text-text hover:text-ink hover:underline underline-offset-4"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">{authDesktop}</div>

        <button
          type="button"
          className="rounded-md p-2 text-ink md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "ปิดเมนู" : "เปิดเมนู"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </Container>

      {/* ซ่อนด้วย hidden แทนการถอดออกจาก DOM: ฟอร์มออกจากระบบใน slot ต้องยังอยู่ใน DOM ตอนที่กดแล้วเมนูปิด */}
      <div id="mobile-menu" hidden={!open} className="border-t border-rule bg-surface md:hidden">
        <Container className="flex flex-col py-3">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="py-2.5 text-[16px] text-text"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          {/* node จาก server ใส่ onClick เองไม่ได้ จึงปิดเมนูที่ตัวห่อ */}
          <div className="mt-2 flex gap-2 border-t border-rule pt-3" onClick={() => setOpen(false)}>
            {authMobile}
          </div>
        </Container>
      </div>
    </header>
  );
}
