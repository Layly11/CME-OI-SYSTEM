/**
 * โมดูลจัดการ "ไฟล์ license" ที่ indicator/bot ของ CME OI SYSTEM อ่าน
 *
 * รูปแบบไฟล์เดิมของลูกค้า (จากไฟล์จริง):
 *   id766232.2027.07.02,id97086397.2027.07.01,id26763436.2100.12.30,...
 *
 * - แต่ละรายการ = "id" + เลขบัญชี MT5 + "." + ปี.เดือน.วัน ที่หมดอายุ
 * - คั่นแต่ละรายการด้วยคอมมา ไม่มีช่องว่าง
 * - ตลอดชีพ (Lifetime) ใช้วันไกลๆ เช่น 2099.12.29 / 2100.12.30 / 9999.01.01
 *   เว็บจะใช้ 9999.01.01 เป็นมาตรฐานสำหรับรายการใหม่ แต่ parse ค่าเดิมได้ทุกแบบ
 * - บอทจะทำงานก็ต่อเมื่อเลขบัญชีอยู่ในไฟล์และยังไม่หมดอายุ (ลูกค้ายืนยัน)
 *
 * ข้อควรระวัง: เรายังไม่เห็นโค้ดฝั่ง indicator ว่า parse อย่างไร
 * ก่อนใช้งานจริงต้องเอาไฟล์ที่โมดูลนี้สร้างไปทดสอบกับบอทจริงก่อนทุกครั้ง
 */

export const LIFETIME_EXPIRY = "9999-01-01";

/** วันที่ตั้งแต่ปีนี้ขึ้นไปถือว่าเป็น "ตลอดชีพ" เวลาอ่านไฟล์เดิม */
const LIFETIME_YEAR_THRESHOLD = 2099;

const ENTRY_PATTERN = /^id(\d{1,20})\.(\d{4})\.(\d{2})\.(\d{2})$/;

export type LicenseEntry = {
  /** เลขบัญชี MT5 เป็นสตริง เช่น "766232" */
  accountNumber: string;
  /** วันหมดอายุรูปแบบ ISO (YYYY-MM-DD) ตลอดชีพ = 9999-01-01 */
  expiresAt: string;
};

export type ParsedEntry = LicenseEntry & {
  raw: string;
  isLifetime: boolean;
};

export type ValidationIssue = {
  index: number;
  raw: string;
  reason: string;
};

export type ParseResult = {
  entries: ParsedEntry[];
  issues: ValidationIssue[];
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** แปลง "2027-07-02" → "2027.07.02" */
export function isoToFileDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`วันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD): ${iso}`);
  return `${m[1]}.${m[2]}.${m[3]}`;
}

/** แปลง Date (ใช้เฉพาะส่วนวันที่ตามเวลาเครื่อง) → "YYYY-MM-DD" */
export function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** ตรวจเลขบัญชี MT5: ตัวเลขล้วน 1–20 หลัก */
export function isValidAccountNumber(account: string): boolean {
  return /^\d{1,20}$/.test(account);
}

/** สร้างข้อความ 1 รายการ เช่น formatEntry({accountNumber:"766232", expiresAt:"2027-07-02"}) → "id766232.2027.07.02" */
export function formatEntry(entry: LicenseEntry): string {
  if (!isValidAccountNumber(entry.accountNumber)) {
    throw new Error(`เลขบัญชีไม่ถูกต้อง: ${entry.accountNumber}`);
  }
  return `id${entry.accountNumber}.${isoToFileDate(entry.expiresAt)}`;
}

