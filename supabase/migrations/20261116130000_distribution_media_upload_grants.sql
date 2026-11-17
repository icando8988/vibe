-- ============================================================================
-- 통합 배포 — 미디어 직접 업로드(private intake) grant
-- BE-UPLOAD-025 · 2026-11-17 · CC-BACKEND-01 Claude(Backend)
-- 상태: 로컬 PGlite 대역(upload-run.mjs)으로만 검증. 실제 Supabase 미적용. Storage bucket 생성 안 함.
-- 의존: 000000~120000(distribution_assert_admin_actor, distribution_create_media_asset, distribution_media_assets).
--       기존 테이블·함수·트리거는 바꾸지 않는다(forward only).
--
-- 설계
--   * grant(distribution_media_upload_grants): 서명 업로드 URL을 발급하기 **전에** 자산(pending_upload)과 함께 원자 기록.
--     - 서버 생성 nonce의 sha256만 저장(원문·서명 URL·Storage 토큰은 DB 어디에도 없다).
--     - 한 grant = 한 자산 = 한 경로(자산의 DB 생성 열 upload_object_path). 경로·파일명을 입력으로 받지 않는다.
--     - 신고 형식·크기(검사는 완료 때 바이트로 다시 한다), 앱 만료(expires_at, 300~1800초).
--     - 상태: issued → consumed(완료 처리 1회) | cancelled | expired. 되돌림 없음, 행 삭제 없음.
--   * 앱 만료는 "완료 요청을 받는 기한"일 뿐이다. Supabase 서명 업로드 토큰은 공식 문서상 2시간 유효·개별 철회 불가 →
--     만료·취소 뒤에도 그 경로로 바이트가 올라올 수 있다(완료는 거부, intake 고아 → Storage sweep은 별도 작업).
--   * 모든 테이블: RLS(정책 없음) + 공개 역할 직접 권한 회수. RPC는 service_role 전용 SECURITY DEFINER, search_path = ''.
--   * Storage bucket 계약(실제 생성은 운영 작업 — 이 파일은 실행하지 않는 계약만 적는다):
--       insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--       values ('distribution-media-intake', 'distribution-media-intake', false, 20971520, array['image/jpeg','image/png','image/webp']);
--       -- storage.objects 정책 없음: anon/authenticated 직접 접근 0. 쓰기는 서버 발급 서명 업로드 URL(upsert 없음)로만,
--       -- 읽기·삭제는 service_role 서버만. 변형 bucket 'distribution-media'(jpeg, 8MB)는 120000 계약 그대로.
-- 오류 토큰(메시지 앞 'TOKEN:'): UPLOAD_GRANT_INVALID(P0002) · UPLOAD_GRANT_USED · UPLOAD_GRANT_EXPIRED · UPLOAD_GRANT_CANCELLED ·
--   UPLOAD_GRANT_LIMIT (check_violation) · 기존 VERSION_CONFLICT · INVALID_TRANSITION · MEDIA_PENDING_LIMIT.
-- ============================================================================

