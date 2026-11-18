-- ============================================================================
-- 통합 배포 — 글감 후보 수집 1단계(수동 메모·출처 링크) (forward only)
-- TOPIC-COLLECT-131 · 2026-11-19 · Claude(Backend)
-- 상태: 로컬 PGlite 대역으로만 검증. 실제 Supabase 미적용(적용은 별도 승인). 기존 migration·함수는 바꾸지 않는다.
-- 의존: 000000~160000(distribution_assert_admin_actor, private.is_distribution_admin, distribution_canonical_url,
--       distribution_create_content, distribution_contents).
--
-- 범위(1단계)
--   * 승인된 관리자(D1)가 직접 입력한 글감: 제목 + 메모 + (선택) 출처 링크·출처 이름·분류·출처 날짜.
--   * 출처 링크는 **문자열로만 저장**한다. 서버·DB는 그 주소로 어떤 요청도 보내지 않는다(RSS·웹·공급자 수집은 다음 단계).
--   * 중복 판정(dedupe_key, DB가 계산): 링크가 있으면 정규화한 링크(scheme·host 소문자, #조각 제거), 없으면 제목+메모
--     (공백 정리·소문자). 제외(dismissed)하지 않은 후보 가운데 같은 키가 있으면 새로 만들지 않고 기존 후보를 알려준다.
--   * 상태: new(수집됨) ↔ selected(골라 둠) → converted(원문으로 변환, 최종) / dismissed(제외, new로 되돌릴 수 있음).
--   * 원문 변환: 기존 distribution_create_content를 같은 트랜잭션에서 호출하고 후보에 원문 id를 연결한다.
--     이미 변환된 후보를 다시 변환하면 새 원문을 만들지 않고 **같은 원문**을 돌려준다(중복 요청 안전).
--     변환은 원문 1버전 생성까지만 — 승인·채널 초안·작업·게시를 만들지 않는다.
--   * 소유: 후보는 수집한 관리자(collected_by) 기록을 남기고, 원문 소유자는 기존 규칙대로 변환한 actor다(기존 원문 구조 불변).
--   * 읽기: authenticated + D1 정책(기존 distribution 테이블과 같음). 쓰기: service_role 전용 DEFINER 함수(p_actor_id로 D1 재검사).
-- ============================================================================

create table public.distribution_topic_candidates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200 and title !~ '[[:cntrl:]]'),
  -- 메모(자유 텍스트, 줄바꿈 허용). 길이 상한으로 긴 본문 붙여넣기를 막는다.
  memo text not null default '' check (char_length(memo) <= 5000),
  -- 참고 주소: 저장만 한다(요청 없음). https만, 사용자정보(@)·공백 없음.
  source_url text check (
    source_url is null
    or (char_length(source_url) <= 2048 and source_url ~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$')
  ),
  source_name text check (source_name is null or (char_length(source_name) between 1 and 100 and source_name !~ '[[:cntrl:]]')),
  category text check (category is null or (char_length(category) between 1 and 50 and category !~ '[[:cntrl:]]')),
  -- 출처가 밝힌 날짜(관리자 입력, 선택). 수집 시각(collected_at)과 별개로 보존한다.
  source_date date,
  dedupe_key text not null check (dedupe_key ~ '^[0-9a-f]{64}$'),
  status text not null default 'new' check (status in ('new', 'selected', 'converted', 'dismissed')),
  converted_content_id uuid references public.distribution_contents (id) on delete restrict,
  converted_at timestamptz,
  converted_by uuid references auth.users (id) on delete restrict,
  collected_by uuid not null references auth.users (id) on delete restrict,
  collected_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version >= 1),
  updated_at timestamptz not null default now(),
  constraint distribution_topic_candidates_converted_pair check (
    (status = 'converted') = (converted_content_id is not null)
    and (converted_content_id is null) = (converted_at is null)
    and (converted_content_id is null) = (converted_by is null)
  )
);
-- 제외하지 않은 후보끼리 같은 글감 금지(동시 입력도 차단)
create unique index distribution_topic_candidates_dedupe_uidx
  on public.distribution_topic_candidates (dedupe_key) where status <> 'dismissed';
-- 원문 하나는 후보 하나에서만
create unique index distribution_topic_candidates_content_uidx
  on public.distribution_topic_candidates (converted_content_id) where converted_content_id is not null;
create index distribution_topic_candidates_list_idx
  on public.distribution_topic_candidates (status, collected_at desc);

alter table public.distribution_topic_candidates enable row level security;
revoke all on table public.distribution_topic_candidates from public, anon, authenticated, service_role;
grant select (id, title, memo, source_url, source_name, category, source_date, status, converted_content_id, converted_at,
              collected_by, collected_at, row_version, updated_at)
  on public.distribution_topic_candidates to authenticated;
