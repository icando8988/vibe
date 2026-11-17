/**
 * Instagram Business Login 공급자 호출 — 인증 URL·코드 교환·장기 토큰 교환. BE-INSTAGRAM-OAUTH-043. 규격: ./endpoints.ts(공식 문서).
 * - fetch 주입, 요청별 제한시간, redirect 거부, no-store, 재시도 없음(code는 1회용 — 응답 유실 시 재요청 금지).
 * - 결과는 정제 코드(HTTP 상태·공급자 숫자 code)만. URL·code·token·secret·error_message는 담지 않는다.
 * - 토큰은 SecretToken으로만 돌려준다. user_id는 응답 원문에서 문자열로 뽑는다(숫자 JSON이어도 정밀도 손실 없음, 숫자 변환 금지).
 * - 교환 응답은 문서 형태({"data":[{access_token,user_id,permissions}]})만 받는다. 다르면 unknown(추정 확장 없음 — 실호출 미검증).
 */
import { isValidAccessToken, SecretToken } from "../../connections/crypto";
import type { IgHttpDeps } from "../types";
import { INSTAGRAM_AUTHORIZE_URL, INSTAGRAM_LONG_LIVED_URL, INSTAGRAM_REQUESTED_SCOPES, INSTAGRAM_TOKEN_URL } from "./endpoints";

const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * user_id 원문 추출(HARDEN-046): 따옴표 숫자 문자열 또는 JSON 정수 리터럴(선행 0 없음)만, 값 바로 뒤가 공백 + `,` `}` `]`여야 한다.
 * 소수·지수·부호·잘림·선행 0은 경계 검사에서 걸러져 일치 0개 → 거절. 앞자리만 잘라 오는 일이 없다.
 */
const USER_ID_RE = /"user_id"\s*:\s*(?:"([0-9]{1,32})"|(0|[1-9][0-9]{0,31}))(?=\s*[,}\]])/g;

/** 원문에서 user_id를 정확히 하나 뽑고, 파싱된 값과 종류·값이 일치하는지 대조한다(중복 key·다른 위치 일치 거절). */
function extractUserId(text: string, parsed: unknown): string | null {
  const hits = [...text.matchAll(USER_ID_RE)];
  if (hits.length !== 1) return null;
  const [, quoted, bare] = hits[0] as RegExpMatchArray;
  if (quoted !== undefined) return typeof parsed === "string" && parsed === quoted ? quoted : null;
  if (bare !== undefined) return typeof parsed === "number" && Number.isInteger(parsed) && parsed === Number(bare) ? bare : null;
  return null;
}
const SCOPE_RE = /^[a-z][a-z0-9_]{0,63}$/;

export type ProviderFailure = { kind: "rejected" | "unknown"; httpStatus: number | null; providerCode: number | null };

export function buildAuthorizeUrl(input: { appId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: INSTAGRAM_REQUESTED_SCOPES.join(","),
    state: input.state,
  });
  return `${INSTAGRAM_AUTHORIZE_URL}?${q.toString()}`;
}

/** callback code 정리: 문서상 끝의 "#_"는 code가 아님(브라우저가 fragment를 보내지 않는 게 보통이지만 방어). 형식이 틀리면 null. */
export function normalizeAuthCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.endsWith("#_") ? raw.slice(0, -2) : raw;
  return /^[A-Za-z0-9_\-.]{10,2048}$/.test(c) ? c : null;
}

type Raw = { kind: "response"; status: number; text: string } | { kind: "timeout" } | { kind: "network" };

