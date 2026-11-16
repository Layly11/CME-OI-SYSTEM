/**
 * ทดสอบ flow จริงผ่าน HTTP กับเซิร์ฟเวอร์ที่รันอยู่: สมัคร → เข้าหน้าสมาชิก → สั่งซื้อ → ชำระด้วยบัตร (จำลอง) → เลือกโบรกเกอร์
 * → กรอกเลขบัญชี MT5 → license เปิดอัตโนมัติ (เลขบัญชีอยู่ในรายชื่อที่เผยแพร่) → ต่ออายุ → ออกจากระบบ → รหัสผ่านผิด → เข้าสู่ระบบ
 * รวมถึงด่านสิทธิ์ที่ unit test มองไม่เห็น (proxy, header, Server Action ที่ไม่มี session, route ของสลิป)
 *
 * วิธีรัน (ใช้ฐานข้อมูลทดสอบเท่านั้น — สคริปต์นี้สร้างผู้ใช้จริงในฐานข้อมูลที่เซิร์ฟเวอร์ต่ออยู่):
 *   DATABASE_URL=<ฐานทดสอบ> npm run dev -- -p 3217        (อีกหน้าต่าง)
 *   BASE_URL=http://127.0.0.1:3217 npm run test:e2e
 *
 * เซิร์ฟเวอร์ต้องรันด้วย PAYMENT_PROVIDER=mock และ LICENSE_STORAGE=local + LICENSE_LOCAL_DIR=<โฟลเดอร์ชั่วคราว> (ห้ามชี้ Firebase)
 * จึงจะทดสอบขั้นชำระเงินและการเปิด license ได้ครบ — รายชื่อที่เผยแพร่อ่านผ่าน GET /api/license-file ของเซิร์ฟเวอร์เดียวกัน
 * ถ้าแพ็กเกจ "ตลอดชีพ" ตั้งราคาไว้ด้วย จะทดสอบ license ตลอดชีพเพิ่ม (ไม่ตั้งก็ข้าม)
 *
 * ตัวเลือก:
 *   E2E_EXPECT_PAYMENT=unavailable  เซิร์ฟเวอร์รันโดยไม่ตั้ง PAYMENT_PROVIDER: ตรวจว่าไม่มีปุ่มชำระ/หน้าจำลอง แล้วหยุดแค่นั้น
 *   E2E_EXPECT_PUBLISH=fail         เซิร์ฟเวอร์รันด้วย LICENSE_LOCAL_DIR ที่เขียนไม่ได้ (เช่น /dev/null/x): หลังกรอกเลขบัญชีต้องเห็น
 *                                   "กำลังเปิดใช้งาน" (ไม่ใช่หน้า error) แล้วสคริปต์รัน `npm run license:publish` ไปที่
 *                                   E2E_GOOD_LICENSE_DIR เพื่อซ่อม — ต้องตั้ง DATABASE_URL (ฐานเดียวกับเซิร์ฟเวอร์) และ E2E_GOOD_LICENSE_DIR
 *   E2E_EXPECT_BANK_TRANSFER=1      เซิร์ฟเวอร์รันด้วย PAYMENT_BANK_TRANSFER_ENABLED=true: ทดสอบโอนเงิน + แนบสลิปเพิ่ม
 *   E2E_LICENSE_DIR=<โฟลเดอร์>       LICENSE_LOCAL_DIR ของเซิร์ฟเวอร์ (ต้องตั้ง DATABASE_URL ฐานเดียวกับเซิร์ฟเวอร์ด้วย): ทดสอบสคริปต์
 *                                   `npm run license:publish` — ไฟล์ปลายทางหาย: --if-changed ไม่ซ่อม, ค่าเริ่มต้นเขียนเสมอ
 *   E2E_PURGE_MOCK=1                (ต้องมี E2E_LICENSE_DIR + DATABASE_URL) ท้ายสุดรัน `npm run license:purge-mock` ทั้งแบบทดลองและ --apply
 *                                   แล้วตรวจว่า license/คำสั่งซื้อจากการชำระจำลองถูกล้างและหลุดจากรายชื่อ — ล้างข้อมูลจำลอง "ทั้งฐาน" ใช้กับฐานทิ้งเท่านั้น
 *   E2E_MOCK_CARRYOVER=bank|redeem  ทดสอบว่าคำสั่งซื้อที่ชำระแบบจำลองเอามาแลก license หลังปิด mock ไม่ได้ (รัน 2 รอบ ฐานข้อมูลเดียวกัน
 *                                   ตั้ง E2E_STAMP ให้เหมือนกันทั้งสองรอบ):
 *                                     bank   เซิร์ฟเวอร์เปิด mock: สมัคร → สั่งซื้อ → ชำระจำลอง → เลือกโบรกเกอร์ แล้วหยุด (ยังไม่กรอกเลข)
 *                                     redeem เซิร์ฟเวอร์ "ปิด mock" (ไม่ตั้ง PAYMENT_PROVIDER): เข้าสู่ระบบ → กรอกเลขบัญชี → ต้องเห็น
 *                                            "ชำระแล้ว แต่เปิดใช้งานอัตโนมัติไม่ได้" และเลขบัญชีไม่อยู่ในรายชื่อที่เผยแพร่
 *   E2E_TRUSTED_PROXY_HOPS=1  ถ้าเซิร์ฟเวอร์รันด้วย TRUSTED_PROXY_HOPS=1 จะทดสอบ rate limit ต่อ IP เพิ่ม
 *                             (ปลอม X-Forwarded-For ตัวแรกไม่ได้ผล, คนอื่นล็อกบัญชีเราจาก IP อื่นไม่ได้)
 *   E2E_ALLOW_REMOTE=1        ยอมให้ BASE_URL ไม่ใช่ localhost (ค่าเริ่มต้นไม่ยอม กันยิงใส่เว็บจริง)
 *
 * ข้อจำกัด: ส่งฟอร์มแบบเบราว์เซอร์ที่ปิด JavaScript (อ่านช่องซ่อน $ACTION_* จาก HTML) — พิสูจน์ฝั่งเซิร์ฟเวอร์
 * (สิทธิ์ สถานะ cookie redirect) ได้ แต่ไม่ได้พิสูจน์ว่าหน้าจอในเบราว์เซอร์แสดงข้อความถูกต้อง
 */
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const COOKIE = "cme_session";
const UNKNOWN_UUID = "3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f";

const host = new URL(BASE).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && process.env.E2E_ALLOW_REMOTE !== "1") {
  console.error(`BASE_URL (${host}) ไม่ใช่ localhost — ตั้ง E2E_ALLOW_REMOTE=1 ถ้าตั้งใจจริง`);
  process.exit(2);
}

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}
const section = (title) => console.log(`\n${title}`);

/** fetch ที่ไม่ตาม redirect เอง และส่ง cookie ที่ให้มา */
async function request(path, { method = "GET", cookie, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    body,
    redirect: "manual",
    // คำขอที่ค้าง (เช่น action ที่ไม่ตอบ) ต้องล้มเร็ว ไม่ใช่รอจนหมดเวลาของเซิร์ฟเวอร์
    signal: AbortSignal.timeout(Number(process.env.E2E_TIMEOUT_MS ?? 30000)),
    // เบราว์เซอร์ส่ง Origin กับทุก POST — Next ใช้ตรวจ CSRF ของ Server Action
    headers: { ...(method === "POST" ? { origin: BASE } : {}), ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}), ...headers },
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, location: res.headers.get("location") };
}

function sessionCookie(res) {
  for (const line of res.headers.getSetCookie()) {
    const m = new RegExp(`^${COOKIE}=([^;]*)`).exec(line);
    if (m) return { value: m[1], attributes: line };
  }
  return null;
}

const decodeHtml = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** ช่องซ่อน $ACTION_* ของฟอร์มที่มีข้อความ `marker` (ฟอร์ม Server Action ตอนยังไม่มี JavaScript) */
function actionFields(html, marker) {
  const needle = marker.includes("=") ? marker : `name="${marker}"`;
  for (const [form] of html.matchAll(/<form\b[\s\S]*?<\/form>/g)) {
    if (!form.includes(needle)) continue;
    const fields = {};
    for (const [input] of form.matchAll(/<input\b[^>]*>/g)) {
      const name = /\bname="([^"]*)"/.exec(input)?.[1];
      if (!name?.startsWith("$ACTION")) continue;
      fields[name] = decodeHtml(/\bvalue="([^"]*)"/.exec(input)?.[1] ?? "");
    }
    if (Object.keys(fields).length > 0) return fields;
  }
  throw new Error(`ไม่พบฟอร์ม Server Action ที่มีช่อง "${marker}"`);
}

/** redirect() ที่เกิดหลังเริ่มส่งหน้าแล้ว (ใน <Suspense>) มาเป็น meta refresh / เครื่องหมาย NEXT_REDIRECT ไม่ใช่ status 3xx */
function redirectsTo(html, target) {
  return html.includes(`NEXT_REDIRECT;replace;${target};`) || html.includes(`url=${target}"`);
}

function formData(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function submitForm(path, marker, fields, options = {}) {
  const page = await request(path, { cookie: options.pageCookie });
  return request(path, { ...options, method: "POST", body: formData({ ...actionFields(page.text, marker), ...fields }) });
}

const stamp = /^[a-z0-9]{4,20}$/.test(process.env.E2E_STAMP ?? "") ? process.env.E2E_STAMP : Date.now().toString(36);
const email = `e2e-${stamp}@example.com`;
const password = `รหัสทดสอบ-${stamp}-Aa1`;
const login = (fields, options) => submitForm("/login", "email", { email, password, ...fields }, options);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const HFM_URL = "https://register.hfm.com/sv/en/new-live-account/?refid=371744";
const BROKER_CODES = ["fisg", "cxm", "hfm", "kohle", "dooprime", "hmarkets"];
const CARD_WORDS = /card.?number|cvv|cvc|expiry|เลขบัตร|autocomplete="cc-/i;

const post = (path, marker, html, fields, cookie) =>
  request(path, { method: "POST", cookie, body: formData({ ...actionFields(html, marker), ...fields }) });

/**
 * ส่งฟอร์มของคำสั่งซื้อ `fromId` แต่เปลี่ยน id ที่ bind ไว้เป็น `toId` — จำลองคนที่แก้คำขอเอง
 * (id ที่ bind จาก client component อยู่ในช่อง $ACTION_* แบบอ่านได้ เซิร์ฟเวอร์จึงต้องตรวจสิทธิ์/สถานะเองทุกครั้ง)
 */
function reboundFields(html, marker, fromId, toId) {
  const fields = actionFields(html, marker);
  let replaced = false;
  for (const [k, v] of Object.entries(fields)) {
    if (v.includes(fromId)) {
      fields[k] = v.split(fromId).join(toId);
      replaced = true;
    }
  }
  return { fields, replaced };
}

const hasForm = (html, marker) => {
  try {
    actionFields(html, marker);
    return true;
  } catch {
    return false;
  }
};

// ---- ตัวช่วยของรายชื่อ license ที่เผยแพร่ ----
/** รายชื่อที่เซิร์ฟเวอร์เผยแพร่ล่าสุด (ไฟล์ใน LICENSE_LOCAL_DIR ของเซิร์ฟเวอร์ หรือสำเนาล่าสุดในฐานข้อมูล) — ยังไม่มี = "" */
async function publishedList() {
  const res = await request("/api/license-file");
  return res.status === 200 ? res.text : "";
}
const entriesOf = (content, number) => content.split(",").filter((e) => e.startsWith(`id${number}.`));
/** วันหมดอายุ (YYYY-MM-DD) ของเลขบัญชีในรายชื่อ — ไม่มี/มีซ้ำ คืน null */
function entryDate(content, number) {
  const found = entriesOf(content, number);
  const m = found.length === 1 ? /^id\d+\.(\d{4})\.(\d{2})\.(\d{2})$/.exec(found[0]) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const dayDiff = (from, to) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);
const bangkokToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const thaiDateFormat = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });
const thaiDate = (iso) => thaiDateFormat.format(new Date(iso + "T12:00:00+07:00"));
/** HTML ที่ตัดตัวคั่นของ React ออก เพื่อเทียบข้อความที่ต่อจากหลายส่วน */
const plain = (html) => html.replace(/<!-- -->/g, "");
const PACKAGE_DAYS = [30, 180, 365];

