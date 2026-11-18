/**
 * เนื้อหาทั้งหมดของเว็บ รวมไว้ไฟล์เดียวเพื่อให้แก้ข้อความได้โดยไม่ต้องแตะ layout
 * ที่มา: สื่อการตลาดของ CME OI SYSTEM (อินโฟกราฟิก 17 ฟีเจอร์, Checklist 5 ข้อ, ประวัติผู้พัฒนา)
 *
 * กติกาการเขียน: ไม่มีคำการันตีกำไร ไม่มีตัวเลขผลตอบแทน อธิบายว่า "เครื่องมือทำอะไร" ไม่ใช่ "จะได้เท่าไร"
 */

/**
 * ลิงก์ LINE OA จาก NEXT_PUBLIC_LINE_URL — รับเฉพาะ https:// (ค่าว่าง/รูปแบบอื่น = ยังไม่ได้ตั้ง → null)
 * null ทำให้ทุกจุด "ติดต่อทาง LINE" แสดงเป็นข้อความธรรมดาแทนลิงก์ที่กดไม่ไป (ดู src/components/line-link.tsx)
 */
export function parseLineUrl(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!/^https:\/\/[^\s/]+/i.test(value)) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

export const site = {
  name: "CME OI SYSTEM",
  tagline: "รู้ก่อน เห็นก่อน เทรดได้เปรียบ ด้วยข้อมูลที่สถาบันใช้จริง",
  description:
    "เครื่องมือวิเคราะห์ทองคำ (XAUUSD) บน MetaTrader 5 ที่นำ Open Interest, Option Flow และ Volume จาก CME Group มาวางบนกราฟของคุณ",
  // TODO: ใส่ลิงก์ LINE OA จริงของลูกค้าใน .env.local (NEXT_PUBLIC_LINE_URL) — ค่านี้ถูกฝังตอน build
  // null = ยังไม่ได้ตั้ง: ใช้ <LineLink> แสดงผล ห้ามใส่ลง href ตรงๆ
  lineUrl: parseLineUrl(process.env.NEXT_PUBLIC_LINE_URL),
  copyrightYear: 2026,
  developer: {
    name: "อ.ธวัช ไชยศิริ",
    nameEn: "Tawat Chaisiri",
    title: "ผู้พัฒนา CME OI SYSTEM และผู้ก่อตั้ง CME OI Trades Academy",
    bullets: [
      "ประสบการณ์พัฒนาระบบมากกว่า 10 ปี",
      "B.Eng. Mechanical Engineering",
      "M.A. Marketing",
      "MASTER of Futures, CME Institute (USA)",
      "เจ้าของธุรกิจ Imm Machinery Co., Ltd. และ Imm Sino Machinery Co., Ltd.",
    ],
  },
};

export const nav = [
  { href: "/#features", label: "เครื่องมือ" },
  { href: "/#how-it-works", label: "วิธีใช้" },
  { href: "/pricing", label: "แพ็กเกจ" },
  { href: "/install", label: "ติดตั้ง" },
  { href: "/faq", label: "คำถามที่พบบ่อย" },
];

/** ข้อเท็จจริงสั้นๆ ใต้ hero */
export const facts = [
  { title: "ข้อมูลจาก CME Group", body: "Open Interest, Option Flow, Volume และ COT Report จากตลาดฟิวเจอร์สทองคำที่สถาบันซื้อขายจริง" },
  { title: "ทำงานบน MetaTrader 5", body: "ติดตั้งเป็น indicator บน MT5 ของคุณเอง ใช้กับบัญชีทองคำ (XAUUSD) ของโบรกเกอร์ที่รองรับ" },
  { title: "เห็นครบในหน้าจอเดียว", body: "ไม่ต้องสลับไปมาระหว่างเว็บ CME, TradingView และกราฟเทรด ข้อมูลทุกชุดวางซ้อนบนกราฟเดียว" },
  { title: "อัปเดตฟรีตลอดอายุการใช้งาน", body: "เวอร์ชันใหม่ของ indicator ไม่มีค่าใช้จ่ายเพิ่มเติมตลอดช่วงที่ license ยังใช้งานได้" },
];

