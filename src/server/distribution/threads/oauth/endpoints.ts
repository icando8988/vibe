/**
 * Threads OAuth 엔드포인트·권한 — AUTOPOST-THREADS-OAUTH-019.
 * 출처: Threads_Auto_Posting_Kit_v1.02/threads/src/lib/threads/client.ts(getThreadsAuthorizeUrl·exchangeCodeForToken·
 *       exchangeForLongLivedToken, © BUYLIFE — ../NOTICE). 호스트·방식은 2026-11-17 공식 Meta 문서로 다시 대조했다:
 *   - https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions
 *     · 인증 창: https://threads.com/oauth/authorize — client_id, redirect_uri, scope(쉼표 구분), response_type=code, state
 *     · 코드 교환: POST https://graph.threads.com/oauth/access_token — client_id, client_secret, code,
 *       grant_type=authorization_code, redirect_uri(등록값과 정확히 일치) → access_token, token_type, user_id
 *     · "Authorization codes are valid for 1 hour and can only be used once." · threads_basic 필수
 *   - https://developers.facebook.com/docs/threads/get-started/long-lived-tokens
 *     · 장기 토큰: GET https://graph.threads.com/access_token — grant_type=th_exchange_token, client_secret, access_token
 *       → access_token, token_type, expires_in(초) · 장기 토큰 60일, 단기 토큰 1시간
 *   원본 키트는 threads.net / graph.threads.net 호스트를 썼다. 공식 문서 현재 값(threads.com)을 따른다.
 *   Postman 공개 문서(meta/threads)는 이번 조회에서 본문을 읽지 못했다.
 * 미검증(임의 확정 안 함):
 *   - 코드 교환 본문 형식: 문서는 "POST request body"만 말하고 예시는 multipart(-F). 원본과 같은 urlencoded를 쓴다(실제 호출 미검증).
 *   - 프로필 조회(/me): 위 문서에 없어 호출하지 않는다. 계정 ID는 코드 교환 응답의 user_id를 쓴다.
 *   - 실제 부여된 권한: 교환 응답에 scope가 없어 "요청한 권한"만 기록한다(부여 확인 아님).
 *   - 장기 토큰 교환은 문서상 GET 쿼리에 client_secret·access_token이 들어간다(대안 미문서화) → 그 URL은 요청 함수 밖으로 내보내지 않는다.
 */
export const THREADS_AUTHORIZE_URL = "https://threads.com/oauth/authorize";
export const THREADS_TOKEN_URL = "https://graph.threads.com/oauth/access_token";
export const THREADS_LONG_LIVED_URL = "https://graph.threads.com/access_token";
export const THREADS_REQUESTED_SCOPES = ["threads_basic", "threads_content_publish"] as const;
export const THREADS_CALLBACK_PATH = "/api/distribution/oauth/threads/callback";
export const THREADS_DOCS_CHECKED_AT = "2026-11-17";
