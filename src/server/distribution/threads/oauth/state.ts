/**
 * OAuth state·쿠키 — AUTOPOST-THREADS-OAUTH-019.
 * state = CSPRNG 32바이트(256bit) base64url. DB에는 sha256 hex만. user.id를 state로 쓰지 않는다(원본 K1 수정).
 * 쿠키: __Host- 접두(Secure·Path=/·Domain 없음 강제) + HttpOnly + SameSite=Lax + 짧은 Max-Age.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_STATE_COOKIE = "__Host-dist-threads-oauth";
export const OAUTH_STATE_TTL_SECONDS = 600;
const STATE_RE = /^[A-Za-z0-9_-]{43}$/;

export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function isOAuthStateShape(v: unknown): v is string {
  return typeof v === "string" && STATE_RE.test(v);
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

/** 쿼리 state와 쿠키 state가 같은가(상수 시간). 형식이 틀리면 false. */
export function sameOAuthState(a: unknown, b: unknown): boolean {
  if (!isOAuthStateShape(a) || !isOAuthStateShape(b)) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function stateCookieHeader(value: string, maxAgeSeconds: number): string {
  return `${OAUTH_STATE_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearStateCookieHeader(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
