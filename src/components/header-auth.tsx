import { getSessionUserOrNull, type SessionUser } from "@/lib/auth/dal";
import { Button, ButtonLink } from "./ui";

type Variant = "desktop" | "mobile";

/** ปุ่มมุมขวาของ header — sync จึงใช้เป็น fallback ของ <Suspense> ได้ (user=null = ผู้เยี่ยมชม) ไม่แสดงอีเมล */
export function HeaderAuthView({ user, variant }: { user: Pick<SessionUser, "role"> | null; variant: Variant }) {
  const mobile = variant === "mobile";
  const grow = mobile ? "flex-1" : "";
  const secondary = mobile ? "outline-ink" : "ghost";

  if (!user) {
    return (
      <>
        <ButtonLink href="/login" variant={secondary} className={grow}>
          เข้าสู่ระบบ
        </ButtonLink>
        <ButtonLink href="/pricing" className={grow}>
          สมัครใช้งาน
        </ButtonLink>
      </>
    );
  }

  return (
    <>
      {user.role === "admin" ? (
        <ButtonLink href="/admin" variant={secondary} className={grow}>
          หลังบ้าน
        </ButtonLink>
      ) : null}
      <ButtonLink href="/account" className={grow}>
        บัญชีของฉัน
      </ButtonLink>
      {/* ฟอร์ม HTML ธรรมดาไป POST /logout — ต้องเป็นการโหลดทั้งหน้า ไม่ใช่ Server Action (ดู src/app/logout/route.ts) */}
      <form method="post" action="/logout" className={mobile ? "flex flex-1" : "flex"}>
        <Button type="submit" variant={secondary} className={grow}>
          ออกจากระบบ
        </Button>
      </form>
    </>
  );
}

/** อ่าน session (cookie) จึงต้องอยู่ใน <Suspense> — ฐานข้อมูลล่มก็แสดงแบบผู้เยี่ยมชมแทนที่จะพังทั้งหน้า */
export async function HeaderAuth({ variant }: { variant: Variant }) {
  const user = await getSessionUserOrNull();
  return <HeaderAuthView user={user} variant={variant} />;
}
