/**
 * เขียน/อ่านรายชื่อ license ใน Firebase Realtime Database ผ่าน REST + service account
 *
 * ค่าที่ path นี้คือสวิตช์ของบอทลูกค้าทุกคน จึงมีด่านกันพลาดหลายชั้นก่อนเขียน:
 * 1. path ต้องเป็น "CME_Data/Customer Data/<ชื่อเดียว>" เท่านั้น (path อื่นเป็นข้อมูลตลาดที่บอทใช้
 *    และ path ที่ลึกกว่านั้น เช่น ".../Data/test" จะทำให้ string ของรายชื่อที่ node แม่ถูกแทนด้วย object)
 * 2. เนื้อหาต้องตรงรูปแบบทุกรายการ ไม่มีช่องว่าง/บรรทัดใหม่ และห้ามว่าง
 * 3. เทียบกับค่าปัจจุบัน ถ้าจะทำให้บัญชีหายมากผิดปกติให้หยุด (กันเผยแพร่ก่อน import รายชื่อเดิม)
 * 4. เขียนแล้วอ่านกลับมาเทียบว่าตรงกันทุกตัวอักษร
 * ทุก request มีเวลาจำกัด (requestTimeoutMs) — การเผยแพร่ถือ lock ของทั้งระบบอยู่ จึงค้างไม่มีกำหนดไม่ได้
 *
 * ไฟล์นี้ไม่อ่าน env เอง (รับค่าผ่าน constructor) เพื่อให้เทสได้ด้วย fetch ปลอม
 */
import { createSign } from "node:crypto";
import { parseEntry, parseLicenseFile } from "./license-file";

export const LICENSE_PATH_PREFIX = "CME_Data/Customer Data/";
/** ค่าเริ่มต้นเป็น path ทดสอบ ต้องตั้ง FIREBASE_LICENSE_PATH เองจึงจะเขียน path จริง */
export const DEFAULT_TEST_LICENSE_PATH = "CME_Data/Customer Data/Data_test";

