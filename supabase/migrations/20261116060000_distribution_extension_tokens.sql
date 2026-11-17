-- ============================================================================
-- 통합 배포 — Blog 확장(네이버 블로그 입력기) 연결 토큰
-- AUTOPOST-BLOG-TOKEN-005 · 2026-11-17 · CC-ENG (Claude Code)
-- 참고: 원본 Blog_Posting_Kit_v1.07 utils/extensionAuth.ts·personal_access_tokens(sha256 해시만 저장) 흐름.
--       원본 코드는 복사하지 않았고 이 프로젝트의 D1·service_role 전용 RPC 패턴(050000)으로 다시 작성했다.
-- 상태: 로컬 PGlite 대역(token-run.mjs)으로만 검증. 실제 Supabase 미적용.
-- 의존: M0~M2+050000(public.distribution_assert_admin_actor 재사용).
--
-- 설계
--   * 토큰 원문은 DB에 오지 않는다. 앱이 `pat_` + CSPRNG 32바이트(hex 64자)를 만들고 sha256 hex만 넘긴다.
--   * 테이블은 PUBLIC/anon/authenticated/service_role 모두 권한 없음(SELECT 포함) + RLS(정책 없음).
--     token_hash는 어떤 역할도 직접 조회할 수 없고, 아래 SECURITY DEFINER 함수만 읽고 쓴다.
--   * 발급·목록·철회: service_role 전용. p_actor_id(서버가 검증된 세션에서 도출)로 D1을 다시 검사하고,
--     목록·철회는 actor가 소유한 토큰만 다룬다(다른 소유자 토큰은 "없음"과 같은 응답 — 존재를 드러내지 않음).
--   * 인증: service_role 전용. 해시로 찾아 매번 철회·만료·소유자 D1(현재 상태)을 확인한다.
--     실패 사유(없음/철회/만료/권한)는 구분하지 않고 0행을 돌려준다. 성공 시 last_used_at만 갱신한다.
--   * 모든 함수: SECURITY DEFINER, search_path = '', 객체 schema-qualified, PUBLIC 기본 EXECUTE 회수.
-- ============================================================================

create table public.distribution_extension_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  label text not null check (
    char_length(label) between 1 and 60
    and char_length(btrim(label)) >= 1
    and label !~ '[[:cntrl:]]'
  ),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete restrict,
  constraint distribution_extension_tokens_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '366 days'
  ),
  constraint distribution_extension_tokens_revoke_pair check ((revoked_at is null) = (revoked_by is null))
);

create index distribution_extension_tokens_owner_idx
  on public.distribution_extension_tokens (owner_id, created_at desc);

