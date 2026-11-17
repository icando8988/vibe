/**
 * QA-CHANNEL-ROUTES-039 — Threads OAuth start 라우트 경계 시험(요청 → 서비스 → 응답).
 * 대상: src/app/api/distribution/oauth/threads/start/route.ts
 * 격리: server-only·Supabase service client(@/lib/supabase/admin)·세션 actor(@/server/distribution/actor)만 mock.
 *       route → threads/oauth/session → config(process.env) → flow → http 조립은 실제 코드 그대로다.
 * 실제 공급자·DB·네트워크 호출 없음. env는 vi.stubEnv로 넣는 가짜 형식 값(실제 키 아님)이다.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "11111111-2222-4333-8444-555555555555";
const STATE_ROW = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CONN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SITE = "https://site.example";
const OTHER = "https://evil.example";
const APP_ID = "1234567890";
const APP_SECRET = `S${randomBytes(12).toString("hex")}`; // 가짜 형식 값
const TOKEN_KEY = `v1:${randomBytes(32).toString("base64")}`; // 가짜 형식 값
const START_URL = `${SITE}/api/distribution/oauth/threads/start`;
const RESULT_PREFIX = "/admin/distribution/connections/threads?result=";

const h = vi.hoisted(() => ({
  actor: { ok: true, actorId: "11111111-2222-4333-8444-555555555555" } as { ok: true; actorId: string } | { ok: false; reason: string },
  actorCalls: 0,
  client: null as null | { rpc: (fn: string, p: Record<string, unknown>) => unknown },
  clientThrows: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseServiceClient: () => {
    if (h.clientThrows) throw new Error("factory boom");
    return h.client;
  },
}));
vi.mock("@/server/distribution/actor", () => ({
  requireDistributionActor: async () => {
    h.actorCalls++;
    return h.actor;
  },
}));

type RpcCall = [string, Record<string, unknown>];
/** 첫 RPC 호출을 존재 검증 후 반환(타입 좁히기). 없으면 시험 실패. */
function onlyCall(calls: RpcCall[]): Record<string, unknown> {
  expect(calls).toHaveLength(1);
  const first = calls[0];
  if (!first) throw new Error("RPC 호출 없음");
  return first[1];
}
function rpcClient(handler: (fn: string, p: Record<string, unknown>) => unknown = () => ({ data: { id: STATE_ROW }, error: null })) {
  const calls: RpcCall[] = [];
  h.client = {
    rpc: async (fn, p) => {
      calls.push([fn, p]);
      return handler(fn, p);
    },
  };
  return calls;
}

