/**
 * Instagram 연결 흐름(start / callback) — 의존성 주입 순수 함수(시험 대상). BE-INSTAGRAM-OAUTH-043.
 * Threads 흐름(threads/oauth/flow.ts, 무수정)과 같은 보안 규칙을 Instagram Business Login 규격에 맞춘 독립 구현.
 *
 * start: 세션 actor + D1 → 재연결 입력 → 서버 설정 → 256bit state → DB에 해시 등록(channel instagram, 짧은 수명, 고정 redirect,
 *        재연결이면 대상 연결 id + 렌더된 row_version) → 쿠키 값 + 공급자 인증 URL.
 * callback: actor + D1 → 설정 → 쿠키 state = 쿼리 state(상수 시간) → DB state 1회 소비 → 공급자 오류·취소 → code 1회 교환
 *        → 실제 부여 권한 검사(요청 2개 모두) → 장기 토큰 → 계정 판정 → M3 암호화 저장(channel instagram).
 * 재연결: 공급자 user_id가 대상 연결 계정과 다르면 저장하지 않는다(account_mismatch).
 * 결과는 허용 목록 코드뿐. state·code·token·secret을 결과·redirect·로그에 싣지 않는다. 어떤 단계도 자동 재요청하지 않는다.
 * 연결 성공 ≠ 게시 가능: 게시 실행기·토큰 갱신·live gate는 이 흐름 밖(미구현/닫힘).
 */
import type { ActorResult } from "../../actor-core";
import { mapDistributionDbError } from "../../errors";
import { isUuid } from "../../validation";
import type { RpcClient, WriteOutcome } from "../../write-runner";
import { reconnectSameAccount, saveNewConnection } from "../../connections/service";
import type { IgHttpDeps } from "../types";
import type { InstagramOAuthConfigResult } from "./config";
import { INSTAGRAM_REQUESTED_SCOPES } from "./endpoints";
import { buildAuthorizeUrl, exchangeCode, exchangeLongLived, normalizeAuthCode } from "./provider";
import { generateOAuthState, hashOAuthState, OAUTH_STATE_TTL_SECONDS, sameOAuthState } from "./state";

export const INSTAGRAM_OAUTH_RPC = Object.freeze({ createState: "distribution_create_oauth_state", consumeState: "distribution_consume_oauth_state" } as const);
const CHANNEL = "instagram";

export const INSTAGRAM_OAUTH_RESULTS = [
  "connected",
  "reconnected",
  "cancelled",
  "provider_error",
  "permission_missing",
  "denied",
  "not_ready",
  "invalid_request",
  "state_invalid",
  "state_used",
  "state_expired",
  "state_limit",
  "version_conflict",
  "connection_revoked",
  "connection_not_found",
  "exchange_failed",
  "exchange_unknown",
  "account_mismatch",
  "already_connected",
  "save_failed",
  "save_unknown",
  "start_unknown",
  "unexpected",
] as const;
export type InstagramOAuthResult = (typeof INSTAGRAM_OAUTH_RESULTS)[number];

export function parseInstagramOAuthResult(v: unknown): InstagramOAuthResult | null {
  return typeof v === "string" && (INSTAGRAM_OAUTH_RESULTS as readonly string[]).includes(v) ? (v as InstagramOAuthResult) : null;
}

export type InstagramOAuthDeps = {
  resolveActor: () => Promise<ActorResult>;
  getClient: () => RpcClient | null;
  getConfig: () => InstagramOAuthConfigResult;
  http: IgHttpDeps;
  generateState?: () => string;
  now?: () => number;
};

// ---------------------------------------------------------------- start
export type StartOutcome = { kind: "authorize"; url: string; cookieValue: string; maxAgeSeconds: number } | { kind: "result"; result: InstagramOAuthResult };