create table public.distribution_media_upload_grants (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.distribution_media_assets (id) on delete restrict,
  actor_id uuid not null references auth.users (id) on delete restrict,
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  declared_content_type text not null check (declared_content_type in ('image/jpeg', 'image/png', 'image/webp')),
  declared_byte_size integer not null check (declared_byte_size between 1 and 20971520),
  status text not null default 'issued' check (status in ('issued', 'consumed', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  closed_at timestamptz,
  constraint distribution_media_upload_grants_ttl check (expires_at > created_at and expires_at <= created_at + interval '1800 seconds'),
  constraint distribution_media_upload_grants_state check (
    (status = 'issued' and consumed_at is null and closed_at is null)
    or (status = 'consumed' and consumed_at is not null and closed_at is null)
    or (status in ('cancelled', 'expired') and consumed_at is null and closed_at is not null)
  )
);
create index distribution_media_upload_grants_open_idx on public.distribution_media_upload_grants (actor_id, expires_at) where status = 'issued';
create index distribution_media_upload_grants_expiry_idx on public.distribution_media_upload_grants (expires_at) where status = 'issued';

alter table public.distribution_media_upload_grants enable row level security;
revoke all on table public.distribution_media_upload_grants from public, anon, authenticated, service_role;

-- 가드: 삭제 금지, 식별·신고·만료 열 불변, issued에서만 한 번 전이
create or replace function public.distribution_media_upload_grants_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'upload grants are not deleted' using errcode = 'restrict_violation';
  end if;
  if new.id is distinct from old.id or new.asset_id is distinct from old.asset_id or new.actor_id is distinct from old.actor_id
     or new.nonce_hash is distinct from old.nonce_hash or new.declared_content_type is distinct from old.declared_content_type
     or new.declared_byte_size is distinct from old.declared_byte_size or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at then
    raise exception 'upload grant identity is immutable' using errcode = 'check_violation';
  end if;
  if old.status <> 'issued' then
    raise exception 'INVALID_TRANSITION: upload grant is %', old.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger distribution_media_upload_grants_guard before update or delete on public.distribution_media_upload_grants
  for each row execute function public.distribution_media_upload_grants_guard();

-- 내부: actor 소유 grant 잠금 + 상태·만료 판정(nonce 불일치·타 actor·없음은 구분하지 않는다)
create or replace function public.distribution_media_upload_grant_lock(p_actor_id uuid, p_grant_id uuid, p_nonce_hash text)
returns public.distribution_media_upload_grants
language plpgsql
volatile
set search_path = ''
as $$
declare
  g public.distribution_media_upload_grants%rowtype;
begin
  select * into g from public.distribution_media_upload_grants x
   where x.id = p_grant_id and x.actor_id = p_actor_id and x.nonce_hash = p_nonce_hash
   for update;
  if not found or p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'UPLOAD_GRANT_INVALID: upload grant not found' using errcode = 'no_data_found';
  end if;
  if g.status = 'consumed' then
    raise exception 'UPLOAD_GRANT_USED: upload grant was already completed' using errcode = 'check_violation';
  elsif g.status = 'cancelled' then
    raise exception 'UPLOAD_GRANT_CANCELLED: upload grant was cancelled' using errcode = 'check_violation';
  elsif g.status = 'expired' or g.expires_at <= now() then
    raise exception 'UPLOAD_GRANT_EXPIRED: upload grant expired' using errcode = 'check_violation';
  end if;
  return g;
end;
$$;

-- 내부: grant 응답 JSON(경로는 서버 내부용 — 앱이 DTO로 내보내지 않는다)
create or replace function public.distribution_media_upload_grant_json(g public.distribution_media_upload_grants, a public.distribution_media_assets)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'grant_id', g.id, 'status', g.status, 'expires_at', g.expires_at,
    'declared_content_type', g.declared_content_type, 'declared_byte_size', g.declared_byte_size,
    'object_path', a.upload_object_path, 'asset', public.distribution_media_meta(a));
$$;

-- ----------------------------------------------------------------------------
-- 1) 발급: 자산(pending_upload) + grant 원자 기록 → 앱이 그 다음에 서명 업로드 URL을 만든다
-- ----------------------------------------------------------------------------
create or replace function public.distribution_issue_media_upload_grant(
  p_actor_id uuid, p_source text, p_source_note text, p_content_type text, p_byte_size integer, p_nonce_hash text, p_ttl_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_open integer;
  v_asset jsonb;
  a public.distribution_media_assets%rowtype;
  g public.distribution_media_upload_grants%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_content_type is null or p_content_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'content type is not allowed' using errcode = 'invalid_parameter_value';
  end if;
  if p_byte_size is null or p_byte_size not between 1 and 20971520 then
    raise exception 'byte size must be 1..20971520' using errcode = 'invalid_parameter_value';
  end if;
  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'nonce hash is malformed' using errcode = 'invalid_parameter_value';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 300 and 1800 then
    raise exception 'ttl must be 300..1800 seconds' using errcode = 'invalid_parameter_value';
  end if;
  -- actor 단위 직렬화(열린 grant 상한 경합 방지)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('distribution_media_upload_grant:' || p_actor_id::text, 0));
  select count(*) into v_open from public.distribution_media_upload_grants x
   where x.actor_id = p_actor_id and x.status = 'issued' and x.expires_at > now();
  if v_open >= 5 then
    raise exception 'UPLOAD_GRANT_LIMIT: finish or cancel open uploads first' using errcode = 'check_violation';
  end if;
  v_asset := public.distribution_create_media_asset(p_actor_id, p_source, p_source_note); -- source 검사·대기 자산 상한(MEDIA_PENDING_LIMIT)
  select * into a from public.distribution_media_assets x where x.id = (v_asset ->> 'id')::uuid;
  insert into public.distribution_media_upload_grants (asset_id, actor_id, nonce_hash, declared_content_type, declared_byte_size, expires_at)
  values (a.id, p_actor_id, p_nonce_hash, p_content_type, p_byte_size, now() + pg_catalog.make_interval(secs => p_ttl_seconds))
  returning * into g;
  return public.distribution_media_upload_grant_json(g, a);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) 조회(완료 전 원본 다운로드 위치 확인) — 상태를 바꾸지 않는다
