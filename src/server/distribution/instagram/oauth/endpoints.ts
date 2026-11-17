/**
 * Instagram Business Login 엔드포인트·권한·경로 — BE-INSTAGRAM-OAUTH-043. 계약: handoff/workspace/docs/contracts/INSTAGRAM_OAUTH_CONTRACT.md
 * 공식 근거(2026-11-17, 영어 원문 "Updated: Mar 13, 2026"):
 *   https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
 *   · authorize: https://www.instagram.com/oauth/authorize — client_id, redirect_uri(등록값과 정확히 일치), response_type=code,
 *     scope(쉼표 구분), state(선택 — CSRF 방지에 쓰고 되돌려 줌). code는 1시간·1회용, 끝의 "#_"는 code가 아님.
 *   · 취소: error=access_denied, error_reason=user_denied, error_description
 *   · 교환: POST https://api.instagram.com/oauth/access_token (예시 multipart -F) — client_id, client_secret,
 *     grant_type=authorization_code, redirect_uri, code → {"data":[{access_token, user_id, permissions:"쉼표 목록"}]}
 *     거절 예: {"error_type":"OAuthException","code":400,"error_message":"..."}
 *   · 장기 토큰: GET https://graph.instagram.com/access_token — grant_type=ig_exchange_token, client_secret, access_token
 *     → {access_token, token_type:"bearer", expires_in} (60일, 서버에서만)
 *   · scope 현행: instagram_business_basic, instagram_business_content_publish (옛 business_* 2025-01-27 중단)
 * 하지 않는 것: enable_fb_login·force_reauth(선택값, 기본 유지), 프로필 조회(문서상 불필요), 토큰 갱신(범위 밖), API 버전 추정.
 * 대시보드 Embed URL은 쓰지 않는다 — 요청마다 다른 state가 필요해 같은 구성으로 서버가 조립한다.
 */
export const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
export const INSTAGRAM_LONG_LIVED_URL = "https://graph.instagram.com/access_token";
export const INSTAGRAM_REQUESTED_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"] as const;
export const INSTAGRAM_CALLBACK_PATH = "/api/distribution/oauth/instagram/callback";
export const INSTAGRAM_START_PATH = "/api/distribution/oauth/instagram/start";
export const INSTAGRAM_CONNECTIONS_PAGE = "/admin/distribution/connections/instagram";
export const INSTAGRAM_DOCS_CHECKED_AT = "2026-11-17";
