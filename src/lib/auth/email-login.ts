/**
 * 이메일 로그인(매직 링크) 순수 규칙. Supabase 호출은 서버 액션에서만 한다.
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

export type LoginNotice = "sent" | "invalid_email" | "unavailable" | "callback_failed" | "signed_out" | null;

export function parseLoginNotice(raw: unknown): LoginNotice {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "sent" || v === "invalid_email" || v === "unavailable" || v === "callback_failed" || v === "signed_out"
    ? v
    : null;
}
