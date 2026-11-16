-- ============================================================================
-- 역할 판정 함수를 API 비노출 스키마(private)로 이동
-- 2026-11-16 · CC-ENG-01 · 사용자 지시
-- 이유: Supabase Security Advisor 경고 "Signed-In Users Can Execute SECURITY DEFINER Function".
--   public 스키마 함수는 PostgREST가 /rest/v1/rpc/<name> 으로 노출한다. 반환값은 호출자 자신의
--   불리언뿐이라 위험은 낮지만, RLS 정책에서만 쓰는 내부 함수이므로 노출하지 않는다.
-- 방식: ALTER FUNCTION ... SET SCHEMA. 정책은 함수를 OID로 참조하므로 정책 재작성 없이 따라간다.
--   security definer · search_path='' · 실행 권한(authenticated만)은 그대로 유지된다.
-- private 스키마는 Supabase Data API 노출 스키마 목록(public, graphql_public)에 넣지 않는다.
-- ============================================================================

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;
-- RLS 정책은 호출자 권한으로 평가되므로, 정책 안의 함수 호출에는 스키마 USAGE가 필요하다.
grant usage on schema private to authenticated;

alter function public.is_admin() set schema private;
alter function public.is_approved_member() set schema private;

-- 권한 재확인(이동 시 유지되지만 명시해 둔다)
revoke all on function private.is_admin() from public, anon, authenticated;
revoke all on function private.is_approved_member() from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_approved_member() to authenticated;

-- 이후 private 스키마에 새로 만드는 함수가 기본 권한으로 열리지 않도록
alter default privileges in schema private revoke all on functions from public, anon, authenticated;
