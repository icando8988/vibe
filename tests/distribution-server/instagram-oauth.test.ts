/**
 * BE-INSTAGRAM-OAUTH-043 — Instagram Business Login 설정·공급자 파싱·흐름·라우트 응답 단위 검증(mock HTTP·mock RPC).
 * 실제 Instagram/Meta 호출 없음(fake https 공급자만). 시험 secret·토큰은 실행마다 randomBytes. 비밀 문자열은 단언 값으로 쓰지 않는다.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { loadInstagramOAuthConfig } from "@/server/distribution/instagram/oauth/config";
import {
  INSTAGRAM_AUTHORIZE_URL, INSTAGRAM_CALLBACK_PATH, INSTAGRAM_CONNECTIONS_PAGE, INSTAGRAM_LONG_LIVED_URL, INSTAGRAM_REQUESTED_SCOPES, INSTAGRAM_TOKEN_URL,
} from "@/server/distribution/instagram/oauth/endpoints";
import { handleInstagramCallback, INSTAGRAM_OAUTH_RESULTS, parseInstagramOAuthResult, startInstagramConnect, type InstagramOAuthDeps } from "@/server/distribution/instagram/oauth/flow";
import { authorizeResponse, resultResponse, sameSiteOrigin } from "@/server/distribution/instagram/oauth/http";
import { buildAuthorizeUrl, exchangeCode, exchangeLongLived, normalizeAuthCode } from "@/server/distribution/instagram/oauth/provider";
import { hashOAuthState, INSTAGRAM_STATE_COOKIE } from "@/server/distribution/instagram/oauth/state";
import type { IgHttpDeps } from "@/server/distribution/instagram/types";
import { OAUTH_RESULTS } from "@/server/distribution/threads/oauth/flow";
import { OAUTH_STATE_COOKIE } from "@/server/distribution/threads/oauth/state";
import type { RpcClient } from "@/server/distribution/write-runner";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const CONN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STATE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET = randomBytes(16).toString("hex");
const SHORT = `IGshort_${randomBytes(16).toString("hex")}`;
const LONG = `IGlong_${randomBytes(20).toString("hex")}`;
const CODE = `AQ${randomBytes(24).toString("hex")}`;
const USER_ID = "17841405793187218"; // > MAX_SAFE_INTEGER — 문자열 보존
const STATE = "S".repeat(43);
const ENV = {
  INSTAGRAM_APP_ID: "990602627938098",
  INSTAGRAM_APP_SECRET: SECRET,
  DISTRIBUTION_TOKEN_KEY: `v1:${randomBytes(32).toString("base64")}`,
  NEXT_PUBLIC_SITE_URL: "https://vibe.example",
};
const has = (x: unknown, s: string) => JSON.stringify(x).includes(s);
const PERMS = "instagram_business_basic,instagram_business_content_publish";

type Resp = { status: number; text: string } | "timeout" | "network";
function http(responses: Resp[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r === "network") throw new TypeError(`fetch failed ${url}`);
    if (r === "timeout") return new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    if (!r) throw new Error("no response");
    return new Response(r.text, { status: r.status });
  });
  return { deps: { fetch, timeoutMs: 30 } as IgHttpDeps, calls, fetch };
}
const codeOk = (perms = PERMS, uid: string = `"${USER_ID}"`) => ({ status: 200, text: `{"data":[{"access_token":"${SHORT}","user_id":${uid},"permissions":"${perms}"}]}` });
const longOk = { status: 200, text: `{"access_token":"${LONG}","token_type":"bearer","expires_in":5183944}` };

function rpcMock(map: Record<string, (p: Record<string, unknown>) => { data: unknown; error: unknown }>) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const client: RpcClient = {
    rpc: async (fn, p) => {
      calls.push([fn, p]);
      const h = map[fn];
      return h ? h(p) : { data: null, error: { code: "XX000", message: "unexpected" } };
    },
  };
  return { client, calls, names: () => calls.map(([n]) => n) };
}
const allowed = async (): Promise<ActorResult> => ({ ok: true, actorId: ADMIN });
const deps = (client: RpcClient | null, h: IgHttpDeps, env: Record<string, string | undefined> = ENV): InstagramOAuthDeps => ({
  resolveActor: allowed, getClient: () => client, getConfig: () => loadInstagramOAuthConfig(env), http: h, generateState: () => STATE, now: () => Date.parse("2026-11-17T00:00:00Z"),
});
const consumedOk = (over: Record<string, unknown> = {}) => () => ({ data: { id: STATE_ID, channel: "instagram", target_connection_id: null, target_row_version: null, target_provider_account_id: null, ...over }, error: null });
const savedConn = (p: Record<string, unknown>) => ({
  data: { id: CONN, channel: "instagram", provider_account_id: p.p_provider_account_id, account_label: null, scopes: p.p_scopes, status: "connected", reauth_reason: null,
    expires_at: p.p_expires_at, key_version: 1, row_version: 1, created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z", revoked_at: null, has_credential: true },
  error: null,
});

describe("설정·경로·result 목록", () => {
  it("env 이름만 보고(값 없음), redirect URI 고정, Threads와 다른 쿠키 이름", () => {
    expect(loadInstagramOAuthConfig({ ...ENV, INSTAGRAM_APP_SECRET: undefined, INSTAGRAM_APP_ID: "abc" })).toEqual({ status: "not_ready", missing: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"] });
    expect(loadInstagramOAuthConfig({}).status === "not_ready" && (loadInstagramOAuthConfig({}) as { missing: string[] }).missing).toEqual(["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "DISTRIBUTION_TOKEN_KEY", "NEXT_PUBLIC_SITE_URL"]);
    const ok = loadInstagramOAuthConfig(ENV);
    expect(ok.status === "ok" && ok.config.redirectUri).toBe(`https://vibe.example${INSTAGRAM_CALLBACK_PATH}`);
    expect(has(ok, SECRET)).toBe(false);
    expect(INSTAGRAM_STATE_COOKIE).toBe("__Host-dist-instagram-oauth");
    expect(INSTAGRAM_STATE_COOKIE).not.toBe(OAUTH_STATE_COOKIE);
  });
  it("result 목록 = Threads 22개 + permission_missing, 파서는 허용 목록만", () => {
    expect([...INSTAGRAM_OAUTH_RESULTS].sort()).toEqual([...OAUTH_RESULTS, "permission_missing"].sort());
    expect(parseInstagramOAuthResult("connected")).toBe("connected");
    expect(parseInstagramOAuthResult("javascript:x")).toBeNull();
  });
});

describe("공급자(공식 규격)", () => {
  it("authorize URL: www.instagram.com, client_id·redirect_uri·response_type=code·scope 2개(쉼표)·state, 선택값 없음", () => {
    const u = new URL(buildAuthorizeUrl({ appId: ENV.INSTAGRAM_APP_ID, redirectUri: "https://vibe.example/cb", state: STATE }));
    expect(`${u.origin}${u.pathname}`).toBe(INSTAGRAM_AUTHORIZE_URL);
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: ENV.INSTAGRAM_APP_ID, redirect_uri: "https://vibe.example/cb", response_type: "code", scope: INSTAGRAM_REQUESTED_SCOPES.join(","), state: STATE });
  });
  it("code: '#_' 제거, 형식 오류 null", () => {
    expect(normalizeAuthCode(`${CODE}#_`)).toBe(CODE);
    for (const bad of [null, "", "short", "a b c d e f g h", 7]) expect(normalizeAuthCode(bad)).toBeNull();
  });
  it("QA-045 M-2: user_id는 원문에서 정확 추출 — JSON number(>2^53)와 따옴표 문자열 모두 자리수 손실 없이 같은 문자열", async () => {
    const big = "9007199254740993"; // 2^53+1 — Number(big)는 ...992가 된다(정밀도 손실)
    expect(String(Number(big))).not.toBe(big);
    for (const raw of [big, `"${big}"`, USER_ID, `"${USER_ID}"`]) {
      const want = raw.replace(/"/g, "");
      const r = await exchangeCode(http([codeOk(PERMS, raw)]).deps, { appId: "1", appSecret: { reveal: () => SECRET }, redirectUri: "https://x.example/cb", code: CODE });
      expect(r.ok && r.userId).toBe(want);
    }
    for (const raw of [big, `"${big}"`]) {
      const r = await exchangeCode(http([codeOk(PERMS, raw)]).deps, { appId: "1", appSecret: { reveal: () => SECRET }, redirectUri: "https://x.example/cb", code: CODE });
      expect(r.ok && r.userId).toBe(big);
    }
    const short = await exchangeCode(http([codeOk(PERMS, '"1020"')]).deps, { appId: "1", appSecret: { reveal: () => SECRET }, redirectUri: "https://x.example/cb", code: CODE });
    expect(short.ok && short.userId).toBe("1020");
  });
  it("QA-045 M-1: permissions가 유효 목록인데 필수 scope 누락 → permission_missing / permissions 필드 누락·형식 오류 → exchange_unknown(둘 다 저장·장기 토큰 0)", async () => {
    const cases: Array<[string, string]> = [
      [`{"data":[{"access_token":"${SHORT}","user_id":"${USER_ID}","permissions":"instagram_business_basic"}]}`, "permission_missing"],
      [`{"data":[{"access_token":"${SHORT}","user_id":"${USER_ID}"}]}`, "exchange_unknown"],
      [`{"data":[{"access_token":"${SHORT}","user_id":"${USER_ID}","permissions":["instagram_business_basic","instagram_business_content_publish"]}]}`, "exchange_unknown"],
      [`{"data":[{"access_token":"${SHORT}","user_id":"${USER_ID}","permissions":""}]}`, "exchange_unknown"],
      [`{"data":[{"access_token":"${SHORT}","user_id":"${USER_ID}","permissions":"Bad Scope"}]}`, "exchange_unknown"],
    ];
    for (const [text, result] of cases) {
      const rpc = rpcMock({ distribution_consume_oauth_state: consumedOk() });
      const h = http([{ status: 200, text }, longOk]);
      expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe(result);
      expect([h.fetch.mock.calls.length, rpc.names()]).toEqual([1, ["distribution_consume_oauth_state"]]);
    }
  });
  it("교환: POST multipart(client_id·secret·grant_type·redirect_uri·code), 제한시간·redirect error·no-store, data[] 파싱, user_id 문자열 보존", async () => {
    const h = http([codeOk(PERMS, USER_ID)]); // 숫자 JSON이어도 원문 문자열로
    const r = await exchangeCode(h.deps, { appId: ENV.INSTAGRAM_APP_ID, appSecret: { reveal: () => SECRET }, redirectUri: "https://vibe.example/cb", code: CODE });
    expect(r.ok && [r.userId, r.permissions]).toEqual([USER_ID, ["instagram_business_basic", "instagram_business_content_publish"]]);
    expect(has(r, SHORT)).toBe(false); // SecretToken
    const call = h.calls[0];
    expect([call?.url, call?.init.method, call?.init.redirect, call?.init.cache]).toEqual([INSTAGRAM_TOKEN_URL, "POST", "error", "no-store"]);
    const body = call?.init.body as FormData;
    expect([...body.keys()].sort()).toEqual(["client_id", "client_secret", "code", "grant_type", "redirect_uri"]);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });
  it("교환 형식 엄격: data 없음·평평한 응답·data 2개·permissions 없음/배열·user_id 중복·토큰 없음 → unknown", async () => {
    const bad = [
      `{"access_token":"${SHORT}","user_id":"${USER_ID}","permissions":"${PERMS}"}`,
      `{"data":[]}`,
      `{"data":[{"access_token":"${SHORT}","user_id":"1","permissions":"${PERMS}"},{"access_token":"${SHORT}","user_id":"2","permissions":"${PERMS}"}]}`,
      `{"data":[{"access_token":"${SHORT}","user_id":"${USER_ID}"}]}`,
      `{"data":[{"access_token":"${SHORT}","user_id":"${USER_ID}","permissions":["instagram_business_basic"]}]}`,
      `{"data":[{"user_id":"${USER_ID}","permissions":"${PERMS}"}]}`,
      `not json`,
    ];
    for (const text of bad) {
      const r = await exchangeCode(http([{ status: 200, text }]).deps, { appId: "1", appSecret: { reveal: () => SECRET }, redirectUri: "https://x.example/cb", code: CODE });
      expect(r.ok === false && r.failure.kind).toBe("unknown");
    }
  });
  it("거절 4xx → rejected(공급자 code만), 5xx·시간초과·네트워크 → unknown, 메시지·secret 비노출, 재시도 없음", async () => {
    const rej = http([{ status: 400, text: `{"error_type":"OAuthException","code":400,"error_message":"Matching code was not found or was already used ${SECRET}"}` }]);
    const r = await exchangeCode(rej.deps, { appId: "1", appSecret: { reveal: () => SECRET }, redirectUri: "https://x.example/cb", code: CODE });
    expect(r).toEqual({ ok: false, failure: { kind: "rejected", httpStatus: 400, providerCode: 400 } });
    for (const resp of [{ status: 500, text: "x" }, "timeout", "network"] as Resp[]) {
      const h = http([resp]);
      const out = await exchangeCode(h.deps, { appId: "1", appSecret: { reveal: () => SECRET }, redirectUri: "https://x.example/cb", code: CODE });
      expect(out.ok === false && out.failure.kind).toBe("unknown");
      expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(has(out, SECRET) || has(out, CODE)).toBe(false);
    }
  });
  it("장기 토큰: GET graph.instagram.com/access_token(ig_exchange_token), expires_in 범위·bearer만", async () => {
    const h = http([longOk]);
    const { SecretToken } = await import("@/server/distribution/connections/crypto");
    const r = await exchangeLongLived(h.deps, { appSecret: { reveal: () => SECRET }, shortToken: new SecretToken(SHORT) });
    expect(r.ok && r.expiresInSeconds).toBe(5183944);
    const u = new URL(h.calls[0]?.url ?? "");
    expect([`${u.origin}${u.pathname}`, u.searchParams.get("grant_type"), h.calls[0]?.init.method]).toEqual([INSTAGRAM_LONG_LIVED_URL, "ig_exchange_token", "GET"]);
    for (const text of [`{"access_token":"${LONG}","expires_in":60}`, `{"access_token":"${LONG}","expires_in":"5183944"}`, `{"access_token":"${LONG}","token_type":"mac","expires_in":5183944}`]) {
      const o = await exchangeLongLived(http([{ status: 200, text }]).deps, { appSecret: { reveal: () => SECRET }, shortToken: new SecretToken(SHORT) });
      expect(o.ok).toBe(false);
    }
  });
});

describe("HARDEN-046 공급자 응답 엄격 경계", () => {
  const ex = (text: string) => exchangeCode(http([{ status: 200, text }]).deps, { appId: "1", appSecret: { reveal: () => SECRET }, redirectUri: "https://x.example/cb", code: CODE });
  const item = (uid: string, tail = "") => `{"data":[{"access_token":"${SHORT}","user_id":${uid}${tail},"permissions":"${PERMS}"}]}`;

  it("user_id 수용: JSON 정수 리터럴(2^53+1 정확 보존·0)·따옴표 숫자 문자열, 값 뒤 공백·, } ] 경계", async () => {
    const cases: Array<[string, string]> = [
      [item("9007199254740993"), "9007199254740993"],
      [item(`"9007199254740993"`), "9007199254740993"],
      [item("0"), "0"],
      [`{"data":[{"access_token":"${SHORT}","permissions":"${PERMS}","user_id": 17841405793187218 }]}`, "17841405793187218"], // 공백 + }
      [`{"data":[{"access_token":"${SHORT}","permissions":"${PERMS}","user_id":"1020"}]}`, "1020"],
    ];
    for (const [text, want] of cases) {
      const r = await ex(text);
      expect(r.ok && r.userId).toBe(want);
    }
  });

  it("user_id 거절 → unknown: 소수·지수·부호·선행 0·잘림·빈 문자열·0개·중복 key·숫자 아닌 문자열·불리언", async () => {
    const bad = [
      item("1020.5"), item("1020e3"), item("1.02E+3"), item("-1020"), item("+1020"), item("01020"),
      item(`"10.20"`), item(`"-1020"`), item(`""`), item(`"abc"`), item("true"), item("null"),
      `{"data":[{"access_token":"${SHORT}","user_id":10`, // 잘림(JSON 깨짐)
      `{"data":[{"access_token":"${SHORT}","permissions":"${PERMS}"}]}`, // 0개
      `{"data":[{"access_token":"${SHORT}","user_id":"1","user_id":"2","permissions":"${PERMS}"}]}`, // 중복 key
      `{"data":[{"access_token":"${SHORT}","user_id":"1","permissions":"${PERMS}","meta":{"user_id":"1"}}]}`, // 다른 위치 중복
    ];
    for (const text of bad) {
      const r = await ex(text);
      expect(r.ok === false && r.failure.kind).toBe("unknown");
    }
  });

  it("흐름: user_id 경계 위반은 exchange_unknown(장기 토큰·저장 0)", async () => {
    for (const uid of ["1020.5", "1020e3", "-1"]) {
      const rpc = rpcMock({ distribution_consume_oauth_state: consumedOk() });
      const h = http([{ status: 200, text: item(uid) }, longOk]);
      expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("exchange_unknown");
      expect([h.fetch.mock.calls.length, rpc.names()]).toEqual([1, ["distribution_consume_oauth_state"]]);
    }
  });

  it("장기 토큰 token_type 필수: 유효 토큰+유효 expires_in이어도 누락·비문자열·non-bearer → unknown, bearer(대소문자 무시)는 유지", async () => {
    const { SecretToken } = await import("@/server/distribution/connections/crypto");
    const ll = (text: string) => exchangeLongLived(http([{ status: 200, text }]).deps, { appSecret: { reveal: () => SECRET }, shortToken: new SecretToken(SHORT) });
    expect((await ll(`{"access_token":"${LONG}","expires_in":5183944}`)).ok).toBe(false); // 누락 단독
    for (const tt of [`null`, `1`, `""`, `"mac"`, `"bearer "`, `["bearer"]`]) {
      const r = await ll(`{"access_token":"${LONG}","token_type":${tt},"expires_in":5183944}`);
      expect(r.ok === false && r.failure.kind).toBe("unknown");
    }
    for (const tt of [`"bearer"`, `"Bearer"`]) expect((await ll(`{"access_token":"${LONG}","token_type":${tt},"expires_in":5183944}`)).ok).toBe(true);
    // 흐름: token_type 누락 장기 토큰 → exchange_unknown, 저장 0
    const rpc = rpcMock({ distribution_consume_oauth_state: consumedOk() });
    const h = http([codeOk(), { status: 200, text: `{"access_token":"${LONG}","expires_in":5183944}` }]);
    expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("exchange_unknown");
    expect(rpc.names()).toEqual(["distribution_consume_oauth_state"]);
  });
});

describe("흐름(start / callback)", () => {
  it("not_ready: 설정·service 없으면 state 등록·공급자 호출 0회", async () => {
    const rpc = rpcMock({});
    const h = http([codeOk()]);
    expect(await startInstagramConnect(deps(rpc.client, h.deps, { ...ENV, INSTAGRAM_APP_ID: undefined }))).toEqual({ kind: "result", result: "not_ready" });
    expect(await startInstagramConnect(deps(null, h.deps))).toEqual({ kind: "result", result: "not_ready" });
    expect(await handleInstagramCallback(deps(rpc.client, h.deps, {}), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("not_ready");
    expect([rpc.calls.length, h.fetch.mock.calls.length]).toEqual([0, 0]);
  });
  it("start: actor·channel instagram·해시·고정 redirect·TTL·재연결 대상 묶음, 입력 오류는 invalid_request(RPC 0)", async () => {
    const rpc = rpcMock({ distribution_create_oauth_state: () => ({ data: { id: STATE_ID, expires_at: "x" }, error: null }) });
    const out = await startInstagramConnect(deps(rpc.client, http([]).deps), { connectionId: CONN, expectedVersion: "3" });
    expect(out.kind === "authorize" && out.url.startsWith(`${INSTAGRAM_AUTHORIZE_URL}?`)).toBe(true);
    expect(rpc.calls[0]?.[1]).toEqual({ p_actor_id: ADMIN, p_channel: "instagram", p_state_hash: hashOAuthState(STATE), p_redirect_uri: `https://vibe.example${INSTAGRAM_CALLBACK_PATH}`, p_ttl_seconds: 600, p_target_connection_id: CONN, p_target_row_version: 3 });
    const none = rpcMock({});
    for (const bad of [{ connectionId: CONN }, { expectedVersion: "1" }, { connectionId: "x", expectedVersion: "1" }, { connectionId: CONN, expectedVersion: "0" }, { connectionId: CONN, expectedVersion: "1.5" }]) {
      expect(await startInstagramConnect(deps(none.client, http([]).deps), bad)).toEqual({ kind: "result", result: "invalid_request" });
    }
    expect(none.calls).toEqual([]);
    const denied = await startInstagramConnect({ ...deps(none.client, http([]).deps), resolveActor: async () => ({ ok: false, reason: "unauthenticated" }) as ActorResult });
    expect(denied).toEqual({ kind: "result", result: "denied" });
  });
  it("start DB 오류 매핑·응답 유실 start_unknown", async () => {
    const cases: Array<[unknown, string]> = [
      [{ code: "P0001", message: "VERSION_CONFLICT: x" }, "version_conflict"], [{ code: "23514", message: "ALREADY_REVOKED: x" }, "connection_revoked"],
      [{ code: "23514", message: "OAUTH_STATE_LIMIT: x" }, "state_limit"], [{ code: "P0002", message: "x" }, "connection_not_found"], [{ code: "42501", message: "x" }, "denied"],
    ];
    for (const [error, result] of cases) {
      const rpc = rpcMock({ distribution_create_oauth_state: () => ({ data: null, error }) });
      expect(await startInstagramConnect(deps(rpc.client, http([]).deps))).toEqual({ kind: "result", result });
    }
    const lost: RpcClient = { rpc: async () => { throw new Error("lost"); } };
    expect(await startInstagramConnect(deps(lost, http([]).deps))).toEqual({ kind: "result", result: "start_unknown" });
  });
  it("callback 성공: state 소비 → 교환 → 장기 토큰 → instagram 저장(계정 문자열·부여 권한·만료), 비밀 비노출", async () => {
    const rpc = rpcMock({ distribution_consume_oauth_state: consumedOk(), distribution_create_channel_connection: savedConn });
    const h = http([codeOk(), longOk]);
    expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: STATE, code: `${CODE}#_`, error: null, cookieState: STATE })).toBe("connected");
    expect(rpc.calls[0]).toEqual(["distribution_consume_oauth_state", { p_actor_id: ADMIN, p_channel: "instagram", p_state_hash: hashOAuthState(STATE), p_redirect_uri: `https://vibe.example${INSTAGRAM_CALLBACK_PATH}` }]);
    const save = rpc.calls.find(([n]) => n === "distribution_create_channel_connection")?.[1] ?? {};
    expect([save.p_channel, save.p_provider_account_id, save.p_scopes, save.p_expires_at]).toEqual(["instagram", USER_ID, [...INSTAGRAM_REQUESTED_SCOPES], new Date(Date.parse("2026-11-17T00:00:00Z") + 5183944000).toISOString()]);
    expect(has(rpc.calls, LONG) || has(rpc.calls, SHORT) || has(rpc.calls, SECRET) || has(rpc.calls, CODE)).toBe(false); // 토큰은 암호문으로만
    expect((h.calls[0]?.init.body as FormData).get("code")).toBe(CODE);
  });
  it("callback: 쿠키 불일치 → 소비 0, 취소 → state 소비 뒤 cancelled(교환 0), 그 밖 error → provider_error, code 형식 오류", async () => {
    const rpc = rpcMock({ distribution_consume_oauth_state: consumedOk() });
    const h = http([codeOk()]);
    expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: STATE, code: CODE, error: null, cookieState: "T".repeat(43) })).toBe("state_invalid");
    expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: STATE, code: CODE, error: null, cookieState: null })).toBe("state_invalid");
    expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: "x", code: null, error: "access_denied", cookieState: null })).toBe("cancelled");
    expect(rpc.calls).toEqual([]);
    expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: STATE, code: CODE, error: "access_denied", cookieState: STATE })).toBe("cancelled");
    expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: STATE, code: CODE, error: "server_error", cookieState: STATE })).toBe("provider_error");
    expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: STATE, code: "bad", error: null, cookieState: STATE })).toBe("invalid_request");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("replay·만료·소비 유실: state_used / state_expired / state_invalid(교환 0)", async () => {
    for (const [resp, result] of [[{ code: "23514", message: "OAUTH_STATE_USED: x" }, "state_used"], [{ code: "23514", message: "OAUTH_STATE_EXPIRED: x" }, "state_expired"], [{ code: "23514", message: "OAUTH_STATE_INVALID: x" }, "state_invalid"]] as const) {
      const rpc = rpcMock({ distribution_consume_oauth_state: () => ({ data: null, error: resp }) });
      const h = http([codeOk()]);
      expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe(result);
      expect(h.fetch).not.toHaveBeenCalled();
    }
    const lost: RpcClient = { rpc: async () => { throw new Error("lost"); } };
    expect(await handleInstagramCallback(deps(lost, http([]).deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("state_invalid");
    const wrongChannel = rpcMock({ distribution_consume_oauth_state: consumedOk({ channel: "threads" }) });
    expect(await handleInstagramCallback(deps(wrongChannel.client, http([]).deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("state_invalid");
  });
  it("부여 권한 누락 → permission_missing(장기 토큰·저장 0), 교환 거절/유실/시간초과 → exchange_failed/unknown(재요청 0)", async () => {
    for (const perms of ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_basic,instagram_business_manage_messages"]) {
      const rpc = rpcMock({ distribution_consume_oauth_state: consumedOk() });
      const h = http([codeOk(perms), longOk]);
      expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("permission_missing");
      expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(rpc.names()).toEqual(["distribution_consume_oauth_state"]);
    }
    for (const [resps, result] of [[[{ status: 400, text: "{}" }], "exchange_failed"], [["timeout"], "exchange_unknown"], [[{ status: 502, text: "" }], "exchange_unknown"], [[codeOk(), { status: 400, text: "{}" }], "exchange_failed"], [[codeOk(), "network"], "exchange_unknown"]] as Array<[Resp[], string]>) {
      const rpc = rpcMock({ distribution_consume_oauth_state: consumedOk() });
      const h = http(resps);
      expect(await handleInstagramCallback(deps(rpc.client, h.deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe(result);
      expect(h.fetch).toHaveBeenCalledTimes(resps.length);
      expect(rpc.names()).toEqual(["distribution_consume_oauth_state"]);
    }
  });
  it("재연결: 같은 계정만 reconnected, 다른 계정 account_mismatch(저장 0), 저장 오류 매핑", async () => {
    const target = { target_connection_id: CONN, target_row_version: 2, target_provider_account_id: USER_ID };
    const ok = rpcMock({ distribution_consume_oauth_state: consumedOk(target), distribution_reconnect_channel_connection: (p) => ({ ...savedConn(p), data: { ...savedConn(p).data, row_version: 3 } }) });
    expect(await handleInstagramCallback(deps(ok.client, http([codeOk(), longOk]).deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("reconnected");
    expect(ok.calls.find(([n]) => n === "distribution_reconnect_channel_connection")?.[1]).toMatchObject({ p_connection_id: CONN, p_expected_version: 2, p_provider_account_id: USER_ID });
    const other = rpcMock({ distribution_consume_oauth_state: consumedOk({ ...target, target_provider_account_id: "17841405793187999" }) });
    expect(await handleInstagramCallback(deps(other.client, http([codeOk(), longOk]).deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("account_mismatch");
    expect(other.names()).toEqual(["distribution_consume_oauth_state"]);
    for (const [error, result] of [[{ code: "23505", message: "DUPLICATE: x" }, "already_connected"], [{ code: "23514", message: "x" }, "save_failed"]] as const) {
      const r = rpcMock({ distribution_consume_oauth_state: consumedOk(), distribution_create_channel_connection: () => ({ data: null, error }) });
      expect(await handleInstagramCallback(deps(r.client, http([codeOk(), longOk]).deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe(result);
    }
    const lostSave: RpcClient = { rpc: async (fn) => { if (fn === "distribution_consume_oauth_state") return consumedOk()(); throw new Error("lost"); } };
    expect(await handleInstagramCallback(deps(lostSave, http([codeOk(), longOk]).deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("save_unknown");
  });
});

describe("라우트 응답 조립", () => {
  it("결과: 303 고정 내부 경로, no-store·no-referrer, callback은 쿠키 삭제", () => {
    const r = resultResponse("connected", { clearCookie: true });
    expect([r.status, r.headers.get("location"), r.headers.get("cache-control"), r.headers.get("referrer-policy")]).toEqual([303, `${INSTAGRAM_CONNECTIONS_PAGE}?result=connected`, "no-store", "no-referrer"]);
    expect(r.headers.get("set-cookie")).toContain(`${INSTAGRAM_STATE_COOKIE}=; Path=/; Max-Age=0`);
  });
  it("인증 이동: 고정 authorize 접두만 + __Host 쿠키(HttpOnly·Secure·Lax), 그 밖 URL은 unexpected", () => {
    const a = authorizeResponse(`${INSTAGRAM_AUTHORIZE_URL}?client_id=1`, STATE, 600);
    expect(a.headers.get("set-cookie")).toBe(`${INSTAGRAM_STATE_COOKIE}=${STATE}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
    expect(authorizeResponse("https://evil.example/oauth/authorize?x", STATE, 600).headers.get("location")).toBe(`${INSTAGRAM_CONNECTIONS_PAGE}?result=unexpected`);
    expect(sameSiteOrigin("https://vibe.example", "https://vibe.example")).toBe(true);
    expect(sameSiteOrigin(null, "https://vibe.example") || sameSiteOrigin("https://evil.example", "https://vibe.example")).toBe(false);
  });
});