export async function startInstagramConnect(deps: InstagramOAuthDeps, input: { connectionId?: unknown; expectedVersion?: unknown } = {}): Promise<StartOutcome> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return { kind: "result", result: "denied" };

  const hasId = input.connectionId !== undefined && input.connectionId !== null && input.connectionId !== "";
  const hasVer = input.expectedVersion !== undefined && input.expectedVersion !== null && input.expectedVersion !== "";
  if (hasId !== hasVer) return { kind: "result", result: "invalid_request" };
  let target: { id: string; version: number } | null = null;
  if (hasId) {
    const v = typeof input.expectedVersion === "string" && /^[0-9]{1,9}$/.test(input.expectedVersion) ? Number(input.expectedVersion) : input.expectedVersion;
    if (!isUuid(input.connectionId) || !Number.isInteger(v) || (v as number) < 1) return { kind: "result", result: "invalid_request" };
    target = { id: input.connectionId, version: v as number };
  }

  const cfg = deps.getConfig();
  if (cfg.status !== "ok") return { kind: "result", result: "not_ready" };
  const client = deps.getClient();
  if (!client) return { kind: "result", result: "not_ready" };

  const state = (deps.generateState ?? generateOAuthState)();
  let res;
  try {
    res = await client.rpc(INSTAGRAM_OAUTH_RPC.createState, {
      p_actor_id: actor.actorId,
      p_channel: CHANNEL,
      p_state_hash: hashOAuthState(state),
      p_redirect_uri: cfg.config.redirectUri,
      p_ttl_seconds: OAUTH_STATE_TTL_SECONDS,
      p_target_connection_id: target?.id ?? null,
      p_target_row_version: target?.version ?? null,
    });
  } catch {
    return { kind: "result", result: "start_unknown" };
  }
  if (res.error) {
    const e = mapDistributionDbError(res.error);
    if (e.code === "forbidden") return { kind: "result", result: "denied" };
    if (e.token === "VERSION_CONFLICT") return { kind: "result", result: "version_conflict" };
    if (e.token === "ALREADY_REVOKED") return { kind: "result", result: "connection_revoked" };
    if (e.token === "OAUTH_STATE_LIMIT") return { kind: "result", result: "state_limit" };
    if (e.code === "not_found") return { kind: "result", result: "connection_not_found" };
    return { kind: "result", result: "invalid_request" };
  }
  const d = res.data && typeof res.data === "object" ? (res.data as Record<string, unknown>) : null;
  if (!d || !isUuid(d.id)) return { kind: "result", result: "start_unknown" };
  return {
    kind: "authorize",
    url: buildAuthorizeUrl({ appId: cfg.config.appId, redirectUri: cfg.config.redirectUri, state }),
    cookieValue: state,
    maxAgeSeconds: OAUTH_STATE_TTL_SECONDS,
  };
}

// ---------------------------------------------------------------- callback
export type CallbackInput = { state: unknown; code: unknown; error: unknown; cookieState: unknown };
type Consumed = { targetConnectionId: string | null; targetRowVersion: number | null; targetAccount: string | null };

async function consumeState(client: RpcClient, actorId: string, state: string, redirectUri: string): Promise<{ ok: true; value: Consumed } | { ok: false; result: InstagramOAuthResult }> {
  let res;
  try {
    res = await client.rpc(INSTAGRAM_OAUTH_RPC.consumeState, { p_actor_id: actorId, p_channel: CHANNEL, p_state_hash: hashOAuthState(state), p_redirect_uri: redirectUri });
  } catch {
    return { ok: false, result: "state_invalid" }; // 소비 여부 모름 → code를 쓰지 않는다(fail closed)
  }
  if (res.error) {
    const e = mapDistributionDbError(res.error);
    if (e.code === "forbidden") return { ok: false, result: "denied" };
    if (e.token === "OAUTH_STATE_USED") return { ok: false, result: "state_used" };
    if (e.token === "OAUTH_STATE_EXPIRED") return { ok: false, result: "state_expired" };
    return { ok: false, result: "state_invalid" };
  }
  const d = res.data && typeof res.data === "object" ? (res.data as Record<string, unknown>) : null;
  if (!d || !isUuid(d.id) || d.channel !== CHANNEL) return { ok: false, result: "state_invalid" };
  const tc = d.target_connection_id;
  if (tc !== null && !isUuid(tc)) return { ok: false, result: "state_invalid" };
  const tv = d.target_row_version;
  const ta = d.target_provider_account_id;
  if (tc !== null && (!Number.isInteger(tv) || typeof ta !== "string")) return { ok: false, result: "state_invalid" };
  return { ok: true, value: { targetConnectionId: tc, targetRowVersion: tc !== null ? (tv as number) : null, targetAccount: tc !== null ? (ta as string) : null } };
}