-- ----------------------------------------------------------------------------
create or replace function public.distribution_get_media_upload_grant(p_actor_id uuid, p_grant_id uuid, p_nonce_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g public.distribution_media_upload_grants%rowtype;
  a public.distribution_media_assets%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  g := public.distribution_media_upload_grant_lock(p_actor_id, p_grant_id, p_nonce_hash);
  select * into a from public.distribution_media_assets x where x.id = g.asset_id;
  if a.archived_at is not null or a.status <> 'pending_upload' then
    raise exception 'INVALID_TRANSITION: media asset is %', a.status using errcode = 'check_violation';
  end if;
  return public.distribution_media_upload_grant_json(g, a);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) 소비(1회): 원본을 읽은 뒤 처리 직전에 원자적으로 consumed — 중복 완료는 UPLOAD_GRANT_USED
-- ----------------------------------------------------------------------------
create or replace function public.distribution_consume_media_upload_grant(
  p_actor_id uuid, p_grant_id uuid, p_nonce_hash text, p_expected_version integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g public.distribution_media_upload_grants%rowtype;
  a public.distribution_media_assets%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  g := public.distribution_media_upload_grant_lock(p_actor_id, p_grant_id, p_nonce_hash);
  a := public.distribution_media_lock(p_actor_id, g.asset_id, p_expected_version); -- ARCHIVED · VERSION_CONFLICT
  if a.status <> 'pending_upload' then
    raise exception 'INVALID_TRANSITION: media asset is %', a.status using errcode = 'check_violation';
  end if;
  update public.distribution_media_upload_grants set status = 'consumed', consumed_at = now() where id = g.id returning * into g;
  return public.distribution_media_upload_grant_json(g, a);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) 취소: grant cancelled + 자산 failed(UPLOAD_CANCELLED). 발급된 Storage 토큰은 무효화되지 않는다(문서화된 한계).
-- ----------------------------------------------------------------------------
create or replace function public.distribution_cancel_media_upload_grant(p_actor_id uuid, p_grant_id uuid, p_nonce_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g public.distribution_media_upload_grants%rowtype;
  a public.distribution_media_assets%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  g := public.distribution_media_upload_grant_lock(p_actor_id, p_grant_id, p_nonce_hash);
  update public.distribution_media_upload_grants set status = 'cancelled', closed_at = now() where id = g.id returning * into g;
  select * into a from public.distribution_media_assets x where x.id = g.asset_id for update;
  if a.archived_at is null and a.status = 'pending_upload' then
    update public.distribution_media_assets set status = 'failed', failure_code = 'UPLOAD_CANCELLED', row_version = a.row_version + 1
     where id = a.id returning * into a;
  end if;
  return public.distribution_media_upload_grant_json(g, a);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) 만료 정리(시스템 — 호출 주체(Cron 등)는 아직 없음): 만료된 issued grant → expired, 자산 failed(UPLOAD_EXPIRED)
-- ----------------------------------------------------------------------------
create or replace function public.distribution_expire_media_upload_grants(p_limit integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g public.distribution_media_upload_grants%rowtype;
  v_n integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'limit must be 1..500' using errcode = 'invalid_parameter_value';
  end if;
  for g in
    select * from public.distribution_media_upload_grants x
     where x.status = 'issued' and x.expires_at <= now()
     order by x.expires_at
     limit p_limit
     for update skip locked
  loop
    update public.distribution_media_upload_grants set status = 'expired', closed_at = now() where id = g.id;
    update public.distribution_media_assets a set status = 'failed', failure_code = 'UPLOAD_EXPIRED', row_version = a.row_version + 1
     where a.id = g.asset_id and a.status = 'pending_upload' and a.archived_at is null;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ----------------------------------------------------------------------------
-- ACL
-- ----------------------------------------------------------------------------
revoke all on function public.distribution_media_upload_grants_guard() from public, anon, authenticated, service_role;
revoke all on function public.distribution_media_upload_grant_lock(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.distribution_media_upload_grant_json(public.distribution_media_upload_grants, public.distribution_media_assets) from public, anon, authenticated, service_role;

revoke all on function public.distribution_issue_media_upload_grant(uuid, text, text, text, integer, text, integer) from public, anon, authenticated;
revoke all on function public.distribution_get_media_upload_grant(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.distribution_consume_media_upload_grant(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.distribution_cancel_media_upload_grant(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.distribution_expire_media_upload_grants(integer) from public, anon, authenticated;

grant execute on function public.distribution_issue_media_upload_grant(uuid, text, text, text, integer, text, integer) to service_role;
grant execute on function public.distribution_get_media_upload_grant(uuid, uuid, text) to service_role;
grant execute on function public.distribution_consume_media_upload_grant(uuid, uuid, text, integer) to service_role;
grant execute on function public.distribution_cancel_media_upload_grant(uuid, uuid, text) to service_role;
grant execute on function public.distribution_expire_media_upload_grants(integer) to service_role;
