-- =====================================================================
-- AUTOPOST-LOCAL-DB-VERIFY-002 — Supabase 최소 로컬 대역(stand-in). 실제 Supabase가 아니다.
-- 일회성 PGlite(인메모리 PostgreSQL) DB에서 superuser로 1회 실행한다. 비밀값·키·원격 연결 없음.
--
-- 흉내 내는 것(M0~M2+050000이 의존하는 최소 부분)
--   * anon / authenticated : nologin noinherit (PostgREST가 SET ROLE로 전환하는 역할)
--   * service_role         : nologin noinherit bypassrls (서버 키 역할)
--   * supa_owner           : migration 실행·객체 소유 역할. Supabase의 `postgres`처럼 **superuser가 아님**
--                            (superuser는 권한 검사를 건너뛰어 ACL 결함을 가리므로 일부러 비superuser로 둔다).
--   * auth 스키마, auth.users(id, created_at만), auth.uid() = GUC request.jwt.claim.sub
--   * public 스키마 기본 권한: supa_owner가 만든 테이블·시퀀스·함수에 anon/authenticated/service_role ALL
--     (Supabase의 위험한 기본값을 재현 — migration의 REVOKE가 실제로 필요한지 확인하기 위함)
--
-- 실제 Supabase와 다른 점(이 대역으로 검증되지 않는 것)
--   * GoTrue 인증, JWT 서명 검증, PostgREST 역할 전환/`select=` 경로, auth.users 전체 열·소유자(supabase_auth_admin)
--   * supabase_admin 소유 객체, storage/realtime/pgsodium/vault, Supabase 확장 스키마, 이벤트 트리거
--   * 실제 `postgres` 역할의 정확한 속성(여기서는 createrole·bypassrls 없음 — owner이므로 RLS 영향 없음)
--   * 다중 연결(동시 세션) — PGlite는 단일 연결
-- =====================================================================

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supa_owner nologin noinherit;

-- migration이 create schema private를 하므로 DB CREATE, public 객체 생성을 위해 스키마 소유.
grant create on database postgres to supa_owner;
alter schema public owner to supa_owner;

create schema auth;
create table auth.users (
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

grant usage on schema auth to anon, authenticated, service_role, supa_owner;
grant execute on function auth.uid() to anon, authenticated, service_role, supa_owner;
revoke all on auth.users from public, anon, authenticated;
grant all on auth.users to service_role;
-- 기존 migration이 auth.users FK(REFERENCES)·가입 트리거(TRIGGER)를 만든다.
grant select, references, trigger on auth.users to supa_owner;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role supa_owner in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role supa_owner in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role supa_owner in schema public grant all on functions to anon, authenticated, service_role;
