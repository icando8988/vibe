/**
 * Threads 연결 흐름(start / callback) — 의존성 주입 순수 함수(테스트 대상). AUTOPOST-THREADS-OAUTH-019.
 * 출처 대체: Threads_Auto_Posting_Kit_v1.02/threads/src/app/api/threads/callback/route.ts(© BUYLIFE — ../NOTICE)의 흐름을
 *   우리 구조로 다시 짰다(state=user.id·회원별 앱 키·평문 저장·이중 redirect·예외 일괄 connect_failed 제거).
 *
 * start: 세션 actor + D1 → 서버 설정(앱 ID/Secret·토큰 키·SITE_URL) → 256bit state 생성 → DB에 해시 등록(짧은 수명,
 *        고정 redirect, 재연결이면 대상 연결 id + 렌더된 row_version) → 쿠키 값 + 공급자 인증 URL 반환.
 * callback: 세션 actor + D1 → 설정 → provider error/취소 → 쿼리 state = 쿠키 state(상수 시간) → DB state 1회 소비
 *        (같은 actor·channel·redirect·미소비·미만료) → code 1회 교환 → 장기 토큰 → 계정 판정 → M3 암호화 저장.
 *   재연결: 공급자 계정(user_id)이 대상 연결 계정과 다르면 저장하지 않는다(account_mismatch — 과거 승인 대상 불변).
 *   새 연결: 같은 계정의 활성 연결이 있으면 저장하지 않는다(already_connected — 그 연결의 '같은 계정 재연결'로).
 * 결과는 허용 목록 코드뿐. state·code·token을 결과·redirect·로그에 싣지 않는다. 어떤 단계도 자동 재요청하지 않는다.
 * 연결 성공 ≠ 게시 가능: 부여 권한 확인·capability 검증·실행기·live gate는 이 흐름 밖(모두 미구현/닫힘).
 */
import type { ActorResult } from "../../actor-core";
import { mapDistributionDbError } from "../../errors";
import { isUuid } from "../../validation";
import type { RpcClient, WriteOutcome } from "../../write-runner";
import { reconnectSameAccount, saveNewConnection } from "../../connections/service";
import type { ThreadsHttpDeps } from "../types";
import type { ThreadsOAuthConfigResult } from "./config";
import { THREADS_REQUESTED_SCOPES } from "./endpoints";
import { buildAuthorizeUrl, exchangeCode, exchangeLongLived, normalizeAuthCode } from "./provider";
import { generateOAuthState, hashOAuthState, OAUTH_STATE_TTL_SECONDS, sameOAuthState } from "./state";

export const OAUTH_RPC = Object.freeze({ createState: "distribution_create_oauth_state", consumeState: "distribution_consume_oauth_state" } as const);

