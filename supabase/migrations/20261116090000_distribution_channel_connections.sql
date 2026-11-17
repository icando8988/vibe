-- ============================================================================
-- 통합 배포 — M3 최소: 채널 연결 metadata + 암호화 credential 저장 경계
-- AUTOPOST-M3-CONNECTION-017 · 2026-11-17 · CC-ENG (Claude Code)
-- 상태: 로컬 PGlite 대역(connections-run.mjs)으로만 검증. 실제 Supabase 미적용. OAuth start/callback·실제 토큰 교환 없음.
-- 의존: M0~M2+050000~080000(public.distribution_assert_admin_actor 재사용). 기존 M1/M2 함수는 바꾸지 않는다.
--
-- 설계
--   * 연결(metadata)과 credential(암호문)을 다른 테이블로 나눈다. 두 테이블 모두 PUBLIC/anon/authenticated/service_role
--     직접 권한 없음 + RLS(정책 없음). 아래 SECURITY DEFINER 함수만 읽고 쓴다.
--   * credential: 앱 서버가 Node crypto AES-256-GCM으로 암호화한 봉투(ciphertext·nonce 12B·tag 16B, base64)와
--     key_version·aad_version만 저장한다. 평문 토큰·앱 secret 열은 없다. DB는 키를 모른다(복호화 불가).
--     AAD(앱 측)는 owner_id·channel·provider_account_id·key_version에 묶인다 → 다른 행으로 옮긴 암호문은 복호화 실패.
--   * metadata 저장·재연결·철회·재인증 표시·목록: service_role 전용. p_actor_id(검증된 세션에서 서버가 도출)로 D1을 다시
--     검사하고 actor 소유 연결만 다룬다(다른 소유자 연결은 "없음"과 같은 응답).
--   * worker credential 읽기: service_role 전용. 연결 소유자(p_owner_id)의 현재 D1 + connected + 미만료 + 미철회를 매번 확인.
--     metadata 응답에는 암호문·nonce·tag가 없다(목록·저장 응답 모두).
--   * 재연결 의미 분리:
--       - 같은 계정(provider_account_id 동일, 미철회 연결): 같은 행에서 credential 교체 + row_version 증가. id·계정 불변이므로
--         이 연결을 대상으로 승인된 리비전·작업의 대상은 그대로다.
--       - 다른 계정: 기존 행의 계정을 바꾸지 않는다(ACCOUNT_MISMATCH). 새 연결 행을 만든다 → 기존 승인·작업 대상이
--         조용히 다른 계정으로 바뀌지 않는다. owner/channel/provider_account_id는 트리거로 불변.
--       - 철회된 연결은 최종 상태(재사용 불가). 다시 연결하면 새 id → 그 연결을 가리키던 리비전은 재저장·재승인 필요.
--   * 기존 target_connection_id(M1 리비전, M2 작업) 호환:
--       - FK(on delete restrict)를 NOT VALID로 추가한다(기존 행은 검사하지 않고, 이후 INSERT부터 강제). 연결 행은 삭제하지 않는다.
--       - 리비전 INSERT 시 대상 연결이 같은 채널·미철회·target_external_account_id = provider_account_id인지 확인(새 트리거).
--         M2 작업은 리비전 스냅샷을 복사하므로 별도 검사 불필요. 연결 소유자·상태 재검사는 live gate(아직 false) 몫.
--   * live gate는 열지 않는다(distribution_live_gate는 그대로 false).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 검증 helper (immutable, 내부 전용)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_connection_scopes_valid(p_scopes text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_scopes is not null
    and pg_catalog.cardinality(p_scopes) between 1 and 20
    and pg_catalog.array_position(p_scopes, null) is null
    and (select pg_catalog.bool_and(s ~ '^[a-z][a-z0-9_]{0,63}$') from pg_catalog.unnest(p_scopes) s)
    and (select pg_catalog.count(distinct s) = pg_catalog.count(*) from pg_catalog.unnest(p_scopes) s);
$$;

-- ----------------------------------------------------------------------------
-- 연결 metadata
-- ----------------------------------------------------------------------------
create table public.distribution_channel_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  channel text not null check (channel in ('threads', 'instagram')),
  -- 공급자 계정 ID 형식은 공식 규격 미확정 → 보수적 문자 집합만 허용(임의 확정 없음)
  provider_account_id text not null check (provider_account_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  account_label text check (
    account_label is null or (char_length(account_label) between 1 and 100 and account_label !~ '[[:cntrl:]]')
  ),
  scopes text[] not null check (public.distribution_connection_scopes_valid(scopes)),
  status text not null default 'connected' check (status in ('connected', 'reauth_required', 'revoked')),
  reauth_reason text check (reauth_reason is null or reauth_reason in ('decrypt_failed', 'provider_auth', 'expired', 'key_rotated', 'manual')),
  expires_at timestamptz not null,                 -- credential 만료(공급자 응답 기준). 만료 정보 없는 토큰은 저장하지 않는다.
  key_version integer check (key_version is null or key_version between 1 and 32767),
  row_version integer not null default 1 check (row_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete restrict,
  revoke_reason text check (revoke_reason is null or (char_length(revoke_reason) <= 500 and revoke_reason !~ '[[:cntrl:]]')),
  constraint distribution_channel_connections_revoke_state check (
    (status = 'revoked') = (revoked_at is not null)
    and (revoked_at is null) = (revoked_by is null)
    and (status = 'revoked') = (key_version is null)
  ),
  constraint distribution_channel_connections_reauth_reason check ((status = 'reauth_required') = (reauth_reason is not null))
);

-- 같은 소유자·채널·계정의 미철회 연결은 하나(재연결은 같은 행). 다른 계정은 새 행.
create unique index distribution_channel_connections_active_account_uidx
  on public.distribution_channel_connections (owner_id, channel, provider_account_id)
  where status <> 'revoked';
create index distribution_channel_connections_owner_idx
  on public.distribution_channel_connections (owner_id, created_at desc);

-- ----------------------------------------------------------------------------
-- credential 봉투(암호문만)
-- ----------------------------------------------------------------------------
create table public.distribution_channel_credentials (
  connection_id uuid primary key references public.distribution_channel_connections (id) on delete restrict,
  key_version integer not null check (key_version between 1 and 32767),
  aad_version smallint not null check (aad_version = 1),
  ciphertext text not null check (
    char_length(ciphertext) between 16 and 12000 and char_length(ciphertext) % 4 = 0
    and ciphertext ~ '^[A-Za-z0-9+/]+={0,2}$'
  ),
  nonce text not null check (nonce ~ '^[A-Za-z0-9+/]{16}$'),          -- 12바이트
  auth_tag text not null check (auth_tag ~ '^[A-Za-z0-9+/]{22}==$'),  -- 16바이트
  created_at timestamptz not null default now()
);

alter table public.distribution_channel_connections enable row level security;
alter table public.distribution_channel_credentials enable row level security;
-- 정책 없음 + 테이블 권한 회수: 어떤 공개 역할도 직접 조회·변경할 수 없다(service_role 포함 — 함수로만).
revoke all on table public.distribution_channel_connections from public, anon, authenticated, service_role;
revoke all on table public.distribution_channel_credentials from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 불변 열 + 철회 최종 상태 + 삭제 금지
-- ----------------------------------------------------------------------------
create or replace function public.distribution_channel_connections_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'channel connections are not deleted (revoke instead)' using errcode = 'restrict_violation';
  end if;
  if new.owner_id is distinct from old.owner_id or new.channel is distinct from old.channel
     or new.provider_account_id is distinct from old.provider_account_id or new.created_at is distinct from old.created_at then
    raise exception 'ACCOUNT_MISMATCH: owner/channel/provider account are immutable (create a new connection)'
      using errcode = 'check_violation';
  end if;
  if old.status = 'revoked' then
    raise exception 'ALREADY_REVOKED: revoked connections are final' using errcode = 'check_violation';
  end if;
  if new.row_version <> old.row_version + 1 then
    raise exception 'row_version must advance by 1' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger distribution_channel_connections_guard
  before update or delete on public.distribution_channel_connections
  for each row execute function public.distribution_channel_connections_guard();

-- ----------------------------------------------------------------------------
-- 내부 helper: 봉투 검증 · metadata JSON(비밀 없음) · actor 소유 행 잠금
-- ----------------------------------------------------------------------------
create or replace function public.distribution_connection_check_envelope(
  p_key_version integer, p_aad_version integer, p_ciphertext text, p_nonce text, p_tag text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_key_version is null or p_key_version not between 1 and 32767
     or p_aad_version is distinct from 1
     or p_ciphertext is null or char_length(p_ciphertext) not between 16 and 12000 or char_length(p_ciphertext) % 4 <> 0
     or p_ciphertext !~ '^[A-Za-z0-9+/]+={0,2}$'
     or p_nonce is null or p_nonce !~ '^[A-Za-z0-9+/]{16}$'
     or p_tag is null or p_tag !~ '^[A-Za-z0-9+/]{22}==$' then
    raise exception 'credential envelope is malformed' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create or replace function public.distribution_connection_check_meta(
  p_account_label text, p_scopes text[], p_expires_at timestamptz
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_account_label is not null and (char_length(p_account_label) not between 1 and 100 or p_account_label ~ '[[:cntrl:]]') then
    raise exception 'account label must be 1..100 characters without control characters' using errcode = 'invalid_parameter_value';
  end if;
  if not public.distribution_connection_scopes_valid(p_scopes) then
    raise exception 'scopes must be 1..20 distinct lowercase identifiers' using errcode = 'invalid_parameter_value';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '400 days' then
    raise exception 'expires_at must be in the future (within 400 days)' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create or replace function public.distribution_connection_meta(c public.distribution_channel_connections)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', c.id, 'channel', c.channel, 'provider_account_id', c.provider_account_id, 'account_label', c.account_label,
    'scopes', pg_catalog.to_jsonb(c.scopes), 'status', c.status, 'reauth_reason', c.reauth_reason,
    'expires_at', c.expires_at, 'key_version', c.key_version, 'row_version', c.row_version,
    'created_at', c.created_at, 'updated_at', c.updated_at, 'revoked_at', c.revoked_at);
$$;

/** actor 소유 연결을 잠그고 expected version을 확인. 철회된 연결은 ALREADY_REVOKED. */
create or replace function public.distribution_connection_lock(
  p_actor_id uuid, p_connection_id uuid, p_expected_version integer
)
returns public.distribution_channel_connections
language plpgsql
volatile
set search_path = ''
as $$
declare
  v public.distribution_channel_connections%rowtype;
begin
  select * into v from public.distribution_channel_connections c
  where c.id = p_connection_id and c.owner_id = p_actor_id
  for update;
  if not found then
    raise exception 'channel connection not found' using errcode = 'no_data_found';
  end if;
  if v.status = 'revoked' then
    raise exception 'ALREADY_REVOKED: connection was revoked' using errcode = 'check_violation';
  end if;
  if p_expected_version is null or v.row_version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: connection is at version % (expected %)', v.row_version, p_expected_version
      using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) 새 연결(첫 연결 또는 다른 계정)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_create_channel_connection(
  p_actor_id uuid,
  p_channel text,
  p_provider_account_id text,
  p_account_label text,
  p_scopes text[],
  p_expires_at timestamptz,
  p_key_version integer,
  p_aad_version integer,
  p_ciphertext text,
  p_nonce text,
  p_tag text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.distribution_channel_connections%rowtype;
  v_active integer;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_channel is null or p_channel not in ('threads', 'instagram') then
    raise exception 'channel must be threads or instagram' using errcode = 'invalid_parameter_value';
  end if;
  if p_provider_account_id is null or p_provider_account_id !~ '^[A-Za-z0-9_.:-]{1,128}$' then
    raise exception 'provider account id is malformed' using errcode = 'invalid_parameter_value';
  end if;
  perform public.distribution_connection_check_meta(p_account_label, p_scopes, p_expires_at);
  perform public.distribution_connection_check_envelope(p_key_version, p_aad_version, p_ciphertext, p_nonce, p_tag);

  if exists (
    select 1 from public.distribution_channel_connections c
    where c.owner_id = p_actor_id and c.channel = p_channel and c.provider_account_id = p_provider_account_id
      and c.status <> 'revoked'
  ) then
    raise exception 'DUPLICATE: an active connection for this account exists (reconnect it instead)' using errcode = 'unique_violation';
  end if;
  select count(*) into v_active from public.distribution_channel_connections c
  where c.owner_id = p_actor_id and c.channel = p_channel and c.status <> 'revoked';
  if v_active >= 5 then
    raise exception 'CONNECTION_LIMIT: revoke an existing connection first (max 5 per channel)' using errcode = 'check_violation';
  end if;

  begin
    insert into public.distribution_channel_connections (owner_id, channel, provider_account_id, account_label, scopes, expires_at, key_version)
    values (p_actor_id, p_channel, p_provider_account_id, p_account_label, p_scopes, p_expires_at, p_key_version)
    returning * into v;
  exception when unique_violation then
    raise exception 'DUPLICATE: an active connection for this account exists (reconnect it instead)' using errcode = 'unique_violation';
  end;
  insert into public.distribution_channel_credentials (connection_id, key_version, aad_version, ciphertext, nonce, auth_tag)
  values (v.id, p_key_version, p_aad_version, p_ciphertext, p_nonce, p_tag);

  return public.distribution_connection_meta(v);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) 같은 계정 재연결(credential 교체). 다른 계정이면 ACCOUNT_MISMATCH → 새 연결로.
-- ----------------------------------------------------------------------------
create or replace function public.distribution_reconnect_channel_connection(
  p_actor_id uuid,
  p_connection_id uuid,
  p_expected_version integer,
  p_provider_account_id text,
  p_account_label text,
  p_scopes text[],
  p_expires_at timestamptz,
  p_key_version integer,
  p_aad_version integer,
  p_ciphertext text,
  p_nonce text,
  p_tag text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.distribution_channel_connections%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  v := public.distribution_connection_lock(p_actor_id, p_connection_id, p_expected_version);
  if p_provider_account_id is distinct from v.provider_account_id then
    raise exception 'ACCOUNT_MISMATCH: a different provider account needs a new connection (existing targets are kept)'
      using errcode = 'check_violation';
  end if;
  perform public.distribution_connection_check_meta(p_account_label, p_scopes, p_expires_at);
  perform public.distribution_connection_check_envelope(p_key_version, p_aad_version, p_ciphertext, p_nonce, p_tag);

  delete from public.distribution_channel_credentials where connection_id = v.id;
  insert into public.distribution_channel_credentials (connection_id, key_version, aad_version, ciphertext, nonce, auth_tag)
  values (v.id, p_key_version, p_aad_version, p_ciphertext, p_nonce, p_tag);

  update public.distribution_channel_connections
  set status = 'connected', reauth_reason = null, account_label = p_account_label, scopes = p_scopes,
      expires_at = p_expires_at, key_version = p_key_version, row_version = v.row_version + 1
  where id = v.id
  returning * into v;
  return public.distribution_connection_meta(v);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) 철회(credential 삭제, 최종 상태)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_revoke_channel_connection(
  p_actor_id uuid,
  p_connection_id uuid,
  p_expected_version integer,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.distribution_channel_connections%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_reason is not null and (char_length(p_reason) > 500 or p_reason ~ '[[:cntrl:]]') then
    raise exception 'reason must be at most 500 characters without control characters' using errcode = 'invalid_parameter_value';
  end if;
  v := public.distribution_connection_lock(p_actor_id, p_connection_id, p_expected_version);
  delete from public.distribution_channel_credentials where connection_id = v.id;
  update public.distribution_channel_connections
  set status = 'revoked', reauth_reason = null, key_version = null, revoked_at = now(), revoked_by = p_actor_id,
      revoke_reason = nullif(pg_catalog.btrim(p_reason), ''), row_version = v.row_version + 1
  where id = v.id
  returning * into v;
  return public.distribution_connection_meta(v);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) 재인증 필요 표시(복호화 실패·공급자 인증 오류 등 fail closed)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_mark_channel_connection_reauth(
  p_actor_id uuid,
  p_connection_id uuid,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.distribution_channel_connections%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_reason is null or p_reason not in ('decrypt_failed', 'provider_auth', 'expired', 'key_rotated', 'manual') then
    raise exception 'reauth reason is not allowed' using errcode = 'invalid_parameter_value';
  end if;
  v := public.distribution_connection_lock(p_actor_id, p_connection_id, p_expected_version);
  update public.distribution_channel_connections
  set status = 'reauth_required', reauth_reason = p_reason, row_version = v.row_version + 1
  where id = v.id
  returning * into v;
  return public.distribution_connection_meta(v);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) 목록(actor 소유만, 비밀 없음)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_list_channel_connections(p_actor_id uuid)
returns table (
  id uuid,
  channel text,
  provider_account_id text,
  account_label text,
  scopes text[],
  status text,
  reauth_reason text,
  expires_at timestamptz,
  key_version integer,
  has_credential boolean,
  row_version integer,
  created_at timestamptz,
  updated_at timestamptz,
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
    select c.id, c.channel, c.provider_account_id, c.account_label, c.scopes, c.status, c.reauth_reason, c.expires_at,
           c.key_version, exists (select 1 from public.distribution_channel_credentials k where k.connection_id = c.id),
           c.row_version, c.created_at, c.updated_at, c.revoked_at
    from public.distribution_channel_connections c
    where c.owner_id = p_actor_id
    order by c.created_at desc, c.id desc
    limit 100;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) worker credential 읽기(서버 내부 전용). 소유자 현재 D1 + connected + 미만료 + 미철회.
--    실패 사유는 토큰으로 구분(재인증 필요 vs 없음). 성공 행만 봉투를 담는다.
-- ----------------------------------------------------------------------------
create or replace function public.distribution_read_channel_credential(p_owner_id uuid, p_connection_id uuid)
returns table (
  connection_id uuid,
  owner_id uuid,
  channel text,
  provider_account_id text,
  key_version integer,
  aad_version smallint,
  ciphertext text,
  nonce text,
  auth_tag text,
  expires_at timestamptz,
  row_version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.distribution_channel_connections%rowtype;
  k public.distribution_channel_credentials%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_owner_id);
  select * into v from public.distribution_channel_connections c
  where c.id = p_connection_id and c.owner_id = p_owner_id;
  if not found then
    raise exception 'channel connection not found' using errcode = 'no_data_found';
  end if;
  if v.status = 'revoked' then
    raise exception 'CONNECTION_REVOKED: connection was revoked' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v.status = 'reauth_required' then
    raise exception 'REAUTH_REQUIRED: connection needs re-authentication' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v.expires_at <= now() then
    raise exception 'CREDENTIAL_EXPIRED: credential expired' using errcode = 'object_not_in_prerequisite_state';
  end if;
  select * into k from public.distribution_channel_credentials x where x.connection_id = v.id;
  if not found or k.key_version is distinct from v.key_version then
    raise exception 'REAUTH_REQUIRED: credential missing' using errcode = 'object_not_in_prerequisite_state';
  end if;
  connection_id := v.id; owner_id := v.owner_id; channel := v.channel; provider_account_id := v.provider_account_id;
  key_version := k.key_version; aad_version := k.aad_version; ciphertext := k.ciphertext; nonce := k.nonce;
  auth_tag := k.auth_tag; expires_at := v.expires_at; row_version := v.row_version;
  return next;
end;
$$;

-- ----------------------------------------------------------------------------
-- 기존 target_connection_id 호환(M1 리비전 · M2 작업)
-- ----------------------------------------------------------------------------
-- 리비전 대상 연결 일관성(새 INSERT만). 기존 리비전 트리거·함수는 바꾸지 않는다.
-- invoker 권한: 리비전 INSERT는 소유자 DEFINER 함수(050000 append)로만 일어나므로 연결 테이블을 읽을 수 있다.
-- 다른 역할이 직접 INSERT하면(권한상 불가) 연결 테이블을 못 읽어 실패한다(fail closed).
create or replace function public.distribution_draft_revisions_target_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_channel text;
  c public.distribution_channel_connections%rowtype;
begin
  if new.target_connection_id is null then
    return new;
  end if;
  select d.channel into v_channel from public.distribution_channel_drafts d where d.id = new.draft_id;
  select * into c from public.distribution_channel_connections x where x.id = new.target_connection_id;
  if not found or c.status = 'revoked' or c.channel is distinct from v_channel
     or new.target_external_account_id is distinct from c.provider_account_id then
    raise exception 'TARGET_CONNECTION_MISMATCH: target connection must be an active connection of this channel and account'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger distribution_draft_revisions_target_check
  before insert on public.distribution_draft_revisions
  for each row execute function public.distribution_draft_revisions_target_check();

-- FK: 기존 행은 검사하지 않고(NOT VALID) 이후 INSERT/UPDATE부터 강제. 연결 행은 삭제하지 않으므로 restrict.
alter table public.distribution_draft_revisions
  add constraint distribution_draft_revisions_target_connection_fk
  foreign key (target_connection_id) references public.distribution_channel_connections (id) on delete restrict not valid;
alter table public.distribution_jobs
  add constraint distribution_jobs_target_connection_fk
  foreign key (target_connection_id) references public.distribution_channel_connections (id) on delete restrict not valid;

-- ----------------------------------------------------------------------------
-- ACL: 내부 helper는 모든 역할 회수, RPC는 service_role만
-- ----------------------------------------------------------------------------
revoke all on function public.distribution_connection_scopes_valid(text[]) from public, anon, authenticated, service_role;
revoke all on function public.distribution_channel_connections_guard() from public, anon, authenticated, service_role;
revoke all on function public.distribution_connection_check_envelope(integer, integer, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.distribution_connection_check_meta(text, text[], timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.distribution_connection_meta(public.distribution_channel_connections) from public, anon, authenticated, service_role;
revoke all on function public.distribution_connection_lock(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.distribution_draft_revisions_target_check() from public, anon, authenticated, service_role;

revoke all on function public.distribution_create_channel_connection(uuid, text, text, text, text[], timestamptz, integer, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.distribution_reconnect_channel_connection(uuid, uuid, integer, text, text, text[], timestamptz, integer, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.distribution_revoke_channel_connection(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.distribution_mark_channel_connection_reauth(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.distribution_list_channel_connections(uuid) from public, anon, authenticated;
revoke all on function public.distribution_read_channel_credential(uuid, uuid) from public, anon, authenticated;

grant execute on function public.distribution_create_channel_connection(uuid, text, text, text, text[], timestamptz, integer, integer, text, text, text) to service_role;
grant execute on function public.distribution_reconnect_channel_connection(uuid, uuid, integer, text, text, text[], timestamptz, integer, integer, text, text, text) to service_role;
grant execute on function public.distribution_revoke_channel_connection(uuid, uuid, integer, text) to service_role;
grant execute on function public.distribution_mark_channel_connection_reauth(uuid, uuid, integer, text) to service_role;
grant execute on function public.distribution_list_channel_connections(uuid) to service_role;
grant execute on function public.distribution_read_channel_credential(uuid, uuid) to service_role;