function runNpmScript(script, env, args = []) {
  return new Promise((resolve) => {
    execFile("npm", ["run", script, ...(args.length > 0 ? ["--", ...args] : [])], { env, timeout: 120_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, output: `${stdout}\n${stderr}` });
    });
  });
}
const runLicensePublish = (env, args = []) => runNpmScript("license:publish", env, args);

/**
 * environment ของสคริปต์ที่ e2e รันเอง: ลบค่าตั้ง Firebase ทั้งหมด (กันเขียนรายชื่อจริง) บังคับเขียนไฟล์ในเครื่อง
 * และอนุญาต mock แบบเดียวกับเซิร์ฟเวอร์ทดสอบ (สคริปต์ไม่มี NODE_ENV จึงต้องมี flag ไม่เช่นนั้นคำสั่งซื้อจำลองถูกนับเป็น "ถูกกัน")
 */
function scriptEnv(licenseDir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("FIREBASE_")));
  return Object.assign(env, {
    LICENSE_STORAGE: "local",
    LICENSE_LOCAL_DIR: licenseDir,
    PAYMENT_PROVIDER: "mock",
    PAYMENT_MOCK_ALLOW_IN_PRODUCTION: "true",
  });
}
const lastLines = (output, n = 6) => output.trim().split("\n").slice(-n).join(" | ");

/** กรอกเลขบัญชี MT5 ให้คำสั่งซื้อที่ชำระแล้วและเลือกโบรกเกอร์แล้ว (ส่งขั้นยืนยันตรงๆ) */
async function prepareMt5Submit(session, orderId, accountNumber) {
  const mt5Path = `/account/mt5/new?order=${orderId}`;
  const page = await request(mt5Path, { cookie: session });
  const fields = { accountNumber, accountNumberConfirm: accountNumber, brokerServer: "E2E-Server", label: "", intent: "confirm" };
  return () => post(mt5Path, "accountNumber", page.text, fields, session);
}

async function createOrder(session, newOrderHtml, packageId, mt5AccountId = "") {
  // amountThb ที่ส่งไปต้องถูกทิ้ง — ยอดมาจากราคาในฐานข้อมูล
  const created = await post("/account/orders/new", "mt5AccountId", newOrderHtml, { packageId, mt5AccountId, amountThb: "1" }, session);
  return { status: created.status, path: created.location ?? "", id: (created.location ?? "").split("?")[0].split("/").pop() };
}

/** ชำระเงินจำลองของคำสั่งซื้อ (ปุ่มชำระ → หน้าจำลอง → ยืนยัน) คืนคำตอบของขั้นยืนยัน */
async function payByMock(session, orderPath) {
  const orderPage = await request(orderPath, { cookie: session });
  const started = await post(orderPath, 'data-testid="pay-by-card"', orderPage.text, {}, session);
  const mockPath = `${orderPath}/mock-pay`;
  const mockPage = await request(mockPath, { cookie: session });
  const confirmed = await post(mockPath, 'data-testid="mock-pay"', mockPage.text, {}, session);
  return { started, mockPage, confirmed, mockPath };
}

/**
 * สั่งซื้อ → ชำระด้วยบัตร (จำลอง) → เลือกโบรกเกอร์ → กรอกเลขบัญชี MT5 → license เปิดอัตโนมัติ
 * ต้องมีแพ็กเกจที่ตั้งราคาแล้วอย่างน้อย 1 รายการ (ไม่มีก็ข้าม) และเซิร์ฟเวอร์รันด้วย PAYMENT_PROVIDER=mock
 * (หรือไม่ตั้ง PAYMENT_PROVIDER คู่กับ E2E_EXPECT_PAYMENT=unavailable)
 */
