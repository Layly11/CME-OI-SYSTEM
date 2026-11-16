import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "./constants";
import { deleteSessionByToken, insertSession } from "./session-store";
import { isWellFormedToken } from "./session-token";

/** อ่าน token จาก cookie — คืน null ถ้าไม่มีหรือผิดรูปแบบ (ไม่แตะฐานข้อมูล) */
export async function readSessionToken(): Promise<string | null> {
  const value = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return isWellFormedToken(value) ? value : null;
}

/** เริ่ม session ใหม่ — เรียกได้เฉพาะใน Server Action / Route Handler (ต้องตั้ง cookie) */
export async function startSession(userId: string): Promise<void> {
  const cookieStore = await cookies();
  const previous = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (isWellFormedToken(previous)) await deleteSessionByToken(previous);
  const token = await insertSession(userId);
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** จบ session — ลบแถวในฐานข้อมูลก่อน แล้วลบ cookie (เรียกได้เฉพาะใน Server Action / Route Handler) */
export async function endSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  try {
    if (isWellFormedToken(token)) await deleteSessionByToken(token);
  } finally {
    cookieStore.delete(SESSION_COOKIE_NAME);
  }
}
