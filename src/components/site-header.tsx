"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { nav } from "@/content/site";
import { ButtonLink, Container, Logo } from "./ui";

export function SiteHeader() {
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

        <div className="hidden items-center gap-2 md:flex">
          <ButtonLink href="/login" variant="ghost">
            เข้าสู่ระบบ
          </ButtonLink>
          <ButtonLink href="/pricing">สมัครใช้งาน</ButtonLink>
        </div>

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

      {open ? (
        <div id="mobile-menu" className="border-t border-rule bg-surface md:hidden">
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
            <div className="mt-2 flex gap-2 border-t border-rule pt-3">
              <ButtonLink href="/login" variant="outline-ink" className="flex-1" onClick={() => setOpen(false)}>
                เข้าสู่ระบบ
              </ButtonLink>
              <ButtonLink href="/pricing" className="flex-1" onClick={() => setOpen(false)}>
                สมัครใช้งาน
              </ButtonLink>
            </div>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
