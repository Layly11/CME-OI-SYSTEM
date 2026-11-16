import type { ReactNode } from "react";
import { site } from "@/content/site";

/**
 * ลิงก์ไป LINE ของผู้ให้บริการ — ทางออกของทุกจุดที่ระบบทำเองไม่ได้ ("สอบถามทาง LINE", "ติดต่อทีมงานทาง LINE")
 * ยังไม่ได้ตั้ง NEXT_PUBLIC_LINE_URL (site.lineUrl = null) → แสดงเป็นข้อความธรรมดา ไม่ใช่ลิงก์ที่กดแล้วไม่ไปไหน
 * ค่านี้ถูกฝังตอน build: ตั้งตัวแปรบนเซิร์ฟเวอร์ที่รันอยู่ไม่ช่วย ต้อง build ใหม่ (src/instrumentation.ts เตือนตอนเริ่มเซิร์ฟเวอร์)
 */
export function LineLink({
  children,
  className = "text-link underline underline-offset-4",
}: {
  children: ReactNode;
  className?: string;
}) {
  if (site.lineUrl === null) return <span data-line-link="unset">{children}</span>;
  return (
    <a href={site.lineUrl} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
