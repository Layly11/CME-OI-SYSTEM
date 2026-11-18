import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { faqs, packageCopy, parseLineUrl, referralCopy } from "./site";

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

describe("รายการแพ็กเกจและราคามาจากตาราง packages ที่เดียว", () => {
  const front = ["src/app/page.tsx", "src/app/pricing/page.tsx"];

  it.each(front)("%s ใช้ <PackageCards> และไม่มีราคา/ชื่อแพ็กเกจฝังในโค้ด", (file) => {
    const text = visible(read(file));
    expect(text).toContain("<PackageCards");
    // ราคา (เช่น "3,000 บาท" / priceThb) และรายการแพ็กเกจชุดเดิมต้องไม่กลับมาอยู่ในหน้า
    expect(text).not.toMatch(/\d{1,3},\d{3}\s*บาท|priceThb|สอบถามราคา/);
    expect(text).not.toMatch(/รายเดือน|ตลอดชีพ|packages\.map/);
  });

  it("src/content/site.ts ไม่มีรายการแพ็กเกจ/ราคาแล้ว — มีแค่คำโปรยตาม code", () => {
    const text = read("src/content/site.ts");
    expect(text).not.toMatch(/export const packages\b|priceThb/);
    for (const [code, copy] of Object.entries(packageCopy)) {
      expect(code).toMatch(/^[a-z_]+$/);
      expect(copy.note ?? "", code).not.toMatch(/\d{1,3},\d{3}|บาท/);
    }
  });

  it("ข้อความแพ็กเกจและการชวนเพื่อนไม่มีคำการันตีกำไร และไม่สัญญาสิ่งที่ระบบไม่ได้ทำ (สิทธิ์ของเพื่อน, อีเมล)", () => {
    const all = [
      ...Object.values(packageCopy).map((c) => c.note ?? ""),
      referralCopy.title,
      ...referralCopy.steps,
      referralCopy.limits,
      referralCopy.inviteHint,
      visible(read("src/components/package-cards.tsx")),
      visible(read("src/app/account/invite-link.tsx")),
      visible(read("src/app/account/orders/new/order-form.tsx")),
    ].join(" ");
    expect(all).not.toMatch(/การันตี|รวยแน่นอน|win rate|กำไร/i);
    expect(all).not.toMatch(/ทางอีเมล|เพื่อนของคุณจะได้รับ|เพื่อนได้รับ/);
    // บอกข้อจำกัดของแพ็กเกจฟรีตรงกับที่ระบบบังคับจริง
    expect(referralCopy.limits).toContain("1 ครั้งต่อผู้ใช้");
    expect(referralCopy.limits).toContain("1 ครั้งต่อบัญชี MT5");
  });

  it("ฟอร์มสั่งซื้อใช้ได้ทั้งแพ็กเกจที่ต้องชำระเงินและแพ็กเกจฟรี: ไม่บังคับ \"ชำระเงินก่อน\" และบอกว่าแพ็กเกจฟรีไม่มีขั้นชำระเงิน", () => {
    const form = visible(read("src/app/account/orders/new/order-form.tsx"));
    const page = visible(read("src/app/account/orders/new/page.tsx"));
    for (const text of [form, page]) {
      expect(text).not.toMatch(/ชำระเงินก่อน|หลังชำระเงิน|แล้วชำระเงินด้วยบัตรในขั้นถัดไป/);
    }
    expect(page).toContain("แพ็กเกจฟรีไม่มีขั้นชำระเงิน");
    expect(form).toContain("บัญชีใหม่ (กรอกเลขบัญชีในหน้าคำสั่งซื้อ)");
    // ยังชวนเพื่อนไม่ครบ → มีลิงก์จริงไปหน้าบัญชีของฉัน (ที่มีลิงก์ชวนเพื่อน) ไม่ใช่ข้อความเฉยๆ
    expect(page).toMatch(/need_referral: \{ href: "\/account", label: "[^"]+" \}/);
  });
});
