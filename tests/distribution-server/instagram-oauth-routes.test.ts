/**
 * QA-INSTAGRAM-OAUTH-ROUTES-048 — Instagram OAuth start·callback 라우트 어댑터 경계 회귀시험(QA-047 L-1).
 * 대상: src/app/api/distribution/oauth/instagram/{start,callback}/route.ts
 * 격리: 라우트가 부르는 두 경계만 mock한다 — `oauth/session.getInstagramOAuthDeps`(설정·deps)와
 *       `oauth/flow.{startInstagramConnect, handleInstagramCallback}`(서비스). 응답 조립(`oauth/http.ts`)·쿠키 헤더(`oauth/state.ts`)·
 *       endpoints 상수는 실제 코드다. 공급자·네트워크·DB 호출 없음. flow 자체 동작은 기존 instagram-oauth 시험 범위다.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SITE = "https://site.example";
const AUTH = "https://www.instagram.com/oauth/authorize";
const PAGE = "/admin/distribution/connections/instagram";
const COOKIE = "__Host-dist-instagram-oauth";
const STATE = "S".repeat(43);
const CONN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type StartOut = { kind: "authorize"; url: string; cookieValue: string; maxAgeSeconds: number } | { kind: "result"; result: string };
const h = vi.hoisted(() => ({
  cfg: { status: "ok", config: { siteOrigin: "https://site.example" } } as { status: "ok"; config: { siteOrigin: string } } | { status: "not_ready"; missing: string[] },
  depsThrows: false,
  startCalls: [] as Array<{ deps: unknown; input: Record<string, unknown> }>,
  startImpl: null as null | (() => Promise<unknown>),
  cbCalls: [] as Array<{ deps: unknown; input: Record<string, unknown> }>,
  cbImpl: null as null | (() => Promise<unknown>),
  deps: { marker: "deps" } as Record<string, unknown>,
}));
vi.mock("@/server/distribution/instagram/oauth/session", () => ({
  getInstagramOAuthDeps: () => {
    if (h.depsThrows) throw new Error("deps boom");
    h.deps = { marker: "deps", getConfig: () => h.cfg };
    return h.deps;
  },
}));
vi.mock("@/server/distribution/instagram/oauth/flow", () => ({
  startInstagramConnect: async (deps: unknown, input: Record<string, unknown>) => {
    h.startCalls.push({ deps, input });
    return h.startImpl ? h.startImpl() : { kind: "result", result: "not_ready" };
  },
  handleInstagramCallback: async (deps: unknown, input: Record<string, unknown>) => {
    h.cbCalls.push({ deps, input });
    return h.cbImpl ? h.cbImpl() : "connected";
  },
}));

beforeEach(() => {
  h.cfg = { status: "ok", config: { siteOrigin: SITE } };
  h.depsThrows = false;
  h.startCalls = [];
  h.startImpl = null;
  h.cbCalls = [];
  h.cbImpl = null;
});

const startRoute = () => import("@/app/api/distribution/oauth/instagram/start/route");
const callbackRoute = () => import("@/app/api/distribution/oauth/instagram/callback/route");

function form(fields: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
function startReq(opts: { origin?: string | null; body?: BodyInit | null; headers?: Record<string, string> } = {}) {
  const headers = new Headers(opts.headers ?? {});
  const origin = opts.origin === undefined ? SITE : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  return new Request(`${SITE}/api/distribution/oauth/instagram/start`, { method: "POST", headers, body: opts.body === undefined ? form() : opts.body });
}
function cbReq(query: string, cookie?: string) {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("cookie", cookie);
  return new NextRequest(`${SITE}/api/distribution/oauth/instagram/callback${query}`, { headers });
}
function expectBase(res: Response) {
  expect(res.status).toBe(303);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
}
/** 결과 이동: 고정 내부 경로 + 허용 목록 코드 하나만 */
function expectResultLocation(res: Response, result: string) {
  expectBase(res);
  expect(res.headers.get("location")).toBe(`${PAGE}?result=${result}`);
}
function cookies(res: Response): string[] {
  return res.headers.getSetCookie();
}
const CLEAR = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// ---------------------------------------------------------------- start
describe("start 라우트 — 공개 메서드", () => {
  it("POST만 내보낸다(GET은 Next가 405)", async () => {
    const m = (await startRoute()) as Record<string, unknown>;
    expect(typeof m.POST).toBe("function");
    for (const k of ["GET", "PUT", "PATCH", "DELETE"]) expect(m[k]).toBeUndefined();
  });
});