function form(fields: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
function post(opts: { origin?: string | null; body?: BodyInit | null; headers?: Record<string, string> } = {}) {
  const headers = new Headers(opts.headers ?? {});
  const origin = opts.origin === undefined ? SITE : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  return new Request(START_URL, { method: "POST", headers, body: opts.body === undefined ? form() : opts.body });
}
async function route() {
  return import("@/app/api/distribution/oauth/threads/start/route");
}
function expectBaseHeaders(res: Response) {
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
}
function expectResult(res: Response, result: string) {
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe(`${RESULT_PREFIX}${result}`);
  expect(res.headers.get("set-cookie")).toBeNull();
  expectBaseHeaders(res);
}
/** 거절·오류 응답에 비밀 값(앱 secret·토큰 키)과 state가 실리지 않는지 */
function expectNoSecrets(res: Response) {
  const dump = JSON.stringify([...res.headers.entries()]);
  expect(dump).not.toContain(APP_SECRET);
  expect(dump).not.toContain(TOKEN_KEY.slice(3));
  expect(dump).not.toMatch(/state=|code=|token=/i);
}

beforeEach(() => {
  vi.stubEnv("THREADS_APP_ID", APP_ID);
  vi.stubEnv("THREADS_APP_SECRET", APP_SECRET);
  vi.stubEnv("DISTRIBUTION_TOKEN_KEY", TOKEN_KEY);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  h.actor = { ok: true, actorId: OWNER };
  h.actorCalls = 0;
  h.client = null;
  h.clientThrows = false;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Threads start 라우트 — 공개 메서드", () => {
  it("POST만 내보낸다(GET 등은 Next가 405 처리)", async () => {
    const m = (await route()) as Record<string, unknown>;
    expect(typeof m.POST).toBe("function");
    for (const k of ["GET", "PUT", "PATCH", "DELETE"]) expect(m[k]).toBeUndefined();
  });
});

describe("Threads start 라우트 — 같은 origin 유효 요청", () => {
  it("새 연결: state 등록 RPC 1회 → 고정 인증 URL로 303 + __Host state 쿠키", async () => {
    const calls = rpcClient();
    const res = await (await route()).POST(post());
    expect(res.status).toBe(303);
    expectBaseHeaders(res);
    expect(calls.map(([fn]) => fn)).toEqual(["distribution_create_oauth_state"]);
    const p = onlyCall(calls);
    expect(p).toMatchObject({
      p_actor_id: OWNER, p_channel: "threads", p_redirect_uri: `${SITE}/api/distribution/oauth/threads/callback`,
      p_target_connection_id: null, p_target_row_version: null,
    });
    expect(p.p_state_hash).toMatch(/^[0-9a-f]{64}$/);

    const loc = new URL(res.headers.get("location") ?? "");
    expect(`${loc.origin}${loc.pathname}`).toBe("https://threads.com/oauth/authorize");
    expect(loc.searchParams.get("client_id")).toBe(APP_ID);
    expect(loc.searchParams.get("redirect_uri")).toBe(`${SITE}/api/distribution/oauth/threads/callback`);
    expect(loc.searchParams.get("response_type")).toBe("code");
    const state = loc.searchParams.get("state") ?? "";
    expect(state.length).toBeGreaterThan(20);
    // DB에는 state 원문이 아니라 해시만 간다
    expect(JSON.stringify(p)).not.toContain(state);
    // 인증 URL에 앱 secret·토큰 키가 없다
    expect(loc.toString()).not.toContain(APP_SECRET);

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie.startsWith(`__Host-dist-threads-oauth=${state};`)).toBe(true);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
  });

  it("재연결: 폼의 connectionId·expectedVersion을 RPC 대상에 묶는다", async () => {
    const calls = rpcClient();
    const res = await (await route()).POST(post({ body: form({ connectionId: CONN, expectedVersion: "4" }) }));
    expect(res.status).toBe(303);
    expect(calls).toHaveLength(1);
    expect(onlyCall(calls)).toMatchObject({ p_target_connection_id: CONN, p_target_row_version: 4 });
  });

  it("폼으로 actorId를 보내도 무시 — actor는 세션에서만 도출", async () => {
    const calls = rpcClient();
    const intruder = "99999999-9999-4999-8999-999999999999";
    await (await route()).POST(post({ body: form({ actorId: intruder, p_actor_id: intruder }) }));
    expect(onlyCall(calls).p_actor_id).toBe(OWNER);
    expect(h.actorCalls).toBe(1);
  });
});

describe("Threads start 라우트 — CSRF(Origin) 거절", () => {
  for (const [name, origin] of [["다른 origin", OTHER], ["Origin 없음", null], ["경로 붙은 origin", `${SITE}/`], ["http origin", "http://site.example"], ["null 문자열", "null"]] as const) {
    it(`${name} → invalid_request, actor·RPC 0회`, async () => {
      const calls = rpcClient();
      const res = await (await route()).POST(post({ origin }));
      expectResult(res, "invalid_request");
      expectNoSecrets(res);
      expect(calls).toHaveLength(0);
      expect(h.actorCalls).toBe(0);
    });
  }
});

