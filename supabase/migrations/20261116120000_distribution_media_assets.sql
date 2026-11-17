-- ============================================================================
-- 통합 배포 — M4 최소: 미디어 자산·변형 metadata, 권리 결정 이력, 게시용 서명 승인
-- AUTOPOST-M4-MEDIA-022 · 2026-11-17 · CC-ENG (Claude Code)
-- 상태: 로컬 PGlite 대역(media-run.mjs)으로만 검증. 실제 Supabase 미적용. Storage bucket 생성 안 함.
-- 의존: 000000~110000(distribution_assert_admin_actor, distribution_draft_revision_media). 기존 함수·트리거는 바꾸지 않는다.
--
-- 설계
--   * 자산(distribution_media_assets): 소유 actor, 상태(pending_upload → processing → ready | failed), 원본 검사 결과
--     (감지 형식·바이트·sha256·픽셀), 출처, 권리 상태 캐시(최신 결정), 허용 채널, 권리 유효기한, 보관(archived_at), row_version.
--   * 변형(distribution_media_variants): 서버 sharp가 만든 sRGB JPEG(EXIF 방향 적용·metadata 제거)의 경로·바이트·폭·높이·sha256. 불변.
--   * 권리 결정 이력(distribution_media_rights_decisions): approved/rejected/revoked 불변 기록(수정·삭제 금지).
--   * 서명 승인 기록(distribution_media_signing_grants): 게시용 서명 URL 발급 승인 메타(채널·만료·변형·sha256)만.
--     서명 URL·토큰은 DB 어디에도 없다.
--   * 객체 경로는 **생성 열**(서버가 만든 uuid로만 구성) → 사용자 파일명·경로를 받지 않고, 누구도 경로를 바꿀 수 없다.
--       업로드 대기 객체:  uploads/<owner_id>/<asset_id>/original     (통제된 직접 업로드용 — 이번에는 바이트 입력이 기본)
--       변형 객체:         variants/<asset_id>/<kind>.jpg
--     원본 바이트는 기본적으로 저장하지 않는다(EXIF·GPS 등 개인 metadata 보호). 원본 sha256·크기·형식만 남긴다.
--   * 모든 테이블: RLS(정책 없음) + 모든 공개 역할 직접 권한 회수. 쓰기·조회는 service_role 전용 SECURITY DEFINER 함수만,
--     search_path = ''. 매 호출 p_actor_id D1 + 소유권 + expected row_version.
--   * 기존 리비전 미디어(distribution_draft_revision_media.asset_id/variant_id) 호환:
--       - 마이그레이션 시 고아 참조 수를 NOTICE로 보고(자동 삭제 없음), FK는 NOT VALID로 추가(이후 쓰기부터 강제).
--       - 새 리비전 미디어 INSERT 트리거: 자산 존재·미보관·ready, 변형(있으면)이 같은 자산 소속.
--       - 참조된 자산은 보관(archive) 거부, 자산·변형·결정 행 삭제는 항상 금지(FK restrict + 트리거).
--   * Storage bucket(실제 생성은 운영 작업 — 이 파일은 실행하지 않는 계약만 적는다):
--       insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--       values ('distribution-media', 'distribution-media', false, 8388608, array['image/jpeg']);
--       -- storage.objects 정책은 만들지 않는다: anon/authenticated 접근 0, service_role 서버만 업로드·서명.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- helper
-- ----------------------------------------------------------------------------
create or replace function public.distribution_media_channels_valid(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and pg_catalog.cardinality(p) between 1 and 3
    and pg_catalog.array_position(p, null) is null
    and (select pg_catalog.bool_and(c in ('blog', 'threads', 'instagram')) from pg_catalog.unnest(p) c)
    and (select pg_catalog.count(distinct c) = pg_catalog.count(*) from pg_catalog.unnest(p) c);
$$;

-- ----------------------------------------------------------------------------
-- 자산
-- ----------------------------------------------------------------------------
create table public.distribution_media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  status text not null default 'pending_upload' check (status in ('pending_upload', 'processing', 'ready', 'failed')),
  upload_object_path text generated always as ('uploads/' || owner_id::text || '/' || id::text || '/original') stored,
  source text not null check (source in ('own_creation', 'licensed', 'public_domain', 'other')),
  source_note text check (source_note is null or (char_length(source_note) <= 500 and source_note !~ '[[:cntrl:]]')),
  original_format text check (original_format is null or original_format in ('jpeg', 'png', 'webp')),
  original_byte_size integer check (original_byte_size is null or original_byte_size between 1 and 52428800),
  original_width integer check (original_width is null or original_width between 1 and 100000),
  original_height integer check (original_height is null or original_height between 1 and 100000),
  original_sha256 text check (original_sha256 is null or original_sha256 ~ '^[0-9a-f]{64}$'),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  rights_state text not null default 'unreviewed' check (rights_state in ('unreviewed', 'approved', 'rejected', 'revoked')),
  allowed_channels text[] check (allowed_channels is null or public.distribution_media_channels_valid(allowed_channels)),
  rights_valid_until timestamptz,
  archived_at timestamptz,
  row_version integer not null default 1 check (row_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint distribution_media_assets_failed check ((status = 'failed') = (failure_code is not null)),
  constraint distribution_media_assets_original_set check (
    -- 원본 검사 전 실패(형식 불명·손상 등)는 원본 정보 없이 failed가 될 수 있다
    status in ('pending_upload', 'failed') or (original_format is not null and original_byte_size is not null and original_sha256 is not null)
  ),
  constraint distribution_media_assets_rights_shape check (
    (rights_state = 'approved') = (allowed_channels is not null)
  )
);
create index distribution_media_assets_owner_idx on public.distribution_media_assets (owner_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 변형(불변)
-- ----------------------------------------------------------------------------
create table public.distribution_media_variants (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.distribution_media_assets (id) on delete restrict,
  kind text not null check (kind in ('feed_jpeg')),
  object_path text generated always as ('variants/' || asset_id::text || '/' || kind || '.jpg') stored,
  mime_type text not null check (mime_type = 'image/jpeg'),
  byte_size integer not null check (byte_size between 1 and 8388608),        -- 플랫폼 상한 8MB(공식 문서) 이하
  width integer not null check (width between 320 and 1440),                   -- Instagram 피드 폭 범위(공식 문서)
  height integer not null check (height between 1 and 4000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  color_space text not null check (color_space = 'srgb'),
  created_at timestamptz not null default now(),
  unique (asset_id, kind)
);

-- ----------------------------------------------------------------------------
-- 권리 결정 이력(불변)
-- ----------------------------------------------------------------------------
create table public.distribution_media_rights_decisions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.distribution_media_assets (id) on delete restrict,
  decision text not null check (decision in ('approved', 'rejected', 'revoked')),
  allowed_channels text[] check (allowed_channels is null or public.distribution_media_channels_valid(allowed_channels)),
  valid_until timestamptz,
  note text check (note is null or (char_length(note) <= 1000 and note !~ '[[:cntrl:]]')),
  actor_id uuid not null references auth.users (id) on delete restrict,
  asset_row_version integer not null,
  created_at timestamptz not null default now(),
  constraint distribution_media_rights_decisions_shape check ((decision = 'approved') = (allowed_channels is not null))
);
create index distribution_media_rights_decisions_asset_idx on public.distribution_media_rights_decisions (asset_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 서명 승인 기록(URL·토큰 없음, 만료 메타만)
-- ----------------------------------------------------------------------------
create table public.distribution_media_signing_grants (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.distribution_media_assets (id) on delete restrict,
  variant_id uuid not null references public.distribution_media_variants (id) on delete restrict,
  actor_id uuid not null references auth.users (id) on delete restrict,
  channel text not null check (channel in ('blog', 'threads', 'instagram')),
  variant_sha256 text not null check (variant_sha256 ~ '^[0-9a-f]{64}$'),
  ttl_seconds integer not null check (ttl_seconds between 60 and 900),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index distribution_media_signing_grants_asset_idx on public.distribution_media_signing_grants (asset_id, created_at desc);

alter table public.distribution_media_assets enable row level security;
alter table public.distribution_media_variants enable row level security;
alter table public.distribution_media_rights_decisions enable row level security;
alter table public.distribution_media_signing_grants enable row level security;
revoke all on table public.distribution_media_assets from public, anon, authenticated, service_role;
revoke all on table public.distribution_media_variants from public, anon, authenticated, service_role;
revoke all on table public.distribution_media_rights_decisions from public, anon, authenticated, service_role;
revoke all on table public.distribution_media_signing_grants from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 가드: 삭제 금지·불변 열·row_version +1, 변형·결정·서명 기록 불변
-- ----------------------------------------------------------------------------
create or replace function public.distribution_media_assets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'media assets are not deleted (archive instead)' using errcode = 'restrict_violation';
  end if;
  if new.owner_id is distinct from old.owner_id or new.source is distinct from old.source or new.created_at is distinct from old.created_at then
    raise exception 'media asset owner/source are immutable' using errcode = 'check_violation';
  end if;
  if old.original_sha256 is not null and (new.original_sha256 is distinct from old.original_sha256
     or new.original_byte_size is distinct from old.original_byte_size or new.original_format is distinct from old.original_format) then
    raise exception 'recorded original checksum is immutable' using errcode = 'check_violation';
  end if;
  if old.archived_at is not null then
    raise exception 'ARCHIVED: archived media assets are final' using errcode = 'check_violation';
  end if;
  if new.row_version <> old.row_version + 1 then
    raise exception 'row_version must advance by 1' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger distribution_media_assets_guard before update or delete on public.distribution_media_assets
  for each row execute function public.distribution_media_assets_guard();

create or replace function public.distribution_media_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = 'restrict_violation';
end;
$$;
create trigger distribution_media_variants_immutable before update or delete on public.distribution_media_variants
  for each row execute function public.distribution_media_immutable();
create trigger distribution_media_rights_decisions_immutable before update or delete on public.distribution_media_rights_decisions
  for each row execute function public.distribution_media_immutable();
create trigger distribution_media_signing_grants_immutable before update or delete on public.distribution_media_signing_grants
  for each row execute function public.distribution_media_immutable();

-- ----------------------------------------------------------------------------
-- 내부 helper: metadata JSON(경로·비밀 없음) · 소유 행 잠금
-- ----------------------------------------------------------------------------
create or replace function public.distribution_media_meta(a public.distribution_media_assets)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', a.id, 'status', a.status, 'source', a.source, 'source_note', a.source_note,
    'original_format', a.original_format, 'original_byte_size', a.original_byte_size,
    'original_width', a.original_width, 'original_height', a.original_height, 'failure_code', a.failure_code,
    'rights_state', a.rights_state, 'allowed_channels', pg_catalog.to_jsonb(a.allowed_channels),
    'rights_valid_until', a.rights_valid_until, 'archived_at', a.archived_at, 'row_version', a.row_version,
    'created_at', a.created_at, 'updated_at', a.updated_at,
    'variant', (select pg_catalog.jsonb_build_object('id', v.id, 'kind', v.kind, 'byte_size', v.byte_size, 'width', v.width,
                       'height', v.height, 'sha256', v.sha256)
                from public.distribution_media_variants v where v.asset_id = a.id and v.kind = 'feed_jpeg'));
$$;

create or replace function public.distribution_media_lock(p_actor_id uuid, p_asset_id uuid, p_expected_version integer)
returns public.distribution_media_assets
language plpgsql
volatile
set search_path = ''
as $$
declare
  a public.distribution_media_assets%rowtype;
begin
  select * into a from public.distribution_media_assets x where x.id = p_asset_id and x.owner_id = p_actor_id for update;
  if not found then
    raise exception 'media asset not found' using errcode = 'no_data_found';
  end if;
  if a.archived_at is not null then
    raise exception 'ARCHIVED: media asset is archived' using errcode = 'check_violation';
  end if;
  if p_expected_version is null or a.row_version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: media asset is at version % (expected %)', a.row_version, p_expected_version using errcode = 'P0001';
  end if;
  return a;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) 자산 생성(업로드 대기) — 경로는 생성 열, 사용자 파일명 없음
-- ----------------------------------------------------------------------------
create or replace function public.distribution_create_media_asset(p_actor_id uuid, p_source text, p_source_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.distribution_media_assets%rowtype;
  v_pending integer;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_source is null or p_source not in ('own_creation', 'licensed', 'public_domain', 'other') then
    raise exception 'source is not allowed' using errcode = 'invalid_parameter_value';
  end if;
  if p_source_note is not null and (char_length(p_source_note) > 500 or p_source_note ~ '[[:cntrl:]]') then
    raise exception 'source note must be at most 500 characters' using errcode = 'invalid_parameter_value';
  end if;
  select count(*) into v_pending from public.distribution_media_assets x
  where x.owner_id = p_actor_id and x.status in ('pending_upload', 'processing') and x.archived_at is null;
  if v_pending >= 20 then
    raise exception 'MEDIA_PENDING_LIMIT: finish or archive pending uploads first' using errcode = 'check_violation';
  end if;
  insert into public.distribution_media_assets (owner_id, source, source_note) values (p_actor_id, p_source, nullif(pg_catalog.btrim(p_source_note), ''))
  returning * into a;
  return public.distribution_media_meta(a) || pg_catalog.jsonb_build_object('upload_object_path', a.upload_object_path);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) 원본 수신 기록 → processing (앱이 바이트를 받아 형식·크기·픽셀·sha256을 검사한 결과)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_mark_media_received(
  p_actor_id uuid, p_asset_id uuid, p_expected_version integer,
  p_format text, p_byte_size integer, p_width integer, p_height integer, p_sha256 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.distribution_media_assets%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  a := public.distribution_media_lock(p_actor_id, p_asset_id, p_expected_version);
  if a.status <> 'pending_upload' then
    raise exception 'INVALID_TRANSITION: media asset is %', a.status using errcode = 'check_violation';
  end if;
  if p_format is null or p_format not in ('jpeg', 'png', 'webp') or p_byte_size is null or p_byte_size not between 1 and 52428800
     or p_width is null or p_width not between 1 and 100000 or p_height is null or p_height not between 1 and 100000
     or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'original metadata is malformed' using errcode = 'invalid_parameter_value';
  end if;
  update public.distribution_media_assets
     set status = 'processing', original_format = p_format, original_byte_size = p_byte_size, original_width = p_width,
         original_height = p_height, original_sha256 = p_sha256, row_version = a.row_version + 1
   where id = a.id returning * into a;
  return public.distribution_media_meta(a);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) 변환 완료 → 변형 기록 + ready
-- ----------------------------------------------------------------------------
create or replace function public.distribution_complete_media_processing(
  p_actor_id uuid, p_asset_id uuid, p_expected_version integer,
  p_byte_size integer, p_width integer, p_height integer, p_sha256 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.distribution_media_assets%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  a := public.distribution_media_lock(p_actor_id, p_asset_id, p_expected_version);
  if a.status <> 'processing' then
    raise exception 'INVALID_TRANSITION: media asset is %', a.status using errcode = 'check_violation';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'variant checksum is malformed' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.distribution_media_variants (asset_id, kind, mime_type, byte_size, width, height, sha256, color_space)
  values (a.id, 'feed_jpeg', 'image/jpeg', p_byte_size, p_width, p_height, p_sha256, 'srgb');
  update public.distribution_media_assets set status = 'ready', row_version = a.row_version + 1 where id = a.id returning * into a;
  return public.distribution_media_meta(a);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) 처리 실패(최종)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_fail_media_processing(p_actor_id uuid, p_asset_id uuid, p_expected_version integer, p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.distribution_media_assets%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_code is null or p_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'failure code is malformed' using errcode = 'invalid_parameter_value';
  end if;
  a := public.distribution_media_lock(p_actor_id, p_asset_id, p_expected_version);
  if a.status not in ('pending_upload', 'processing') then
    raise exception 'INVALID_TRANSITION: media asset is %', a.status using errcode = 'check_violation';
  end if;
  update public.distribution_media_assets set status = 'failed', failure_code = p_code, row_version = a.row_version + 1
   where id = a.id returning * into a;
  return public.distribution_media_meta(a);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) 권리 결정(approved / rejected / revoked) — 불변 이력 + 캐시 갱신
-- ----------------------------------------------------------------------------
create or replace function public.distribution_decide_media_rights(
  p_actor_id uuid, p_asset_id uuid, p_expected_version integer,
  p_decision text, p_allowed_channels text[] default null, p_valid_until timestamptz default null, p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.distribution_media_assets%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  a := public.distribution_media_lock(p_actor_id, p_asset_id, p_expected_version);
  if p_decision is null or p_decision not in ('approved', 'rejected', 'revoked') then
    raise exception 'decision must be approved, rejected or revoked' using errcode = 'invalid_parameter_value';
  end if;
  if p_note is not null and (char_length(p_note) > 1000 or p_note ~ '[[:cntrl:]]') then
    raise exception 'note must be at most 1000 characters' using errcode = 'invalid_parameter_value';
  end if;
  if p_decision = 'approved' then
    if a.status <> 'ready' then
      raise exception 'INVALID_TRANSITION: rights are approved only for ready assets' using errcode = 'check_violation';
    end if;
    if not public.distribution_media_channels_valid(p_allowed_channels) then
      raise exception 'allowed channels must be 1..3 distinct of blog/threads/instagram' using errcode = 'invalid_parameter_value';
    end if;
    if p_valid_until is not null and p_valid_until <= now() then
      raise exception 'valid_until must be in the future' using errcode = 'invalid_parameter_value';
    end if;
  elsif p_allowed_channels is not null or p_valid_until is not null then
    raise exception 'channels and validity belong to approvals only' using errcode = 'invalid_parameter_value';
  end if;
  if p_decision = 'revoked' and a.rights_state <> 'approved' then
    raise exception 'INVALID_TRANSITION: only approved rights can be revoked' using errcode = 'check_violation';
  end if;
  if p_decision = 'rejected' and a.rights_state = 'approved' then
    raise exception 'INVALID_TRANSITION: revoke the approval instead of rejecting' using errcode = 'check_violation';
  end if;

  insert into public.distribution_media_rights_decisions (asset_id, decision, allowed_channels, valid_until, note, actor_id, asset_row_version)
  values (a.id, p_decision, p_allowed_channels, p_valid_until, nullif(pg_catalog.btrim(p_note), ''), p_actor_id, a.row_version);
  update public.distribution_media_assets
     set rights_state = p_decision,
         allowed_channels = case when p_decision = 'approved' then p_allowed_channels else null end,
         rights_valid_until = case when p_decision = 'approved' then p_valid_until else null end,
         row_version = a.row_version + 1
   where id = a.id returning * into a;
  return public.distribution_media_meta(a);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) 보관(참조된 자산은 거부, 행 삭제는 없음)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_archive_media_asset(p_actor_id uuid, p_asset_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.distribution_media_assets%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  a := public.distribution_media_lock(p_actor_id, p_asset_id, p_expected_version);
  if exists (select 1 from public.distribution_draft_revision_media m where m.asset_id = a.id) then
    raise exception 'ASSET_REFERENCED: media asset is used by a draft revision' using errcode = 'check_violation';
  end if;
  update public.distribution_media_assets set archived_at = now(), row_version = a.row_version + 1 where id = a.id returning * into a;
  return public.distribution_media_meta(a);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) 목록(소유 actor만, 경로·서명 없음)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_list_media_assets(p_actor_id uuid)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  return query
    select public.distribution_media_meta(a) from public.distribution_media_assets a
    where a.owner_id = p_actor_id order by a.created_at desc, a.id desc limit 100;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8) 게시용 서명 승인: D1·소유·미보관·ready·권리 approved·유효기한(TTL 포함)·허용 채널·변형 소속·sha256 일치를
--    재검사한 뒤 승인 기록(URL 없음)을 남기고, 서버가 서명할 변형 경로와 고정 메타를 돌려준다.
-- ----------------------------------------------------------------------------
create or replace function public.distribution_authorize_media_signing(
  p_actor_id uuid, p_asset_id uuid, p_variant_id uuid, p_expected_sha256 text, p_channel text, p_ttl_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.distribution_media_assets%rowtype;
  v public.distribution_media_variants%rowtype;
  v_expires timestamptz;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_channel is null or p_channel not in ('blog', 'threads', 'instagram') then
    raise exception 'channel is not allowed' using errcode = 'invalid_parameter_value';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 60 and 900 then
    raise exception 'ttl must be 60..900 seconds' using errcode = 'invalid_parameter_value';
  end if;
  select * into a from public.distribution_media_assets x where x.id = p_asset_id and x.owner_id = p_actor_id for share;
  if not found then
    raise exception 'media asset not found' using errcode = 'no_data_found';
  end if;
  v_expires := now() + pg_catalog.make_interval(secs => p_ttl_seconds);
  if a.archived_at is not null then
    raise exception 'ARCHIVED: media asset is archived' using errcode = 'check_violation';
  end if;
  if a.status <> 'ready' then
    raise exception 'MEDIA_NOT_READY: media asset is %', a.status using errcode = 'check_violation';
  end if;
  if a.rights_state <> 'approved' then
    raise exception 'RIGHTS_NOT_APPROVED: rights are %', a.rights_state using errcode = 'check_violation';
  end if;
  if a.rights_valid_until is not null and a.rights_valid_until <= v_expires then
    raise exception 'RIGHTS_EXPIRED: rights end before the signed url would expire' using errcode = 'check_violation';
  end if;
  if not (p_channel = any (a.allowed_channels)) then
    raise exception 'CHANNEL_NOT_ALLOWED: rights do not cover %', p_channel using errcode = 'check_violation';
  end if;
  select * into v from public.distribution_media_variants x where x.id = p_variant_id and x.asset_id = a.id;
  if not found then
    raise exception 'VARIANT_MISMATCH: variant does not belong to the asset' using errcode = 'check_violation';
  end if;
  if p_expected_sha256 is null or v.sha256 <> p_expected_sha256 then
    raise exception 'VARIANT_MISMATCH: variant checksum differs from the pinned value' using errcode = 'check_violation';
  end if;

  insert into public.distribution_media_signing_grants (asset_id, variant_id, actor_id, channel, variant_sha256, ttl_seconds, expires_at)
  values (a.id, v.id, p_actor_id, p_channel, v.sha256, p_ttl_seconds, v_expires);
  return pg_catalog.jsonb_build_object(
    'asset_id', a.id, 'variant_id', v.id, 'object_path', v.object_path, 'sha256', v.sha256, 'byte_size', v.byte_size,
    'width', v.width, 'height', v.height, 'mime_type', v.mime_type, 'channel', p_channel, 'expires_at', v_expires, 'ttl_seconds', p_ttl_seconds);
end;
$$;

-- ----------------------------------------------------------------------------
-- 기존 리비전 미디어 호환: 고아 사전 점검(NOTICE, 자동 삭제 없음) → FK NOT VALID → 새 INSERT 검사
-- ----------------------------------------------------------------------------
do $$
declare
  v_orphan_assets integer;
  v_orphan_variants integer;
begin
  select count(*) into v_orphan_assets from public.distribution_draft_revision_media m
  where not exists (select 1 from public.distribution_media_assets a where a.id = m.asset_id);
  select count(*) into v_orphan_variants from public.distribution_draft_revision_media m
  where m.variant_id is not null and not exists (select 1 from public.distribution_media_variants v where v.id = m.variant_id);
  if v_orphan_assets > 0 or v_orphan_variants > 0 then
    raise notice 'distribution_draft_revision_media: % orphan asset refs, % orphan variant refs (kept; FK added NOT VALID)',
      v_orphan_assets, v_orphan_variants;
  end if;
end;
$$;

alter table public.distribution_draft_revision_media
  add constraint distribution_draft_revision_media_asset_fk
  foreign key (asset_id) references public.distribution_media_assets (id) on delete restrict not valid;
alter table public.distribution_draft_revision_media
  add constraint distribution_draft_revision_media_variant_fk
  foreign key (variant_id) references public.distribution_media_variants (id) on delete restrict not valid;

-- invoker 권한: 리비전 미디어 INSERT는 소유자 DEFINER 함수(050000 append)로만 일어난다.
create or replace function public.distribution_revision_media_asset_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  a public.distribution_media_assets%rowtype;
begin
  select * into a from public.distribution_media_assets x where x.id = new.asset_id;
  if not found or a.archived_at is not null or a.status <> 'ready' then
    raise exception 'MEDIA_NOT_READY: revision media must reference a ready, active asset' using errcode = 'check_violation';
  end if;
  if new.variant_id is not null and not exists (
    select 1 from public.distribution_media_variants v where v.id = new.variant_id and v.asset_id = new.asset_id
  ) then
    raise exception 'VARIANT_MISMATCH: variant does not belong to the asset' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger distribution_revision_media_asset_check before insert on public.distribution_draft_revision_media
  for each row execute function public.distribution_revision_media_asset_check();

-- ----------------------------------------------------------------------------
-- ACL
-- ----------------------------------------------------------------------------
revoke all on function public.distribution_media_channels_valid(text[]) from public, anon, authenticated, service_role;
revoke all on function public.distribution_media_assets_guard() from public, anon, authenticated, service_role;
revoke all on function public.distribution_media_immutable() from public, anon, authenticated, service_role;
revoke all on function public.distribution_media_meta(public.distribution_media_assets) from public, anon, authenticated, service_role;
revoke all on function public.distribution_media_lock(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.distribution_revision_media_asset_check() from public, anon, authenticated, service_role;

revoke all on function public.distribution_create_media_asset(uuid, text, text) from public, anon, authenticated;
revoke all on function public.distribution_mark_media_received(uuid, uuid, integer, text, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public.distribution_complete_media_processing(uuid, uuid, integer, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public.distribution_fail_media_processing(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.distribution_decide_media_rights(uuid, uuid, integer, text, text[], timestamptz, text) from public, anon, authenticated;
revoke all on function public.distribution_archive_media_asset(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.distribution_list_media_assets(uuid) from public, anon, authenticated;
revoke all on function public.distribution_authorize_media_signing(uuid, uuid, uuid, text, text, integer) from public, anon, authenticated;

grant execute on function public.distribution_create_media_asset(uuid, text, text) to service_role;
grant execute on function public.distribution_mark_media_received(uuid, uuid, integer, text, integer, integer, integer, text) to service_role;
grant execute on function public.distribution_complete_media_processing(uuid, uuid, integer, integer, integer, integer, text) to service_role;
grant execute on function public.distribution_fail_media_processing(uuid, uuid, integer, text) to service_role;
grant execute on function public.distribution_decide_media_rights(uuid, uuid, integer, text, text[], timestamptz, text) to service_role;
grant execute on function public.distribution_archive_media_asset(uuid, uuid, integer) to service_role;
grant execute on function public.distribution_list_media_assets(uuid) to service_role;
grant execute on function public.distribution_authorize_media_signing(uuid, uuid, uuid, text, text, integer) to service_role;