alter table public.distribution_extension_tokens enable row level security;
-- 정책 없음: RLS를 우회하지 않는 역할은 행을 볼 수 없다. 아래 REVOKE로 테이블 권한 자체도 없다.
revoke all on table public.distribution_extension_tokens from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 발급 (원문 없음 — 해시만)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_issue_extension_token(
  p_actor_id uuid,
  p_token_hash text,
  p_label text,
  p_ttl_days integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_created timestamptz := now();
  v_expires timestamptz;
  v_active integer;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token hash must be lowercase sha256 hex' using errcode = 'invalid_parameter_value';
  end if;
  if p_label is null or char_length(p_label) not between 1 and 60 or char_length(btrim(p_label)) < 1
     or p_label ~ '[[:cntrl:]]' then
    raise exception 'label must be 1..60 characters without control characters' using errcode = 'invalid_parameter_value';
  end if;
  if p_ttl_days is null or p_ttl_days not between 1 and 365 then
    raise exception 'ttl must be 1..365 days' using errcode = 'invalid_parameter_value';
  end if;

  -- 소유자별 유효 토큰 상한(분실·남발 방지)
  select count(*) into v_active
  from public.distribution_extension_tokens t
  where t.owner_id = p_actor_id and t.revoked_at is null and t.expires_at > v_created;
  if v_active >= 10 then
    raise exception 'TOKEN_LIMIT: revoke an existing token first (max 10 active)' using errcode = 'check_violation';
  end if;

  v_expires := v_created + pg_catalog.make_interval(days => p_ttl_days);
  begin
    insert into public.distribution_extension_tokens (owner_id, label, token_hash, created_at, expires_at)
    values (p_actor_id, p_label, p_token_hash, v_created, v_expires)
    returning id into v_id;
  exception when unique_violation then
    -- 해시 충돌(사실상 재사용 시도). 기존 행 정보는 드러내지 않는다.
    raise exception 'DUPLICATE: token already registered' using errcode = 'unique_violation';
  end;

  return pg_catalog.jsonb_build_object('id', v_id, 'label', p_label, 'created_at', v_created, 'expires_at', v_expires);
end;
$$;

-- ----------------------------------------------------------------------------
-- 목록 (actor 소유만, 해시 없음)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_list_extension_tokens(p_actor_id uuid)
returns table (
  id uuid,
  label text,
  created_at timestamptz,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  return query
    select t.id, t.label, t.created_at, t.expires_at, t.last_used_at, t.revoked_at
    from public.distribution_extension_tokens t
    where t.owner_id = p_actor_id
    order by t.created_at desc, t.id desc
    limit 50;
end;
$$;

-- ----------------------------------------------------------------------------
-- 철회 (actor 소유만)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_revoke_extension_token(p_actor_id uuid, p_token_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.distribution_extension_tokens%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);

  select * into v_row
  from public.distribution_extension_tokens t
  where t.id = p_token_id and t.owner_id = p_actor_id
  for update;
  if not found then
    -- 다른 소유자 토큰도 같은 응답(존재 여부 비노출)
    raise exception 'extension token not found' using errcode = 'no_data_found';
  end if;
  if v_row.revoked_at is not null then
    raise exception 'ALREADY_REVOKED: token was already revoked' using errcode = 'unique_violation';
  end if;

  update public.distribution_extension_tokens
  set revoked_at = now(), revoked_by = p_actor_id
  where id = v_row.id;

  return pg_catalog.jsonb_build_object('id', v_row.id, 'revoked_at', now());
end;
$$;

-- ----------------------------------------------------------------------------
-- 인증 (Bearer → 해시). 실패 사유를 구분하지 않고 0행.
-- ----------------------------------------------------------------------------
create or replace function public.distribution_authenticate_extension_token(p_token_hash text)
returns table (user_id uuid, token_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_owner uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select t.id, t.owner_id into v_id, v_owner
  from public.distribution_extension_tokens t
  join public.profiles p on p.id = t.owner_id and p.approval_status = 'approved'
  where t.token_hash = p_token_hash
    and t.revoked_at is null
    and t.expires_at > now()
    and exists (
      select 1 from public.role_assignments ra
      where ra.user_id = t.owner_id and ra.role = 'admin'
    );
  if v_id is null then
    return;
  end if;

  update public.distribution_extension_tokens set last_used_at = now() where id = v_id;
  user_id := v_owner;
  token_id := v_id;
  return next;
end;
$$;

-- ----------------------------------------------------------------------------
-- ACL: 기본 PUBLIC EXECUTE 회수 → service_role만
-- ----------------------------------------------------------------------------
revoke all on function public.distribution_issue_extension_token(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.distribution_list_extension_tokens(uuid) from public, anon, authenticated;
revoke all on function public.distribution_revoke_extension_token(uuid, uuid) from public, anon, authenticated;
revoke all on function public.distribution_authenticate_extension_token(text) from public, anon, authenticated;

grant execute on function public.distribution_issue_extension_token(uuid, text, text, integer) to service_role;
grant execute on function public.distribution_list_extension_tokens(uuid) to service_role;
grant execute on function public.distribution_revoke_extension_token(uuid, uuid) to service_role;
grant execute on function public.distribution_authenticate_extension_token(text) to service_role;
