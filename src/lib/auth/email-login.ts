/**
 * 이메일+비밀번호 로그인 순수 규칙. Supabase 호출은 서버 액션에서만 한다.
 * 메일 링크(가입 인증·비밀번호 재설정)는 /auth/callback 으로 돌아온다.
 */
import { safeReturnTo } from "@/lib/domain/input";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 형식만 확인한다. 존재 여부는 응답으로 드러내지 않는다. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v.length < 3 || v.length > 254 || !EMAIL.test(v)) return null;
  return v;
}

/** 사이트 기준 주소: https 환경변수 우선, 없으면 요청 origin(로컬 개발 http 허용). */
export function resolveSiteOrigin(envUrl: string | undefined, requestOrigin: string | null): string | null {
  for (const candidate of [envUrl, requestOrigin]) {
    if (!candidate) continue;
    try {
      const u = new URL(candidate.trim());
      if (u.username || u.password) continue;
      const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      if (u.protocol === "https:" || (u.protocol === "http:" && local)) return u.origin;
    } catch {
      // 다음 후보
    }
  }
  return null;
}

/** 메일 링크가 돌아올 주소. 복귀 경로는 내부 경로만 허용한다. */
export function buildEmailRedirect(origin: string, rawReturnTo: unknown): string {
  const next = safeReturnTo(rawReturnTo, "/me");
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", next);
  return url.toString();
}

/** 비밀번호: 8자 이상, 72바이트 이하(bcrypt 한도), 공백만으로 된 값 거절. 원문은 다듬지 않는다. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;
export function validatePassword(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length < PASSWORD_MIN || new TextEncoder().encode(raw).length > PASSWORD_MAX_BYTES) return null;
  if (raw.trim().length === 0) return null;
  return raw;
}

export type LoginMode = "login" | "signup" | "reset";
export function parseLoginMode(raw: unknown): LoginMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "signup" || v === "reset" ? v : "login";
}

export const LOGIN_NOTICES = [
  "invalid_email",
  "invalid_password",
  "password_mismatch",
  "invalid_login",
  "email_not_confirmed",
  "signup_sent",
  "reset_sent",
  "password_updated",
  "rate_limited",
  "unavailable",
  "callback_failed",
  "signed_out",
] as const;
export type LoginNotice = (typeof LOGIN_NOTICES)[number];

export function parseLoginNotice(raw: unknown): LoginNotice | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && (LOGIN_NOTICES as readonly string[]).includes(v) ? (v as LoginNotice) : null;
}