create policy distribution_topic_candidates_admin_read on public.distribution_topic_candidates
  for select to authenticated using ((select private.is_distribution_admin()));

-- 불변 열·삭제 금지·버전 증가·변환 최종 상태
create or replace function public.distribution_topic_candidates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'topic candidates are not deleted (dismiss instead)' using errcode = 'restrict_violation';
  end if;
  if new.title is distinct from old.title or new.memo is distinct from old.memo
     or new.source_url is distinct from old.source_url or new.source_name is distinct from old.source_name
     or new.category is distinct from old.category or new.source_date is distinct from old.source_date
     or new.dedupe_key is distinct from old.dedupe_key or new.collected_by is distinct from old.collected_by
     or new.collected_at is distinct from old.collected_at then
    raise exception 'topic candidate input is immutable (collect a new candidate instead)' using errcode = 'check_violation';
  end if;
  if old.status = 'converted' then
    raise exception 'ALREADY_CONVERTED: converted topic candidates are final' using errcode = 'check_violation';
  end if;
  if new.row_version <> old.row_version + 1 then
    raise exception 'row_version must advance by 1' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger distribution_topic_candidates_guard
  before update or delete on public.distribution_topic_candidates
  for each row execute function public.distribution_topic_candidates_guard();

-- 중복 키(내부 helper). 링크 우선, 없으면 제목+메모.
create or replace function public.distribution_topic_dedupe_key(p_title text, p_memo text, p_source_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    case
      when p_source_url is not null
        then 'url:' || pg_catalog.regexp_replace(public.distribution_canonical_url(p_source_url), '#.*$', '')
      else 'text:' || lower(pg_catalog.regexp_replace(btrim(p_title), '[[:space:]]+', ' ', 'g'))
           || E'\n' || lower(pg_catalog.regexp_replace(btrim(coalesce(p_memo, '')), '[[:space:]]+', ' ', 'g'))
    end, 'UTF8')), 'hex');
$$;

