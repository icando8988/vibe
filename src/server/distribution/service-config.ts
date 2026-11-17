/**
 * service_role(secret) 키 설정 판정 — 순수 함수(테스트 대상). 실제 클라이언트 생성은 lib/supabase/admin.ts(server-only).
 * - 키는 Supabase 새 형식 secret key(`sb_secret_…`)만 받는다. 공개(publishable) 키나 JWT 형식은 거절한다.
 * - 주소는 https origin만. 값이 없거나 형식이 틀리면 null → 호출부는 "not_ready".
 * 값 자체는 로그·오류에 넣지 않는다.
 */

export type ServiceConfig = { url: string; secretKey: string };

const SECRET_KEY_RE = /^sb_secret_[A-Za-z0-9_-]{16,256}$/;

export function parseServiceConfig(rawUrl: string | undefined, rawKey: string | undefined): ServiceConfig | null {
  if (!rawUrl || !rawKey) return null;
  const key = rawKey.trim();
  if (!SECRET_KEY_RE.test(key)) return null;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return { url: url.origin, secretKey: key };
}