async function purchaseFlow(session) {
  section("สั่งซื้อ");
  const expectUnavailable = process.env.E2E_EXPECT_PAYMENT === "unavailable";

  const newOrder = await request("/account/orders/new", { cookie: session });
  const packageId = [...newOrder.text.matchAll(/<input\b[^>]*name="packageId"[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => !/\bdisabled\b/.test(tag))
    .map((tag) => /\bvalue="([^"]*)"/.exec(tag)?.[1])[0];
  if (!packageId) {
    console.log("  ข้าม  ยังไม่มีแพ็กเกจที่ตั้งราคา (ทุกแพ็กเกจเป็น \"สอบถามราคา\") — ตั้ง price_thb ในฐานทดสอบเพื่อทดสอบส่วนนี้");
    return;
  }
  // แพ็กเกจตลอดชีพที่สั่งซื้อได้ (ถ้าตั้งราคาไว้) — ใช้ทดสอบ license ตลอดชีพ
  const lifetimePackageId = [...newOrder.text.matchAll(/<label\b[\s\S]*?<\/label>/g)]
    .map(([label]) => label)
    .filter((label) => label.includes('name="packageId"') && label.includes("ตลอดชีพ") && !/<input\b[^>]*\bdisabled\b/.test(label))
    .map((label) => /\bvalue="([^"]*)"/.exec(label)?.[1])[0];
  const expectPublishFail = process.env.E2E_EXPECT_PUBLISH === "fail";
  const listBefore = await publishedList();

  const noOrderMt5 = await request("/account/mt5/new", { cookie: session });
  check("/account/mt5/new โดยไม่มีคำสั่งซื้อ → ไม่มีฟอร์มกรอกเลขบัญชี", noOrderMt5.status === 200 && !noOrderMt5.text.includes('name="accountNumber"') && noOrderMt5.text.includes("ต้องสั่งซื้อแพ็กเกจและชำระเงินก่อน"));
  const accountHome = await request("/account", { cookie: session });
  check("หน้าบัญชีไม่มีปุ่มเพิ่มบัญชี MT5 ก่อนสั่งซื้อ", !accountHome.text.includes('href="/account/mt5/new"'));

  const order = await createOrder(session, newOrder.text, packageId);
  const orderPath = order.path;
  const orderId = order.id;
  check("สร้างคำสั่งซื้อ (ยังไม่ระบุบัญชี) → 303 ไปหน้าคำสั่งซื้อ", order.status === 303 && /^\/account\/orders\/[0-9a-f-]{36}$/.test(orderPath), `${order.status} ${orderPath}`);
  let orderPage = await request(orderPath, { cookie: session });
  check("หน้าคำสั่งซื้อ: รอชำระ และมีปุ่มยกเลิก", orderPage.text.includes("รอชำระ") && orderPage.text.includes("ยกเลิกคำสั่งซื้อนี้"));
  check("ก่อนชำระ: ยังไม่มีตัวเลือกโบรกเกอร์และไม่มีทางกรอกเลขบัญชี MT5", !orderPage.text.includes('name="brokerCode"') && !orderPage.text.includes("/account/mt5/new"));

  const slipVisible = orderPage.text.includes('name="slip"');
  const expectSlip = process.env.E2E_EXPECT_BANK_TRANSFER === "1";
  check(
    expectSlip ? "เปิดช่องทางโอนเงิน: หน้าคำสั่งซื้อมีฟอร์มแนบสลิป" : "ค่าเริ่มต้น: ไม่มีฟอร์มแนบสลิปและไม่มีรายละเอียดบัญชีธนาคาร (บัตรเป็นช่องทางเดียว)",
    expectSlip ? slipVisible : !slipVisible && !orderPage.text.includes("แนบสลิปโอนเงิน") && !orderPage.text.includes("ยอดที่ต้องโอน") && !orderPage.text.includes("เลขที่บัญชี"),
  );
  const unpaidMt5 = await request(`/account/mt5/new?order=${orderId}`, { cookie: session });
  check("/account/mt5/new ของคำสั่งซื้อที่ยังไม่ชำระ → ไม่มีฟอร์ม", !unpaidMt5.text.includes('name="accountNumber"') && unpaidMt5.text.includes("กรุณาชำระเงินในหน้าคำสั่งซื้อก่อน"));

  if (expectUnavailable) {
    check("ยังไม่เปิดรับชำระ: แสดงข้อความและลิงก์ LINE แทนปุ่มชำระ", orderPage.text.includes("ระบบชำระเงินยังไม่เปิดให้บริการ") && orderPage.text.includes("สอบถามทาง LINE"));
    check("ยังไม่เปิดรับชำระ: ไม่มีฟอร์มชำระเงิน", !orderPage.text.includes('data-testid="pay-by-card"') && !hasForm(orderPage.text, 'data-testid="pay-by-card"'));
    const mock = await request(`${orderPath}/mock-pay`, { cookie: session });
    check("ยังไม่เปิดรับชำระ: หน้าจำลองการชำระเงิน → 404", mock.text.includes("ไม่พบหน้านี้") && !mock.text.includes("จำลองการชำระเงิน (โหมดทดสอบ)") && !hasForm(mock.text, 'data-testid="mock-pay"'));
    const still = await request(orderPath, { cookie: session });
    check("ยังไม่เปิดรับชำระ: คำสั่งซื้อยังรอชำระ", still.text.includes("รอชำระ") && !still.text.includes("ชำระแล้ว"));
    return;
  }

  // ---- ชำระเงินด้วยบัตร (จำลอง) ----
  section("ชำระเงินด้วยบัตร (โหมดทดสอบ)");
  check("หน้าคำสั่งซื้อมีปุ่มชำระด้วยบัตร และบอกว่าเป็นโหมดทดสอบ", orderPage.text.includes("ชำระเงินด้วยบัตรเครดิต/เดบิต") && orderPage.text.includes("ไม่มีการตัดเงินจริง"));
  check("ฟอร์มชำระไม่มีช่องกรอกใดๆ นอกจากช่องซ่อนของ Server Action", formInputsAreActionOnly(orderPage.text, 'data-testid="pay-by-card"'));
  const mockPath = `${orderPath}/mock-pay`;
  // หน้าคำสั่งซื้อตอนยังรอชำระ — เก็บไว้จำลอง "แท็บค้าง" ที่กดชำระหลังคำสั่งซื้อถูกชำระไปแล้วจากอีกแท็บ
  const unpaidOrderHtml = orderPage.text;
  const started = await post(orderPath, 'data-testid="pay-by-card"', orderPage.text, { cardNumber: "4111111111111111", amountThb: "1" }, session);
  check("กดชำระ → 303 ไปหน้าจำลองการชำระเงินของคำสั่งซื้อนี้", started.status === 303 && started.location === mockPath, `${started.status} ${started.location}`);
  const afterStart = await request(orderPath, { cookie: session });
  check("เปิดหน้าจำลองแล้วแต่ยังไม่ยืนยัน → คำสั่งซื้อยังรอชำระ", afterStart.text.includes("รอชำระ") && !afterStart.text.includes('name="brokerCode"'));

  const mockPage = await request(mockPath, { cookie: session });
  check("หน้าจำลอง: ป้าย \"จำลองการชำระเงิน (โหมดทดสอบ)\" และบอกว่าไม่ตัดเงินจริง", mockPage.status === 200 && mockPage.text.includes("จำลองการชำระเงิน (โหมดทดสอบ)") && mockPage.text.includes("ไม่มีการตัดเงินจริง"));
  const visibleInputs = [...mockPage.text.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)].map(([tag]) => tag).filter((tag) => !(/type="hidden"/.test(tag) && /name="\$ACTION/.test(tag)));
  check("หน้าจำลอง: ไม่มีช่องกรอกข้อมูลบัตร (ไม่มี input อื่นนอกจากช่องซ่อนของ Server Action)", visibleInputs.length === 0 && !CARD_WORDS.test(mockPage.text.replace(/<script\b[\s\S]*?<\/script>/g, "")), visibleInputs.join(" "));

  // ผู้ใช้อีกคน: เปิดหน้าจำลองของเราไม่ได้ และยืนยันการชำระแทนเราไม่ได้
  const other = await submitForm("/register", "email", { name: "ผู้ทดสอบ 2", email: `e2e-other-${stamp}@example.com`, password, accept: "on" });
  const otherSession = sessionCookie(other)?.value;
  check("สมัครผู้ใช้คนที่สอง", typeof otherSession === "string");
  const foreignMock = await request(mockPath, { cookie: otherSession });
  check("คนอื่นเปิดหน้าจำลองการชำระเงินของเรา → 404", foreignMock.text.includes("ไม่พบหน้านี้") && !hasForm(foreignMock.text, 'data-testid="mock-pay"'));
  const otherNew = await request("/account/orders/new", { cookie: otherSession });
  const otherOrder = await createOrder(otherSession, otherNew.text, packageId);
  const otherMockPath = `${otherOrder.path}/mock-pay`;
  const otherMockPage = await request(otherMockPath, { cookie: otherSession });
  {
    const { fields, replaced } = reboundFields(otherMockPage.text, 'data-testid="mock-pay"', otherOrder.id, orderId);
    const forged = await request(otherMockPath, { method: "POST", cookie: otherSession, body: formData(fields) });
    const ours = await request(orderPath, { cookie: session });
    check("คนอื่นยืนยันการชำระเงินของคำสั่งซื้อเรา (แก้ id ในคำขอ) → ไม่สำเร็จ คำสั่งซื้อเรายังรอชำระ", replaced && forged.status === 200 && forged.text.includes("ไม่พบคำสั่งซื้อนี้") && ours.text.includes("รอชำระ") && !ours.text.includes('name="brokerCode"'), `replaced=${replaced} status=${forged.status}`);
  }

  const confirmedPay = await post(mockPath, 'data-testid="mock-pay"', mockPage.text, { cardNumber: "4111111111111111", cvv: "123", amountThb: "1" }, session);
  check("ยืนยันการชำระเงิน (จำลอง) → 303 กลับหน้าคำสั่งซื้อ", confirmedPay.status === 303 && confirmedPay.location === orderPath, `${confirmedPay.status} ${confirmedPay.location}`);
  orderPage = await request(orderPath, { cookie: session });
  check("ชำระแล้ว: สถานะเปลี่ยนทันที ไม่มีปุ่มชำระ/ยกเลิกแล้ว", orderPage.text.includes("ชำระแล้ว") && !orderPage.text.includes('data-testid="pay-by-card"') && !orderPage.text.includes("ยกเลิกคำสั่งซื้อนี้"));
  const replayPay = await post(mockPath, 'data-testid="mock-pay"', mockPage.text, {}, session);
  check("ส่งคำขอยืนยันซ้ำ → 303 กลับหน้าคำสั่งซื้อ (ไม่ error)", replayPay.status === 303 && replayPay.location === orderPath, `${replayPay.status} ${replayPay.location}`);
  check("ชำระแล้วแต่ยังไม่มีเลขบัญชี → รายชื่อ license ที่เผยแพร่ยังไม่เปลี่ยน", (await publishedList()) === listBefore);
  const mockAfterPaid = await request(mockPath, { cookie: session });
  check("เปิดหน้าจำลองของคำสั่งซื้อที่ชำระแล้ว → ถูกพากลับหน้าคำสั่งซื้อ", redirectsTo(mockAfterPaid.text, orderPath) && !hasForm(mockAfterPaid.text, 'data-testid="mock-pay"'));
  const stalePay = await post(orderPath, 'data-testid="pay-by-card"', unpaidOrderHtml, {}, session);
  check("แท็บค้าง: กดปุ่มชำระของคำสั่งซื้อที่ชำระไปแล้ว → 303 กลับหน้าคำสั่งซื้อ (หน้าถูกโหลดใหม่ ไม่ใช่ข้อความ error ข้างปุ่มชำระที่ค้างอยู่)", stalePay.status === 303 && stalePay.location === orderPath, `${stalePay.status} ${stalePay.location}`);
  {
    // ลูกค้าที่ชำระแล้วออกไปเปิดบัญชีเทรด แล้วล็อกอินกลับมา: หน้าบัญชีต้องบอกขั้นถัดไป ไม่ใช่ชวนสั่งซื้อใหม่
    const home = await request("/account", { cookie: session });
    const notice = /data-testid="unfinished-orders"[\s\S]*?<\/div><\/div>/.exec(home.text)?.[0] ?? "";
    check("หน้าบัญชีหลังชำระ (ยังไม่เลือกโบรกเกอร์): มีประกาศ \"ชำระแล้ว ขั้นถัดไป\" พร้อมลิงก์ไปคำสั่งซื้อนั้น", notice.includes("ชำระแล้ว ขั้นถัดไป") && notice.includes(`href="${orderPath}"`) && notice.includes("เลือกโบรกเกอร์"), notice.slice(0, 200));
    check("หน้าบัญชีหลังชำระ: ไม่ขึ้น \"เริ่มจากสั่งซื้อแพ็กเกจ\" และบอกว่าไม่ต้องสั่งซื้อใหม่", !home.text.includes("เริ่มจากสั่งซื้อแพ็กเกจ") && home.text.includes("ไม่ต้องสั่งซื้อใหม่"));
  }

  // ---- เลือกโบรกเกอร์ ----
  section("เลือกโบรกเกอร์ → กรอกเลขบัญชี MT5");
  const brokerValues = [...new Set([...orderPage.text.matchAll(/<input\b[^>]*name="brokerCode"[^>]*>/g)].map(([tag]) => /\bvalue="([^"]*)"/.exec(tag)?.[1]))];
  check("หลังชำระ: มีโบรกเกอร์ให้เลือก 6 ราย", JSON.stringify(brokerValues) === JSON.stringify(BROKER_CODES), JSON.stringify(brokerValues));
  check("ยังไม่เลือกโบรกเกอร์: ยังไม่มีทางกรอกเลขบัญชี MT5 และยังไม่มีลิงก์โบรกเกอร์", !orderPage.text.includes("/account/mt5/new") && !orderPage.text.includes("register.hfm.com"));
  const noBrokerMt5 = await request(`/account/mt5/new?order=${orderId}`, { cookie: session });
  check("/account/mt5/new ก่อนเลือกโบรกเกอร์ → ไม่มีฟอร์ม", !noBrokerMt5.text.includes('name="accountNumber"') && noBrokerMt5.text.includes("กรุณาเลือกโบรกเกอร์"));

  const badBroker = await post(orderPath, "brokerCode", orderPage.text, { brokerCode: "evil-broker" }, session);
  const afterBad = await request(orderPath, { cookie: session });
  check("code โบรกเกอร์ที่ไม่อยู่ในรายชื่อ → ถูกปฏิเสธ ยังอยู่ขั้นเลือกโบรกเกอร์", badBroker.status === 200 && !afterBad.text.includes("/account/mt5/new") && !afterBad.text.includes("โบรกเกอร์ที่เลือก"), `status ${badBroker.status}`);
  const chosen = await post(orderPath, "brokerCode", orderPage.text, { brokerCode: "hfm" }, session);
  check("เลือก HFM → 303 กลับหน้าคำสั่งซื้อ", chosen.status === 303 && chosen.location === orderPath, `${chosen.status} ${chosen.location}`);
  orderPage = await request(orderPath, { cookie: session });
  const hfmAnchor = [...orderPage.text.matchAll(/<a\b[^>]*>/g)].map(([tag]) => decodeHtml(tag)).find((tag) => tag.includes(`href="${HFM_URL}"`));
  check("หน้าคำสั่งซื้อมีลิงก์เปิดบัญชีของ HFM ตรงตามที่ผู้ให้บริการให้มา", typeof hfmAnchor === "string");
  check("ลิงก์โบรกเกอร์เปิดแท็บใหม่ พร้อม rel=\"noopener noreferrer sponsored\"", /rel="noopener noreferrer sponsored"/.test(hfmAnchor ?? "") && /target="_blank"/.test(hfmAnchor ?? ""), hfmAnchor);
  check("หน้าคำสั่งซื้อบอกว่าโบรกเกอร์ไม่ส่งเลขบัญชีมาให้ และมีปุ่มกรอกเลขบัญชี", orderPage.text.includes("โบรกเกอร์ไม่ส่งเลขบัญชีมาให้ระบบ") && orderPage.text.includes(`/account/mt5/new?order=${orderId}`));
  {
    const home = await request("/account", { cookie: session });
    const notice = /data-testid="unfinished-orders"[\s\S]*?<\/div><\/div>/.exec(home.text)?.[0] ?? "";
    check("หน้าบัญชีหลังเลือกโบรกเกอร์: ประกาศเปลี่ยนเป็น \"กรอกเลขบัญชี MT5\" พร้อมลิงก์ไปคำสั่งซื้อ", notice.includes("กรอกเลขบัญชี MT5") && notice.includes(`href="${orderPath}"`), notice.slice(0, 200));
  }

  // ---- กรอกเลขบัญชี MT5: ขั้นทวน → ขั้นยืนยัน ----
  const accountNumber = String(10_000_000 + (Date.now() % 89_999_999));
  const mt5Path = `/account/mt5/new?order=${orderId}`;
  const mt5Fields = { accountNumber, accountNumberConfirm: accountNumber, brokerServer: "E2E-Server", label: "" };
  const mt5Page = await request(mt5Path, { cookie: session });
  check("หน้ากรอกเลขบัญชีแสดงคำสั่งซื้อและโบรกเกอร์ที่เลือก ไม่มีช่องรหัสผ่าน", mt5Page.text.includes('name="accountNumber"') && mt5Page.text.includes("HFM") && !/type="password"/.test(mt5Page.text));

  // คำสั่งซื้ออีกรายการที่ยังไม่ชำระ: ส่งเลขบัญชีเข้าไปตรงๆ (แก้ id ในคำขอ) ต้องไม่ได้
  const unpaidOrder = await createOrder(session, newOrder.text, packageId);
  {
    const strayNumber = String(Number(accountNumber) + 1);
    const { fields, replaced } = reboundFields(mt5Page.text, "accountNumber", orderId, unpaidOrder.id);
    const stray = await request(mt5Path, { method: "POST", cookie: session, body: formData({ ...fields, ...mt5Fields, accountNumber: strayNumber, accountNumberConfirm: strayNumber, intent: "confirm" }) });
    const home = await request("/account", { cookie: session });
    check("ส่งเลขบัญชีให้คำสั่งซื้อที่ยังไม่ชำระ (แก้ id ในคำขอ) → ถูกปฏิเสธ และไม่มีบัญชีนั้นในระบบ", replaced && stray.status === 200 && stray.text.includes("ยังไม่ได้ชำระเงิน") && !home.text.includes(strayNumber), `replaced=${replaced} status=${stray.status}`);
  }

  const leadingZero = await post(mt5Path, "accountNumber", mt5Page.text, { ...mt5Fields, accountNumber: "0" + accountNumber, accountNumberConfirm: "0" + accountNumber, intent: "confirm" }, session);
  check("เลขบัญชีขึ้นต้นด้วย 0 → ถูกปฏิเสธ", leadingZero.status === 200 && leadingZero.text.includes("ไม่ขึ้นต้นด้วย 0"));
  const review = await post(mt5Path, "accountNumber", mt5Page.text, { ...mt5Fields, intent: "review" }, session);
  // ไม่มี JavaScript ผลของ action อยู่ใน payload ของหน้า (state) ไม่ได้อยู่ใน markup เสมอไป จึงรับได้ทั้งสองแบบ
  check("ขั้นทวนเลขบัญชี → ยังไม่บันทึก", review.status === 200 && (review.text.includes("ยืนยัน เปิด license ให้บัญชีนี้") || /\\?"step\\?":\\?"review/.test(review.text)), `status ${review.status}`);
  const afterReview = await request("/account", { cookie: session });
  check("หลังขั้นทวน ยังไม่มีบัญชีนี้ในหน้าบัญชี", !afterReview.text.includes(accountNumber));
  const confirmed = await post(mt5Path, "accountNumber", mt5Page.text, { ...mt5Fields, intent: "confirm", password: "mt5-secret", partnerBrokerCode: "cxm" }, session);
  check("ยืนยัน → 303 กลับหน้าคำสั่งซื้อ", confirmed.status === 303 && confirmed.location === orderPath, `${confirmed.status} ${confirmed.location}`);
  orderPage = await request(orderPath, { cookie: session });
  check("หน้าคำสั่งซื้อแสดงเลขบัญชีที่ผูก", orderPage.status === 200 && orderPage.text.includes(accountNumber));
  check("หลังยืนยันเลขบัญชี: ไม่ใช่หน้า error", orderPage.status === 200 && !orderPage.text.includes("ระบบขัดข้อง"));

  // ---- license เปิดอัตโนมัติ ----
  section(expectPublishFail ? "เปิด license: เผยแพร่รายชื่อล้ม → กำลังเปิดใช้งาน → ซ่อมด้วย license:publish" : "license เปิดอัตโนมัติ");
  let firstExpiry = null;
  if (expectPublishFail) {
    check("เผยแพร่ล้ม: หน้าคำสั่งซื้อ 200 แสดง \"กำลังเปิดใช้งาน\" (ยังไม่ใช่ \"เปิดใช้งานแล้ว\") และบอกว่าไม่ต้องชำระซ้ำ", orderPage.status === 200 && orderPage.text.includes("กำลังเปิดใช้งาน") && !orderPage.text.includes("เปิดใช้งานแล้ว") && orderPage.text.includes("ไม่ต้องชำระซ้ำ"));
    check("เผยแพร่ล้ม: เลขบัญชียังไม่อยู่ในรายชื่อที่เผยแพร่", entriesOf(await publishedList(), accountNumber).length === 0);
    const home = await request("/account", { cookie: session });
    check("เผยแพร่ล้ม: หน้าบัญชีแสดง license ของบัญชีนี้เป็น \"กำลังเปิดใช้งาน\" (license ถูกสร้างในฐานข้อมูลแล้ว)", home.text.includes(accountNumber) && home.text.includes("กำลังเปิดใช้งาน") && !home.text.includes("ยังไม่มี license"));
    const retried = await post(orderPath, 'data-testid="retry-activation"', orderPage.text, {}, session);
    check("กด \"ตรวจสอบสถานะอีกครั้ง\" ขณะ storage ยังเขียนไม่ได้ → 200 ข้อความแจ้งให้รอ (ไม่ใช่ error page)", retried.status === 200 && retried.text.includes("ระบบยังเปิดใช้งานไม่เสร็จ"), `status ${retried.status}`);

    const goodDir = process.env.E2E_GOOD_LICENSE_DIR;
    if (!goodDir || !process.env.DATABASE_URL) {
      check("ตั้ง E2E_GOOD_LICENSE_DIR และ DATABASE_URL (ฐานเดียวกับเซิร์ฟเวอร์) เพื่อทดสอบ license:publish", false);
    } else {
      // สคริปต์ซ่อมเขียนลงโฟลเดอร์ที่เขียนได้ — ลบค่าตั้ง Firebase ทั้งหมดออกจาก environment ของสคริปต์ กันเขียนรายชื่อจริง
      const env = scriptEnv(goodDir);
      const repaired = await runLicensePublish(env);
      check("npm run license:publish → exit 0 และรายงานว่าเขียนปลายทางแล้ว", repaired.code === 0 && repaired.output.includes("เขียนปลายทางแล้ว"), lastLines(repaired.output));
      const again = await runLicensePublish(env, ["--if-changed"]);
      check("รัน license:publish -- --if-changed ซ้ำ → exit 0 และบอกว่าไม่ได้เขียนปลายทาง (ไม่ได้ตรวจปลายทางจริง)", again.code === 0 && again.output.includes("ไม่ได้เขียนปลายทาง") && again.output.includes("ไม่ได้ตรวจปลายทางจริง"), lastLines(again.output, 4));
      const fileName = process.env.LICENSE_FILE_NAME ?? "license.txt";
      const content = await readFile(path.join(goodDir, fileName), "utf8").catch(() => "");
      firstExpiry = entryDate(content, accountNumber);
      check("ไฟล์รายชื่อในโฟลเดอร์ที่ซ่อมมีเลขบัญชีของลูกค้า พร้อมวันหมดอายุในอนาคต", firstExpiry !== null && firstExpiry > bangkokToday(), String(firstExpiry));
      orderPage = await request(orderPath, { cookie: session });
      check("โหลดหน้าคำสั่งซื้อใหม่ → \"เปิดใช้งานแล้ว\"", orderPage.text.includes("เปิดใช้งานแล้ว") && !orderPage.text.includes('data-testid="retry-activation"'));
    }
  } else {
    const list = await publishedList();
    firstExpiry = entryDate(list, accountNumber);
    const days = firstExpiry ? dayDiff(bangkokToday(), firstExpiry) : null;
    check("รายชื่อที่เผยแพร่มี id<เลขบัญชี>.<ปี.เดือน.วัน> ของลูกค้า 1 รายการ", firstExpiry !== null, list.slice(0, 200));
    check("วันหมดอายุ = วันนี้ + อายุแพ็กเกจ (30/180/365 วัน)", PACKAGE_DAYS.includes(days), `${firstExpiry} (${days} วัน)`);
    check("รายชื่อเดิมยังอยู่ครบ (ไม่มีรายการของลูกค้าคนอื่นหาย)", listBefore === "" || listBefore.split(",").every((e) => list.split(",").includes(e)));
    check("หน้าคำสั่งซื้อ: \"เปิดใช้งานแล้ว\" พร้อมวันหมดอายุแบบไทย ไม่มีสถานะกำลังเปิดใช้งาน", orderPage.text.includes("เปิดใช้งานแล้ว") && firstExpiry !== null && plain(orderPage.text).includes(`ใช้ได้ถึง ${thaiDate(firstExpiry)} (อีก ${days} วัน)`) && !orderPage.text.includes('data-testid="retry-activation"'));
    check("หน้าคำสั่งซื้อมีลิงก์ไปวิธีติดตั้ง", orderPage.text.includes('href="/install"'));
    check("หน้าคำสั่งซื้อที่เปิดใช้งานแล้วบอกวิธีรับไฟล์ติดตั้งที่ใช้ได้จริง (ทีมงานทาง LINE) ไม่ให้รออีเมล", plain(orderPage.text).includes("รับไฟล์ติดตั้ง indicator: ติดต่อทีมงาน") && plain(orderPage.text).includes("ระบบยังไม่ส่งไฟล์ทางอีเมล"));
    const install = await request("/install");
    check("หน้าวิธีติดตั้งไม่สัญญาอีเมล/ดาวน์โหลดจากหน้าบัญชี และบอกให้รับไฟล์จากทีมงาน", install.status === 200 && !install.text.includes("ได้รับอีเมล") && !install.text.includes("ดาวน์โหลดซ้ำได้") && install.text.includes("รับไฟล์ติดตั้งจากทีมงาน"));
    const home = await request("/account", { cookie: session });
    check("หน้าบัญชีหลังเปิดใช้งาน: ส่วนดาวน์โหลดบอกวิธีรับไฟล์ และไม่มีประกาศคำสั่งซื้อค้าง", plain(home.text).includes("license ของคุณเปิดใช้งานแล้ว รับไฟล์ติดตั้งและคู่มือได้โดยติดต่อทีมงาน") && !home.text.includes('data-testid="unfinished-orders"'));
  }
  check("มีบัญชีแล้ว: ไม่มีตัวเลือกโบรกเกอร์/ปุ่มกรอกเลขบัญชีอีก", !orderPage.text.includes('name="brokerCode"') && !orderPage.text.includes("/account/mt5/new"));
  const replayConfirm = await post(mt5Path, "accountNumber", mt5Page.text, { ...mt5Fields, intent: "confirm" }, session);
  check("ส่งคำขอยืนยันเลขบัญชีซ้ำ → ไม่สร้างซ้ำ (แจ้งว่าคำสั่งซื้อระบุบัญชีแล้ว)", replayConfirm.status === 200 && replayConfirm.text.includes("คำสั่งซื้อนี้ระบุบัญชี MT5 แล้ว"), `status ${replayConfirm.status}`);
  const replayPayAfter = await post(mockPath, 'data-testid="mock-pay"', mockPage.text, {}, session);
  if (!expectPublishFail) {
    const list = await publishedList();
    check("ส่งคำขอชำระเงินและคำขอยืนยันเลขบัญชีซ้ำหลังเปิดใช้งาน → รายการในรายชื่อเหมือนเดิม (1 รายการ วันหมดอายุเดิม)", replayPayAfter.status === 303 && entriesOf(list, accountNumber).length === 1 && entryDate(list, accountNumber) === firstExpiry, `${replayPayAfter.status} ${entryDate(list, accountNumber)}`);
  }
  const mt5After = await request(mt5Path, { cookie: session });
  check("เปิดหน้ากรอกเลขบัญชีของคำสั่งซื้อที่มีบัญชีแล้ว → ไม่มีฟอร์ม", !mt5After.text.includes('name="accountNumber"'));

  const account = await request("/account", { cookie: session });
  const accountId = new RegExp(`/account/orders/new\\?account=([0-9a-f-]{36})`).exec(account.text)?.[1];
  check("หน้าบัญชีแสดงบัญชีใหม่ (เลขบัญชี + โบรกเกอร์พาร์ตเนอร์) และมีลิงก์สั่งซื้อ/ต่ออายุ", typeof accountId === "string" && account.text.includes(accountNumber) && /พาร์ตเนอร์: (?:<!-- -->)?HFM/.test(account.text));
  if (firstExpiry !== null) {
    check("หน้าบัญชีแสดง license ใช้งานได้ พร้อมวันหมดอายุ และคำสั่งซื้อ \"เปิดใช้งานแล้ว\"", account.text.includes("ใช้งานได้") && account.text.includes(thaiDate(firstExpiry)) && account.text.includes("เปิดใช้งานแล้ว") && account.text.includes("ต่ออายุ") && !account.text.includes("ยังไม่มี license"));
  }
  check("บัญชีใหม่ปรากฏครั้งเดียว (กดยืนยันซ้ำไม่สร้างซ้ำ)", new Set([...account.text.matchAll(/\/account\/orders\/new\?account=([0-9a-f-]{36})/g)].map((m) => m[1])).size === 1);

  // ---- คำสั่งซื้อต่ออายุของบัญชีเดิม ----
  const renewal = await createOrder(session, newOrder.text, packageId, accountId ?? "");
  check("สั่งซื้อให้บัญชีเดิม (ต่ออายุ) → สร้างคำสั่งซื้อใหม่ที่มีบัญชีมาแต่แรก", renewal.status === 303 && /^\/account\/orders\/[0-9a-f-]{36}$/.test(renewal.path) && renewal.path !== orderPath, `${renewal.status} ${renewal.path}`);
  const again = await createOrder(session, newOrder.text, packageId, accountId ?? "");
  check("สั่งซื้อซ้ำให้บัญชีที่มีคำสั่งซื้อค้าง → กลับรายการเดิมพร้อม notice", again.status === 303 && again.path === `${renewal.path}?notice=existing`, `${again.status} ${again.path}`);
  const noticed = await request(again.path || renewal.path, { cookie: session });
  check("หน้าคำสั่งซื้อบอกว่าไม่ได้สร้างรายการใหม่ และแสดงเลขบัญชีพร้อมปุ่มชำระ", noticed.text.includes("ไม่ได้สร้างรายการใหม่") && noticed.text.includes(accountNumber) && noticed.text.includes('data-testid="pay-by-card"'));

  // ---- ต่ออายุ: คำสั่งซื้อมีบัญชีมาแต่แรก ชำระเงินทีหลัง → license ต่ออายุทันทีตอนชำระ ----
  if (!expectPublishFail && firstExpiry !== null) {
    section("ต่ออายุ (มีบัญชีก่อน ชำระทีหลัง) และใช้บัญชีเดิมกับคำสั่งซื้อที่ชำระแล้ว");
    const duration = dayDiff(bangkokToday(), firstExpiry);
    const renewed = await payByMock(session, renewal.path);
    check("ชำระคำสั่งซื้อต่ออายุ → 303 กลับหน้าคำสั่งซื้อ", renewed.confirmed.status === 303 && renewed.confirmed.location === renewal.path, `${renewed.confirmed.status} ${renewed.confirmed.location}`);
    const renewalPage = await request(renewal.path, { cookie: session });
    let list = await publishedList();
    const secondExpiry = entryDate(list, accountNumber);
    check("ต่ออายุก่อนหมด: วันหมดอายุในรายชื่อขยับจากวันหมดอายุเดิมเท่าอายุแพ็กเกจพอดี (ไม่ใช่นับจากวันนี้)", secondExpiry !== null && dayDiff(firstExpiry, secondExpiry) === duration, `${firstExpiry} → ${secondExpiry} (แพ็กเกจ ${duration} วัน)`);
    check("หน้าคำสั่งซื้อต่ออายุ: \"เปิดใช้งานแล้ว\" ทันทีหลังชำระ ไม่ต้องเลือกโบรกเกอร์/กรอกเลขอีก", renewalPage.text.includes("เปิดใช้งานแล้ว") && secondExpiry !== null && plain(renewalPage.text).includes(`ใช้ได้ถึง ${thaiDate(secondExpiry)}`) && !renewalPage.text.includes('name="brokerCode"') && !renewalPage.text.includes("/account/mt5/new"));
    await post(renewed.mockPath, 'data-testid="mock-pay"', renewed.mockPage.text, {}, session);
    list = await publishedList();
    check("ส่งคำขอชำระเงินของคำสั่งซื้อต่ออายุซ้ำ → ไม่ต่ออายุซ้ำ", entryDate(list, accountNumber) === secondExpiry && entriesOf(list, accountNumber).length === 1, String(entryDate(list, accountNumber)));
    const firstOrderPage = await request(orderPath, { cookie: session });
    check("คำสั่งซื้อแรกยังแสดง \"เปิดใช้งานแล้ว\" ด้วยวันหมดอายุใหม่", firstOrderPage.text.includes("เปิดใช้งานแล้ว") && secondExpiry !== null && plain(firstOrderPage.text).includes(thaiDate(secondExpiry)));

    // คำสั่งซื้อใหม่ที่ยังไม่ระบุบัญชี: ชำระก่อน แล้วเลือก "ใช้บัญชี MT5 ที่ลงทะเบียนไว้แล้ว" → เปิดทันทีตอนผูกบัญชี
    const third = await createOrder(session, newOrder.text, packageId);
    await payByMock(session, third.path);
    const thirdPage = await request(third.path, { cookie: session });
    check("คำสั่งซื้อที่ชำระแล้ว (ยังไม่ระบุบัญชี) เสนอให้ใช้บัญชีที่ลงทะเบียนไว้แล้ว", thirdPage.text.includes("ใช้บัญชีนี้และเปิด license ทันที") && thirdPage.text.includes(accountNumber));
    const attached = await post(third.path, "mt5AccountId", thirdPage.text, { mt5AccountId: accountId ?? "" }, session);
    check("เลือกบัญชีเดิม → 303 กลับหน้าคำสั่งซื้อ", attached.status === 303 && attached.location === third.path, `${attached.status} ${attached.location}`);
    const replayAttach = await post(third.path, "mt5AccountId", thirdPage.text, { mt5AccountId: accountId ?? "" }, session);
    list = await publishedList();
    const thirdExpiry = entryDate(list, accountNumber);
    check("ชำระก่อน ผูกบัญชีทีหลัง: ต่ออายุอีก 1 รอบพอดี แม้ส่งคำขอผูกบัญชีซ้ำ", secondExpiry !== null && thirdExpiry !== null && dayDiff(secondExpiry, thirdExpiry) === duration && replayAttach.status === 200, `${secondExpiry} → ${thirdExpiry} replay=${replayAttach.status}`);
    const thirdAfter = await request(third.path, { cookie: session });
    check("หน้าคำสั่งซื้อนั้น: \"เปิดใช้งานแล้ว\"", thirdAfter.text.includes("เปิดใช้งานแล้ว") && thirdExpiry !== null && plain(thirdAfter.text).includes(thaiDate(thirdExpiry)));
  }

  // ---- ลูกค้าเดิมที่กดเลือกโบรกเกอร์ไปก่อน ต้องยังใช้บัญชี MT5 เดิมได้ (ไม่ใช่ทางตัน) ----
  if (!expectPublishFail && firstExpiry !== null) {
    section("ลูกค้าเดิม: เลือกโบรกเกอร์ก่อน แล้วใช้บัญชี MT5 ที่ลงทะเบียนไว้แล้ว");
    const duration = dayDiff(bangkokToday(), firstExpiry);
    const before = entryDate(await publishedList(), accountNumber);
    const fourth = await createOrder(session, newOrder.text, packageId);
    await payByMock(session, fourth.path);
    let page = await request(fourth.path, { cookie: session });
    await post(fourth.path, "brokerCode", page.text, { brokerCode: "hfm" }, session);
    page = await request(fourth.path, { cookie: session });
    check("หลังเลือกโบรกเกอร์: หน้าคำสั่งซื้อยังเสนอ \"ใช้บัญชี MT5 ที่ลงทะเบียนไว้แล้ว\" คู่กับปุ่มกรอกเลขใหม่", page.text.includes(`/account/mt5/new?order=${fourth.id}`) && hasForm(page.text, "mt5AccountId") && page.text.includes("ใช้บัญชีนี้และเปิด license ทันที") && page.text.includes(accountNumber));
    const ownPath = `/account/mt5/new?order=${fourth.id}`;
    const ownPage = await request(ownPath, { cookie: session });
    const own = await post(ownPath, "accountNumber", ownPage.text, { ...mt5Fields, intent: "review" }, session);
    check("กรอกเลขที่ตัวเองลงทะเบียนไว้แล้ว → ข้อความบอกทางไปต่อ (กลับไปเลือกบัญชีนั้นในหน้าคำสั่งซื้อ)", own.status === 200 && own.text.includes("คุณลงทะเบียนเลขบัญชีนี้ไว้แล้ว") && own.text.includes("ใช้บัญชี MT5 ที่ลงทะเบียนไว้แล้ว"), `status ${own.status}`);
    const attached = await post(fourth.path, "mt5AccountId", page.text, { mt5AccountId: accountId ?? "" }, session);
    const after = entryDate(await publishedList(), accountNumber);
    check("เลือกบัญชีเดิมหลังเลือกโบรกเกอร์ → 303 และ license ต่ออายุ 1 รอบพอดี", attached.status === 303 && attached.location === fourth.path && before !== null && after !== null && dayDiff(before, after) === duration, `${attached.status} ${before} → ${after}`);
    const done = await request(fourth.path, { cookie: session });
    check("หน้าคำสั่งซื้อนั้น: \"เปิดใช้งานแล้ว\" ไม่มีฟอร์มเลือกบัญชี/โบรกเกอร์อีก", done.text.includes("เปิดใช้งานแล้ว") && !hasForm(done.text, "mt5AccountId") && !done.text.includes('name="brokerCode"'));
  }

  // ---- สคริปต์ license:publish: ไฟล์ปลายทางหาย → --if-changed ไม่ซ่อม (และบอกตรงๆ), ค่าเริ่มต้นเขียนเสมอ ----
  const licenseDir = process.env.E2E_LICENSE_DIR;
  const canRunScripts = !expectPublishFail && Boolean(licenseDir) && Boolean(process.env.DATABASE_URL);
  if (canRunScripts) {
    section("npm run license:publish กับปลายทางที่ไฟล์หาย");
    const target = path.join(licenseDir, process.env.LICENSE_FILE_NAME ?? "license.txt");
    // รอบแรก: ให้สคริปต์เก็บตกคำสั่งซื้อที่ค้างในฐานทดสอบ (ถ้ามี จากการรันครั้งก่อน) ให้หมดก่อน — รายชื่อหลังจากนี้จึงนิ่ง
    const settled = await runLicensePublish(scriptEnv(licenseDir));
    check("npm run license:publish (ค่าเริ่มต้น) → exit 0 และรายงานว่าเขียนปลายทางแล้ว", settled.code === 0 && settled.output.includes("เขียนปลายทางแล้ว"), lastLines(settled.output));
    const original = await readFile(target, "utf8").catch(() => null);
    check("อ่านไฟล์รายชื่อใน E2E_LICENSE_DIR ได้ และมีเลขบัญชีของลูกค้า (โฟลเดอร์เดียวกับเซิร์ฟเวอร์)", original !== null && entriesOf(original, accountNumber).length === 1);
    await rm(target, { force: true });
    const skipped = await runLicensePublish(scriptEnv(licenseDir), ["--if-changed"]);
    const stillMissing = (await readFile(target, "utf8").catch(() => null)) === null;
    check("--if-changed: รายชื่อเหมือนประวัติ → ไม่เขียน ไฟล์ยังหาย และข้อความบอกว่าไม่ได้ตรวจปลายทางจริง", skipped.code === 0 && stillMissing && skipped.output.includes("ไม่ได้เขียนปลายทาง") && skipped.output.includes("ไม่ได้ตรวจปลายทางจริง"), lastLines(skipped.output));
    const repaired = await runLicensePublish(scriptEnv(licenseDir));
    const restored = await readFile(target, "utf8").catch(() => null);
    check("ค่าเริ่มต้น (เขียนเสมอ): ไฟล์ปลายทางกลับมา เนื้อหาเหมือนเดิมทุกตัวอักษร", repaired.code === 0 && repaired.output.includes("เขียนปลายทางแล้ว") && restored === original, lastLines(repaired.output));
    const noStorage = scriptEnv(licenseDir);
    delete noStorage.LICENSE_STORAGE;
    delete noStorage.NODE_ENV;
    const refused = await runLicensePublish(noStorage);
    check("ไม่ตั้ง LICENSE_STORAGE → สคริปต์ไม่เดาปลายทาง: exit 1 พร้อมชื่อตัวแปร ไม่แตะอะไร", refused.code === 1 && refused.output.includes("LICENSE_STORAGE") && refused.output.includes("ยังไม่ได้แตะ"), lastLines(refused.output));
    const typo = Object.assign(scriptEnv(licenseDir), { LICENSE_STORAGE: "Firebase" });
    const refusedTypo = await runLicensePublish(typo);
    check("LICENSE_STORAGE=Firebase (พิมพ์ผิด) → exit 1 ไม่ถอยไปเขียนไฟล์ในเครื่อง", refusedTypo.code === 1 && refusedTypo.output.includes("ไม่รู้จักค่า LICENSE_STORAGE"), lastLines(refusedTypo.output));
  }

  // ---- ผู้ใช้อีกคน: เลขซ้ำ และคำสั่งซื้อของคนอื่น ----
  {
    const paid = await payByMock(otherSession, otherOrder.path);
    let otherPage = await request(otherOrder.path, { cookie: otherSession });
    await post(otherOrder.path, "brokerCode", otherPage.text, { brokerCode: "cxm" }, otherSession);
    const otherMt5Path = `/account/mt5/new?order=${otherOrder.id}`;
    const otherMt5 = await request(otherMt5Path, { cookie: otherSession });
    const taken = await post(otherMt5Path, "accountNumber", otherMt5.text, { ...mt5Fields, intent: "review" }, otherSession);
    check("คนอื่น (ชำระแล้ว เลือกโบรกเกอร์แล้ว) กรอกเลขเดียวกัน → แจ้งว่าถูกลงทะเบียนแล้ว", paid.confirmed.status === 303 && taken.status === 200 && taken.text.includes("เลขบัญชีนี้ถูกลงทะเบียนในระบบแล้ว"), `pay=${paid.confirmed.status} status=${taken.status}`);
    const takenConfirm = await post(otherMt5Path, "accountNumber", otherMt5.text, { ...mt5Fields, intent: "confirm" }, otherSession);
    otherPage = await request(otherOrder.path, { cookie: otherSession });
    check("คนอื่นข้ามขั้นทวนไปยืนยันเลยก็ไม่ได้ คำสั่งซื้อของเขายังรอเลขบัญชี", takenConfirm.status === 200 && takenConfirm.text.includes("เลขบัญชีนี้ถูกลงทะเบียนในระบบแล้ว") && !otherPage.text.includes(accountNumber) && otherPage.text.includes(`/account/mt5/new?order=${otherOrder.id}`), `status ${takenConfirm.status}`);
  }
  const foreignOrder = await request(orderPath, { cookie: otherSession });
  check("คนอื่นเปิดคำสั่งซื้อของเรา → 404 ภาษาไทย ไม่เห็นข้อมูล", foreignOrder.text.includes("ไม่พบหน้านี้") && !foreignOrder.text.includes(accountNumber));

  // ---- ลูกค้าสองคนเปิดใช้งานพร้อมกัน (+ แพ็กเกจตลอดชีพ ถ้าตั้งราคาไว้) ----
  if (!expectPublishFail) {
    section("ลูกค้าสองคนกรอกเลขบัญชีพร้อมกัน" + (lifetimePackageId ? " (คนหนึ่งซื้อแพ็กเกจตลอดชีพ)" : ""));
    if (!lifetimePackageId) console.log("  ข้าม  แพ็กเกจตลอดชีพยังไม่ตั้งราคา — ไม่ได้ทดสอบ license ตลอดชีพ (ตั้ง price_thb ของ lifetime ในฐานทดสอบ)");
    const reg = await submitForm("/register", "email", { name: "ผู้ทดสอบ 3", email: `e2e-third-${stamp}@example.com`, password, accept: "on" });
    const thirdSession = sessionCookie(reg)?.value;
    const thirdNew = await request("/account/orders/new", { cookie: thirdSession });
    const thirdOrder = await createOrder(thirdSession, thirdNew.text, lifetimePackageId ?? packageId);
    await payByMock(thirdSession, thirdOrder.path);
    const thirdOrderPage = await request(thirdOrder.path, { cookie: thirdSession });
    await post(thirdOrder.path, "brokerCode", thirdOrderPage.text, { brokerCode: "fisg" }, thirdSession);

    const numberB = String(Number(accountNumber) + 11);
    const numberC = String(Number(accountNumber) + 12);
    // otherOrder ของผู้ใช้คนที่สอง ชำระแล้วและเลือกโบรกเกอร์แล้วจากขั้นก่อนหน้า
    const submitB = await prepareMt5Submit(otherSession, otherOrder.id, numberB);
    const submitC = await prepareMt5Submit(thirdSession, thirdOrder.id, numberC);
    const [resB, resC] = await Promise.all([submitB(), submitC()]);
    check("ทั้งสองคำขอ → 303 กลับหน้าคำสั่งซื้อของตัวเอง", resB.status === 303 && resB.location === otherOrder.path && resC.status === 303 && resC.location === thirdOrder.path, `${resB.status} ${resC.status}`);
    const list = await publishedList();
    const dateB = entryDate(list, numberB);
    const dateC = entryDate(list, numberC);
    check("รายชื่อที่เผยแพร่มีเลขบัญชีของทั้งสองคน และเลขของลูกค้าคนแรกยังอยู่", dateB !== null && dateC !== null && entryDate(list, accountNumber) !== null, list.slice(0, 300));
    check("รายชื่อเดิมก่อนเริ่มทดสอบยังอยู่ครบ", listBefore === "" || listBefore.split(",").every((e) => list.split(",").some((x) => x.split(".")[0] === e.split(".")[0])));
    const pageB = await request(otherOrder.path, { cookie: otherSession });
    const pageC = await request(thirdOrder.path, { cookie: thirdSession });
    check("ทั้งสองคนเห็น \"เปิดใช้งานแล้ว\"", pageB.text.includes("เปิดใช้งานแล้ว") && pageC.text.includes("เปิดใช้งานแล้ว"));
    if (lifetimePackageId) {
      check("แพ็กเกจตลอดชีพ: รายการในรายชื่อเป็น 9999.01.01", dateC === "9999-01-01", String(dateC));
      check("แพ็กเกจตลอดชีพ: หน้าคำสั่งซื้อแสดง \"ใช้ได้ตลอดชีพ\"", pageC.text.includes("ใช้ได้ตลอดชีพ"));
      const thirdHome = await request("/account", { cookie: thirdSession });
      check("แพ็กเกจตลอดชีพ: หน้าบัญชีแสดง \"ตลอดชีพ\" และไม่มีลิงก์ต่ออายุ", thirdHome.text.includes("ตลอดชีพ") && thirdHome.text.includes("ใช้งานได้") && !thirdHome.text.includes("/account/orders/new?account="));
    }
  }

  // ---- ก่อนรับเงิน: บัญชี MT5 ของคำสั่งซื้อต่ออายุกลายเป็นตลอดชีพไปแล้ว → ไม่รับเงิน ----
  if (!expectPublishFail && firstExpiry !== null && lifetimePackageId && accountId) {
    section("ต่ออายุค้างชำระ แต่บัญชีกลายเป็นตลอดชีพไปแล้ว → ไม่พาไปชำระเงิน");
    const stale = await createOrder(session, newOrder.text, packageId, accountId);
    const stalePage = await request(stale.path, { cookie: session });
    check("คำสั่งซื้อต่ออายุ (รอชำระ) มีปุ่มชำระตามปกติ", stale.status === 303 && hasForm(stalePage.text, 'data-testid="pay-by-card"'));
    // ซื้อแพ็กเกจตลอดชีพแบบ "บัญชีใหม่" แล้วเลือกบัญชีเดิมหลังชำระ → บัญชีนั้นเป็นตลอดชีพ
    const life = await createOrder(session, newOrder.text, lifetimePackageId);
    await payByMock(session, life.path);
    const lifePage = await request(life.path, { cookie: session });
    const lifeAttach = await post(life.path, "mt5AccountId", lifePage.text, { mt5AccountId: accountId }, session);
    check("บัญชีเดิมกลายเป็นตลอดชีพ (รายชื่อเป็น 9999.01.01)", lifeAttach.status === 303 && entryDate(await publishedList(), accountNumber) === "9999-01-01", `${lifeAttach.status} ${entryDate(await publishedList(), accountNumber)}`);

    const blockedPage = await request(stale.path, { cookie: session });
    check("หน้าคำสั่งซื้อต่ออายุที่ค้าง: ไม่มีปุ่มชำระ แสดงเหตุผล (ตลอดชีพอยู่แล้ว) และยังยกเลิกได้", blockedPage.text.includes('data-testid="payment-blocked"') && !hasForm(blockedPage.text, 'data-testid="pay-by-card"') && blockedPage.text.includes("ตลอดชีพ") && blockedPage.text.includes("ยกเลิกคำสั่งซื้อนี้"));
    const forcedStart = await post(stale.path, 'data-testid="pay-by-card"', stalePage.text, {}, session);
    check("กดชำระจากแท็บที่ค้าง → 303 กลับหน้าคำสั่งซื้อ ไม่ไปหน้าชำระเงิน", forcedStart.status === 303 && forcedStart.location === stale.path, `${forcedStart.status} ${forcedStart.location}`);
    const forcedMock = await request(`${stale.path}/mock-pay`, { cookie: session });
    check("เปิดหน้าจำลองการชำระเงินของคำสั่งซื้อนั้นตรงๆ → ไม่มีปุ่มยืนยัน ถูกพากลับหน้าคำสั่งซื้อ", !hasForm(forcedMock.text, 'data-testid="mock-pay"') && redirectsTo(forcedMock.text, stale.path));
    const stillUnpaid = await request(stale.path, { cookie: session });
    check("คำสั่งซื้อนั้นยังรอชำระ (ไม่มีการรับเงินที่เปิด license ไม่ได้)", stillUnpaid.text.includes("รอชำระ") && !stillUnpaid.text.includes("กำลังเปิดใช้งาน"));
  }

  // ---- ล้างข้อมูลการชำระเงินจำลอง (ก่อนเปิดระบบจริง) ----
  if (canRunScripts && process.env.E2E_PURGE_MOCK === "1") {
    section("npm run license:purge-mock (ทดลอง → ทำจริง → เผยแพร่ใหม่)");
    const env = scriptEnv(licenseDir);
    const listBeforePurge = await publishedList();
    const dry = await runNpmScript("license:purge-mock", env);
    const count = (output, label) => Number(new RegExp(`${label}: (\\d+)`).exec(output)?.[1] ?? "-1");
    check("ทดลอง: exit 0 บอกจำนวนที่จะทำ (>0) และบอกว่ายังไม่ได้เปลี่ยนอะไร", dry.code === 0 && dry.output.includes("ยังไม่ได้เปลี่ยนอะไร") && count(dry.output, "ยกเลิกคำสั่งซื้อจำลองที่สถานะชำระแล้ว") > 0 && count(dry.output, "หมดอายุ") > 0, lastLines(dry.output, 8));
    const untouched = await request(orderPath, { cookie: session });
    check("ทดลองแล้วข้อมูลไม่เปลี่ยน: คำสั่งซื้อยัง \"เปิดใช้งานแล้ว\" รายชื่อเท่าเดิม", untouched.text.includes("เปิดใช้งานแล้ว") && (await publishedList()) === listBeforePurge);

    const applied = await runNpmScript("license:purge-mock", env, ["--apply"]);
    check("--apply: exit 0 จำนวนเท่ากับตอนทดลอง", applied.code === 0 && applied.output.includes("ล้างข้อมูลการชำระเงินจำลองแล้ว") && count(applied.output, "ยกเลิกคำสั่งซื้อจำลองที่สถานะชำระแล้ว") === count(dry.output, "ยกเลิกคำสั่งซื้อจำลองที่สถานะชำระแล้ว") && count(applied.output, "หมดอายุ") === count(dry.output, "หมดอายุ"), lastLines(applied.output, 8));
    const republished = await runLicensePublish(env);
    const listAfterPurge = await publishedList();
    check("เผยแพร่ใหม่หลังล้าง: เลขบัญชีจากการชำระจำลองของรอบนี้หลุดจากรายชื่อ", republished.code === 0 && entriesOf(listAfterPurge, accountNumber).length === 0 && listAfterPurge !== listBeforePurge, lastLines(republished.output));
    const purgedOrder = await request(orderPath, { cookie: session });
    check("คำสั่งซื้อจำลองถูกยกเลิก: ไม่แสดง \"เปิดใช้งานแล้ว\" และไม่มีปุ่มชำระ/กรอกเลขบัญชี", purgedOrder.text.includes("ยกเลิก") && !purgedOrder.text.includes("เปิดใช้งานแล้ว") && !hasForm(purgedOrder.text, 'data-testid="pay-by-card"') && !purgedOrder.text.includes("/account/mt5/new"));
    const purgedHome = await request("/account", { cookie: session });
    check("หน้าบัญชี: license ของบัญชีนั้นเป็น \"หมดอายุ\" ไม่ใช่ \"ใช้งานได้\"", purgedHome.text.includes(accountNumber) && purgedHome.text.includes("หมดอายุ") && !purgedHome.text.includes("ใช้งานได้"));
    const again = await runNpmScript("license:purge-mock", env, ["--apply"]);
    check("รันซ้ำ → ไม่มีอะไรให้ล้างเพิ่ม", again.code === 0 && count(again.output, "ยกเลิกคำสั่งซื้อจำลองที่สถานะชำระแล้ว") === 0, lastLines(again.output, 8));
  }

  if (slipVisible) await slipFlow(session, otherSession, unpaidOrder);
}

/**
 * คำสั่งซื้อที่ชำระแบบจำลองต้องเอามาแลก license ไม่ได้หลังปิด mock (E2E_MOCK_CARRYOVER=bank แล้ว redeem — ดูหัวไฟล์)
 * ใช้ผู้ใช้ carry-<E2E_STAMP>@example.com คนเดียวกันทั้งสองรอบ
 */
async function mockCarryover(phase) {
  const carryEmail = `carry-${stamp}@example.com`;
  const number = String(20_000_000 + (parseInt(stamp, 36) % 69_999_999));
  if (phase === "bank") {
    section("ชำระแบบจำลองแล้วค้างไว้ (เซิร์ฟเวอร์เปิด mock)");
    const reg = await submitForm("/register", "email", { name: "ผู้ทดสอบ carry", email: carryEmail, password, accept: "on" });
    const session = sessionCookie(reg)?.value;
    check("สมัครผู้ใช้", typeof session === "string");
    const newOrder = await request("/account/orders/new", { cookie: session });
    const packageId = [...newOrder.text.matchAll(/<input\b[^>]*name="packageId"[^>]*>/g)].map(([tag]) => tag).filter((tag) => !/\bdisabled\b/.test(tag)).map((tag) => /\bvalue="([^"]*)"/.exec(tag)?.[1])[0];
    const order = await createOrder(session, newOrder.text, packageId ?? "");
    const paid = await payByMock(session, order.path);
    check("ชำระแบบจำลอง → 303", paid.confirmed.status === 303, `${paid.confirmed.status}`);
    const page = await request(order.path, { cookie: session });
    const chosen = await post(order.path, "brokerCode", page.text, { brokerCode: "hfm" }, session);
    check("เลือกโบรกเกอร์ → 303 (หยุดตรงนี้ ยังไม่กรอกเลขบัญชี)", chosen.status === 303, `${chosen.status}`);
    console.log(`  คำสั่งซื้อ ${order.id} ค้างไว้ที่ขั้นกรอกเลขบัญชี — รันรอบ redeem กับเซิร์ฟเวอร์ที่ปิด mock ด้วย E2E_STAMP=${stamp}`);
    return;
  }

  section("เอาคำสั่งซื้อจำลองที่ค้างไว้มากรอกเลขบัญชี หลังปิด mock");
  const listBefore = await publishedList();
  const loggedIn = await submitForm("/login", "email", { email: carryEmail, password });
  const session = sessionCookie(loggedIn)?.value;
  check("เข้าสู่ระบบด้วยผู้ใช้จากรอบ bank", typeof session === "string", `status ${loggedIn.status}`);
  const home = await request("/account", { cookie: session });
  const orderPath = /href="(\/account\/orders\/[0-9a-f-]{36})"/.exec(home.text)?.[1];
  check("หน้าบัญชีมีประกาศคำสั่งซื้อที่ชำระแล้วรอเลขบัญชี", typeof orderPath === "string" && home.text.includes('data-testid="unfinished-orders"'));
  if (!orderPath) return;
  const orderId = orderPath.split("/").pop();
  const fresh = await request("/account/orders/new", { cookie: session });
  const packageId = [...fresh.text.matchAll(/<input\b[^>]*name="packageId"[^>]*>/g)].map(([tag]) => tag).filter((tag) => !/\bdisabled\b/.test(tag)).map((tag) => /\bvalue="([^"]*)"/.exec(tag)?.[1])[0];
  const another = await createOrder(session, fresh.text, packageId ?? "");
  const anotherPage = await request(another.path, { cookie: session });
  check("mock ปิดอยู่: คำสั่งซื้อใหม่ไม่มีปุ่มชำระ มีแต่ข้อความระบบชำระเงินยังไม่เปิดให้บริการ", anotherPage.text.includes("ระบบชำระเงินยังไม่เปิดให้บริการ") && !hasForm(anotherPage.text, 'data-testid="pay-by-card"') && !anotherPage.text.includes('href="#line"'));

  const submit = await prepareMt5Submit(session, orderId, number);
  const submitted = await submit();
  check("กรอกเลขบัญชีให้คำสั่งซื้อจำลอง → 303 กลับหน้าคำสั่งซื้อ (ไม่ใช่หน้า error)", submitted.status === 303 && submitted.location === orderPath, `${submitted.status} ${submitted.location}`);
  const page = await request(orderPath, { cookie: session });
  check("หน้าคำสั่งซื้อ: \"ชำระแล้ว แต่ระบบเปิดใช้งาน license ... อัตโนมัติไม่ได้\" พร้อมเหตุผล (ชำระแบบจำลอง) — ไม่ใช่ \"เปิดใช้งานแล้ว\"/\"กำลังเปิดใช้งาน\"", page.text.includes('data-testid="activation-blocked"') && plain(page.text).includes("อัตโนมัติไม่ได้") && page.text.includes("จำลองการชำระเงิน") && !page.text.includes("เปิดใช้งานแล้ว") && !page.text.includes("กำลังเปิดใช้งาน") && !hasForm(page.text, 'data-testid="retry-activation"'));
  const list = await publishedList();
  check("เลขบัญชีนั้นไม่อยู่ในรายชื่อที่เผยแพร่ และรายชื่อไม่เปลี่ยน", entriesOf(list, number).length === 0 && list === listBefore, list.slice(0, 120));
  const homeAfter = await request("/account", { cookie: session });
  check("หน้าบัญชี: คำสั่งซื้อนั้นขึ้น \"รอทีมงานตรวจสอบ\" และบัญชียังไม่มี license", homeAfter.text.includes("รอทีมงานตรวจสอบ") && homeAfter.text.includes(number) && homeAfter.text.includes("ยังไม่มี license"));
}

/** ฟอร์มที่มี `marker` ต้องไม่มี input/select/textarea อื่นนอกจากช่องซ่อน $ACTION_* */
function formInputsAreActionOnly(html, marker) {
  for (const [form] of html.matchAll(/<form\b[\s\S]*?<\/form>/g)) {
    if (!form.includes(marker)) continue;
    const controls = [...form.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)].map(([tag]) => tag);
    return controls.length > 0 && controls.every((tag) => /type="hidden"/.test(tag) && /name="\$ACTION/.test(tag));
  }
  return false;
}

/** โอนเงิน + แนบสลิป (ขั้นตอนรอบก่อน) — รันเฉพาะเมื่อเซิร์ฟเวอร์เปิด PAYMENT_BANK_TRANSFER_ENABLED=true */
async function slipFlow(session, otherSession, order) {
  section("โอนเงิน + แนบสลิป (PAYMENT_BANK_TRANSFER_ENABLED=true)");
  const orderPath = order.path;
  let orderPage = await request(orderPath, { cookie: session });
  if (!orderPage.text.includes('name="slip"')) {
    console.log("  ข้าม  ฟอร์มแนบสลิปไม่แสดง (SLIP_STORAGE=disabled)");
    return;
  }
  check("เปิดช่องทางโอนเงินแล้วยังมีปุ่มชำระด้วยบัตรด้วย", orderPage.text.includes('data-testid="pay-by-card"'));
  const fake = await post(orderPath, 'name="slip"', orderPage.text, { paymentMethod: "bank_transfer", slip: new File(["<script>alert(1)</script>"], "slip.png", { type: "image/png" }) }, session);
  check("ไฟล์ที่ไม่ใช่รูปจริง (ชื่อ .png) → ถูกปฏิเสธ", fake.status === 200 && fake.text.includes("รองรับเฉพาะไฟล์ JPG, PNG, WebP หรือ PDF"));
  const uploaded = await post(orderPath, 'name="slip"', orderPage.text, { paymentMethod: "bank_transfer", slip: new File([PNG], "../../evil.png", { type: "image/png" }) }, session);
  check("แนบสลิป PNG → สถานะรอตรวจสลิป", uploaded.status === 200 && uploaded.text.includes("ได้รับสลิปแล้ว"), `status ${uploaded.status}`);
  orderPage = await request(orderPath, { cookie: session });
  check("แนบสลิปแล้วไม่มีปุ่มยกเลิกเอง และไม่มีปุ่มชำระด้วยบัตร (กันจ่ายซ้ำ)", !orderPage.text.includes("ยกเลิกคำสั่งซื้อนี้") && !orderPage.text.includes('data-testid="pay-by-card"'));

  const slipPath = `/api/orders/${order.id}/slip`;
  const mine = await request(slipPath, { cookie: session });
  check("เจ้าของเปิดสลิป → 200 image/png พร้อม CSP sandbox", mine.status === 200 && mine.headers.get("content-type") === "image/png" && (mine.headers.get("content-security-policy") ?? "").includes("sandbox"), `status ${mine.status}`);
  check("สลิปไม่ถูก cache", mine.headers.get("cache-control") === "private, no-store");
  const theirs = await request(slipPath, { cookie: otherSession });
  check("คนอื่นเปิดสลิปของเรา → 404", theirs.status === 404, `status ${theirs.status}`);
  const anonymous = await request(slipPath);
  check("ไม่ล็อกอินเปิดสลิป → 401", anonymous.status === 401, `status ${anonymous.status}`);
}

async function main() {
  console.log(`e2e → ${BASE}`);

  const carryover = process.env.E2E_MOCK_CARRYOVER;
  if (carryover === "bank" || carryover === "redeem") {
    await mockCarryover(carryover);
    console.log(`\nผ่าน ${passed} ข้อ, ไม่ผ่าน ${failures.length} ข้อ`);
    if (failures.length > 0) {
      for (const f of failures) console.log(`  - ${f}`);
      process.exit(1);
    }
    return;
  }

  section("header ความปลอดภัย");
  {
    const res = await request("/login");
    check("หน้า /login ตอบ 200", res.status === 200, `status ${res.status}`);
    check("Strict-Transport-Security", /max-age=\d+/.test(res.headers.get("strict-transport-security") ?? ""));
    check("X-Frame-Options: DENY", res.headers.get("x-frame-options") === "DENY");
    check("X-Content-Type-Options: nosniff", res.headers.get("x-content-type-options") === "nosniff");
    check("Referrer-Policy", res.headers.get("referrer-policy") === "strict-origin-when-cross-origin");
    check("ไม่ส่ง X-Powered-By", res.headers.get("x-powered-by") === null);
    check("มีข้อความ <noscript> ภาษาไทย", /<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/.test(res.text));
  }

  section("ข้อความหน้าบ้านตรงกับขั้นตอนจริง");
  {
    const pricing = await request("/pricing");
    const text = plain(pricing.text);
    const idx = ["เลือกแพ็กเกจและสมัครสมาชิก", "ชำระเงินด้วยบัตร", "เลือกโบรกเกอร์และเปิดบัญชีเทรด", "กรอกเลขบัญชี MT5"].map((t) => text.indexOf(`>${t}<`));
    check("หน้าแพ็กเกจ: ขั้นตอนเรียง เลือกแพ็กเกจ → ชำระด้วยบัตร → เลือกโบรกเกอร์ → กรอกเลขบัญชี MT5", idx.every((i) => i >= 0) && [...idx].sort((a, b) => a - b).join() === idx.join(), idx.join(","));
    const home = await request("/");
    const install = await request("/install");
    const faq = await request("/faq");
    check("หน้าแรก/แพ็กเกจ/ติดตั้ง/FAQ ไม่สัญญาว่าจะส่งไฟล์หรือแจ้งเตือนทางอีเมล", [home, pricing, install, faq].every((r) => r.status === 200 && !/รับไฟล์ติดตั้งทางอีเมล|ได้รับอีเมล|แจ้งเตือนทางอีเมล/.test(r.text)));
    check("ไม่มีลิงก์ LINE ที่กดแล้วไม่ไปไหน (href=\"#line\")", [home, pricing, install, faq].every((r) => !r.text.includes('href="#line"')));
  }

  section("ยังไม่ล็อกอิน");
  {
    const res = await request("/account");
    check("GET /account → 307 ไป /login?next=/account", res.status === 307 && res.location?.endsWith("/login?next=%2Faccount"), `${res.status} ${res.location}`);
    const withQuery = await request("/account/orders/new?package=yearly");
    const next = withQuery.location ? new URL(withQuery.location, BASE).searchParams.get("next") : null;
    check("next เก็บ query ของหน้าที่ขอ", next === "/account/orders/new?package=yearly", String(next));
    const admin = await request("/admin");
    check("GET /admin → 307 ไป /login", admin.status === 307 && (admin.location ?? "").includes("/login?next=%2Fadmin"));
    const slip = await request(`/api/orders/${UNKNOWN_UUID}/slip`);
    check("GET สลิปโดยไม่ล็อกอิน → 401", slip.status === 401, `status ${slip.status}`);
    const getLogout = await request("/logout");
    check("GET /logout ไม่ใช่คำสั่งออกจากระบบ (405)", getLogout.status === 405, `status ${getLogout.status}`);
    const missing = await request(`/ไม่มีหน้านี้-${stamp}`);
    check("URL ที่ไม่มี → 404 พร้อมข้อความไทย", missing.status === 404 && missing.text.includes("ไม่พบหน้านี้"), `status ${missing.status}`);
  }

  section("สมัครสมาชิก");
  let session;
  {
    const invalid = await submitForm("/register", "email", { name: "ผู้ทดสอบ", email, password: "short", accept: "on" });
    check("รหัสผ่านสั้น → ไม่สร้างบัญชี ไม่มี cookie", invalid.status === 200 && sessionCookie(invalid) === null, `status ${invalid.status}`);
    check("ข้อความ error รหัสผ่านอยู่ในคำตอบ", invalid.text.includes("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"));
    check("คำตอบไม่มีรหัสผ่านที่ส่งไป", !invalid.text.includes('"short"'));

    const res = await submitForm("/register", "email", { name: "ผู้ทดสอบ e2e", email, password, accept: "on" });
    check("สมัครสำเร็จ → 303 ไป /account", res.status === 303 && res.location === "/account", `${res.status} ${res.location}`);
    const cookie = sessionCookie(res);
    check("ได้ cookie session", cookie !== null && /^[A-Za-z0-9_-]{43}$/.test(cookie.value));
    check("cookie เป็น HttpOnly + SameSite=Lax + Path=/", /HttpOnly/i.test(cookie?.attributes ?? "") && /SameSite=lax/i.test(cookie?.attributes ?? "") && /Path=\//i.test(cookie?.attributes ?? ""), cookie?.attributes);
    check("คำตอบไม่มีรหัสผ่าน", !res.text.includes(password));
    session = cookie?.value;

    const guest = await request("/register?package=yearly");
    check("หน้าสมัครที่เลือกแพ็กเกจมา: ลิงก์ \"เข้าสู่ระบบ\" พากลับไปสั่งซื้อแพ็กเกจนั้น", guest.text.includes('href="/login?next=%2Faccount%2Forders%2Fnew%3Fpackage%3Dyearly"'));

    const dup = await submitForm("/register", "email", { name: "ซ้ำ", email, password, accept: "on" });
    check("อีเมลซ้ำ → ไม่ได้ session ใหม่", dup.status === 200 && sessionCookie(dup) === null && dup.text.includes("อีเมลนี้มีบัญชีอยู่แล้ว"), `status ${dup.status}`);
  }
  if (!session) throw new Error("สมัครสมาชิกไม่สำเร็จ — หยุดทดสอบส่วนที่เหลือ");

  section("ล็อกอินอยู่");
  let orderActionId = null;
  {
    const account = await request("/account", { cookie: session });
    check("GET /account → 200 และมีอีเมลของผู้ใช้", account.status === 200 && account.text.includes(email), `status ${account.status}`);
    const admin = await request("/admin", { cookie: session });
    check("ลูกค้าเปิด /admin → ไม่เห็นหน้าแอดมิน (ถูกพาไป /account)", !admin.text.includes("license.txt") && redirectsTo(admin.text, "/account"), `status ${admin.status}`);
    const order = await request(`/account/orders/${UNKNOWN_UUID}`, { cookie: session });
    check("คำสั่งซื้อที่ไม่มี/ไม่ใช่ของเรา → หน้า 404 ภาษาไทย", order.text.includes("ไม่พบหน้านี้"), `status ${order.status}`);
    const slip = await request(`/api/orders/${UNKNOWN_UUID}/slip`, { cookie: session });
    check("สลิปของคำสั่งซื้อที่ไม่มี → 404", slip.status === 404, `status ${slip.status}`);
    const loginPage = await request("/login?next=%2Faccount%2Forders%2Fnew%3Fpackage%3Dyearly", { cookie: session });
    check("ล็อกอินอยู่แล้วเปิด /login → ถูกพาไปปลายทาง next", redirectsTo(loginPage.text, "/account/orders/new?package=yearly"));

    const newOrder = await request("/account/orders/new", { cookie: session });
    try {
      orderActionId = JSON.parse(actionFields(newOrder.text, "mt5AccountId")["$ACTION_1:0"]).id;
    } catch {
      orderActionId = null;
    }
    check("หน้า /account/orders/new มีฟอร์มสั่งซื้อ", typeof orderActionId === "string");
  }

  section("Server Action หลัง session หาย (proxy ต้องไม่ redirect POST)");
  {
    // แบบเบราว์เซอร์ที่มี JavaScript: POST พร้อม header Next-Action ไปที่ URL ของหน้า โดยไม่มี cookie
    const body = formData({ 0: '[{"ok":false},"$K1"]', _1_packageId: UNKNOWN_UUID, _1_mt5AccountId: "" });
    const res = await request("/account/orders/new", {
      method: "POST",
      body,
      headers: { "next-action": orderActionId ?? "unknown", accept: "text/x-component" },
    });
    check("POST ไม่ถูก proxy ตอบ 307", res.status !== 307 && !(res.location ?? "").includes("/login?next="), `${res.status} ${res.location}`);
    check("action ตรวจ session เองแล้วพาไป /login", (res.headers.get("x-action-redirect") ?? "").startsWith("/login"), `status ${res.status} x-action-redirect=${res.headers.get("x-action-redirect")}`);

    // cookie ที่รูปแบบถูกแต่ไม่มีในฐานข้อมูล
    const forged = await request("/account/orders/new", {
      method: "POST",
      body: formData({ 0: '[{"ok":false},"$K1"]', _1_packageId: UNKNOWN_UUID, _1_mt5AccountId: "" }),
      cookie: "A".repeat(43),
      headers: { "next-action": orderActionId ?? "unknown", accept: "text/x-component" },
    });
    check("cookie ปลอม → action พาไป /login เช่นกัน", (forged.headers.get("x-action-redirect") ?? "").startsWith("/login"), `status ${forged.status}`);
  }

  await purchaseFlow(session);

  section("ออกจากระบบ");
  {
    const res = await request("/logout", { method: "POST", cookie: session });
    check("POST /logout → 303 ไป / (โหลดทั้งหน้า)", res.status === 303 && res.location === "/", `${res.status} ${res.location}`);
    const cleared = sessionCookie(res);
    check("cookie ถูกลบ", cleared !== null && cleared.value === "", cleared?.attributes);
    const slip = await request(`/api/orders/${UNKNOWN_UUID}/slip`, { cookie: session });
    check("cookie เดิมใช้ไม่ได้แล้ว (session ถูกลบฝั่งเซิร์ฟเวอร์)", slip.status === 401, `status ${slip.status}`);
    const account = await request("/account", { cookie: session });
    check("เปิด /account ด้วย cookie เดิม → ไม่มีข้อมูลผู้ใช้", !account.text.includes(email));
  }

  section("เข้าสู่ระบบ");
  {
    const wrong = await login({ password: password + "x" });
    check("รหัสผ่านผิด → ไม่มี cookie", wrong.status === 200 && sessionCookie(wrong) === null, `status ${wrong.status}`);
    check("ข้อความกลาง (ไม่บอกว่าอีเมลมีบัญชีหรือไม่)", wrong.text.includes("อีเมลหรือรหัสผ่านไม่ถูกต้อง"));
    const nobody = await login({ email: `nobody-${stamp}@example.com` });
    check("อีเมลที่ไม่มีบัญชี → ข้อความเดียวกัน", nobody.status === 200 && sessionCookie(nobody) === null && nobody.text.includes("อีเมลหรือรหัสผ่านไม่ถูกต้อง"));

    const ok = await login({ next: "/account/orders/new?package=yearly" });
    check("รหัสผ่านถูก → 303 ไปปลายทาง next พร้อม query", ok.status === 303 && ok.location === "/account/orders/new?package=yearly", `${ok.status} ${ok.location}`);
    const cookie = sessionCookie(ok);
    check("ได้ session ใหม่ (ไม่ใช่ค่าเดิม)", cookie !== null && cookie.value !== session && cookie.value.length === 43);

    const open = await login({ next: "//evil.example/x" });
    check("next ที่ชี้ออกนอกเว็บ → ไป /account", open.status === 303 && open.location === "/account", `${open.status} ${open.location}`);

    if (cookie) {
      const account = await request("/account", { cookie: cookie.value });
      check("session ใหม่เปิด /account ได้", account.status === 200 && account.text.includes(email));
      await request("/logout", { method: "POST", cookie: cookie.value });
    }
  }

  if (process.env.E2E_TRUSTED_PROXY_HOPS === "1") {
    section("rate limit ต่อ IP (เซิร์ฟเวอร์ต้องรันด้วย TRUSTED_PROXY_HOPS=1)");
    const victim = `victim-${stamp}@example.com`;
    const attempt = (xff) => login({ email: victim, password: "wrong-password-1" }, { headers: { "x-forwarded-for": xff } });
    const limited = (res) => res.text.includes("พยายามหลายครั้งเกินไป");

    // ปลอมตัวแรกของ X-Forwarded-For หมุนไปเรื่อยๆ — ตัวท้าย (ที่ proxy ของเราเติม) เหมือนเดิม
    const spoofed = [];
    for (let i = 1; i <= 10; i++) spoofed.push(limited(await attempt(`203.0.113.${i}, 198.51.100.77`)));
    check("ปลอม X-Forwarded-For ตัวแรก 10 ครั้ง → 8 ครั้งแรกผ่าน ครั้งที่ 9–10 ถูกจำกัด", spoofed.slice(0, 8).every((x) => !x) && spoofed.slice(8).every((x) => x), JSON.stringify(spoofed));

    // "เจ้าของบัญชี" มาจาก IP อื่น — ต้องยังลองล็อกอินได้ (ไม่ถูกล็อกเพราะคนอื่นยิงอีเมลเดียวกัน)
    const owner = await attempt("198.51.100.200");
    check("อีเมลเดียวกันจาก IP อื่น → ไม่ถูกจำกัด", !limited(owner) && owner.text.includes("อีเมลหรือรหัสผ่านไม่ถูกต้อง"));
  }

  console.log(`\nผ่าน ${passed} ข้อ, ไม่ผ่าน ${failures.length} ข้อ`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\ne2e หยุดกลางทาง:", err instanceof Error ? err.message : err);
  process.exit(1);
});