-- 1) 후보 수집. 반환: {created:true, candidate_id} | {created:false, duplicate_of, duplicate_status}
create or replace function public.distribution_create_topic_candidate(
  p_actor_id uuid,
  p_title text,
  p_memo text default '',
  p_source_url text default null,
  p_source_name text default null,
  p_category text default null,
  p_source_date text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_memo text := btrim(coalesce(p_memo, ''));
  v_url text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_key text;
  v_date date;
  v_id uuid;
  v_dup record;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if v_title = '' then
    raise exception 'title is required' using errcode = 'invalid_parameter_value';
  end if;
  -- 날짜는 'YYYY-MM-DD' 문자열로 받는다(형식 검사 후 변환). 잘못된 달력 날짜는 변환 오류를 22023으로 바꾼다.
  if nullif(btrim(coalesce(p_source_date, '')), '') is not null then
    if btrim(p_source_date) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'source_date must be YYYY-MM-DD' using errcode = 'invalid_parameter_value';
    end if;
    begin
      v_date := btrim(p_source_date)::date;
    exception when others then
      raise exception 'source_date must be a real date' using errcode = 'invalid_parameter_value';
    end;
    if v_date > (now() at time zone 'utc')::date + 1 or v_date < date '1990-01-01' then
      raise exception 'source_date is out of range' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  v_key := public.distribution_topic_dedupe_key(v_title, v_memo, v_url);

  select c.id, c.status into v_dup from public.distribution_topic_candidates c
  where c.dedupe_key = v_key and c.status <> 'dismissed';
  if found then
    return pg_catalog.jsonb_build_object('created', false, 'duplicate_of', v_dup.id, 'duplicate_status', v_dup.status);
  end if;

  begin
    insert into public.distribution_topic_candidates (title, memo, source_url, source_name, category, source_date, dedupe_key, collected_by)
    values (v_title, v_memo, v_url, nullif(btrim(coalesce(p_source_name, '')), ''), nullif(btrim(coalesce(p_category, '')), ''),
            v_date, v_key, p_actor_id)
    returning id into v_id;
  exception when unique_violation then
    -- 동시 입력: 먼저 커밋된 후보를 알려준다
    select c.id, c.status into v_dup from public.distribution_topic_candidates c
    where c.dedupe_key = v_key and c.status <> 'dismissed';
    return pg_catalog.jsonb_build_object('created', false, 'duplicate_of', v_dup.id, 'duplicate_status', v_dup.status);
  end;
  return pg_catalog.jsonb_build_object('created', true, 'candidate_id', v_id);
end;
$$;

-- 2) 상태 변경(new ↔ selected, → dismissed, dismissed → new). 반환: {candidate_id, status, row_version}
create or replace function public.distribution_set_topic_candidate_status(
  p_actor_id uuid,
  p_candidate_id uuid,
  p_expected_version integer,
  p_status text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.distribution_topic_candidates;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_status is null or p_status not in ('new', 'selected', 'dismissed') then
    raise exception 'status must be new, selected or dismissed' using errcode = 'invalid_parameter_value';
  end if;
  if p_expected_version is null then
    raise exception 'expected version is required' using errcode = 'invalid_parameter_value';
  end if;
  select * into v from public.distribution_topic_candidates c where c.id = p_candidate_id for update;
  if not found then
    raise exception 'topic candidate not found' using errcode = 'no_data_found';
  end if;
  if v.row_version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: topic candidate % is at version % (expected %)', p_candidate_id, v.row_version, p_expected_version
      using errcode = 'P0001';
  end if;
  if v.status = 'converted' then
    raise exception 'ALREADY_CONVERTED: converted topic candidates are final' using errcode = 'check_violation';
  end if;
  if v.status = p_status then
    raise exception 'INVALID_TRANSITION: topic candidate is already %', p_status using errcode = 'check_violation';
  end if;
  -- 제외를 되돌릴 때 같은 글감이 그 사이 다시 수집됐으면 거절(중복 유지)
  if v.status = 'dismissed' and exists (
    select 1 from public.distribution_topic_candidates o
    where o.dedupe_key = v.dedupe_key and o.status <> 'dismissed' and o.id <> v.id
  ) then
    raise exception 'DUPLICATE: the same topic was collected again' using errcode = 'unique_violation';
  end if;
  update public.distribution_topic_candidates
     set status = p_status, row_version = v.row_version + 1
   where id = v.id
  returning * into v;
  return pg_catalog.jsonb_build_object('candidate_id', v.id, 'status', v.status, 'row_version', v.row_version);
end;
$$;

-- 3) 원문으로 변환(원문 1버전 생성 + 후보 연결, 한 트랜잭션). 승인·초안·작업 없음.
--    반환: {candidate_id, content_id, already_converted, version_id?, version_no?, content_hash?}
--    이미 변환된 후보: 새 원문을 만들지 않고 같은 content_id(already_converted=true). 이때 expected_version은 보지 않는다.
create or replace function public.distribution_convert_topic_candidate(
  p_actor_id uuid,
  p_candidate_id uuid,
  p_expected_version integer,
  p_title text,
  p_body text,
  p_target_path text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.distribution_topic_candidates;
  v_created jsonb;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  select * into v from public.distribution_topic_candidates c where c.id = p_candidate_id for update;
  if not found then
    raise exception 'topic candidate not found' using errcode = 'no_data_found';
  end if;
  if v.status = 'converted' then
    return pg_catalog.jsonb_build_object('candidate_id', v.id, 'content_id', v.converted_content_id, 'already_converted', true);
  end if;
  if p_expected_version is null or v.row_version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: topic candidate % is at version % (expected %)', p_candidate_id, v.row_version, p_expected_version
      using errcode = 'P0001';
  end if;
  if v.status = 'dismissed' then
    raise exception 'INVALID_TRANSITION: dismissed topic candidates cannot be converted' using errcode = 'check_violation';
  end if;

  v_created := public.distribution_create_content(
    p_actor_id, p_title, p_body, null, p_target_path, '[]'::jsonb, '{}'::uuid[], '글감 후보에서 변환');
  update public.distribution_topic_candidates
     set status = 'converted',
         converted_content_id = (v_created ->> 'content_id')::uuid,
         converted_at = now(),
         converted_by = p_actor_id,
         row_version = v.row_version + 1
   where id = v.id;
  return pg_catalog.jsonb_build_object(
    'candidate_id', v.id, 'content_id', v_created -> 'content_id', 'already_converted', false,
    'version_id', v_created -> 'version_id', 'version_no', v_created -> 'version_no', 'content_hash', v_created -> 'content_hash');
end;
$$;

revoke all on function public.distribution_topic_candidates_guard() from public, anon, authenticated, service_role;
revoke all on function public.distribution_topic_dedupe_key(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.distribution_create_topic_candidate(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.distribution_set_topic_candidate_status(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.distribution_convert_topic_candidate(uuid, uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.distribution_create_topic_candidate(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.distribution_set_topic_candidate_status(uuid, uuid, integer, text) to service_role;
grant execute on function public.distribution_convert_topic_candidate(uuid, uuid, integer, text, text, text) to service_role;
