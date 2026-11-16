/**
 * ตัวช่วยของ unit test: redirect() ของ Next ทำงานด้วยการ throw error ที่มี digest "NEXT_REDIRECT;<type>;<url>;<status>;"
 * คืน URL ปลายทางถ้า promise นั้น redirect, คืน null ถ้าจบปกติ, error อื่น throw ต่อ
 */
export async function redirectTarget(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    const digest = (err as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) {
      return digest.split(";").slice(2, -2).join(";");
    }
    throw err;
  }
}
