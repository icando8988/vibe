/**
 * QA-CHANNEL-ROUTES-039 — 미디어 직접 업로드 cancel 라우트 경계 시험(요청 → 서비스 → 응답).
 * 대상: src/app/api/distribution/media/upload/cancel/route.ts (계약 MEDIA_UPLOAD_CONTRACT.md §3.3)
 * 격리: server-only·Supabase service client(@/lib/supabase/admin)·세션 actor(@/server/distribution/actor)만 mock.
 *       route → upload-http(readJsonBody·HTTP 매핑) → media/session → upload.cancelUpload → storage-supabase(intake)는 실제 코드다.
 * 실제 DB·Storage·네트워크 호출 없음. env는 vi.stubEnv로 넣는 가짜 형식 값이다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SB_ORIGIN = "https://proj-fake.supabase.co";
const APP = "https://app.example";
const CANCEL_URL = `${APP}/api/distribution/media/upload/cancel`;
const OWNER = "11111111-2222-4333-8444-555555555555";
const INTRUDER = "99999999-9999-4999-8999-999999999999";
const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GRANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UPATH = `uploads/${OWNER}/${ASSET}/original`;
const NONCE = "N".repeat(43);
const INTAKE = "distribution-media-intake";

const h = vi.hoisted(() => ({
  actor: { ok: true, actorId: "11111111-2222-4333-8444-555555555555" } as { ok: true; actorId: string } | { ok: false; reason: string },
  actorCalls: 0,
  client: null as unknown,
  factoryCalls: 0,
  factoryThrows: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseServiceClient: () => {
    h.factoryCalls++;
    if (h.factoryThrows) throw new Error("factory boom");
    return h.client;
  },
}));
vi.mock("@/server/distribution/actor", () => ({
  requireDistributionActor: async () => {
    h.actorCalls++;
    return h.actor;
  },
}));

const assetRow = (over: Record<string, unknown> = {}) => ({
  id: ASSET, status: "failed", source: "own_creation", source_note: null, original_format: null, original_byte_size: null,
  original_width: null, original_height: null, failure_code: "UPLOAD_CANCELLED", rights_state: "unreviewed", allowed_channels: null,
  rights_valid_until: null, archived_at: null, row_version: 2, created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:01Z", variant: null, ...over,
});
const cancelledGrant = () => ({
  grant_id: GRANT, status: "cancelled", expires_at: "2026-11-17T00:15:00Z", declared_content_type: "image/png", declared_byte_size: 1234,
  object_path: UPATH, asset: assetRow(),
});
const dbErr = (message: string, code = "23514") => ({ data: null, error: { code, message } });

type RpcCall = [string, Record<string, unknown>];
/** 첫 RPC 호출을 존재 검증 후 반환(타입 좁히기). 없으면 시험 실패. */
function onlyCall(calls: RpcCall[]): Record<string, unknown> {
  expect(calls).toHaveLength(1);
  const first = calls[0];
  if (!first) throw new Error("RPC 호출 없음");
  return first[1];
}
function runtime(opts: { rpc?: (fn: string, p: Record<string, unknown>) => unknown; remove?: (paths: string[]) => unknown } = {}) {
  const rpcCalls: RpcCall[] = [];
  const storage = { from: [] as string[], remove: [] as string[][] };
  const api = {
    remove: async (paths: string[]) => (storage.remove.push(paths), opts.remove ? opts.remove(paths) : { data: paths.map((name) => ({ name })), error: null }),
    download: async () => ({ data: null, error: { status: 500 } }),
    upload: async () => ({ data: null, error: { status: 500 } }),
    createSignedUrl: async () => ({ data: null, error: { status: 500 } }),
    createSignedUploadUrl: async () => ({ data: null, error: { status: 500 } }),
  };
  h.client = {
    rpc: async (fn: string, p: Record<string, unknown>) => {
      rpcCalls.push([fn, p]);
      return opts.rpc ? opts.rpc(fn, p) : { data: cancelledGrant(), error: null };
    },
    storage: { from: (b: string) => (storage.from.push(b), api) },
  };
  return { rpcCalls, storage };
}

