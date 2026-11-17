-- ============================================================================
-- 통합 배포 — OAuth 일회 state (Threads 연결 시작 ↔ callback 대조)
-- AUTOPOST-THREADS-OAUTH-019 · 2026-11-17 · CC-ENG (Claude Code)
-- 상태: 로컬 PGlite 대역(oauth-run.mjs)으로만 검증. 실제 Supabase 미적용.
-- 의존: 000000~090000(public.distribution_assert_admin_actor, distribution_channel_connections). 기존 SQL은 바꾸지 않는다.
--
-- 설계(최소 메타만)
--   * 앱이 256bit CSPRNG state를 만들어 브라우저 쿠키(HttpOnly·Secure·SameSite=Lax)와 provider authorize URL에 싣고,
--     DB에는 sha256 hex만 저장한다(원문 state·code·token 없음). user.id를 state로 쓰지 않는다.
--   * 행: actor·channel·고정 redirect_uri·짧은 만료(60~900초)·재연결 대상(선택: 연결 id + 렌더된 row_version)·소비 시각.
--   * 소비: service_role 전용. 같은 actor·channel·redirect·미소비·미만료일 때만 1회 consumed_at 기록(FOR UPDATE로 동시 재사용 직렬화 →
--     두 번째는 OAUTH_STATE_USED). 다른 actor·없는 state는 구분 없이 OAUTH_STATE_INVALID(존재 비노출, 소비하지 않음).
--   * 테이블은 RLS(정책 없음) + 모든 공개 역할 직접 권한 회수. SECURITY DEFINER 함수만, search_path = ''.
-- ============================================================================

create table public.distribution_oauth_states (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users (id) on delete restrict,
  channel text not null check (channel in ('threads')),
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  redirect_uri text not null check (
    char_length(redirect_uri) between 12 and 300 and redirect_uri ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/[A-Za-z0-9/_.-]*$'
  ),
  target_connection_id uuid references public.distribution_channel_connections (id) on delete restrict,
  target_row_version integer check (target_row_version is null or target_row_version >= 1),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint distribution_oauth_states_ttl check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint distribution_oauth_states_target_pair check ((target_connection_id is null) = (target_row_version is null))
);

create index distribution_oauth_states_actor_idx on public.distribution_oauth_states (actor_id, created_at desc);

alter table public.distribution_oauth_states enable row level security;
revoke all on table public.distribution_oauth_states from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 시작: state 해시 등록
-- ----------------------------------------------------------------------------
create or replace function public.distribution_create_oauth_state(
  p_actor_id uuid,
  p_channel text,
  p_state_hash text,
  p_redirect_uri text,
  p_ttl_seconds integer,
  p_target_connection_id uuid default null,
  p_target_row_version integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_now timestamptz := now();
  v_expires timestamptz;
  v_open integer;
  c public.distribution_channel_connections%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_channel is null or p_channel not in ('threads') then
    raise exception 'channel must be threads' using errcode = 'invalid_parameter_value';
  end if;
  if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'state hash must be lowercase sha256 hex' using errcode = 'invalid_parameter_value';
  end if;
  if p_redirect_uri is null or char_length(p_redirect_uri) not between 12 and 300
     or p_redirect_uri !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/[A-Za-z0-9/_.-]*$' then
    raise exception 'redirect uri must be a fixed https uri' using errcode = 'invalid_parameter_value';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 60 and 900 then
    raise exception 'ttl must be 60..900 seconds' using errcode = 'invalid_parameter_value';
  end if;
  if (p_target_connection_id is null) <> (p_target_row_version is null) then
    raise exception 'target connection and row version go together' using errcode = 'invalid_parameter_value';
  end if;
  if p_target_connection_id is not null then
    select * into c from public.distribution_channel_connections x
    where x.id = p_target_connection_id and x.owner_id = p_actor_id;
    if not found or c.channel <> p_channel then
      raise exception 'channel connection not found' using errcode = 'no_data_found';
    end if;
    if c.status = 'revoked' then
      raise exception 'ALREADY_REVOKED: connection was revoked (connect it as a new connection)' using errcode = 'check_violation';
    end if;
    if c.row_version <> p_target_row_version then
      raise exception 'VERSION_CONFLICT: connection is at version % (expected %)', c.row_version, p_target_row_version using errcode = 'P0001';
    end if;
  end if;

  -- 열린(미소비·미만료) state 상한: 연결 버튼 남발·state 축적 방지
  select count(*) into v_open from public.distribution_oauth_states s
  where s.actor_id = p_actor_id and s.consumed_at is null and s.expires_at > v_now;
  if v_open >= 5 then
    raise exception 'OAUTH_STATE_LIMIT: too many pending connection attempts; wait for them to expire' using errcode = 'check_violation';
  end if;

  v_expires := v_now + pg_catalog.make_interval(secs => p_ttl_seconds);
  begin
    insert into public.distribution_oauth_states (actor_id, channel, state_hash, redirect_uri, target_connection_id, target_row_version, created_at, expires_at)
    values (p_actor_id, p_channel, p_state_hash, p_redirect_uri, p_target_connection_id, p_target_row_version, v_now, v_expires)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'DUPLICATE: state already registered' using errcode = 'unique_violation';
  end;
  return pg_catalog.jsonb_build_object('id', v_id, 'expires_at', v_expires);
end;
$$;

-- ----------------------------------------------------------------------------
-- callback: 1회 소비
-- ----------------------------------------------------------------------------
create or replace function public.distribution_consume_oauth_state(
  p_actor_id uuid,
  p_channel text,
  p_state_hash text,
  p_redirect_uri text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.distribution_oauth_states%rowtype;
  v_account text;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'OAUTH_STATE_INVALID: state not recognized' using errcode = 'check_violation';
  end if;
  select * into s from public.distribution_oauth_states x where x.state_hash = p_state_hash for update;
  if not found or s.actor_id <> p_actor_id or s.channel is distinct from p_channel or s.redirect_uri is distinct from p_redirect_uri then
    raise exception 'OAUTH_STATE_INVALID: state not recognized' using errcode = 'check_violation';
  end if;
  if s.consumed_at is not null then
    raise exception 'OAUTH_STATE_USED: state was already used' using errcode = 'check_violation';
  end if;
  if s.expires_at <= now() then
    -- 만료 state는 그대로 사용 불가(예외가 트랜잭션을 되돌리므로 소비 기록은 남기지 않는다)
    raise exception 'OAUTH_STATE_EXPIRED: state expired' using errcode = 'check_violation';
  end if;
  update public.distribution_oauth_states set consumed_at = now() where id = s.id;

  if s.target_connection_id is not null then
    select c.provider_account_id into v_account from public.distribution_channel_connections c where c.id = s.target_connection_id;
  end if;
  return pg_catalog.jsonb_build_object(
    'id', s.id, 'channel', s.channel, 'target_connection_id', s.target_connection_id,
    'target_row_version', s.target_row_version, 'target_provider_account_id', v_account);
end;
$$;

revoke all on function public.distribution_create_oauth_state(uuid, text, text, text, integer, uuid, integer) from public, anon, authenticated;
revoke all on function public.distribution_consume_oauth_state(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.distribution_create_oauth_state(uuid, text, text, text, integer, uuid, integer) to service_role;
grant execute on function public.distribution_consume_oauth_state(uuid, text, text, text) to service_role;