/** ตัวอย่างข้อมูล Option Flow จากหน้าจอจริง 30 ต.ค. 2026 (XAUUSD M30) — ใช้วาด ladder ใน hero */
export const sampleLadder = {
  caption: "ตัวอย่างจากหน้าจอจริง XAUUSD M30 วันที่ 30 ต.ค. 2026 ราคาขณะนั้น 3,875",
  highlightPrice: 4000,
  highlightNote: "ที่ราคา 4000 มีสัญญาค้าง 2,887 สัญญา มากกว่าระดับอื่นหลายเท่า ราคาขึ้นไปชนโซนนี้แล้วปรับตัวลง",
  rows: [
    { price: 4010, call: 50, put: 19, net: 10, abs: 102 },
    { price: 4005, call: 54, put: 15, net: 39, abs: 69 },
    { price: 4000, call: 259, put: 619, net: 21, abs: 2887 },
    { price: 3995, call: 16, put: 10, net: 117, abs: 1273 },
    { price: 3990, call: 20, put: 26, net: 9, abs: 31 },
    { price: 3985, call: 84, put: 67, net: 10, abs: 151 },
    { price: 3980, call: 80, put: 88, net: 148, abs: 430 },
    { price: 3975, call: 46, put: 32, net: 202, abs: 232 },
    { price: 3970, call: 17, put: 13, net: 4, abs: 30 },
    { price: 3965, call: 133, put: 87, net: 87, abs: 319 },
  ],
};

/** Checklist 5 ข้อ ก่อนเข้าออเดอร์ (จากอินโฟกราฟิกของลูกค้า) */
export const steps = [
  {
    title: "หาแนวรับ–แนวต้าน",
    body: "ระบุโซนสำคัญ ตรวจ Round Number เช่น 00 / 25 / 50 / 75 และดูว่าราคาอยู่ใกล้กรอบ ±1 SD หรือไม่ โซนที่ซ้อนกันคือจุดที่ราคามักเกิดแรงปะทะหรือกลับตัว",
  },
  {
    title: "รอให้กวาด SL Clutches ก่อน",
    body: "ดูว่ามีการกวาด Stop Loss หรือสภาพคล่อง (Liquidity Sweep) แล้วหรือยัง และรอสัญญาณกลับตัวหรือยืนยันทิศทาง ไม่รีบเข้าเพียงเพราะราคาวิ่งถึงโซน",
  },
  {
    title: "ดู Volume ABS NET แถว Round Number",
    body: "ตรวจ OI, Vol²Vol และ Option Flow ว่ามีค่า ABS NET สูงในโซนราคาสำคัญหรือไม่ พิจารณาร่วมกับทิศทางและความสดใหม่ของข้อมูล",
  },
  {
    title: "ดูแนวป้องกันของ Swap Dealer",
    body: "ตรวจ Option PUT / CALL ที่มีปริมาณสัญญาสูง Strike สำคัญมักเป็นแนวป้องกันของสถาบัน ตัวเลขสูงเป็นเบาะแส ไม่ใช่หลักฐานยืนยันแนวรับ–แนวต้านโดยลำพัง",
  },
  {
    title: "ยืนยันด้วยแรงซื้อ–ขายและ Price Action",
    body: "ดูว่า Volume และแรงซื้อ–ขายเพิ่มขึ้นจริงหรือไม่ แยกให้ออกระหว่างแรงที่ต่อเนื่องกับแรงที่กำลังหมด แล้วค่อยตัดสินใจเข้าออเดอร์",
  },
];

/** เครื่องมือในระบบ (จากอินโฟกราฟิก 17 ข้อ และหน้า "วิเคราะห์อะไรบ้าง") */
export const features = [
  { name: "OI Heatmap", body: "การสะสมสัญญาคงค้าง (Open Interest) ตามระดับราคา ดูว่าเงินกองอยู่ตรงไหน" },
  { name: "Option Flow", body: "ปริมาณ CALL / PUT ที่เข้ามาใหม่ตามราคา Strike แสดงได้ถึง 110 บรรทัด (เว็บ CME แสดง 10 บรรทัด)" },
  { name: "Vol²Vol Intraday", body: "แรงซื้อ–ขายระหว่างวัน เทียบกับความผันผวนของฟิวเจอร์ส" },
  { name: "CME Futures L2", body: "ความลึกของตลาดฟิวเจอร์สทองคำ (Market Depth)" },
  { name: "COT Report", body: "พฤติกรรมผู้เล่นรายใหญ่จากรายงาน Commitments of Traders" },
  { name: "Auto Basis", body: "ส่วนต่างราคาฟิวเจอร์สกับราคา Spot คำนวณให้แบบเรียลไทม์บน MT5" },
  { name: "Absolute Net Contract", body: "ยอดสัญญาสุทธิแบบเรียลไทม์ ตัวเลขที่เว็บ CME ไม่แสดง" },
  { name: "Contract Movement", body: "การเคลื่อนไหวของสัญญารายวัน รายสัปดาห์ รายเดือน" },
  { name: "Futures Sentiment", body: "สัดส่วนความรู้สึกตลาดฝั่ง Bullish / Bearish ของนักลงทุนสถาบัน" },
  { name: "GEX (Gamma Exposure)", body: "ระดับราคาที่ผู้ขาย Option ต้องปรับพอร์ต มักกลายเป็นโซนแรงดึงหรือแรงต้าน" },
  { name: "Roll Over", body: "ติดตามการต่ออายุสัญญาเมื่อใกล้หมดอายุ" },
  { name: "Order Book และ SL Clutches ของรายย่อย", body: "ตำแหน่งคำสั่งค้างและกลุ่ม Stop Loss ของเทรดเดอร์รายย่อย" },
  { name: "SMC Indicator", body: "Structure, Liquidity, FVG, BOS, OB และ Session ครบในตัว" },
  { name: "ปฏิทินข่าว", body: "ข่าวเศรษฐกิจกล่องส้ม–แดงที่จะมากระทบรายวัน แสดงบนกราฟ" },
  { name: "Trader Panel", body: "ส่งคำสั่งแบบ Manual และ Semi-auto พร้อมเครื่องมือจัดการความเสี่ยง (TP/SL ทุกไม้, ปิดทุกออเดอร์ตามเงื่อนไข)" },
  { name: "เชื่อมต่อตรงกับ CME", body: "ดึงข้อมูลผ่าน API โดยตรง ไม่ผูกกับหน้าเว็บ CME จึงยังทำงานต่อเนื่องแม้เว็บ CME ล่ม" },
];

