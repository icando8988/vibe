-- ============================================================================
-- 통합 배포 — Instagram Business Login OAuth state 채널 추가(forward only)
-- BE-INSTAGRAM-OAUTH-043 · 2026-11-17 · CC-BACKEND-01 Claude(Backend)
-- 상태: 로컬 PGlite 대역(instagram-oauth.pglite.test.ts)으로만 검증. 실제 Supabase 미적용.
-- 의존: 100000(distribution_oauth_states·distribution_create_oauth_state·distribution_consume_oauth_state), 090000(연결 channel은 이미 instagram 허용).
--
-- 변경(최소)
--   1) distribution_oauth_states.channel 검사: ('threads') → ('threads', 'instagram'). 기존 행은 모두 threads라 그대로 만족한다.
--      제약을 다시 만들 뿐 완화가 아니라 허용 값 1개 추가다. 행 삭제·갱신 없음.
--   2) distribution_create_oauth_state: 채널 검사만 ('threads', 'instagram')로 넓힌다. 나머지 본문(D1·hash·redirect·TTL·대상 연결 소유·
--      revoked·row_version·열린 state 5개 상한·DUPLICATE)은 100000과 같다. 서명·ACL 동일(아래 다시 명시).
--   3) distribution_consume_oauth_state: 변경 없음(channel 일치 비교만 하므로 instagram도 그대로 동작).
-- Threads 동작·기존 state 불변. live gate 무관(계속 false). rollback down migration 없음.
-- ============================================================================

alter table public.distribution_oauth_states drop constraint distribution_oauth_states_channel_check;
alter table public.distribution_oauth_states
  add constraint distribution_oauth_states_channel_check check (channel in ('threads', 'instagram'));

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
  if p_channel is null or p_channel not in ('threads', 'instagram') then
    raise exception 'channel must be threads or instagram' using errcode = 'invalid_parameter_value';
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

  -- 열린(미소비·미만료) state 상한: 연결 버튼 남발·state 축적 방지(채널 합산 — 100000과 같음)
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

revoke all on function public.distribution_create_oauth_state(uuid, text, text, text, integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.distribution_create_oauth_state(uuid, text, text, text, integer, uuid, integer) to service_role;