const TOKEN_SCOPES = [
  "https://www.googleapis.com/auth/firebase.database",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type FirebaseRtdbOptions = {
  /** เช่น https://<project>-default-rtdb.asia-southeast1.firebasedatabase.app */
  databaseUrl: string;
  serviceAccount: ServiceAccount;
  path?: string;
  /** จำนวนบัญชีสูงสุดที่ยอมให้หายไปในการเขียนครั้งเดียว (ค่าเริ่มต้น 10) */
  maxRemovedEntries?: number;
  /** เวลาสูงสุดของแต่ละ request (ค่าเริ่มต้น 10 วินาที) — หมดเวลา = error การเขียนครั้งนั้นถือว่าไม่สำเร็จ */
  requestTimeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
};

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** ตรวจว่า path อยู่ในขอบเขตที่อนุญาต คืน path ที่ encode แล้วสำหรับ REST */
export function encodeLicensePath(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (!clean.startsWith(LICENSE_PATH_PREFIX)) {
    throw new Error(`ไม่อนุญาตให้เขียน path นอก "${LICENSE_PATH_PREFIX}": ${JSON.stringify(path)}`);
  }
  const segments = clean.split("/");
  // ต้องมีชื่อเดียวต่อจาก prefix: path ที่ลึกกว่า (ลูกของ node รายชื่อ) ถูกปฏิเสธสำหรับผู้เขียนทุกราย
  if (segments.length !== LICENSE_PATH_PREFIX.split("/").length) {
    throw new Error(
      `path ของรายชื่อ license ต้องเป็น "${LICENSE_PATH_PREFIX}<ชื่อ>" ชั้นเดียว ไม่มี path ย่อย: ${JSON.stringify(path)}`,
    );
  }
  for (const s of segments) {
    if (s.length === 0 || /[.#$\[\]\u0000-\u001f]/.test(s)) {
      throw new Error(`path ของ Firebase ไม่ถูกต้อง: ${JSON.stringify(path)}`);
    }
  }
  return segments.map(encodeURIComponent).join("/");
}

/** เนื้อหาต้องเป็น id<บัญชี>.<ปี>.<เดือน>.<วัน> คั่นด้วยคอมมาเท่านั้น ไม่มีอย่างอื่นปน */
export function assertPublishable(content: string): void {
  if (content.length === 0) {
    throw new Error("เนื้อหา license ว่างเปล่า — ไม่เขียน เพราะจะทำให้บอทลูกค้าทุกคนหยุดทำงาน");
  }
  content.split(",").forEach((raw, i) => {
    if (!parseEntry(raw) || raw !== raw.trim()) {
      throw new Error(`รายการที่ ${i + 1} รูปแบบไม่ถูกต้อง: ${JSON.stringify(raw.slice(0, 60))}`);
    }
  });
}

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

export class FirebaseRtdb {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly maxRemoved: number;
  private readonly timeoutMs: number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly opts: FirebaseRtdbOptions) {
    const base = opts.databaseUrl.replace(/\/+$/, "");
    if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) {
      throw new Error("FIREBASE_DATABASE_URL ต้องเป็น https://<host> ไม่มี path ต่อท้าย");
    }
    if (!opts.serviceAccount.client_email || !opts.serviceAccount.private_key) {
      throw new Error("service account ของ Firebase ไม่ครบ (ต้องมี client_email และ private_key)");
    }
    this.url = `${base}/${encodeLicensePath(opts.path ?? DEFAULT_TEST_LICENSE_PATH)}.json`;
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.maxRemoved = opts.maxRemovedEntries ?? 10;
    const timeout = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** fetch ที่มีเวลาจำกัด — error ไม่มี URL/token ปนในข้อความ */
  private async request(what: string, url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`${what}: ไม่ได้รับคำตอบภายใน ${this.timeoutMs} ms`);
      }
      throw new Error(`${what}: เชื่อมต่อไม่สำเร็จ`);
    }
  }

  /** URL ของค่าที่ indicator อ่าน (ไม่มี token) */
  get publicUrl() {
    return this.url;
  }

  private async accessToken(): Promise<string> {
    const nowSec = Math.floor(this.now() / 1000);
    if (this.token && this.token.expiresAt - 60 > nowSec) return this.token.value;

    const { client_email, private_key } = this.opts.serviceAccount;
    const tokenUri = this.opts.serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token";
    const unsigned =
      base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) +
      "." +
      base64url(
        JSON.stringify({
          iss: client_email,
          scope: TOKEN_SCOPES,
          aud: tokenUri,
          iat: nowSec,
          exp: nowSec + 3600,
        }),
      );
    const signature = createSign("RSA-SHA256").update(unsigned).sign(private_key);
    const assertion = `${unsigned}.${base64url(signature)}`;

    const res = await this.request("ขอ access token จาก Google", tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!res.ok) {
      throw new Error(`ขอ access token จาก Google ไม่สำเร็จ (HTTP ${res.status})`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("Google ไม่ส่ง access_token กลับมา");
    this.token = { value: json.access_token, expiresAt: nowSec + (json.expires_in ?? 3600) };
    return json.access_token;
  }

  /** อ่านค่าปัจจุบัน คืน null ถ้ายังไม่มีค่าที่ path นี้ */
  async read(): Promise<string | null> {
    const res = await this.request("อ่านรายชื่อ license จาก Firebase", this.url, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`อ่านรายชื่อ license จาก Firebase ไม่สำเร็จ (HTTP ${res.status})`);
    const value: unknown = await res.json();
    if (value === null) return null;
    if (typeof value !== "string") {
      throw new Error("ค่าใน Firebase ไม่ใช่ string ก้อนเดียวตามที่คาดไว้ — หยุดเพื่อความปลอดภัย");
    }
    return value;
  }

  /** เขียนทับทั้งก้อน (ผ่านด่านตรวจทั้งหมดก่อน) แล้วอ่านกลับมายืนยัน */
  async write(content: string): Promise<void> {
    assertPublishable(content);

    const current = await this.read();
    if (current !== null) {
      const next = new Set(parseLicenseFile(content).entries.map((e) => e.accountNumber));
      const removed = parseLicenseFile(current).entries.filter((e) => !next.has(e.accountNumber));
      if (removed.length > this.maxRemoved) {
        throw new Error(
          `การเขียนครั้งนี้จะทำให้บัญชีหายไป ${removed.length} รายการ (เกินเพดาน ${this.maxRemoved}) — ` +
            "ตรวจว่า import รายชื่อเดิมเข้าฐานข้อมูลครบแล้ว หรือปรับ FIREBASE_MAX_REMOVED_ENTRIES ถ้าตั้งใจ",
        );
      }
    }

    const res = await this.request("เขียนรายชื่อ license ลง Firebase", this.url, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(content),
    });
    if (!res.ok) throw new Error(`เขียนรายชื่อ license ลง Firebase ไม่สำเร็จ (HTTP ${res.status})`);

    const after = await this.read();
    if (after !== content) {
      throw new Error("อ่านค่ากลับจาก Firebase แล้วไม่ตรงกับที่เขียน — ตรวจสอบด่วน");
    }
  }
}