export const screenshots = [
  {
    src: "/images/screen-m30-option-flow.webp",
    width: 1280,
    height: 639,
    alt: "หน้าจอ MT5 XAUUSD M30 แสดงตาราง Option Flow, OI Heatmap และ Vol2Vol ซ้อนบนกราฟ",
    caption: "ตาราง Option Flow, OI Heatmap และ Vol²Vol วางซ้อนบนกราฟ XAUUSD แต่ละแถวคือระดับราคา ตัวเลขในวงเล็บคือส่วนที่เพิ่มขึ้นวันนี้",
  },
  {
    src: "/images/screen-m15-order-book.webp",
    width: 1280,
    height: 639,
    alt: "หน้าจอ MT5 แสดง Pending Order Book และ Position Order Book ของรายย่อย",
    caption: "Pending Order Book และ Position Order Book ของรายย่อย ดูว่าคำสั่งค้างและสถานะกำไร–ขาดทุนกองอยู่ที่ราคาไหน",
  },
  {
    src: "/images/screen-m5-breakout.webp",
    width: 1360,
    height: 678,
    alt: "หน้าจอ MT5 XAUUSD M5 ราคาวิ่งขึ้นจากโซนที่มีสัญญาค้างสูง",
    caption: "ไทม์เฟรม M5: ราคาวิ่งจากโซน 4050 ที่มี ABS NET สูง ขึ้นไปชนโซน 4100 ที่มีสัญญาค้างสะสมอีกชั้น",
  },
];

/**
 * ข้อความประกอบของแต่ละแพ็กเกจ (key = packages.code) — "รายการแพ็กเกจ ชื่อ ราคา อายุ วันแถม และเงื่อนไขของแพ็กเกจฟรี"
 * ไม่อยู่ที่นี่: หน้าเว็บอ่านจากตาราง packages ที่เดียว (ตั้งค่าด้วย `npm run db:seed` — src/lib/purchase/package-lineup.ts)
 * ที่นี่มีแค่คำโปรยและการเน้นสี แพ็กเกจที่ไม่มีใน record นี้ก็แสดงได้ตามปกติ
 */
export const packageCopy: Record<string, { note?: string; highlight?: boolean }> = {
  free_referral: { note: "ไม่ต้องชำระเงิน รับได้ 1 ครั้งต่อผู้ใช้ และ 1 ครั้งต่อบัญชี MT5" },
  three_months: { note: "เหมาะกับการเริ่มใช้งานจริง" },
  yearly: { note: "ราคาต่อวันต่ำที่สุด", highlight: true },
};

/** ข้อความของการชวนเพื่อน (หน้าแพ็กเกจ / หน้าสั่งซื้อ / หน้าบัญชี) — จำนวนเพื่อนที่ต้องชวนอยู่ใน REFERRALS_REQUIRED_FOR_FREE */
export const referralCopy = {
  title: "ชวนเพื่อน รับแพ็กเกจฟรี",
  steps: [
    "สมัครสมาชิก แล้วคัดลอกลิงก์ชวนเพื่อนจากหน้าบัญชีของฉัน",
    "ส่งลิงก์ให้เพื่อน เมื่อเพื่อนสมัครสมาชิกผ่านลิงก์ของคุณ ระบบนับให้อัตโนมัติ",
    "ครบตามเงื่อนไขแล้ว กดรับแพ็กเกจฟรีในหน้าสั่งซื้อ ไม่มีขั้นชำระเงิน จากนั้นเลือกโบรกเกอร์และกรอกเลขบัญชี MT5",
  ],
  limits: "แพ็กเกจฟรีรับได้ 1 ครั้งต่อผู้ใช้ และ 1 ครั้งต่อบัญชี MT5",
  inviteHint: "ส่งลิงก์นี้ให้เพื่อน เมื่อเพื่อนสมัครสมาชิกผ่านลิงก์ ระบบนับให้อัตโนมัติ (เพื่อนต้องเปิดลิงก์นี้ก่อนสมัคร สมัครไปแล้วนับย้อนหลังไม่ได้)",
};

