/**
 * Instagram OAuth state 쿠키 — BE-INSTAGRAM-OAUTH-043.
 * state 생성·해시·상수시간 비교는 Threads와 같은 함수(읽기 전용 재사용, Threads 파일 무수정). 쿠키만 Instagram 전용 이름.
 * 쿠키: __Host- 접두(Secure·Path=/·Domain 없음) + HttpOnly + SameSite=Lax + 짧은 Max-Age.
 */
export { generateOAuthState, hashOAuthState, isOAuthStateShape, OAUTH_STATE_TTL_SECONDS, sameOAuthState } from "../../threads/oauth/state";

export const INSTAGRAM_STATE_COOKIE = "__Host-dist-instagram-oauth";

export function stateCookieHeader(value: string, maxAgeSeconds: number): string {
  return `${INSTAGRAM_STATE_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearStateCookieHeader(): string {
  return `${INSTAGRAM_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
