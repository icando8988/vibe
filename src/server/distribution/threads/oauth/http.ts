/**
 * OAuth 라우트 응답 조립 — 순수 함수(테스트 대상). AUTOPOST-THREADS-OAUTH-019.
 * 결과 이동은 고정 내부 경로(상대 Location)만. state·code·token·공급자 메시지를 URL에 싣지 않는다(허용 목록 결과 코드만).
 * 모든 응답: no-store, Referrer-Policy no-referrer.
 */
import type { OAuthResult } from "./flow";
import { clearStateCookieHeader, stateCookieHeader } from "./state";
import { THREADS_AUTHORIZE_URL } from "./endpoints";

export const THREADS_CONNECTIONS_PAGE = "/admin/distribution/connections/threads";

function base(): Headers {
  const h = new Headers();
  h.set("Cache-Control", "no-store");
  h.set("Referrer-Policy", "no-referrer");
  return h;
}

export function resultResponse(result: OAuthResult, opts: { clearCookie?: boolean } = {}): Response {
  const h = base();
  h.set("Location", `${THREADS_CONNECTIONS_PAGE}?result=${result}`);
  if (opts.clearCookie) h.append("Set-Cookie", clearStateCookieHeader());
  return new Response(null, { status: 303, headers: h });
}

/** 공급자 인증 창으로 이동 + state 쿠키. 대상은 고정 인증 URL 접두만 허용(open redirect 방지). */
export function authorizeResponse(url: string, cookieValue: string, maxAgeSeconds: number): Response {
  if (!url.startsWith(`${THREADS_AUTHORIZE_URL}?`)) return resultResponse("unexpected");
  const h = base();
  h.set("Location", url);
  h.append("Set-Cookie", stateCookieHeader(cookieValue, maxAgeSeconds));
  return new Response(null, { status: 303, headers: h });
}

/** CSRF: 시작 요청의 Origin이 설정된 사이트 origin과 정확히 같아야 한다. */
export function sameSiteOrigin(originHeader: string | null, siteOrigin: string): boolean {
  return originHeader !== null && originHeader === siteOrigin;
}
