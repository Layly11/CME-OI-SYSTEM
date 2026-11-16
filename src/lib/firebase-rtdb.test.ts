import { createVerify, generateKeyPairSync } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { assertPublishable, encodeLicensePath, FirebaseRtdb } from "./firebase-rtdb";

const DB_URL = "https://example-default-rtdb.asia-southeast1.firebasedatabase.app";
const TOKEN_URI = "https://oauth2.googleapis.com/token";

let privateKey: string;
let publicKey: string;

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

/** Firebase ปลอม: เก็บค่าเดียวในหน่วยความจำ และจดทุก request ไว้ตรวจ */
function fakeFirebase(initial: unknown = null, opts: { corruptWrites?: boolean } = {}) {
  const state = { value: initial, calls: [] as Call[] };
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = init.body === undefined ? "" : String(init.body);
    state.calls.push({ url, method, headers: (init.headers ?? {}) as Record<string, string>, body });
    if (url === TOKEN_URI) return Response.json({ access_token: "tok-123", expires_in: 3600 });
    if (method === "PUT") {
      state.value = opts.corruptWrites ? "id1.2027.01.01" : JSON.parse(body);
      return Response.json(state.value);
    }
    return Response.json(state.value);
  }) as typeof fetch;
  return { state, fetchImpl };
}

function client(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof FirebaseRtdb>[0]> = {}) {
  return new FirebaseRtdb({
    databaseUrl: DB_URL,
    serviceAccount: { client_email: "svc@example.iam.gserviceaccount.com", private_key: privateKey },
    fetch: fetchImpl,
    ...extra,
  });
}

describe("encodeLicensePath", () => {
  it("encode เว้นวรรคใน Customer Data", () => {
    expect(encodeLicensePath("CME_Data/Customer Data/Data")).toBe("CME_Data/Customer%20Data/Data");
  });

  it("ปฏิเสธ path นอก Customer Data (ข้อมูลตลาดของบอท)", () => {
    expect(() => encodeLicensePath("CME_Data/GOLD")).toThrow();
    expect(() => encodeLicensePath("CME_Data")).toThrow();
    expect(() => encodeLicensePath("fxssi")).toThrow();
    expect(() => encodeLicensePath("")).toThrow();
  });

  it("ปฏิเสธ path ที่พยายามไต่ออกหรือมีอักขระต้องห้าม", () => {
    expect(() => encodeLicensePath("CME_Data/Customer Data/../GOLD")).toThrow();
    expect(() => encodeLicensePath("CME_Data/Customer Data//Data")).toThrow();
    expect(() => encodeLicensePath("CME_Data/Customer Data/")).toThrow();
  });

  it("ปฏิเสธ path ที่ลึกกว่า 1 ชั้นใต้ Customer Data (ลูกของ node รายชื่อ = เขียนแล้วรายชื่อที่ node แม่กลายเป็น object)", () => {
    expect(() => encodeLicensePath("CME_Data/Customer Data/Data/test")).toThrow(/ชั้นเดียว/);
    expect(() => encodeLicensePath("/CME_Data/Customer Data/Data/x/y/")).toThrow(/ชั้นเดียว/);
    expect(() => encodeLicensePath("CME_Data/Customer Data/Data_test/2")).toThrow(/ชั้นเดียว/);
    // ชั้นเดียวยังใช้ได้ตามเดิม (รวม "/" หัวท้าย)
    expect(encodeLicensePath("/CME_Data/Customer Data/Data_test/")).toBe("CME_Data/Customer%20Data/Data_test");
  });
});

