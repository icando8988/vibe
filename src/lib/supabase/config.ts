/**
 * Supabase 공개 설정(URL·publishable key) 판독. 값은 이 모듈 밖으로 로그·응답하지 않는다.
 * publishable key는 브라우저 노출용 공개 키다. 서버 전용 secret key는 여기서 다루지 않는다.
 */
export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

export function parseSupabaseConfig(rawUrl: unknown, rawKey: unknown): SupabasePublicConfig | null {
  if (typeof rawUrl !== "string" || typeof rawKey !== "string") return null;
  const url = rawUrl.trim();
  const key = rawKey.trim();
  if (!url || !key) return null;
  // 비밀(서버 전용) 키를 실수로 공개 변수에 넣은 경우 사용하지 않는다.
  if (key.startsWith("sb_secret_")) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return { url: u.origin, publishableKey: key };
  } catch {
    return null;
  }
}

export function supabaseConfigFromEnv(): SupabasePublicConfig | null {
  return parseSupabaseConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