/** อ่าน 1 รายการ คืน null ถ้ารูปแบบไม่ตรง */
export function parseEntry(raw: string): ParsedEntry | null {
  const token = raw.trim();
  const m = ENTRY_PATTERN.exec(token);
  if (!m) return null;
  const [, account, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (!isValidCalendarDate(year, month, day)) return null;
  return {
    raw: token,
    accountNumber: account,
    expiresAt: `${y}-${mo}-${d}`,
    isLifetime: year >= LIFETIME_YEAR_THRESHOLD,
  };
}

/**
 * อ่านทั้งไฟล์ ทนต่อช่องว่าง/ขึ้นบรรทัดใหม่/คอมมาซ้ำ
 * รายการที่รูปแบบผิดจะถูกรายงานใน issues แทนที่จะโยน error ทิ้งทั้งไฟล์
 */
export function parseLicenseFile(text: string): ParseResult {
  const entries: ParsedEntry[] = [];
  const issues: ValidationIssue[] = [];
  const seen = new Map<string, number>();

  const tokens = text
    .replace(/^﻿/, "") // ตัด BOM ถ้ามี
    .split(/[,\r\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  tokens.forEach((raw, index) => {
    const parsed = parseEntry(raw);
    if (!parsed) {
      issues.push({ index, raw, reason: "รูปแบบไม่ตรง id<เลขบัญชี>.<ปี>.<เดือน>.<วัน>" });
      return;
    }
    const dup = seen.get(parsed.accountNumber);
    if (dup !== undefined) {
      issues.push({
        index,
        raw,
        reason: `เลขบัญชี ${parsed.accountNumber} ซ้ำกับรายการที่ ${dup + 1}`,
      });
      return;
    }
    seen.set(parsed.accountNumber, index);
    entries.push(parsed);
  });

  return { entries, issues };
}

export type BuildOptions = {
  /** เรียงตามเลขบัญชีเพื่อให้ไฟล์ diff ง่าย (ค่าเริ่มต้น: true) */
  sort?: boolean;
  /** ใส่ขึ้นบรรทัดใหม่ท้ายไฟล์หรือไม่ (ค่าเริ่มต้น: false ตามไฟล์เดิม) */
  trailingNewline?: boolean;
};

/**
 * สร้างเนื้อหาไฟล์จากรายการ license
 * - ถ้าเลขบัญชีซ้ำ จะเก็บวันหมดอายุที่ไกลที่สุด (ป้องกันต่ออายุแล้วไฟล์ยังมีค่าเก่า)
 * - ตรวจความถูกต้องทุกรายการก่อนสร้าง ถ้ามีรายการผิดจะโยน error ไม่สร้างไฟล์ครึ่งๆ กลางๆ
 */
export function buildLicenseFile(entries: LicenseEntry[], options: BuildOptions = {}): string {
  const { sort = true, trailingNewline = false } = options;
  const byAccount = new Map<string, string>();

  for (const e of entries) {
    if (!isValidAccountNumber(e.accountNumber)) {
      throw new Error(`เลขบัญชีไม่ถูกต้อง: ${JSON.stringify(e.accountNumber)}`);
    }
    isoToFileDate(e.expiresAt); // โยน error ถ้าวันที่ผิดรูปแบบ
    const current = byAccount.get(e.accountNumber);
    if (!current || e.expiresAt > current) byAccount.set(e.accountNumber, e.expiresAt);
  }

  let list = [...byAccount.entries()].map(([accountNumber, expiresAt]) =>
    formatEntry({ accountNumber, expiresAt }),
  );
  if (sort) {
    list = list.sort((a, b) => {
      const na = BigInt(a.slice(2).split(".")[0]);
      const nb = BigInt(b.slice(2).split(".")[0]);
      return na < nb ? -1 : na > nb ? 1 : 0;
    });
  }
  const body = list.join(",");
  return trailingNewline ? body + "\n" : body;
}

/** license ยังใช้ได้ไหม ณ วันที่กำหนด (นับรวมวันหมดอายุเป็นวันสุดท้ายที่ใช้ได้) */
export function isEntryActive(entry: LicenseEntry, today: string = dateToIso(new Date())): boolean {
  return entry.expiresAt >= today;
}

/** จำนวนวันที่เหลือ (ติดลบ = หมดอายุแล้ว) สำหรับตลอดชีพคืน Infinity */
export function daysRemaining(entry: LicenseEntry, today: string = dateToIso(new Date())): number {
  if (entry.expiresAt >= `${LIFETIME_YEAR_THRESHOLD}-01-01`) return Infinity;
  const a = Date.parse(entry.expiresAt + "T00:00:00Z");
  const b = Date.parse(today + "T00:00:00Z");
  return Math.round((a - b) / 86_400_000);
}

/**
 * คำนวณวันหมดอายุใหม่เมื่อซื้อ/ต่ออายุ
 * - ถ้า license เดิมยังไม่หมด: ต่อจากวันหมดอายุเดิม (ลูกค้าไม่เสียวันที่เหลือ)
 * - ถ้าหมดแล้วหรือไม่มี: เริ่มนับจากวันนี้
 * - durationDays = null → ตลอดชีพ
 */
export function computeNewExpiry(
  durationDays: number | null,
  currentExpiresAt: string | null,
  today: string = dateToIso(new Date()),
): string {
  if (durationDays === null) return LIFETIME_EXPIRY;
  const base = currentExpiresAt && currentExpiresAt >= today ? currentExpiresAt : today;
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + durationDays);
  return d.toISOString().slice(0, 10);
}

/** เปรียบเทียบไฟล์เก่า-ใหม่ ใช้แสดงให้แอดมินดูก่อนกดเผยแพร่ */
export function diffLicenseFiles(oldText: string, newText: string) {
  const oldMap = new Map(parseLicenseFile(oldText).entries.map((e) => [e.accountNumber, e]));
  const newMap = new Map(parseLicenseFile(newText).entries.map((e) => [e.accountNumber, e]));
  const added: ParsedEntry[] = [];
  const removed: ParsedEntry[] = [];
  const changed: { accountNumber: string; from: string; to: string }[] = [];

  for (const [acct, e] of newMap) {
    const prev = oldMap.get(acct);
    if (!prev) added.push(e);
    else if (prev.expiresAt !== e.expiresAt) {
      changed.push({ accountNumber: acct, from: prev.expiresAt, to: e.expiresAt });
    }
  }
  for (const [acct, e] of oldMap) {
    if (!newMap.has(acct)) removed.push(e);
  }
  return { added, removed, changed };
}