export const packageIncludes = [
  "ใช้ได้กับบัญชี MT5 ที่ลงทะเบียนไว้ 1 บัญชี",
  "เครื่องมือครบทุกชุด (OI Heatmap, Option Flow, Vol²Vol, COT, Order Book, SMC, Trader Panel)",
  "อัปเดตเวอร์ชันใหม่ฟรีตลอดอายุ license",
  "คู่มือติดตั้งและวิดีโอสอนใช้งาน",
  "ช่องทางสอบถามผ่าน LINE",
];

export const faqs = [
  {
    q: "ต้องใช้โปรแกรมอะไรบ้าง",
    a: "MetaTrader 5 (MT5) บน Windows และบัญชีเทรดทองคำ (XAUUSD) กับโบรกเกอร์ที่รองรับ MT5 ตัวระบบติดตั้งเป็น indicator บน MT5 ของคุณเอง ไม่ต้องติดตั้งโปรแกรมอื่นเพิ่ม",
  },
  {
    q: "ระบบเทรดให้อัตโนมัติหรือไม่",
    a: "หัวใจของระบบคือการแสดงข้อมูลสถาบันบนกราฟเพื่อช่วยตัดสินใจ มี Trader Panel สำหรับส่งคำสั่งแบบ Manual และ Semi-auto พร้อมเครื่องมือจัดการความเสี่ยง การตัดสินใจเข้าออเดอร์ยังเป็นของผู้ใช้",
  },
  {
    q: "license ผูกกับอะไร",
    a: "ผูกกับเลขบัญชี MT5 ที่คุณลงทะเบียนไว้ เมื่อเปิดกราฟ indicator จะตรวจว่าเลขบัญชีอยู่ในรายชื่อและยังไม่หมดอายุ เราไม่ขอและไม่เก็บรหัสผ่านบัญชีเทรดของคุณ",
  },
  {
    q: "เปลี่ยนเลขบัญชี MT5 ได้ไหม",
    a: "ติดต่อทีมงานผ่าน LINE เพื่อย้าย license ไปบัญชีใหม่ (เงื่อนไขจำนวนครั้งต่อปีจะแจ้งในหน้าแพ็กเกจ)",
  },
  {
    q: "ใช้แล้วจะได้กำไรไหม",
    a: "ไม่มีเครื่องมือใดรับประกันกำไรได้ CME OI SYSTEM ช่วยให้เห็นข้อมูลที่สถาบันใช้ แต่การเทรดมีความเสี่ยงสูง ผลลัพธ์ขึ้นกับการบริหารความเสี่ยงและวินัยของผู้ใช้ ควรทดลองในบัญชีทดลองก่อน",
  },
  {
    q: "หมดอายุแล้วเกิดอะไรขึ้น",
    a: "indicator จะหยุดแสดงข้อมูลจนกว่าจะต่ออายุ ดูวันหมดอายุและต่ออายุได้จากหน้าบัญชีของคุณ ถ้าต่ออายุก่อนหมด วันที่เหลือจะถูกนับต่อ ไม่หายไป",
  },
];

export const riskNotice =
  "การซื้อขายทองคำ ฟิวเจอร์ส และ CFD มีความเสี่ยงสูง อาจสูญเสียเงินลงทุนทั้งหมด ผลการดำเนินงานในอดีตไม่ใช่สิ่งยืนยันผลในอนาคต CME OI SYSTEM เป็นเครื่องมือแสดงและวิเคราะห์ข้อมูล ไม่ใช่คำแนะนำการลงทุน ผู้ใช้ควรศึกษาและตัดสินใจด้วยตนเอง";

export const legalLinks = [
  { href: "/legal/terms", label: "ข้อตกลงการใช้งาน" },
  { href: "/legal/privacy", label: "นโยบายความเป็นส่วนตัว" },
  { href: "/legal/refund", label: "นโยบายการคืนเงิน" },
  { href: "/legal/risk", label: "คำเตือนความเสี่ยง" },
];
