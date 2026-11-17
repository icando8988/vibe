/**
 * service_role(secret) Supabase 클라이언트 — 서버 전용(AUTOPOST-SOURCE-PORT-001, 명세 §2·§6.3).
 * - 콘솔 쓰기 RPC(distribution_*, service_role 전용)만 이 클라이언트로 호출한다. 조회는 사용자 세션 클라이언트를 쓴다.
 * - env `SUPABASE_SECRET_KEY`(NEXT_PUBLIC_ 접두 금지)가 없거나 형식이 틀리면 null → 호출부는 not_ready.
 * - 세션 저장·자동 갱신·쿠키 없음. 이 모듈은 클라이언트 번들에 들어가면 빌드가 실패한다(server-only).
 */
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseServiceConfig } from "@/server/distribution/service-config";

export function createSupabaseServiceClient(): SupabaseClient | null {
  const config = parseServiceConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  if (!config) return null;
  return createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
