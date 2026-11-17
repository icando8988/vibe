/**
 * AUTOPOST-THREADS-OAUTH-019 — OAuth 설정·state·공급자 교환·흐름·라우트 응답 단위 검증(mock HTTP·mock RPC).
 * 실제 Threads/Meta 호출 없음. 시험 키·secret·토큰은 실행마다 randomBytes로 만든 임시 값.
 * 비밀 문자열은 단언 값으로 쓰지 않는다(includes → boolean, equals만).
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { decryptCredential } from "@/server/distribution/connections/crypto";
import { loadThreadsOAuthConfig, parseSiteOrigin } from "@/server/distribution/threads/oauth/config";
import { THREADS_AUTHORIZE_URL, THREADS_LONG_LIVED_URL, THREADS_TOKEN_URL } from "@/server/distribution/threads/oauth/endpoints";
import { handleThreadsCallback, startThreadsConnect, type OAuthDeps } from "@/server/distribution/threads/oauth/flow";
import { authorizeResponse, resultResponse, sameSiteOrigin } from "@/server/distribution/threads/oauth/http";
import { buildAuthorizeUrl, exchangeCode, exchangeLongLived, normalizeAuthCode } from "@/server/distribution/threads/oauth/provider";
import { generateOAuthState, hashOAuthState, OAUTH_STATE_COOKIE, sameOAuthState } from "@/server/distribution/threads/oauth/state";
import type { ThreadsHttpDeps } from "@/server/distribution/threads/types";
import type { RpcClient } from "@/server/distribution/write-runner";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const CONN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET = randomBytes(16).toString("hex");
const SHORT = `THshort_${randomBytes(16).toString("hex")}`;
const LONG = `THlong_${randomBytes(20).toString("hex")}`;
const CODE = `AQ${randomBytes(24).toString("hex")}`;
const USER_ID = "17841405793187218"; // > Number.MAX_SAFE_INTEGER — 문자열로 보존돼야 함
const ENV = {
  THREADS_APP_ID: "1234567890123",
  THREADS_APP_SECRET: SECRET,
  DISTRIBUTION_TOKEN_KEY: `v1:${randomBytes(32).toString("base64")}`,
  NEXT_PUBLIC_SITE_URL: "https://vibe.example",
};
const has = (x: unknown, s: string) => JSON.stringify(x).includes(s);

type Call = { url: string; init: RequestInit };
function http(responses: Array<{ status: number; text: string } | "timeout" | "network">) {
  const calls: Call[] = [];
  let i = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r === "network") throw new TypeError(`fetch failed ${url}`);
    if (r === "timeout") return new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    if (!r) throw new Error("no response");
    return new Response(r.text, { status: r.status });
  });
  return { deps: { fetch, timeoutMs: 30 } as ThreadsHttpDeps, calls, fetch };
}
const tokenOk = { status: 200, text: `{"access_token":"${SHORT}","token_type":"bearer","user_id":${USER_ID}}` };
const longOk = { status: 200, text: `{"access_token":"${LONG}","token_type":"bearer","expires_in":5183944}` };

describe("설정·state", () => {
  it("설정 준비 판정: 빠진 이름만, 값 없음", () => {
    const r = loadThreadsOAuthConfig({ ...ENV, THREADS_APP_SECRET: undefined, NEXT_PUBLIC_SITE_URL: "http://vibe.example" });
    expect(r).toEqual({ status: "not_ready", missing: ["THREADS_APP_SECRET", "NEXT_PUBLIC_SITE_URL"] });
    const ok = loadThreadsOAuthConfig(ENV);
    expect(ok.status === "ok" && ok.config.redirectUri).toBe("https://vibe.example/api/distribution/oauth/threads/callback");
    expect(has(ok, SECRET)).toBe(false); // secret은 SecretToken으로 가려짐
    expect(loadThreadsOAuthConfig({ ...ENV, DISTRIBUTION_TOKEN_KEY: "bad" }).status).toBe("not_ready");
  });
  it("SITE_URL은 https origin만(경로·쿼리·자격정보 거부)", () => {
    expect(parseSiteOrigin("https://vibe.example/")).toBe("https://vibe.example");
    for (const bad of ["https://vibe.example/x", "https://u:p@vibe.example", "https://vibe.example/?a=1", "javascript:alert(1)", ""]) expect(parseSiteOrigin(bad)).toBeNull();
  });
  it("state: 256bit base64url, 매번 다름, 해시만 DB로, 상수 시간 비교", () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(hashOAuthState(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(sameOAuthState(a, a)).toBe(true);
    expect(sameOAuthState(a, b)).toBe(false);
    expect(sameOAuthState(a, null)).toBe(false);
    expect(sameOAuthState(ADMIN, ADMIN)).toBe(false); // user id 같은 형식은 state가 아님
  });
});

describe("공급자 교환(mock HTTP)", () => {
  it("인증 URL: 공식 호스트·쉼표 scope·response_type=code·state", () => {
    const u = new URL(buildAuthorizeUrl({ appId: "1234567890123", redirectUri: "https://vibe.example/cb", state: "S" }));
    expect(`${u.origin}${u.pathname}`).toBe(THREADS_AUTHORIZE_URL);
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: "1234567890123", redirect_uri: "https://vibe.example/cb", scope: "threads_basic,threads_content_publish", response_type: "code", state: "S" });
  });
  it("code 정리: '#_' 제거, 형식 오류 null", () => {
    expect(normalizeAuthCode(`${CODE}#_`)).toBe(CODE);
    expect(normalizeAuthCode("a b")).toBeNull();
    expect(normalizeAuthCode(undefined)).toBeNull();
  });
  it("코드 교환: POST 본문(URL에 secret·code 없음) 1회, user_id 문자열 보존, 토큰은 가려짐", async () => {
    const cfg = loadThreadsOAuthConfig(ENV);
    if (cfg.status !== "ok") throw new Error("cfg");
    const { deps, calls } = http([tokenOk]);
    const r = await exchangeCode(deps, { appId: "1234567890123", appSecret: cfg.config.appSecret, redirectUri: "https://vibe.example/cb", code: CODE });
    expect(r.ok && r.userId).toBe(USER_ID);
    expect(r.ok && r.shortToken.equals(SHORT)).toBe(true);
    expect(has(r, SHORT)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(THREADS_TOKEN_URL);
    expect(calls[0]?.url.includes(SECRET) || calls[0]?.url.includes(CODE)).toBe(false);
    const body = new URLSearchParams(String(calls[0]?.init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code") === CODE && body.get("client_secret") === SECRET).toBe(true);
    expect(calls[0]?.init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
  });
  it("코드 교환 실패: 4xx rejected, timeout·network·5xx·형식 오류 unknown, 재시도 없음", async () => {
    const cfg = loadThreadsOAuthConfig(ENV);
    if (cfg.status !== "ok") throw new Error("cfg");
    const input = { appId: cfg.config.appId, appSecret: cfg.config.appSecret, redirectUri: cfg.config.redirectUri, code: CODE };
    expect(await exchangeCode(http([{ status: 400, text: '{"error":{"message":"Matching code was not found or was already used","code":100}}' }]).deps, input)).toEqual({ ok: false, failure: { kind: "rejected", httpStatus: 400, providerCode: 100 } });
    for (const r of ["timeout", "network", { status: 502, text: "" }, { status: 200, text: "{}" }] as const) {
      const h = http([r]);
      const out = await exchangeCode(h.deps, input);
      expect(out.ok === false && out.failure.kind).toBe("unknown");
      expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(has(out, SECRET) || has(out, CODE)).toBe(false);
    }
  });
  it("장기 토큰: 문서 규격 GET th_exchange_token, expires_in 범위 검사", async () => {
    const cfg = loadThreadsOAuthConfig(ENV);
    if (cfg.status !== "ok") throw new Error("cfg");
    const { deps, calls } = http([longOk]);
    const { SecretToken } = await import("@/server/distribution/connections/crypto");
    const r = await exchangeLongLived(deps, { appSecret: cfg.config.appSecret, shortToken: new SecretToken(SHORT) });
    expect(r.ok && r.expiresInSeconds).toBe(5183944);
    expect(r.ok && r.token.equals(LONG)).toBe(true);
    const u = new URL(calls[0]?.url ?? "");
    expect(`${u.origin}${u.pathname}`).toBe(THREADS_LONG_LIVED_URL);
    expect(u.searchParams.get("grant_type")).toBe("th_exchange_token");
    expect(calls[0]?.init.method).toBe("GET");
    expect((await exchangeLongLived(http([{ status: 200, text: `{"access_token":"${LONG}","expires_in":10}` }]).deps, { appSecret: cfg.config.appSecret, shortToken: new SecretToken(SHORT) })).ok).toBe(false);
  });
});

describe("흐름(mock RPC + mock HTTP)", () => {
  const allowed = async (): Promise<ActorResult> => ({ ok: true, actorId: ADMIN });
  const deniedActor = async (): Promise<ActorResult> => ({ ok: false, reason: "not_approved" });
  type Rpc = (fn: string, p: Record<string, unknown>) => { data: unknown; error: unknown };
  const rpcOf = (impl: Rpc) => {
    const rpc = vi.fn(async (fn: string, p: Record<string, unknown>) => impl(fn, p));
    return { c: { rpc } as unknown as RpcClient, rpc };
  };
  const STATE = generateOAuthState();
  const meta = (o: Record<string, unknown> = {}) => ({
    id: CONN, channel: "threads", provider_account_id: USER_ID, account_label: null, scopes: ["threads_basic", "threads_content_publish"],
    status: "connected", reauth_reason: null, expires_at: "2099-01-01T00:00:00.000Z", key_version: 1, row_version: 1,
    created_at: "2026-11-17T00:00:00.000Z", updated_at: "2026-11-17T00:00:00.000Z", revoked_at: null, ...o,
  });
  const consumed = (o: Record<string, unknown> = {}) => ({ data: { id: CONN, channel: "threads", target_connection_id: null, target_row_version: null, target_provider_account_id: null, ...o }, error: null });
  const deps = (rpc: RpcClient, h: ThreadsHttpDeps, o: Partial<OAuthDeps> = {}): OAuthDeps => ({
    resolveActor: allowed, getClient: () => rpc, getConfig: () => loadThreadsOAuthConfig(ENV), http: h, generateState: () => STATE, now: () => Date.parse("2026-11-17T00:00:00Z"), ...o,
  });

  it("start: D1·설정 없으면 RPC 0회, 정상이면 해시만 등록하고 인증 URL·쿠키 값", async () => {
    const r = rpcOf(() => ({ data: { id: CONN, expires_at: "x" }, error: null }));
    const h = http([]);
    expect(await startThreadsConnect(deps(r.c, h.deps, { resolveActor: deniedActor }))).toEqual({ kind: "result", result: "denied" });
    expect(await startThreadsConnect(deps(r.c, h.deps, { getConfig: () => ({ status: "not_ready", missing: ["THREADS_APP_ID"] }) }))).toEqual({ kind: "result", result: "not_ready" });
    expect(r.rpc).not.toHaveBeenCalled();
    const out = await startThreadsConnect(deps(r.c, h.deps));
    expect(out.kind).toBe("authorize");
    if (out.kind !== "authorize") return;
    expect(out.cookieValue).toBe(STATE);
    expect(new URL(out.url).searchParams.get("state")).toBe(STATE);
    const p = (r.rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0]?.[1] ?? {};
    expect(p).toMatchObject({ p_actor_id: ADMIN, p_channel: "threads", p_state_hash: hashOAuthState(STATE), p_ttl_seconds: 600, p_target_connection_id: null });
    expect(has(p, STATE)).toBe(false);
    expect(h.fetch).not.toHaveBeenCalled(); // start는 공급자를 부르지 않는다
  });
  it("start 재연결: 대상 id·렌더 version 묶음, 형식 오류 invalid_request", async () => {
    const r = rpcOf(() => ({ data: { id: CONN }, error: null }));
    await startThreadsConnect(deps(r.c, http([]).deps), { connectionId: CONN, expectedVersion: "3" });
    expect((r.rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0]?.[1]).toMatchObject({ p_target_connection_id: CONN, p_target_row_version: 3 });
    expect(await startThreadsConnect(deps(r.c, http([]).deps), { connectionId: CONN, expectedVersion: "x" })).toEqual({ kind: "result", result: "invalid_request" });
  });

  it("callback 정상: 쿠키=쿼리 state → 소비 → 교환 2회 → 새 연결 저장(봉투만, user_id 문자열)", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const r = rpcOf((fn, p) => {
      calls.push([fn, p]);
      return fn === "distribution_consume_oauth_state" ? consumed() : { data: meta(), error: null };
    });
    const h = http([tokenOk, longOk]);
    const result = await handleThreadsCallback(deps(r.c, h.deps), { state: STATE, code: `${CODE}#_`, error: null, cookieState: STATE });
    expect(result).toBe("connected");
    expect(calls.map((c) => c[0])).toEqual(["distribution_consume_oauth_state", "distribution_create_channel_connection"]);
    const save = calls[1]?.[1] ?? {};
    expect(save.p_provider_account_id).toBe(USER_ID);
    expect(has(save, LONG) || has(save, SHORT) || has(save, SECRET) || has(save, CODE)).toBe(false);
    const cfg = loadThreadsOAuthConfig(ENV);
    if (cfg.status !== "ok") throw new Error("cfg");
    const dec = decryptCredential(cfg.config.keyring, { ownerId: ADMIN, channel: "threads", providerAccountId: USER_ID }, { keyVersion: save.p_key_version as number, aadVersion: 1, ciphertext: save.p_ciphertext as string, nonce: save.p_nonce as string, tag: save.p_tag as string });
    expect(dec.ok && dec.token.equals(LONG)).toBe(true); // 장기 토큰만 저장
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
  it("callback: 쿠키 불일치·없음 → state_invalid, 소비·교환 0회", async () => {
    const r = rpcOf(() => consumed());
    const h = http([tokenOk]);
    expect(await handleThreadsCallback(deps(r.c, h.deps), { state: STATE, code: CODE, error: null, cookieState: generateOAuthState() })).toBe("state_invalid");
    expect(await handleThreadsCallback(deps(r.c, h.deps), { state: STATE, code: CODE, error: null, cookieState: null })).toBe("state_invalid");
    expect(r.rpc).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("callback: 재사용·만료·D1·준비 전 → 교환 0회", async () => {
    const h = http([tokenOk]);
    const err = (msg: string, code = "23514") => rpcOf(() => ({ data: null, error: { code, message: msg } })).c;
    expect(await handleThreadsCallback(deps(err("OAUTH_STATE_USED: x"), h.deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("state_used");
    expect(await handleThreadsCallback(deps(err("OAUTH_STATE_EXPIRED: x"), h.deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("state_expired");
    expect(await handleThreadsCallback(deps(err("actor is not", "42501"), h.deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("denied");
    expect(await handleThreadsCallback(deps(err("x"), h.deps, { resolveActor: deniedActor }), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("denied");
    expect(await handleThreadsCallback(deps(err("x"), h.deps, { getConfig: () => ({ status: "not_ready", missing: [] }) }), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("not_ready");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("callback: 공급자 오류·취소 → state 소비 후 교환 없음", async () => {
    const r = rpcOf(() => consumed());
    const h = http([tokenOk]);
    expect(await handleThreadsCallback(deps(r.c, h.deps), { state: STATE, code: null, error: "access_denied", cookieState: STATE })).toBe("cancelled");
    expect(await handleThreadsCallback(deps(r.c, h.deps), { state: STATE, code: CODE, error: "server_error", cookieState: STATE })).toBe("provider_error");
    expect(r.rpc).toHaveBeenCalledTimes(2);
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("callback: 교환 거절·응답 유실 → 저장 없음, 재요청 없음", async () => {
    for (const [resp, want] of [[{ status: 400, text: '{"error":{"code":100}}' }, "exchange_failed"], ["timeout", "exchange_unknown"]] as const) {
      const r = rpcOf(() => consumed());
      const h = http([resp]);
      expect(await handleThreadsCallback(deps(r.c, h.deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe(want);
      expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(r.rpc).toHaveBeenCalledTimes(1); // 소비만, 저장 없음
    }
    // 장기 토큰 단계 실패
    const r2 = rpcOf(() => consumed());
    expect(await handleThreadsCallback(deps(r2.c, http([tokenOk, "network"]).deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("exchange_unknown");
    expect(r2.rpc).toHaveBeenCalledTimes(1);
  });
  it("callback 재연결: 같은 계정만 저장(같은 id·렌더 version), 다른 계정은 저장 없이 account_mismatch", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const same = rpcOf((fn, p) => {
      calls.push([fn, p]);
      return fn === "distribution_consume_oauth_state" ? consumed({ target_connection_id: CONN, target_row_version: 4, target_provider_account_id: USER_ID }) : { data: meta({ row_version: 5 }), error: null };
    });
    expect(await handleThreadsCallback(deps(same.c, http([tokenOk, longOk]).deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("reconnected");
    expect(calls[1]?.[0]).toBe("distribution_reconnect_channel_connection");
    expect(calls[1]?.[1]).toMatchObject({ p_connection_id: CONN, p_expected_version: 4, p_provider_account_id: USER_ID });

    const other = rpcOf((fn) => (fn === "distribution_consume_oauth_state" ? consumed({ target_connection_id: CONN, target_row_version: 4, target_provider_account_id: "17841400000000001" }) : { data: meta(), error: null }));
    expect(await handleThreadsCallback(deps(other.c, http([tokenOk, longOk]).deps), { state: STATE, code: CODE, error: null, cookieState: STATE })).toBe("account_mismatch");
    expect(other.rpc).toHaveBeenCalledTimes(1);
  });
  it("callback 저장 결과: 이미 연결된 계정·응답 유실·철회·버전 충돌", async () => {
    const run = async (saveResp: { data: unknown; error: unknown } | "throw", target = false) => {
      const r = rpcOf((fn) => {
        if (fn === "distribution_consume_oauth_state") return consumed(target ? { target_connection_id: CONN, target_row_version: 2, target_provider_account_id: USER_ID } : {});
        if (saveResp === "throw") throw new Error("lost");
        return saveResp;
      });
      return handleThreadsCallback(deps(r.c, http([tokenOk, longOk]).deps), { state: STATE, code: CODE, error: null, cookieState: STATE });
    };
    expect(await run({ data: null, error: { code: "23505", message: "DUPLICATE: active" } })).toBe("already_connected");
    expect(await run("throw")).toBe("save_unknown");
    expect(await run({ data: { weird: 1 }, error: null })).toBe("save_unknown");
    expect(await run({ data: null, error: { code: "23514", message: "ALREADY_REVOKED: x" } }, true)).toBe("connection_revoked");
    expect(await run({ data: null, error: { code: "P0001", message: "VERSION_CONFLICT: x" } }, true)).toBe("version_conflict");
  });
});

describe("라우트 응답", () => {
  it("결과 이동은 고정 내부 경로·코드만, no-store·no-referrer, 쿠키 삭제", () => {
    const r = resultResponse("state_invalid", { clearCookie: true });
    expect(r.status).toBe(303);
    expect(r.headers.get("Location")).toBe("/admin/distribution/connections/threads?result=state_invalid");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(r.headers.get("Set-Cookie")).toContain(`${OAUTH_STATE_COOKIE}=; Path=/; Max-Age=0`);
  });
  it("인증 이동: 고정 인증 URL만, 쿠키 HttpOnly·Secure·SameSite=Lax·__Host-", () => {
    const state = generateOAuthState();
    const ok = authorizeResponse(buildAuthorizeUrl({ appId: "1234567890123", redirectUri: "https://vibe.example/cb", state }), state, 600);
    const c = ok.headers.get("Set-Cookie") ?? "";
    expect(c.startsWith("__Host-dist-threads-oauth=")).toBe(true);
    for (const a of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=600"]) expect(c).toContain(a);
    expect(c.includes("Domain")).toBe(false);
    const bad = authorizeResponse("https://evil.example/?x=1", state, 600);
    expect(bad.headers.get("Location")).toBe("/admin/distribution/connections/threads?result=unexpected");
    expect(bad.headers.get("Set-Cookie")).toBeNull();
  });
  it("CSRF: Origin 정확히 일치만", () => {
    expect(sameSiteOrigin("https://vibe.example", "https://vibe.example")).toBe(true);
    expect(sameSiteOrigin("https://evil.example", "https://vibe.example")).toBe(false);
    expect(sameSiteOrigin(null, "https://vibe.example")).toBe(false);
  });
});
