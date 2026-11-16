import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { faqs, parseLineUrl } from "./site";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
/** ตัด comment ออก — ตรวจเฉพาะข้อความที่ลูกค้าเห็น */
const visible = (source: string) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");

describe("parseLineUrl (NEXT_PUBLIC_LINE_URL)", () => {
  it("ไม่ได้ตั้ง / ว่าง / ไม่ใช่ https → null (ทุกจุดติดต่อ LINE แสดงเป็นข้อความ ไม่ใช่ลิงก์ที่กดไม่ไป)", () => {
    for (const raw of [undefined, "", "   ", "#line", "line", "http://lin.ee/abc", "javascript:alert(1)", "https://", "//lin.ee/abc"]) {
      expect(parseLineUrl(raw), String(raw)).toBeNull();
    }
  });
  it("https → ใช้ได้ (ตัดช่องว่างหัวท้าย)", () => {
    expect(parseLineUrl("https://lin.ee/abc123")).toBe("https://lin.ee/abc123");
    expect(parseLineUrl("  https://line.me/R/ti/p/@cmeoi  ")).toBe("https://line.me/R/ti/p/@cmeoi");
  });
});

describe("ข้อความที่ลูกค้าเห็นตรงกับสิ่งที่ระบบทำได้จริง", () => {
  // ระบบยังไม่ส่งอีเมลและยังไม่มีหน้าดาวน์โหลด: ห้ามสัญญาว่าจะได้ไฟล์/การแจ้งเตือนทางอีเมล
  const pages = [
    "src/app/page.tsx",
    "src/app/pricing/page.tsx",
    "src/app/install/page.tsx",
    "src/app/login/page.tsx",
    "src/app/register/register-form.tsx",
    "src/app/account/page.tsx",
    "src/app/account/orders/[id]/page.tsx",
  ];
  it.each(pages)("%s ไม่สัญญาเรื่องอีเมล/ลิงก์ดาวน์โหลดที่ยังไม่มี", (file) => {
    const text = visible(read(file));
    expect(text).not.toMatch(/รับไฟล์ติดตั้งทางอีเมล|ได้รับอีเมล|แจ้งเตือนทางอีเมล|ดาวน์โหลดไฟล์จากอีเมล|ดาวน์โหลดซ้ำได้|และรับไฟล์ติดตั้ง"/);
  });
  it("FAQ ไม่สัญญาว่าจะแจ้งเตือนทางอีเมล", () => {
    expect(faqs.map((f) => f.a).join(" ")).not.toMatch(/ทางอีเมล/);
  });

  it("หน้าคำสั่งซื้อ/หน้าบัญชี/วิธีติดตั้ง บอกวิธีรับไฟล์ที่ใช้ได้จริง (ทีมงานทาง LINE)", () => {
    expect(read("src/app/account/orders/[id]/page.tsx")).toContain("รับไฟล์ติดตั้ง indicator: ติดต่อทีมงาน");
    expect(read("src/app/account/page.tsx")).toContain("รับไฟล์ติดตั้งและคู่มือได้โดยติดต่อทีมงาน");
    expect(read("src/app/install/page.tsx")).toContain("รับไฟล์ติดตั้งจากทีมงาน");
  });

  it("ประกาศ \"กำลังเปิดใช้งาน\" ไม่สัญญาเวลา (ไม่มีงานเบื้องหลังลองใหม่เอง)", () => {
    const text = visible(read("src/app/account/orders/[id]/page.tsx"));
    expect(text).not.toMatch(/ไม่เกิน 1 นาที|ภายใน \d+ นาที/);
    expect(text).toContain("ไม่ต้องชำระซ้ำ");
    expect(text).toContain("ตรวจสอบสถานะอีกครั้ง");
  });

  it("ขั้นตอนสั่งซื้อหน้าแพ็กเกจเรียงตามจริง: ชำระ → เลือกโบรกเกอร์ → กรอกเลขบัญชี MT5", () => {
    const text = read("src/app/pricing/page.tsx");
    const order = ["เลือกแพ็กเกจและสมัครสมาชิก", "ชำระเงินด้วยบัตร", "เลือกโบรกเกอร์และเปิดบัญชีเทรด", 'title: "กรอกเลขบัญชี MT5"'].map((t) => text.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).not.toContain("สมัครและลงทะเบียนเลขบัญชี MT5");
  });

  it("ไม่มีลิงก์ LINE แบบ href ตรงๆ (ต้องผ่าน <LineLink> ที่รู้จักกรณียังไม่ได้ตั้ง NEXT_PUBLIC_LINE_URL) และไม่มี #line", () => {
    const files = [
      ...pages,
      "src/app/faq/page.tsx",
      "src/components/site-footer.tsx",
      "src/app/account/orders/[id]/bank-transfer-section.tsx",
      "src/app/account/orders/new/order-form.tsx",
      "src/content/site.ts",
    ];
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toMatch(/<a\s+href=\{(site\.)?lineUrl\}/);
      expect(visible(text), file).not.toContain('"#line"');
    }
  });

  it("ไม่มีคำการันตีกำไรในข้อความที่เพิ่ม", () => {
    for (const file of pages) expect(visible(read(file)), file).not.toMatch(/การันตี|รวยแน่นอน|win rate/i);
  });
});