describe("assertPublishable", () => {
  it("ผ่านเมื่อรูปแบบถูกทุกรายการ", () => {
    expect(() => assertPublishable("id766232.2027.07.02,id97058698.9999.01.01")).not.toThrow();
  });

  it("ปฏิเสธเนื้อหาว่าง ช่องว่าง บรรทัดใหม่ คอมมาเกิน และรายการผิดรูปแบบ", () => {
    for (const bad of [
      "",
      "id766232.2027.07.02, id1.2027.01.01",
      "id766232.2027.07.02\n",
      "id766232.2027.07.02,",
      "id766232.2027.07.02,,id1.2027.01.01",
      "766232.2027.07.02",
      "id766232.2027.7.2",
    ]) {
      expect(() => assertPublishable(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("FirebaseRtdb", () => {
  it("ค่าเริ่มต้นชี้ path ทดสอบ ไม่ใช่ path จริง", () => {
    const { fetchImpl } = fakeFirebase();
    expect(client(fetchImpl).publicUrl).toBe(`${DB_URL}/CME_Data/Customer%20Data/Data_test.json`);
  });

  it("เขียนเป็น JSON string ด้วย Bearer token แล้วอ่านกลับมายืนยัน", async () => {
    const { state, fetchImpl } = fakeFirebase();
    const content = "id766232.2027.07.02,id97058698.9999.01.01";
    await client(fetchImpl, { path: "CME_Data/Customer Data/Data" }).write(content);

    expect(state.value).toBe(content);
    const put = state.calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe(`${DB_URL}/CME_Data/Customer%20Data/Data.json`);
    expect(put.body).toBe(JSON.stringify(content));
    expect(put.headers.authorization).toBe("Bearer tok-123");
    expect(put.url).not.toContain("tok-123");
    // ขอ token ครั้งเดียว ใช้ซ้ำทั้ง read/PUT/read
    expect(state.calls.filter((c) => c.url === TOKEN_URI)).toHaveLength(1);
  });

  it("JWT ที่ส่งไปขอ token เซ็นด้วย private key และมี scope ของ RTDB", async () => {
    const { state, fetchImpl } = fakeFirebase("id1.2027.01.01");
    await client(fetchImpl).read();

    const assertion = new URLSearchParams(state.calls[0].body).get("assertion")!;
    const [header, payload, signature] = assertion.split(".");
    const ok = createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims.iss).toBe("svc@example.iam.gserviceaccount.com");
    expect(claims.aud).toBe(TOKEN_URI);
    expect(claims.scope).toContain("https://www.googleapis.com/auth/firebase.database");
  });

  it("ไม่ส่ง PUT เลยถ้าเนื้อหาไม่ผ่านการตรวจ", async () => {
    const { state, fetchImpl } = fakeFirebase("id1.2027.01.01");
    await expect(client(fetchImpl).write("id1.2027.01.01,bad")).rejects.toThrow();
    await expect(client(fetchImpl).write("")).rejects.toThrow();
    expect(state.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(state.value).toBe("id1.2027.01.01");
  });

  it("หยุดถ้าบัญชีจะหายเกินเพดาน (เช่น publish ก่อน import รายชื่อเดิม)", async () => {
    const existing = Array.from({ length: 30 }, (_, i) => `id${1000 + i}.2027.01.01`).join(",");
    const { state, fetchImpl } = fakeFirebase(existing);
    await expect(client(fetchImpl).write("id999.2027.01.01")).rejects.toThrow(/หายไป 30/);
    expect(state.value).toBe(existing);
  });

  it("ยอมให้บัญชีหายได้ไม่เกินเพดาน (ตัดรายที่หมดอายุ)", async () => {
    const { state, fetchImpl } = fakeFirebase("id1.2027.01.01,id2.2027.01.01,id3.2027.01.01");
    await client(fetchImpl, { maxRemovedEntries: 1 }).write("id1.2027.01.01,id2.2028.01.01");
    expect(state.value).toBe("id1.2027.01.01,id2.2028.01.01");
  });

  it("โยน error ถ้าอ่านกลับมาไม่ตรงกับที่เขียน", async () => {
    const { fetchImpl } = fakeFirebase(null, { corruptWrites: true });
    await expect(client(fetchImpl).write("id5.2027.01.01")).rejects.toThrow(/ไม่ตรง/);
  });

  it("หยุดถ้าค่าใน Firebase ไม่ใช่ string", async () => {
    const { fetchImpl } = fakeFirebase({ a: 1 });
    await expect(client(fetchImpl).read()).rejects.toThrow(/ไม่ใช่ string/);
  });

  it("ปฏิเสธ path นอกขอบเขตตั้งแต่ตอนสร้าง", () => {
    const { fetchImpl } = fakeFirebase();
    expect(() => client(fetchImpl, { path: "CME_Data/GOLD" })).toThrow();
    expect(() => client(fetchImpl, { path: "CME_Data/Customer Data/Data/test" })).toThrow(/ชั้นเดียว/);
  });

  it("ทุก request (ขอ token / อ่าน / เขียน) ส่ง AbortSignal — ไม่มี request ที่รอได้ไม่มีกำหนด", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const { fetchImpl } = fakeFirebase();
    const spy = ((input: RequestInfo | URL, init: RequestInit = {}) => {
      signals.push(init.signal);
      return fetchImpl(input, init);
    }) as typeof fetch;
    await client(spy).write("id5.2027.01.01");
    // token + read + PUT + read
    expect(signals).toHaveLength(4);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });

  it("Firebase ไม่ตอบ → ล้มเมื่อครบเวลา (ไม่ค้าง) ข้อความไม่มี URL/token และไม่มีการเขียน", async () => {
    const { state, fetchImpl } = fakeFirebase("id1.2027.01.01");
    // ตอบ token ปกติ แต่ request ไปฐานข้อมูลค้างจนถูกยกเลิกด้วย signal
    const hanging = ((input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input) === TOKEN_URI) return fetchImpl(input, init);
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    }) as typeof fetch;
    const started = Date.now();
    const err = await client(hanging, { requestTimeoutMs: 50 })
      .write("id1.2027.01.01,id2.2027.01.01")
      .catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/ไม่ได้รับคำตอบภายใน 50 ms/);
    expect((err as Error).message).not.toContain("http");
    expect((err as Error).message).not.toContain("tok-123");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(state.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(state.value).toBe("id1.2027.01.01");
  });
});