export const OAUTH_RESULTS = [
  "connected",
  "reconnected",
  "cancelled",
  "provider_error",
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
export type OAuthResult = (typeof OAUTH_RESULTS)[number];

export function parseOAuthResult(v: unknown): OAuthResult | null {
  return typeof v === "string" && (OAUTH_RESULTS as readonly string[]).includes(v) ? (v as OAuthResult) : null;
}

export type OAuthDeps = {
  resolveActor: () => Promise<ActorResult>;
  getClient: () => RpcClient | null;
  getConfig: () => ThreadsOAuthConfigResult;
  http: ThreadsHttpDeps;
  generateState?: () => string;
  now?: () => number;
};

// ---------------------------------------------------------------- start
export type StartOutcome = { kind: "authorize"; url: string; cookieValue: string; maxAgeSeconds: number } | { kind: "result"; result: OAuthResult };

export async function startThreadsConnect(deps: OAuthDeps, input: { connectionId?: unknown; expectedVersion?: unknown } = {}): Promise<StartOutcome> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return { kind: "result", result: "denied" };

  const reconnect = input.connectionId !== undefined && input.connectionId !== null && input.connectionId !== "";
  let target: { id: string; version: number } | null = null;
  if (reconnect) {
    const v = typeof input.expectedVersion === "string" ? Number(input.expectedVersion) : input.expectedVersion;
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
    res = await client.rpc(OAUTH_RPC.createState, {
      p_actor_id: actor.actorId,
      p_channel: "threads",
      p_state_hash: hashOAuthState(state),
      p_redirect_uri: cfg.config.redirectUri,
      p_ttl_seconds: OAUTH_STATE_TTL_SECONDS,
      p_target_connection_id: target?.id ?? null,
      p_target_row_version: target?.version ?? null,
    });
  } catch {
    return { kind: "result", result: "start_unknown" }; // 등록 여부 모름 → 이 state는 쓰지 않는다(곧 만료)
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
export type CallbackInput = {
  /** 쿼리 값(원문). 이 함수 밖으로 되돌려 보내지 않는다. */
  state: unknown;
  code: unknown;
  error: unknown;
  cookieState: unknown;
};

type Consumed = { targetConnectionId: string | null; targetRowVersion: number | null; targetAccount: string | null };

async function consumeState(client: RpcClient, actorId: string, state: string, redirectUri: string): Promise<{ ok: true; value: Consumed } | { ok: false; result: OAuthResult }> {
  let res;
  try {
    res = await client.rpc(OAUTH_RPC.consumeState, { p_actor_id: actorId, p_channel: "threads", p_state_hash: hashOAuthState(state), p_redirect_uri: redirectUri });
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
  if (!d || !isUuid(d.id) || d.channel !== "threads") return { ok: false, result: "state_invalid" };
  const tc = d.target_connection_id;
  if (tc !== null && !isUuid(tc)) return { ok: false, result: "state_invalid" };
  return {
    ok: true,
    value: {
      targetConnectionId: tc,
      targetRowVersion: Number.isInteger(d.target_row_version) ? (d.target_row_version as number) : null,
      targetAccount: typeof d.target_provider_account_id === "string" ? d.target_provider_account_id : null,
    },
  };
}

function saveResult(out: WriteOutcome<unknown>, okResult: OAuthResult): OAuthResult {
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
      return "save_unknown"; // 저장됐는지 응답으로 확인 못함
    case "db_error": {
      const e = out.error;
      if (e.code === "unavailable") return "save_unknown"; // 응답 유실
      if (e.token === "DUPLICATE") return "already_connected";
      if (e.token === "ACCOUNT_MISMATCH") return "account_mismatch";
      if (e.token === "VERSION_CONFLICT") return "version_conflict";
      if (e.token === "ALREADY_REVOKED") return "connection_revoked";
      if (e.code === "not_found") return "connection_not_found";
      return "save_failed";
    }
  }
}

export async function handleThreadsCallback(deps: OAuthDeps, input: CallbackInput): Promise<OAuthResult> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return "denied";
  const cfg = deps.getConfig();
  if (cfg.status !== "ok") return "not_ready";
  const client = deps.getClient();
  if (!client) return "not_ready";

  // 쿠키 state와 쿼리 state가 같아야 이후 단계(소비 포함)로 간다 — 위조 요청으로 남의 state를 소비하지 않음
  const cookieOk = sameOAuthState(input.state, input.cookieState);
  const providerError = typeof input.error === "string" && input.error.length > 0;
  if (!cookieOk) return providerError ? "cancelled" : "state_invalid";

  const consumed = await consumeState(client, actor.actorId, input.state as string, cfg.config.redirectUri);
  if (!consumed.ok) return consumed.result;

  // 공급자 오류·사용자 취소: state는 이미 닫았다. code가 있어도 쓰지 않는다.
  if (providerError) return input.error === "access_denied" ? "cancelled" : "provider_error";

  const code = normalizeAuthCode(input.code);
  if (!code) return "invalid_request";

  const ex = await exchangeCode(deps.http, { appId: cfg.config.appId, appSecret: cfg.config.appSecret, redirectUri: cfg.config.redirectUri, code });
  if (!ex.ok) return ex.failure.kind === "rejected" ? "exchange_failed" : "exchange_unknown"; // code는 1회용 → 재요청 없음
  const ll = await exchangeLongLived(deps.http, { appSecret: cfg.config.appSecret, shortToken: ex.shortToken });
  if (!ll.ok) return ll.failure.kind === "rejected" ? "exchange_failed" : "exchange_unknown";

  const now = (deps.now ?? Date.now)();
  const expiresAt = new Date(now + ll.expiresInSeconds * 1000).toISOString();
  const saveDeps = { resolveActor: deps.resolveActor, getClient: deps.getClient, getKeyring: () => ({ status: "ok" as const, keyring: cfg.config.keyring }) };
  const meta = { channel: "threads", providerAccountId: ex.userId, accountLabel: null, scopes: [...THREADS_REQUESTED_SCOPES], expiresAt, token: ll.token };

  if (consumed.value.targetConnectionId) {
    // 같은 계정 재연결만. 다른 계정이면 저장하지 않는다(기존 연결·승인 대상 불변).
    if (consumed.value.targetAccount !== ex.userId) return "account_mismatch";
    const out = await reconnectSameAccount(saveDeps, { ...meta, connectionId: consumed.value.targetConnectionId, expectedVersion: consumed.value.targetRowVersion }, now);
    return saveResult(out, "reconnected");
  }
  const out = await saveNewConnection(saveDeps, meta, now);
  return saveResult(out, "connected");
}