function req(opts: { method?: string; origin?: string | null; type?: string | null; body?: string | null; headers?: Record<string, string>; url?: string } = {}) {
  const headers = new Headers(opts.headers ?? {});
  const origin = opts.origin === undefined ? APP : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  const type = opts.type === undefined ? "application/json" : opts.type;
  if (type !== null) headers.set("content-type", type);
  const body = opts.body === undefined ? JSON.stringify({ grantId: GRANT, nonce: NONCE }) : opts.body;
  return new Request(opts.url ?? CANCEL_URL, { method: opts.method ?? "POST", headers, body });
}
async function route() {
  return import("@/app/api/distribution/media/upload/cancel/route");
}
async function call(r: Request) {
  const res = await (await route()).POST(r);
  const text = await res.text();
  return { res, text, json: JSON.parse(text) as Record<string, unknown> };
}
function expectSafeHeaders(res: Response) {
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SB_ORIGIN);
  vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"x".repeat(24)}`); // 가짜 형식 값(실제 키 아님)
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", APP); // 업로드 Origin 기준(QA-PROXY-ORIGIN-AUDIT-053)
  h.actor = { ok: true, actorId: OWNER };
  h.actorCalls = 0;
  h.client = null;
  h.factoryCalls = 0;
  h.factoryThrows = false;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cancel 라우트 — 공개 메서드", () => {
  it("POST만 내보낸다", async () => {
    const m = (await route()) as Record<string, unknown>;
    expect(typeof m.POST).toBe("function");
    for (const k of ["GET", "PUT", "PATCH", "DELETE"]) expect(m[k]).toBeUndefined();
  });
});

describe("cancel 라우트 — 요청 경계 거절(서비스·actor·client 0회)", () => {
  const big = JSON.stringify({ grantId: GRANT, nonce: NONCE, pad: "x".repeat(5000) });
  const cases: Array<[string, Parameters<typeof req>[0]]> = [
    ["POST 아닌 method(PUT)", { method: "PUT" }],
    ["Content-Type text/plain", { type: "text/plain" }],
    ["Content-Type 없음", { type: null }],
    ["Content-Type application/jsonx", { type: "application/jsonx" }],
    ["Origin 없음", { origin: null }],
    ["다른 Origin", { origin: "https://evil.example" }],
    ["같은 host 다른 scheme", { origin: "http://app.example" }],
    ["Origin 'null'", { origin: "null" }],
    ["본문 4KB 초과", { body: big }],
    ["content-length를 작게 속인 4KB 초과 본문", { body: big, headers: { "content-length": "10" } }],
    ["content-length 헤더가 4KB 초과", { headers: { "content-length": "5000" } }],
    ["JSON 아님", { body: "grantId=x" }],
    ["JSON 배열", { body: JSON.stringify([GRANT, NONCE]) }],
    ["JSON null", { body: "null" }],
  ];
  for (const [name, opts] of cases) {
    it(`${name} → 400 invalid_request`, async () => {
      const rt = runtime();
      const { res, json } = await call(req(opts));
      expect(res.status).toBe(400);
      expect(json).toEqual({ status: "invalid_request" });
      expectSafeHeaders(res);
      expect(rt.rpcCalls).toHaveLength(0);
      expect(rt.storage.remove).toHaveLength(0);
      expect(h.actorCalls).toBe(0);
      expect(h.factoryCalls).toBe(0);
    });
  }

  it("charset 붙은 application/json과 정확히 4096바이트 본문은 통과", async () => {
    const rt = runtime();
    const base = JSON.stringify({ grantId: GRANT, nonce: NONCE, pad: "" });
    const body = JSON.stringify({ grantId: GRANT, nonce: NONCE, pad: "x".repeat(4096 - Buffer.byteLength(base)) });
    expect(Buffer.byteLength(body)).toBe(4096);
    const { res } = await call(req({ type: "application/json; charset=utf-8", body }));
    expect(res.status).toBe(200);
    expect(rt.rpcCalls).toHaveLength(1);
  });
});

describe("cancel 라우트 — reverse proxy 뒤 Origin 기준(QA-PROXY-ORIGIN-AUDIT-053)", () => {
  const INTERNAL_URL = "http://localhost:3000/api/distribution/media/upload/cancel";
  function expectRejected(res: Response, json: Record<string, unknown>, rt: ReturnType<typeof runtime>) {
    expect(res.status).toBe(400);
    expect(json).toEqual({ status: "invalid_request" });
    expectSafeHeaders(res);
    expect(rt.rpcCalls).toHaveLength(0);
    expect(h.actorCalls).toBe(0);
    expect(h.factoryCalls).toBe(0);
  }

  it("내부 localhost request.url + 공개 Origin(설정값) → 통과해 서비스 위임", async () => {
    const rt = runtime();
    const { res, json } = await call(req({ url: INTERNAL_URL, headers: { host: "localhost:3000" } }));
    expect(res.status).toBe(200);
    expect(json.status).toBe("cancelled");
    expect(rt.rpcCalls).toHaveLength(1);
  });
  it("내부 request.url과 같은 Origin이라도 설정 origin이 아니면 거절", async () => {
    const rt = runtime();
    const { res, json } = await call(req({ url: INTERNAL_URL, origin: "http://localhost:3000" }));
    expectRejected(res, json, rt);
  });
  it("적대적 Origin + x-forwarded-host 위조 → 거절", async () => {
    const rt = runtime();
    const { res, json } = await call(req({ url: INTERNAL_URL, origin: "https://evil.example", headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" } }));
    expectRejected(res, json, rt);
  });
  for (const [name, value] of [["없음", ""], ["형식 오류", "not a url"], ["https 아님", "http://app.example"], ["경로 포함", "https://app.example/x"]] as const) {
    it(`NEXT_PUBLIC_SITE_URL ${name} → 같은 origin 요청도 거절(fail closed)`, async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", value);
      const rt = runtime();
      const { res, json } = await call(req());
      expectRejected(res, json, rt);
    });
  }
});

describe("cancel 라우트 — 입력 검증(서비스 위임 전)", () => {
  for (const [name, body, field] of [
    ["grantId uuid 아님", { grantId: "x", nonce: NONCE }, "grantId"],
    ["grantId 없음", { nonce: NONCE }, "grantId"],
    ["nonce 형식 틀림", { grantId: GRANT, nonce: "short" }, "nonce"],
    ["nonce 숫자", { grantId: GRANT, nonce: 12345 }, "nonce"],
  ] as const) {
    it(`${name} → 400 invalid(field=${field}), RPC 0회`, async () => {
      const rt = runtime();
      const { res, json } = await call(req({ body: JSON.stringify(body) }));
      expect(res.status).toBe(400);
      expect(json).toEqual({ status: "invalid", field });
      expectSafeHeaders(res);
      expect(rt.rpcCalls).toHaveLength(0);
    });
  }
});

describe("cancel 라우트 — actor는 세션에서만", () => {
  it("본문의 actorId·p_actor_id는 무시하고 세션 actor로 RPC", async () => {
    const rt = runtime();
    const { res } = await call(req({ body: JSON.stringify({ grantId: GRANT, nonce: NONCE, actorId: INTRUDER, p_actor_id: INTRUDER }) }));
    expect(res.status).toBe(200);
    // 서비스는 cancelUpload 진입과 begin()에서 세션 actor를 각각 확인한다(현재 2회 — 결과 문서 관찰 항목). 횟수가 아니라 출처를 본다.
    expect(h.actorCalls).toBeGreaterThanOrEqual(1);
    expect(rt.rpcCalls).toHaveLength(1);
    expect(onlyCall(rt.rpcCalls).p_actor_id).toBe(OWNER);
    expect(JSON.stringify(rt.rpcCalls)).not.toContain(INTRUDER);
  });

  it("세션 actor 거부 → 401 denied, RPC 0회", async () => {
    h.actor = { ok: false, reason: "not_admin" };
    const rt = runtime();
    const { res, json } = await call(req());
    expect(res.status).toBe(401);
    expect(json).toEqual({ status: "denied" });
    expect(rt.rpcCalls).toHaveLength(0);
  });

  it("nonce 원문은 RPC에 가지 않는다(해시만)", async () => {
    const rt = runtime();
    await call(req());
    const p = onlyCall(rt.rpcCalls);
    expect(p).toMatchObject({ p_grant_id: GRANT });
    expect(p.p_nonce_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(p)).not.toContain(NONCE);
  });
});

describe("cancel 라우트 — 서비스 결과 → HTTP 매핑", () => {
  it("cancelled → 200, 자산 DTO, intake 원본 삭제 1회(intake bucket·DB 경로)", async () => {
    const rt = runtime();
    const { res, json } = await call(req());
    expect(res.status).toBe(200);
    expectSafeHeaders(res);
    expect(json.status).toBe("cancelled");
    expect(json.asset).toMatchObject({ id: ASSET, rowVersion: 2 });
    expect(rt.rpcCalls.map(([fn]) => fn)).toEqual(["distribution_cancel_media_upload_grant"]);
    expect(rt.storage.from).toEqual([INTAKE]);
    expect(rt.storage.remove).toEqual([[UPATH]]);
    // 응답에 Storage 경로·nonce가 실리지 않는다
    expect(JSON.stringify(json)).not.toContain(UPATH);
    expect(JSON.stringify(json)).not.toContain(NONCE);
  });

  it("원본 삭제가 실패해도(없음·오류) 취소 결과는 200 cancelled", async () => {
    for (const remove of [() => ({ data: [], error: null }), () => ({ data: null, error: { status: 500 } })]) {
      runtime({ remove });
      const { res, json } = await call(req());
      expect(res.status).toBe(200);
      expect(json.status).toBe("cancelled");
    }
  });

  it("RPC 응답 형식 이상 → 200 cancelled(asset null), Storage 삭제 0회", async () => {
    const rt = runtime({ rpc: () => ({ data: { weird: true }, error: null }) });
    const { res, json } = await call(req());
    expect(res.status).toBe(200);
    expect(json).toEqual({ status: "cancelled", asset: null });
    expect(rt.storage.remove).toHaveLength(0);
  });

  const map: Array<[string, () => unknown, number, string]> = [
    ["UPLOAD_GRANT_USED", () => dbErr("UPLOAD_GRANT_USED: x"), 409, "grant_used"],
    ["INVALID_TRANSITION", () => dbErr("INVALID_TRANSITION: x", "P0001"), 409, "grant_used"],
    ["UPLOAD_GRANT_EXPIRED", () => dbErr("UPLOAD_GRANT_EXPIRED: x"), 410, "grant_expired"],
    ["UPLOAD_GRANT_CANCELLED", () => dbErr("UPLOAD_GRANT_CANCELLED: x"), 410, "grant_cancelled"],
    ["UPLOAD_GRANT_INVALID", () => dbErr("UPLOAD_GRANT_INVALID: x"), 404, "grant_invalid"],
    ["DB 권한 거부 42501", () => dbErr("denied", "42501"), 401, "denied"],
    ["RPC 예외(응답 유실)", () => { throw new Error("socket hang up"); }, 503, "unavailable"],
    ["모르는 DB 오류", () => dbErr("boom", "XX000"), 500, "error"],
  ];
  for (const [name, rpc, http, status] of map) {
    it(`${name} → ${http} ${status}, Storage 삭제 0회`, async () => {
      const rt = runtime({ rpc });
      const { res, json, text } = await call(req());
      expect(res.status).toBe(http);
      expect(json).toEqual({ status });
      expectSafeHeaders(res);
      expect(rt.storage.remove).toHaveLength(0);
      expect(text).not.toMatch(/socket|boom|UPLOAD_GRANT|XX000/);
    });
  }
});

describe("cancel 라우트 — 준비 전·예외 정제", () => {
  it("service client 없음 → 503 not_ready, actor는 확인함", async () => {
    h.client = null;
    const { res, json } = await call(req());
    expect(res.status).toBe(503);
    expect(json).toEqual({ status: "not_ready" });
    expectSafeHeaders(res);
  });

  it("deps 조립 중 예외 → 503 uncertain, 예외 메시지 미노출", async () => {
    h.factoryThrows = true;
    const { res, json, text } = await call(req());
    expect(res.status).toBe(503);
    expect(json).toEqual({ status: "uncertain" });
    expectSafeHeaders(res);
    expect(text).not.toContain("factory boom");
  });
});