describe("start 라우트 — Origin 검사(설정 ok)", () => {
  it("정확히 같은 Origin → flow 1회, 같은 deps 전달", async () => {
    const res = await (await startRoute()).POST(startReq());
    expect(h.startCalls).toHaveLength(1);
    expect(h.startCalls[0]?.deps).toBe(h.deps);
    expectResultLocation(res, "not_ready");
  });

  for (const [name, origin] of [["다른 origin", "https://evil.example"], ["Origin 없음", null], ["끝 슬래시", `${SITE}/`], ["http", "http://site.example"], ["대문자 host", "https://SITE.example"], ["'null'", "null"]] as const) {
    it(`${name} → invalid_request, flow 0회, 쿠키 없음`, async () => {
      const res = await (await startRoute()).POST(startReq({ origin }));
      expectResultLocation(res, "invalid_request");
      expect(cookies(res)).toEqual([]);
      expect(h.startCalls).toHaveLength(0);
    });
  }
});

describe("start 라우트 — 설정 미준비", () => {
  it("설정 not_ready면 Origin 검사 없이 flow에 위임(flow가 not_ready로 state·공급자 0을 책임), 응답에 쿠키 없음", async () => {
    h.cfg = { status: "not_ready", missing: ["INSTAGRAM_APP_SECRET"] };
    h.startImpl = async () => ({ kind: "result", result: "not_ready" });
    const res = await (await startRoute()).POST(startReq({ origin: "https://evil.example" }));
    expectResultLocation(res, "not_ready");
    expect(cookies(res)).toEqual([]);
    expect(h.startCalls).toHaveLength(1);
    // 응답에 빠진 설정 이름조차 싣지 않는다
    expect(JSON.stringify([...res.headers.entries()])).not.toContain("INSTAGRAM_APP_SECRET");
  });
});

describe("start 라우트 — 본문·필드 전달", () => {
  it("formData 파싱 실패(JSON 본문) → invalid_request, flow 0회", async () => {
    const res = await (await startRoute()).POST(startReq({ body: JSON.stringify({ connectionId: CONN }), headers: { "content-type": "application/json" } }));
    expectResultLocation(res, "invalid_request");
    expect(h.startCalls).toHaveLength(0);
  });

  it("본문 없음 → invalid_request, flow 0회", async () => {
    const res = await (await startRoute()).POST(startReq({ body: null }));
    expectResultLocation(res, "invalid_request");
    expect(h.startCalls).toHaveLength(0);
  });

  it("새 연결: 필드 없음 → connectionId·expectedVersion 모두 undefined로 전달", async () => {
    await (await startRoute()).POST(startReq());
    expect(h.startCalls[0]?.input).toEqual({ connectionId: undefined, expectedVersion: undefined });
  });

  it("재연결: connectionId·expectedVersion 원문 그대로 전달, 그 밖 폼 필드(actorId 등)는 전달하지 않음", async () => {
    await (await startRoute()).POST(startReq({ body: form({ connectionId: CONN, expectedVersion: "7", actorId: "intruder", p_actor_id: "intruder" }) }));
    expect(h.startCalls[0]?.input).toEqual({ connectionId: CONN, expectedVersion: "7" });
  });
});