describe("Threads start 라우트 — 잘못된 본문", () => {
  it("formData 파싱 실패(JSON 본문) → invalid_request, RPC 0회", async () => {
    const calls = rpcClient();
    const res = await (await route()).POST(post({ body: JSON.stringify({ connectionId: CONN }), headers: { "content-type": "application/json" } }));
    expectResult(res, "invalid_request");
    expect(calls).toHaveLength(0);
  });

  it("본문 없음 → invalid_request, RPC 0회", async () => {
    const calls = rpcClient();
    const res = await (await route()).POST(post({ body: null }));
    expectResult(res, "invalid_request");
    expect(calls).toHaveLength(0);
  });

  for (const [name, fields] of [
    ["connectionId가 uuid 아님", { connectionId: "not-a-uuid", expectedVersion: "1" }],
    ["expectedVersion 없음", { connectionId: CONN }],
    ["expectedVersion 0", { connectionId: CONN, expectedVersion: "0" }],
    ["expectedVersion 소수", { connectionId: CONN, expectedVersion: "1.5" }],
  ] as const) {
    it(`재연결 입력 오류(${name}) → invalid_request, RPC 0회`, async () => {
      const calls = rpcClient();
      const res = await (await route()).POST(post({ body: form(fields) }));
      expectResult(res, "invalid_request");
      expect(calls).toHaveLength(0);
    });
  }
});

describe("Threads start 라우트 — 준비·권한 분기", () => {
  it("설정 미비(앱 secret 없음) → not_ready, RPC 0회. 값 없이 결과 코드만", async () => {
    vi.stubEnv("THREADS_APP_SECRET", "");
    const calls = rpcClient();
    const res = await (await route()).POST(post());
    expectResult(res, "not_ready");
    expectNoSecrets(res);
    expect(calls).toHaveLength(0);
  });

  it("설정 미비면 Origin 검사보다 준비 판정이 먼저다(기존 분기) — 다른 origin이어도 not_ready, RPC 0회", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const calls = rpcClient();
    const res = await (await route()).POST(post({ origin: OTHER }));
    expectResult(res, "not_ready");
    expect(calls).toHaveLength(0);
  });

  it("service client 없음 → not_ready", async () => {
    h.client = null;
    const res = await (await route()).POST(post());
    expectResult(res, "not_ready");
  });

  it("세션 actor 거부 → denied, RPC 0회", async () => {
    h.actor = { ok: false, reason: "not_admin" };
    const calls = rpcClient();
    const res = await (await route()).POST(post());
    expectResult(res, "denied");
    expect(calls).toHaveLength(0);
  });
});

describe("Threads start 라우트 — 서비스 결과·예외의 정제 응답", () => {
  const cases: Array<[string, () => unknown, string]> = [
    ["RPC 예외(응답 유실)", () => { throw new Error(`boom ${APP_SECRET}`); }, "start_unknown"],
    ["DB 권한 거부 42501", () => ({ data: null, error: { code: "42501", message: "denied" } }), "denied"],
    ["VERSION_CONFLICT", () => ({ data: null, error: { code: "P0001", message: "VERSION_CONFLICT: stale" } }), "version_conflict"],
    ["OAUTH_STATE_LIMIT", () => ({ data: null, error: { code: "P0001", message: "OAUTH_STATE_LIMIT: too many" } }), "state_limit"],
    ["응답 형식 이상(id 없음)", () => ({ data: { nope: true }, error: null }), "start_unknown"],
  ];
  for (const [name, handler, result] of cases) {
    it(`${name} → ${result}, 쿠키 없음·비밀 미노출`, async () => {
      rpcClient(handler);
      const res = await (await route()).POST(post());
      expectResult(res, result);
      expectNoSecrets(res);
    });
  }

  it("deps 조립 중 예외(service client factory throw) → unexpected 303, 예외 메시지 미노출", async () => {
    h.clientThrows = true;
    const res = await (await route()).POST(post());
    expectResult(res, "unexpected");
    expect(JSON.stringify([...res.headers.entries()])).not.toContain("factory boom");
  });
});