async function send(deps: IgHttpDeps, url: string, init: RequestInit): Promise<Raw> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, { ...init, signal: ctrl.signal, cache: "no-store", redirect: "error" });
    let text = "";
    try {
      text = await res.text();
    } catch {
      return { kind: "network" };
    }
    return { kind: "response", status: res.status, text: text.slice(0, 20_000) };
  } catch {
    return ctrl.signal.aborted ? { kind: "timeout" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 4xx = 공급자 명시 거절(코드 무효·재사용·redirect 불일치 등). 그 밖(5xx·형식 오류·유실)은 결과 불명. 공급자 숫자 code만 남긴다. */
function failureOf(raw: Raw): ProviderFailure {
  if (raw.kind !== "response") return { kind: "unknown", httpStatus: null, providerCode: null };
  const b = parseJson(raw.text);
  const nested = b?.error && typeof b.error === "object" ? (b.error as Record<string, unknown>).code : undefined;
  const c = typeof b?.code === "number" ? b.code : nested;
  const providerCode = typeof c === "number" && Number.isInteger(c) ? c : null;
  return { kind: raw.status >= 400 && raw.status < 500 ? "rejected" : "unknown", httpStatus: raw.status, providerCode };
}

const malformed = (status: number): { ok: false; failure: ProviderFailure } => ({ ok: false, failure: { kind: "unknown", httpStatus: status, providerCode: null } });

export type CodeExchangeResult =
  | { ok: true; shortToken: SecretToken; userId: string; permissions: string[] }
  | { ok: false; failure: ProviderFailure };

/** 1) code → 단기 토큰 + Instagram 범위 user_id + 실제 부여 권한(POST form, 1회). */
export async function exchangeCode(
  deps: IgHttpDeps,
  input: { appId: string; appSecret: { reveal(): string }; redirectUri: string; code: string },
): Promise<CodeExchangeResult> {
  const body = new FormData(); // 문서 예시(curl -F) 그대로 multipart
  body.set("client_id", input.appId);
  body.set("client_secret", input.appSecret.reveal());
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", input.redirectUri);
  body.set("code", input.code);
  const raw = await send(deps, INSTAGRAM_TOKEN_URL, { method: "POST", body });
  if (raw.kind !== "response" || raw.status < 200 || raw.status >= 300) return { ok: false, failure: failureOf(raw) };
  const j = parseJson(raw.text);
  const data = j?.data;
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== "object") return malformed(raw.status);
  const item = data[0] as Record<string, unknown>;
  const userId = extractUserId(raw.text, item.user_id); // 정확히 하나, 전체 경계, 파싱 값과 일치(모호·잘림이면 거절)
  if (!isValidAccessToken(item.access_token) || !userId) return malformed(raw.status);
  if (typeof item.permissions !== "string") return malformed(raw.status); // 부여 권한을 알 수 없으면 단정하지 않는다
  const permissions = item.permissions.split(",").map((s) => s.trim()).filter(Boolean);
  if (permissions.length === 0 || permissions.length > 20 || !permissions.every((s) => SCOPE_RE.test(s))) return malformed(raw.status);
  return { ok: true, shortToken: new SecretToken(item.access_token), userId, permissions: [...new Set(permissions)] };
}

export type LongLivedResult = { ok: true; token: SecretToken; expiresInSeconds: number } | { ok: false; failure: ProviderFailure };

/** 2) 단기 → 장기 토큰(문서상 GET 쿼리, 1회). secret·token이 담긴 이 URL은 send 밖으로 나가지 않는다. */
export async function exchangeLongLived(deps: IgHttpDeps, input: { appSecret: { reveal(): string }; shortToken: SecretToken }): Promise<LongLivedResult> {
  const q = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: input.appSecret.reveal(), access_token: input.shortToken.reveal() });
  const raw = await send(deps, `${INSTAGRAM_LONG_LIVED_URL}?${q.toString()}`, { method: "GET" });
  if (raw.kind !== "response" || raw.status < 200 || raw.status >= 300) return { ok: false, failure: failureOf(raw) };
  const j = parseJson(raw.text);
  const exp = j?.expires_in;
  if (!isValidAccessToken(j?.access_token) || typeof exp !== "number" || !Number.isInteger(exp) || exp < 3600 || exp > 70 * 86_400) return malformed(raw.status);
  // HARDEN-046: token_type은 필수(계약 v2·공식 응답). 누락·문자열 아님·bearer 아님 → 형식 오류(대소문자 무시는 기존 정책 유지)
  if (typeof j?.token_type !== "string" || j.token_type.toLowerCase() !== "bearer") return malformed(raw.status);
  return { ok: true, token: new SecretToken(j?.access_token as string), expiresInSeconds: exp };
}
