/**
 * service_role(secret) Supabase 클라이언트 — 서버 전용(AUTOPOST-SOURCE-PORT-001, 명세 §2·§6.3).
 * - 기본 사용은 콘솔 쓰기 RPC(distribution_*, service_role 전용)다. 일반 조회는 사용자 세션 클라이언트를 쓴다.
 * - 공개 읽기 예외는 `src/server/public-feed/index.ts` 한 곳뿐이다. server-only 경계 뒤에서 읽기 전용 SELECT와
 *   `core.ts`의 승인·게시 증거 판정을 거쳐 최소 공개 DTO로 투영한다. 이 예외를 새 service_role 읽기로 확장하지 않는다.
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