function saveResult(out: WriteOutcome<unknown>, okResult: InstagramOAuthResult): InstagramOAuthResult {
  switch (out.status) {
    case "ok":
      return okResult;
    case "denied":
      return "denied";
    case "not_ready":
      return "not_ready";
    case "invalid":
      return "save_failed";
    case "bad_response":
      return "save_unknown";
    case "db_error": {
      const e = out.error;
      if (e.code === "unavailable") return "save_unknown";
      if (e.token === "DUPLICATE") return "already_connected";
      if (e.token === "ACCOUNT_MISMATCH") return "account_mismatch";
      if (e.token === "VERSION_CONFLICT") return "version_conflict";
      if (e.token === "ALREADY_REVOKED") return "connection_revoked";
      if (e.code === "not_found") return "connection_not_found";
      return "save_failed";
    }
  }
}

export async function handleInstagramCallback(deps: InstagramOAuthDeps, input: CallbackInput): Promise<InstagramOAuthResult> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return "denied";
  const cfg = deps.getConfig();
  if (cfg.status !== "ok") return "not_ready";
  const client = deps.getClient();
  if (!client) return "not_ready";

  const cookieOk = sameOAuthState(input.state, input.cookieState);
  const providerError = typeof input.error === "string" && input.error.length > 0;
  if (!cookieOk) return providerError ? "cancelled" : "state_invalid"; // 위조 요청으로 남의 state를 소비하지 않음

  const consumed = await consumeState(client, actor.actorId, input.state as string, cfg.config.redirectUri);
  if (!consumed.ok) return consumed.result;

  // 공급자 오류·사용자 취소: state는 이미 닫았다. code가 있어도 쓰지 않는다.
  if (providerError) return input.error === "access_denied" ? "cancelled" : "provider_error";

  const code = normalizeAuthCode(input.code);
  if (!code) return "invalid_request";

  const ex = await exchangeCode(deps.http, { appId: cfg.config.appId, appSecret: cfg.config.appSecret, redirectUri: cfg.config.redirectUri, code });
  if (!ex.ok) return ex.failure.kind === "rejected" ? "exchange_failed" : "exchange_unknown";
  // 실제 부여 권한(교환 응답 permissions)에 요청 2개가 모두 있어야 저장한다. 저장 scopes = 요청 범위 ∩ 부여(=요청 2개).
  if (!INSTAGRAM_REQUESTED_SCOPES.every((s) => ex.permissions.includes(s))) return "permission_missing";
  const ll = await exchangeLongLived(deps.http, { appSecret: cfg.config.appSecret, shortToken: ex.shortToken });
  if (!ll.ok) return ll.failure.kind === "rejected" ? "exchange_failed" : "exchange_unknown";

  const now = (deps.now ?? Date.now)();
  const expiresAt = new Date(now + ll.expiresInSeconds * 1000).toISOString();
  const saveDeps = { resolveActor: deps.resolveActor, getClient: deps.getClient, getKeyring: () => ({ status: "ok" as const, keyring: cfg.config.keyring }) };
  const meta = { channel: CHANNEL, providerAccountId: ex.userId, accountLabel: null, scopes: [...INSTAGRAM_REQUESTED_SCOPES], expiresAt, token: ll.token };

  if (consumed.value.targetConnectionId) {
    if (consumed.value.targetAccount !== ex.userId) return "account_mismatch";
    const out = await reconnectSameAccount(saveDeps, { ...meta, connectionId: consumed.value.targetConnectionId, expectedVersion: consumed.value.targetRowVersion }, now);
    return saveResult(out, "reconnected");
  }
  const out = await saveNewConnection(saveDeps, meta, now);
  return saveResult(out, "connected");
}
