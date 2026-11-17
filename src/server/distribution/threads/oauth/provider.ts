/**
 * Threads OAuth 공급자 호출 — 인증 URL·코드 교환·장기 토큰 교환. AUTOPOST-THREADS-OAUTH-019.
 * 출처: Threads_Auto_Posting_Kit_v1.02/threads/src/lib/threads/client.ts getThreadsAuthorizeUrl·exchangeCodeForToken·
 *       exchangeForLongLivedToken (© BUYLIFE — ../NOTICE). 호스트는 공식 문서 현재 값(endpoints.ts).
 * 변경:
 *   - fetch 의존성 주입, 요청별 timeout, redirect 거부, no-store. 재시도 없음(코드는 1회용 — 응답 유실 시 재요청 금지).
 *   - 예외·공급자 메시지 대신 정제 결과(코드·HTTP 상태만). URL·code·token·secret은 결과·로그에 담지 않는다.
 *   - 토큰은 SecretToken으로만 돌려준다. user_id는 응답 원문에서 문자열로 뽑는다(17자리 숫자 → JS number 정밀도 손실 방지).
 *   - 프로필(/me) 조회는 공식 문서에서 확인하지 못해 하지 않는다.
 */
import { isValidAccessToken, SecretToken } from "../../connections/crypto";
import type { ThreadsHttpDeps } from "../types";
import { THREADS_AUTHORIZE_URL, THREADS_LONG_LIVED_URL, THREADS_REQUESTED_SCOPES, THREADS_TOKEN_URL } from "./endpoints";

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_ID_RE = /"user_id"\s*:\s*"?([0-9]{1,32})"?/;

export type ProviderFailure = { kind: "rejected" | "unknown"; httpStatus: number | null; providerCode: number | null };

export function buildAuthorizeUrl(input: { appId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.redirectUri,
    scope: THREADS_REQUESTED_SCOPES.join(","),
    response_type: "code",
    state: input.state,
  });
  return `${THREADS_AUTHORIZE_URL}?${q.toString()}`;
}

/** callback의 code 정리: 문서상 "#_" 접미는 code가 아님. 형식이 틀리면 null. */
export function normalizeAuthCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.endsWith("#_") ? raw.slice(0, -2) : raw;
  return /^[A-Za-z0-9_\-.]{10,2048}$/.test(c) ? c : null;
}

type Raw = { kind: "response"; status: number; text: string } | { kind: "timeout" } | { kind: "network" };

async function send(deps: ThreadsHttpDeps, url: string, init: RequestInit): Promise<Raw> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, { ...init, signal: ctrl.signal, cache: "no-store", redirect: "error" });
    let text = "";
    try {
      text = await res.text();
    } catch {
      return { kind: "network" }; // 본문 유실
    }
    return { kind: "response", status: res.status, text: text.slice(0, 20_000) };
  } catch {
    return ctrl.signal.aborted ? { kind: "timeout" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

function failureOf(raw: Raw): ProviderFailure {
  if (raw.kind !== "response") return { kind: "unknown", httpStatus: null, providerCode: null };
  let providerCode: number | null = null;
  try {
    const b = JSON.parse(raw.text) as { error?: { code?: unknown } };
    providerCode = typeof b?.error?.code === "number" && Number.isInteger(b.error.code) ? b.error.code : null;
  } catch {
    providerCode = null;
  }
  // 4xx = 공급자가 명시 거절(코드 무효·만료·재사용·redirect 불일치 등). 그 밖(5xx·형식 오류)은 결과 불명.
  return { kind: raw.status >= 400 && raw.status < 500 ? "rejected" : "unknown", httpStatus: raw.status, providerCode };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type CodeExchangeResult = { ok: true; shortToken: SecretToken; userId: string } | { ok: false; failure: ProviderFailure };

// 1) 코드 → 단기 토큰(POST 본문, 1회)
export async function exchangeCode(
  deps: ThreadsHttpDeps,
  input: { appId: string; appSecret: SecretToken; redirectUri: string; code: string },
): Promise<CodeExchangeResult> {
  const body = new URLSearchParams({
    client_id: input.appId,
    client_secret: input.appSecret.reveal(),
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  const raw = await send(deps, THREADS_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  if (raw.kind !== "response" || raw.status < 200 || raw.status >= 300) return { ok: false, failure: failureOf(raw) };
  const j = parseJson(raw.text);
  const token = j?.access_token;
  const userId = USER_ID_RE.exec(raw.text)?.[1] ?? null;
  if (!isValidAccessToken(token) || !userId) return { ok: false, failure: { kind: "unknown", httpStatus: raw.status, providerCode: null } };
  return { ok: true, shortToken: new SecretToken(token), userId };
}

export type LongLivedResult = { ok: true; token: SecretToken; expiresInSeconds: number } | { ok: false; failure: ProviderFailure };

// 2) 단기 → 장기 토큰(문서상 GET 쿼리, 1회). 이 URL은 send 밖으로 나가지 않는다.
export async function exchangeLongLived(deps: ThreadsHttpDeps, input: { appSecret: SecretToken; shortToken: SecretToken }): Promise<LongLivedResult> {
  const q = new URLSearchParams({ grant_type: "th_exchange_token", client_secret: input.appSecret.reveal(), access_token: input.shortToken.reveal() });
  const raw = await send(deps, `${THREADS_LONG_LIVED_URL}?${q.toString()}`, { method: "GET" });
  if (raw.kind !== "response" || raw.status < 200 || raw.status >= 300) return { ok: false, failure: failureOf(raw) };
  const j = parseJson(raw.text);
  const token = j?.access_token;
  const exp = j?.expires_in;
  // 60일 근처(문서) — 1시간~70일 밖이면 형식 오류로 보고 저장하지 않는다
  if (!isValidAccessToken(token) || typeof exp !== "number" || !Number.isInteger(exp) || exp < 3600 || exp > 70 * 86_400) {
    return { ok: false, failure: { kind: "unknown", httpStatus: raw.status, providerCode: null } };
  }
  return { ok: true, token: new SecretToken(token), expiresInSeconds: exp };
}
