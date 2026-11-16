import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { HeaderAuth, HeaderAuthView } from "@/components/header-auth";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { site } from "@/content/site";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: `${site.name} — ข้อมูลสถาบันจาก CME บนกราฟทอง MT5 ของคุณ`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  openGraph: {
    type: "website",
    locale: "th_TH",
    siteName: site.name,
    title: `${site.name} — ข้อมูลสถาบันจาก CME บนกราฟทอง MT5 ของคุณ`,
    description: site.description,
    images: [{ url: "/images/dashboard-box.webp", width: 853, height: 1280 }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className="h-full">
      <head>
        {/* ฟอนต์ไทยโหลดฝั่งเบราว์เซอร์ (IBM Plex Sans Thai) — ไม่ใช้ next/font เพื่อให้ build ได้ในเครือข่ายปิด */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- root layout ใช้ได้กับทุกหน้า */}
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="flex min-h-full flex-col">
        {/* ฟอร์มสมัคร/เข้าสู่ระบบ/สั่งซื้อแสดงผลลัพธ์ผ่าน JavaScript — ปิดไว้จะกดส่งแล้วไม่เห็นข้อความใดๆ จึงต้องบอกตรงๆ */}
        <noscript>
          <div role="alert" className="bg-gold-soft px-5 py-3 text-center text-[14.5px] text-text">
            เว็บไซต์นี้ต้องเปิดใช้ JavaScript จึงจะสมัครสมาชิก เข้าสู่ระบบ และสั่งซื้อได้
            กรุณาเปิด JavaScript ในเบราว์เซอร์แล้วโหลดหน้านี้ใหม่
          </div>
        </noscript>
        {/* session อ่านใน <Suspense> เท่านั้น — ห้าม await ใน layout (จะทำให้ทุกหน้า prerender ไม่ได้) */}
        <SiteHeader
          authDesktop={
            <Suspense fallback={<HeaderAuthView user={null} variant="desktop" />}>
              <HeaderAuth variant="desktop" />
            </Suspense>
          }
          authMobile={
            <Suspense fallback={<HeaderAuthView user={null} variant="mobile" />}>
              <HeaderAuth variant="mobile" />
            </Suspense>
          }
        />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
