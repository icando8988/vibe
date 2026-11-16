-- =====================================================================
-- Supabase 대체 스텁 (테스트 전용). 실제 Supabase가 아니다.
-- 실제 Supabase 플랫폼이 제공하는 것 중 migration이 의존하는 최소 부분만 흉내 낸다:
--   * 역할 anon / authenticated(로그인 불가 역할) / service_role(BYPASSRLS)
--   * auth 스키마, auth.users(id만), auth.uid() = JWT sub 클레임
--   * public 스키마 기본 권한: 새 테이블·시퀀스·함수에 anon/authenticated/service_role ALL
--     (Supabase 기본 설정과 같은 '위험한 출발점'을 재현해 migration의 REVOKE가 실제로 필요한지 검증)
-- 실제 Supabase와의 차이: GoTrue 인증, JWT 서명 검증, PostgREST 역할 전환, auth.users 전체 열,
--   storage/realtime 스키마, supabase_admin 소유권, pgsodium 등은 없다. → 실제 Supabase 로컬/브랜치에서 재검증 필요.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- 실제 Supabase처럼 auth.users는 클라이언트 역할이 직접 읽지 못한다.
revoke all on auth.users from public, anon, authenticated;
grant all on auth.users to service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
