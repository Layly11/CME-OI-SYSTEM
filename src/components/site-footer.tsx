import Link from "next/link";
import { legalLinks, nav, riskNotice, site } from "@/content/site";
import { Container, Logo } from "./ui";

export function SiteFooter() {
  return (
    <footer className="on-ink bg-ink text-on-ink-muted">
      <Container className="py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo onInk />
            <p className="mt-4 max-w-[46ch] text-[15px]">{site.description}</p>
            <p className="mt-4 text-[15px]">
              สอบถามและติดต่อทีมงานผ่าน{" "}
              <a href={site.lineUrl} className="text-on-ink underline underline-offset-4">
                LINE
              </a>
            </p>
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-on-ink">เมนู</h3>
            <ul className="mt-3 space-y-2 text-[15px]">
              {nav.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="hover:text-on-ink">
                    {n.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/about" className="hover:text-on-ink">
                  ผู้พัฒนา
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-on-ink">
                  เข้าสู่ระบบ
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-on-ink">ข้อกำหนด</h3>
            <ul className="mt-3 space-y-2 text-[15px]">
              {legalLinks.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="hover:text-on-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-ink-line pt-6">
          <p className="max-w-[90ch] text-[13px] leading-relaxed">{riskNotice}</p>
          <p className="mt-4 text-[13px]">© {site.copyrightYear} CME OI SYSTEM. สงวนลิขสิทธิ์</p>
        </div>
      </Container>
    </footer>
  );
}