describe("start 라우트 — flow 결과 연결", () => {
  it("authorize → 303 인증 URL + __Host 쿠키(값·Max-Age 그대로, HttpOnly·Secure·SameSite=Lax·Path=/)", async () => {
    const url = `${AUTH}?client_id=123456&redirect_uri=${encodeURIComponent(`${SITE}/api/distribution/oauth/instagram/callback`)}&response_type=code&scope=a&state=${STATE}`;
    h.startImpl = async () => ({ kind: "authorize", url, cookieValue: STATE, maxAgeSeconds: 600 } satisfies StartOut);
    const res = await (await startRoute()).POST(startReq());
    expectBase(res);
    expect(res.headers.get("location")).toBe(url);
    expect(cookies(res)).toEqual([`${COOKIE}=${STATE}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`]);
  });

  it("authorize인데 URL이 고정 인증 주소가 아니면(open redirect) → unexpected, 쿠키 없음", async () => {
    for (const url of ["https://evil.example/oauth/authorize?x=1", `${AUTH}.evil.example?x=1`, `${AUTH}`, "//evil.example"]) {
      h.startImpl = async () => ({ kind: "authorize", url, cookieValue: STATE, maxAgeSeconds: 600 });
      const res = await (await startRoute()).POST(startReq());
      expectResultLocation(res, "unexpected");
      expect(cookies(res)).toEqual([]);
    }
  });

  for (const result of ["denied", "invalid_request", "state_limit", "version_conflict", "connection_revoked", "connection_not_found", "start_unknown"]) {
    it(`result ${result} → 고정 경로 303, 쿠키 없음`, async () => {
      h.startImpl = async () => ({ kind: "result", result });
      const res = await (await startRoute()).POST(startReq());
      expectResultLocation(res, result);
      expect(cookies(res)).toEqual([]);
    });
  }

  it("flow 예외 → unexpected(예외 메시지 미노출)", async () => {
    h.startImpl = async () => { throw new Error("secret-ish boom"); };
    const res = await (await startRoute()).POST(startReq());
    expectResultLocation(res, "unexpected");
    expect(JSON.stringify([...res.headers.entries()])).not.toContain("boom");
  });

  it("deps 조립 예외 → unexpected, flow 0회", async () => {
    h.depsThrows = true;
    const res = await (await startRoute()).POST(startReq());
    expectResultLocation(res, "unexpected");
    expect(h.startCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- callback
describe("callback 라우트 — 공개 메서드", () => {
  it("GET만 내보낸다", async () => {
    const m = (await callbackRoute()) as Record<string, unknown>;
    expect(typeof m.GET).toBe("function");
    for (const k of ["POST", "PUT", "PATCH", "DELETE"]) expect(m[k]).toBeUndefined();
  });
});

describe("callback 라우트 — 입력 전달", () => {
  it("state·code·error 쿼리와 Instagram 전용 쿠키 값을 정확히 전달(같은 deps)", async () => {
    await (await callbackRoute()).GET(cbReq(`?state=${STATE}&code=AQBcode123456&error=`, `${COOKIE}=${STATE}`));
    expect(h.cbCalls).toHaveLength(1);
    expect(h.cbCalls[0]?.deps).toBe(h.deps);
    expect(h.cbCalls[0]?.input).toEqual({ state: STATE, code: "AQBcode123456", error: "", cookieState: STATE });
  });

  it("쿼리·쿠키가 없으면 모두 null로 전달(빈 문자열로 바꾸지 않음)", async () => {
    await (await callbackRoute()).GET(cbReq(""));
    expect(h.cbCalls[0]?.input).toEqual({ state: null, code: null, error: null, cookieState: null });
  });

  it("Threads 쿠키만 있으면 cookieState null(채널 쿠키 분리)", async () => {
    await (await callbackRoute()).GET(cbReq(`?state=${STATE}&code=x`, `__Host-dist-threads-oauth=${STATE}`));
    expect(h.cbCalls[0]?.input.cookieState).toBeNull();
  });

  it("공급자 취소 쿼리(error·error_reason·error_description)에서 error 값만 전달", async () => {
    await (await callbackRoute()).GET(cbReq(`?state=${STATE}&error=access_denied&error_reason=user_denied&error_description=The+user+denied+your+request`, `${COOKIE}=${STATE}`));
    expect(h.cbCalls[0]?.input).toEqual({ state: STATE, code: null, error: "access_denied", cookieState: STATE });
  });
});

describe("callback 라우트 — 응답·쿠키 삭제·누출 방지", () => {
  const ALL = [
    "connected", "reconnected", "cancelled", "provider_error", "permission_missing", "denied", "not_ready", "invalid_request",
    "state_invalid", "state_used", "state_expired", "state_limit", "version_conflict", "connection_revoked", "connection_not_found",
    "exchange_failed", "exchange_unknown", "account_mismatch", "already_connected", "save_failed", "save_unknown", "start_unknown", "unexpected",
  ];
  for (const result of ALL) {
    it(`flow 결과 ${result} → 303 고정 경로 + state 쿠키 삭제`, async () => {
      h.cbImpl = async () => result;
      const res = await (await callbackRoute()).GET(cbReq(`?state=${STATE}&code=c0de0000000`, `${COOKIE}=${STATE}`));
      expectResultLocation(res, result);
      expect(cookies(res)).toEqual([CLEAR]);
    });
  }

  it("flow 예외 → unexpected + 쿠키 삭제(예외 메시지 미노출)", async () => {
    h.cbImpl = async () => { throw new Error("token=EAAC secret boom"); };
    const res = await (await callbackRoute()).GET(cbReq(`?state=${STATE}&code=x`, `${COOKIE}=${STATE}`));
    expectResultLocation(res, "unexpected");
    expect(cookies(res)).toEqual([CLEAR]);
    expect(JSON.stringify([...res.headers.entries()])).not.toMatch(/boom|EAAC/);
  });

  it("deps 조립 예외 → unexpected + 쿠키 삭제, flow 0회", async () => {
    h.depsThrows = true;
    const res = await (await callbackRoute()).GET(cbReq(`?state=${STATE}`));
    expectResultLocation(res, "unexpected");
    expect(cookies(res)).toEqual([CLEAR]);
    expect(h.cbCalls).toHaveLength(0);
  });

  it("외부 쿼리의 code·token·secret·error_description·state가 Location·헤더·본문에 실리지 않음", async () => {
    const secrets = { code: "AQBleakcode9999", access_token: "EAACleaktoken", client_secret: "leaksecret0123456789", error_description: "Leaky+Description", state: STATE };
    h.cbImpl = async () => "provider_error";
    const qs = `?${new URLSearchParams({ ...secrets, error: "server_error" }).toString()}`;
    const res = await (await callbackRoute()).GET(cbReq(qs, `${COOKIE}=${STATE}`));
    expectResultLocation(res, "provider_error");
    const dump = JSON.stringify([...res.headers.entries()]) + (await res.text());
    for (const v of [secrets.code, secrets.access_token, secrets.client_secret, "Leaky", STATE, "server_error"]) expect(dump).not.toContain(v);
  });
});
