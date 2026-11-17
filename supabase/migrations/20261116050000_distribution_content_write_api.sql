-- ============================================================================
-- 통합 배포 M1 쓰기 API — 원문 버전 · 채널 초안/리비전(+미디어) · 승인/반려/철회 · 보관
-- AUTOPOST-M1-WRITE-API-001 · 2026-11-16 · CC-ENG (Claude Code) · run_eaedc8d53618
-- 근거: .ai/decisions/DEC-AUTOPOST-DATA-001.md (D1/D2), docs/AUTOPOST_INTEGRATION_PLAN.md,
--       M1 20261116030000_distribution_content.sql (테이블·트리거·해시 계약 (a)~(g)),
--       M2 20261116040000_distribution_jobs.sql (distribution_assert_admin_actor, distribution_effective_approval_id,
--       distribution_job_basis_problem, DEFINER/GRANT 패턴)
-- 상태: 어떤 DB에도 적용·실행 검증하지 않았다(작성·정적 검토만). 구문·트리거·RLS·ACL 동작 미실행.
-- 의존: M0~M2가 먼저 적용돼 있어야 한다(M2 helper 재사용). PostgreSQL 13+(M1 xid8 전제), 내장 sha256(PG11+).
--
-- ----------------------------------------------------------------------------
-- 범위
--   * service_role 전용 SECURITY DEFINER API 8개(아래 "API 목록"). 모든 함수가 p_actor_id를 받아
--     public.distribution_assert_admin_actor(uuid)로 D1 조건(role=admin AND approval_status=approved)을 재검증.
--   * 서버 측 SHA-256 해시 계산 helper(입력 해시 불신 — M1 (e)(f) 이행).
--   * public.distribution_archive_events: 보관 사유·행위자 불변 이력(신규 테이블, append-only).
--   * M1 6개 테이블의 service_role 직접 INSERT/UPDATE/DELETE 회수 → 이 파일의 함수만 쓰기 경로
--     (M2와 같은 "함수만이 쓰기 경로" 원칙. 해시 재계산 보장이 직접 DML로 우회되지 않게 한다).
--     SELECT는 유지한다. ※ M1 grants 계약의 강화이므로 결과 보고서에 별도 표시.
--
-- 범위 밖
--   * M1/M2 객체 재정의·변경 없음(함수·트리거·제약·RLS 정책). 기존 M1 트리거가 그대로 연속 번호·포인터 전진·
--     동일 트랜잭션 미디어·subject_hash 일치·철회 대상 일치를 강제하고, 이 파일의 함수는 그 위에서 동작한다.
--   * 이전 버전 참조 jobs의 stale 표시: jobs를 바꾸지 않는다. M2 claim/rerun의 distribution_job_basis_problem()이
--     stale/archived/approval_revoked를 재검사해 hold를 건다.
--   * 자기 승인 제한, 필수 체크리스트 키 목록, 채널별 길이·미디어 수 규칙(validation) — 미결정.
--
-- ----------------------------------------------------------------------------
-- 권한·actor 경계 (fail closed)
--   * API 함수: SECURITY DEFINER, search_path = '', 모든 객체 schema-qualified. EXECUTE는 PUBLIC/anon/authenticated
--     회수 후 service_role에만 GRANT(함수별 명시). helper는 service_role 포함 전부 회수(owner만 = DEFINER 안에서만).
--   * 함수 첫 문장에서 actor 재검증. 실패 시 insufficient_privilege로 아무 것도 쓰지 않는다.
--     주의: auth.uid() 기반 private.is_distribution_admin()은 service_role 호출에 쓸 수 없어 M2 helper를 쓴다.
--     호출 서버는 세션 사용자(검증된 JWT의 sub)를 p_actor_id로 넘겨야 한다 — 임의 actor 위조 방지는
--     service_role 키를 서버에만 두는 것에 의존한다(DB는 actor가 승인된 admin인지까지만 확인).
--   * 클라이언트(anon/authenticated) 쓰기 경로 없음: M1 테이블 INSERT/UPDATE/DELETE 권한·정책 없음(M1 그대로),
--     이 파일의 함수 EXECUTE도 없음. 승인·원문 텍스트는 직접 client write 불가.
--
-- ----------------------------------------------------------------------------
-- 동시성 (head row FOR UPDATE + expected pointer)
--   * 잠금 순서는 항상 distribution_contents → distribution_channel_drafts(교착 방지).
--     M1 INSERT 트리거는 각각 contents / channel_drafts 한 행만 FOR UPDATE, M2 create_job은 둘 다 FOR SHARE라
--     이 순서와 교착을 만들지 않는다(SHARE↔SHARE 비충돌).
--   * 버전 추가: contents FOR UPDATE + p_expected_version_no = current_version_no (불일치 VERSION_CONFLICT).
--   * 리비전 추가: contents FOR SHARE(새 버전 차단) + drafts FOR UPDATE + p_expected_revision_no = current_revision_no
--     (REVISION_CONFLICT) + p_expected_content_version_id = contents.current_version_id (STALE_CONTENT_VERSION).
--   * 승인/반려: 대상이 현재 포인터(최신)인지 잠금 아래 확인(NOT_LATEST) + p_expected_subject_hash = 저장 해시
--     = 재계산 해시(SUBJECT_CHANGED / HASH_INTEGRITY). content_version은 contents FOR UPDATE,
--     draft_revision은 contents FOR SHARE + drafts FOR UPDATE(같은 대상 동시 결정 직렬화).
--   * 같은 트랜잭션에서 같은 대상에 두 번째 승인/반려 거부(M2 유효 승인 판정이 created_at desc, id desc라
--     같은 트랜잭션 결정은 순서가 임의가 되므로 — M2 helper 주석의 "쓰기 함수가 한 번에 하나만" 요구 이행).
--
-- ----------------------------------------------------------------------------
-- 해시 정규화(canonicalization) v1 — 고정 규칙. 바꾸려면 헤더 버전을 올린 새 함수로(기존 해시 재계산 금지).
--   알고리즘: hex( SHA-256( UTF-8 바이트( canonical 문자열 ) ) ), 소문자 16진 64자.
--     pg_catalog.sha256(bytea)(PostgreSQL 11+ 내장) + pg_catalog.convert_to(text, 'UTF8') + encode(…, 'hex').
--     pgcrypto/digest()에 의존하지 않는다(기존 migration 어디에도 pgcrypto 생성·사용 없음을 확인 — 확장 스키마 추측 회피).
--   canonical 문자열 = 헤더 줄 + 필드 줄들(고정 순서).
--     헤더: 'distribution.content_version.v1\n' 또는 'distribution.draft_revision.v1\n' (도메인 분리)
--     필드 줄: <name> '=' <value-encoding> '\n'
--       value-encoding = NULL이면 '-'
--                        아니면 <값의 UTF-8 바이트 수(10진)> ':' <값 그대로>
--     → 길이 접두라서 값 안의 '=', ':', '\n' 등과 경계가 섞이지 않는다. NULL('-')과 빈 문자열('0:')이 구분된다.
--   텍스트: 저장 값 그대로(trim·Unicode NFC·줄바꿈 정규화 없음). 정규화가 필요하면 앱이 제출 전에 한다.
--   uuid: PostgreSQL uuid::text(소문자, 하이픈 포함 36자).
--   정수: 10진 문자열.
--   content_version.v1 필드 순서:
--     content_id, title, body, target_path, source_refs, media_asset_ids.count, media_asset_ids[1..n]
--     - source_refs: jsonb::text (PostgreSQL jsonb 정규 출력: 키 정렬·중복 제거·고정 구분자, 숫자는 numeric 표기
--       그대로 — 1과 1.0은 다른 값). DB 밖에서 재현하지 말고 DB 계산값을 기준으로 한다.
--     - media_asset_ids[i]: 배열 순서(1부터) 그대로. 순서가 바뀌면 다른 해시.
--     - 제외: change_summary(편집 메모), created_by/created_at, story_slug(머리 메타). version_no는 행 고정이며
--       내용 동일 시 되돌림 버전이 같은 해시를 갖는 것은 M1 설계(되돌림 허용)와 일치한다.
--   draft_revision.v1 필드 순서:
--     draft_id, content_id, channel, content_version_id, content_hash(고정된 원문 버전의 저장 해시), body, link_url,
--     utm.count, (utm.key, utm.value) × 키의 바이트 순(COLLATE "C") 정렬,
--     target_connection_id, target_external_account_id,
--     media.count, (media[i].asset_id, media[i].variant_id, media[i].alt_text) × position 1..n
--     - utm은 문자열 값만 허용(입력 검증)하므로 jsonb 표기와 무관하게 키/값 텍스트로 정규화된다.
--     - media는 position 오름차순, position은 1..n 연속(쓰기 함수가 배열 순서로 부여, 재계산 시 연속성 검사).
--     - 대상 계정(target_connection_id, target_external_account_id) 포함 → 계정 변경 시 재승인(D13 권고).
--     - 제외: validation(검증 결과 메타 — 승인자가 보는 판정이지 게시 내용이 아님), created_by/created_at,
--       revision_no, created_xact_id.
--   승인 subject_hash: 입력 해시를 저장하지 않는다. 대상 행을 다시 읽어 재계산 → 저장 해시와 일치 확인 →
--     호출자 p_expected_subject_hash(검토 화면에 보인 해시)와 일치 확인 → 저장 해시를 기록(M1 트리거가 재대조).
-- ============================================================================


-- ============================================================================
-- 1. 보관 이력 (불변)
-- ============================================================================
create table public.distribution_archive_events (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('content', 'channel_draft')),
  content_id uuid not null references public.distribution_contents (id) on delete restrict,
  draft_id uuid,
  reason text not null check (char_length(reason) <= 1000 and char_length(btrim(reason)) >= 1),
  actor_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint distribution_archive_events_draft_fk
    foreign key (draft_id, content_id)
    references public.distribution_channel_drafts (id, content_id) on delete restrict,
  constraint distribution_archive_events_subject_match check ((subject_type = 'content') = (draft_id is null))
);
create index distribution_archive_events_content_idx
  on public.distribution_archive_events (content_id, created_at desc);
-- 보관은 단방향(해제 API 없음) → 대상당 이력 1행.
create unique index distribution_archive_events_content_once
  on public.distribution_archive_events (content_id) where subject_type = 'content';
create unique index distribution_archive_events_draft_once
  on public.distribution_archive_events (draft_id) where draft_id is not null;

-- 불변: M1의 distribution_reject_mutation() 재사용(재정의 없음).
create trigger distribution_archive_events_immutable before update or delete on public.distribution_archive_events
  for each row execute function public.distribution_reject_mutation();
create trigger distribution_archive_events_no_truncate before truncate on public.distribution_archive_events
  for each statement execute function public.distribution_reject_mutation();


-- ============================================================================
-- 2. 내부 helper (EXECUTE: owner만 — DEFINER API 안에서만 호출)
-- ============================================================================

-- 2.1 해시 필드 한 줄: name=<len>:<value>\n 또는 name=-\n
create or replace function public.distribution_hash_field(p_name text, p_value text)
returns text
language sql
stable
set search_path = ''
as $$
  select p_name || '='
      || case
           when p_value is null then '-'
           else pg_catalog.octet_length(pg_catalog.convert_to(p_value, 'UTF8'))::text || ':' || p_value
         end
      || E'\n';
$$;

-- 2.2 원문 버전 해시(content_version.v1)
create or replace function public.distribution_compute_content_hash(
  p_content_id uuid,
  p_title text,
  p_body text,
  p_target_path text,
  p_source_refs jsonb,
  p_media_asset_ids uuid[]
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_media_n integer;
  v_media text;
  v_text text;
begin
  if p_content_id is null or p_title is null or p_body is null or p_source_refs is null or p_media_asset_ids is null then
    raise exception 'content hash input is incomplete' using errcode = 'invalid_parameter_value';
  end if;

  select count(*)::integer,
         coalesce(string_agg(public.distribution_hash_field('media_asset_ids[' || m.ord || ']', m.a::text), ''
                             order by m.ord), '')
    into v_media_n, v_media
  from pg_catalog.unnest(p_media_asset_ids) with ordinality as m(a, ord);

  v_text := 'distribution.content_version.v1' || E'\n'
    || public.distribution_hash_field('content_id', p_content_id::text)
    || public.distribution_hash_field('title', p_title)
    || public.distribution_hash_field('body', p_body)
    || public.distribution_hash_field('target_path', p_target_path)
    || public.distribution_hash_field('source_refs', p_source_refs::text)
    || public.distribution_hash_field('media_asset_ids.count', v_media_n::text)
    || v_media;

  return pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_text, 'UTF8')), 'hex');
end;
$$;

-- 2.3 리비전 해시(draft_revision.v1). p_media는 distribution_normalize_media() 출력 형식
--     [{asset_id, variant_id, alt_text}, …] (배열 순서 = position).
create or replace function public.distribution_compute_revision_hash(
  p_draft_id uuid,
  p_content_id uuid,
  p_channel text,
  p_content_version_id uuid,
  p_content_hash text,
  p_body text,
  p_link_url text,
  p_utm jsonb,
  p_target_connection_id uuid,
  p_target_external_account_id text,
  p_media jsonb
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_utm_n integer;
  v_utm text;
  v_media_n integer;
  v_media text;
  v_text text;
begin
  if p_draft_id is null or p_content_id is null or p_channel is null or p_content_version_id is null
     or p_content_hash is null or p_body is null or p_utm is null or p_media is null
     or pg_catalog.jsonb_typeof(p_utm) <> 'object' or pg_catalog.jsonb_typeof(p_media) <> 'array' then
    raise exception 'revision hash input is incomplete' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_each(p_utm) as u(k, v) where pg_catalog.jsonb_typeof(u.v) <> 'string'
  ) then
    raise exception 'utm values must be strings' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_media) as m(e)
    where pg_catalog.jsonb_typeof(m.e) <> 'object' or (m.e ->> 'asset_id') is null
  ) then
    raise exception 'media entries need asset_id' using errcode = 'invalid_parameter_value';
  end if;

  select count(*)::integer,
         coalesce(string_agg(public.distribution_hash_field('utm.key', u.k)
                             || public.distribution_hash_field('utm.value', u.v), ''
                             order by u.k collate pg_catalog."C"), '')
    into v_utm_n, v_utm
  from pg_catalog.jsonb_each_text(p_utm) as u(k, v);

  select count(*)::integer,
         coalesce(string_agg(
             public.distribution_hash_field('media[' || m.ord || '].asset_id', ((m.e ->> 'asset_id')::uuid)::text)
          || public.distribution_hash_field('media[' || m.ord || '].variant_id', ((m.e ->> 'variant_id')::uuid)::text)
          || public.distribution_hash_field('media[' || m.ord || '].alt_text', m.e ->> 'alt_text'), ''
          order by m.ord), '')
    into v_media_n, v_media
  from pg_catalog.jsonb_array_elements(p_media) with ordinality as m(e, ord);

  v_text := 'distribution.draft_revision.v1' || E'\n'
    || public.distribution_hash_field('draft_id', p_draft_id::text)
    || public.distribution_hash_field('content_id', p_content_id::text)
    || public.distribution_hash_field('channel', p_channel)
    || public.distribution_hash_field('content_version_id', p_content_version_id::text)
    || public.distribution_hash_field('content_hash', p_content_hash)
    || public.distribution_hash_field('body', p_body)
    || public.distribution_hash_field('link_url', p_link_url)
    || public.distribution_hash_field('utm.count', v_utm_n::text)
    || v_utm
    || public.distribution_hash_field('target_connection_id', p_target_connection_id::text)
    || public.distribution_hash_field('target_external_account_id', p_target_external_account_id)
    || public.distribution_hash_field('media.count', v_media_n::text)
    || v_media;

  return pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_text, 'UTF8')), 'hex');
end;
$$;

-- 2.4 저장된 대상 행으로 해시 재계산(대상 없으면 null). 미디어 position 비연속이면 HASH_INTEGRITY.
create or replace function public.distribution_recompute_subject_hash(p_subject_type text, p_subject_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hash text;
  v_rev record;
  v_n integer;
  v_max integer;
  v_media jsonb;
begin
  if p_subject_type = 'content_version' then
    select public.distribution_compute_content_hash(v.content_id, v.title, v.body, v.target_path,
                                                    v.source_refs, v.media_asset_ids)
      into v_hash
    from public.distribution_content_versions v where v.id = p_subject_id;
    return v_hash;
  elsif p_subject_type = 'draft_revision' then
    select r.id, r.draft_id, r.content_id, r.content_version_id, r.body, r.link_url, r.utm,
           r.target_connection_id, r.target_external_account_id, d.channel, v.content_hash
      into v_rev
    from public.distribution_draft_revisions r
    join public.distribution_channel_drafts d on d.id = r.draft_id
    join public.distribution_content_versions v on v.id = r.content_version_id
    where r.id = p_subject_id;
    if not found then
      return null;
    end if;
    select count(*)::integer,
           coalesce(max(m.position), 0),
           coalesce(jsonb_agg(pg_catalog.jsonb_build_object('asset_id', m.asset_id, 'variant_id', m.variant_id,
                                                            'alt_text', m.alt_text) order by m.position), '[]'::jsonb)
      into v_n, v_max, v_media
    from public.distribution_draft_revision_media m where m.revision_id = p_subject_id;
    if v_n <> v_max then
      raise exception 'HASH_INTEGRITY: revision % media positions are not contiguous', p_subject_id
        using errcode = 'data_corrupted';
    end if;
    return public.distribution_compute_revision_hash(
      v_rev.draft_id, v_rev.content_id, v_rev.channel, v_rev.content_version_id, v_rev.content_hash,
      v_rev.body, v_rev.link_url, v_rev.utm, v_rev.target_connection_id, v_rev.target_external_account_id, v_media);
  end if;
  raise exception 'invalid subject type' using errcode = 'invalid_parameter_value';
end;
$$;

-- 2.5 원문 입력 검증(테이블 check가 다루지 않는 크기·형식). title/body/target_path 형식은 M1 check가 최종 판정.
create or replace function public.distribution_assert_content_input(
  p_title text,
  p_body text,
  p_source_refs jsonb,
  p_media_asset_ids uuid[]
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_title is null or p_body is null then
    raise exception 'title and body are required' using errcode = 'invalid_parameter_value';
  end if;
  if p_source_refs is null or pg_catalog.jsonb_typeof(p_source_refs) <> 'array'
     or pg_catalog.jsonb_array_length(p_source_refs) > 100
     or pg_catalog.octet_length(p_source_refs::text) > 65536 then
    raise exception 'source_refs must be a json array (<= 100 items, <= 64KiB)' using errcode = 'invalid_parameter_value';
  end if;
  if p_media_asset_ids is null or coalesce(pg_catalog.array_ndims(p_media_asset_ids), 1) <> 1
     or coalesce(pg_catalog.cardinality(p_media_asset_ids), 0) > 50
     or pg_catalog.array_position(p_media_asset_ids, null) is not null then
    raise exception 'media_asset_ids must be a one-dimensional uuid array without nulls (<= 50)'
      using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- 2.6 UTM: 객체, 키 ^[a-z][a-z0-9_]{0,31}$, 값은 1~200자 문자열, 최대 10개. (값 허용 문자는 앱 utm.ts가 더 엄격히 검사)
create or replace function public.distribution_assert_utm(p_utm jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_utm is null or pg_catalog.jsonb_typeof(p_utm) <> 'object' then
    raise exception 'utm must be a json object' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from pg_catalog.jsonb_each(p_utm)) > 10
     or exists (
       select 1 from pg_catalog.jsonb_each(p_utm) as u(k, v)
       where u.k !~ '^[a-z][a-z0-9_]{0,31}$'
          or pg_catalog.jsonb_typeof(u.v) <> 'string'
          or char_length(u.v #>> '{}') not between 1 and 200
     ) then
    raise exception 'utm must map <= 10 lowercase keys to non-empty strings (<= 200 chars)'
      using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- 2.7 체크리스트: 객체, 키 ^[a-z][a-z0-9_]{0,63}$, 값 boolean, 최대 50개.
--     승인(p_require_all_true)은 항목 1개 이상 + 전부 true(미리 체크/누락 금지는 앱 UI 책임, DB는 false 거부).
--     필수 키 목록은 미결정 — 확정되면 CREATE OR REPLACE로 키 집합 검사 추가.
create or replace function public.distribution_assert_checklist(p_checklist jsonb, p_require_all_true boolean)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_checklist is null or pg_catalog.jsonb_typeof(p_checklist) <> 'object' then
    raise exception 'checklist must be a json object' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from pg_catalog.jsonb_each(p_checklist)) > 50
     or exists (
       select 1 from pg_catalog.jsonb_each(p_checklist) as c(k, v)
       where c.k !~ '^[a-z][a-z0-9_]{0,63}$' or pg_catalog.jsonb_typeof(c.v) <> 'boolean'
     ) then
    raise exception 'checklist must map <= 50 snake_case keys to booleans' using errcode = 'invalid_parameter_value';
  end if;
  if p_require_all_true and (
       not exists (select 1 from pg_catalog.jsonb_each(p_checklist))
       or exists (select 1 from pg_catalog.jsonb_each(p_checklist) as c(k, v) where c.v <> 'true'::jsonb)
     ) then
    raise exception 'CHECKLIST_INCOMPLETE: approval needs a non-empty checklist with every item true'
      using errcode = 'check_violation';
  end if;
end;
$$;

-- 2.8 리비전 미디어 입력 정규화 → [{asset_id(소문자 uuid), variant_id(uuid|null), alt_text(text|null)}] (최대 20).
--     허용 키 외 거부. position = 배열 순서(1부터). 채널별 개수 규칙은 validation 책임.
create or replace function public.distribution_normalize_media(p_media jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uuid_re constant text := '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$';
  v_out jsonb;
begin
  if p_media is null then
    return '[]'::jsonb;
  end if;
  if pg_catalog.jsonb_typeof(p_media) <> 'array' or pg_catalog.jsonb_array_length(p_media) > 20 then
    raise exception 'media must be a json array (<= 20 items)' using errcode = 'invalid_parameter_value';
  end if;
  -- 비객체 원소를 먼저 별도 문장으로 거부한다. SQL의 OR는 평가 순서를 보장하지 않아, 같은 WHERE에 두면
  -- 스칼라 원소에 jsonb_object_keys()가 평가돼 다른 오류(22023 cannot call ... on a scalar)가 날 수 있다.
  -- (AUTOPOST-M1-VERIFY-001 정적 재검토 수정)
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_media) as m(e) where pg_catalog.jsonb_typeof(m.e) <> 'object'
  ) then
    raise exception 'media items must be json objects' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_media) as m(e)
    where exists (select 1 from pg_catalog.jsonb_object_keys(m.e) as k(key)
                  where k.key not in ('asset_id', 'variant_id', 'alt_text'))
       or pg_catalog.jsonb_typeof(m.e -> 'asset_id') is distinct from 'string'
       or (m.e ->> 'asset_id') !~ v_uuid_re
       or (coalesce(pg_catalog.jsonb_typeof(m.e -> 'variant_id'), 'null') <> 'null'
           and (pg_catalog.jsonb_typeof(m.e -> 'variant_id') <> 'string' or (m.e ->> 'variant_id') !~ v_uuid_re))
       or (coalesce(pg_catalog.jsonb_typeof(m.e -> 'alt_text'), 'null') <> 'null'
           and (pg_catalog.jsonb_typeof(m.e -> 'alt_text') <> 'string' or char_length(m.e ->> 'alt_text') > 1000))
  ) then
    raise exception 'media items must be {asset_id: uuid, variant_id?: uuid|null, alt_text?: string<=1000|null}'
      using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(jsonb_agg(pg_catalog.jsonb_build_object(
           'asset_id', (m.e ->> 'asset_id')::uuid,
           'variant_id', (m.e ->> 'variant_id')::uuid,
           'alt_text', m.e ->> 'alt_text') order by m.ord), '[]'::jsonb)
    into v_out
  from pg_catalog.jsonb_array_elements(p_media) with ordinality as m(e, ord);
  return v_out;
end;
$$;


-- ============================================================================
-- 3. service_role 전용 API (SECURITY DEFINER)
--    반환은 jsonb 객체(키는 각 함수 주석). 오류 메시지 접두어: VERSION_CONFLICT, REVISION_CONFLICT,
--    STALE_CONTENT_VERSION, NOT_LATEST, ARCHIVED, ALREADY_ARCHIVED, DUPLICATE, SUBJECT_CHANGED, HASH_INTEGRITY,
--    ALREADY_APPROVED, ALREADY_REVOKED, DECISION_IN_SAME_TRANSACTION, CHECKLIST_INCOMPLETE, NO_CONTENT_VERSION.
-- ============================================================================

-- 3.1 (a) 원문 생성 + 첫 버전(v1). → {content_id, version_id, version_no, content_hash}
create or replace function public.distribution_create_content(
  p_actor_id uuid,
  p_title text,
  p_body text,
  p_story_slug text default null,
  p_target_path text default null,
  p_source_refs jsonb default '[]'::jsonb,
  p_media_asset_ids uuid[] default '{}'::uuid[],
  p_change_summary text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_refs jsonb := coalesce(p_source_refs, '[]'::jsonb);
  v_media uuid[];
  v_content_id uuid;
  v_version_id uuid;
  v_hash text;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  perform public.distribution_assert_content_input(p_title, p_body, v_refs, coalesce(p_media_asset_ids, '{}'::uuid[]));
  -- 하한 1로 재구성(해시·저장 배열 순서 일치)
  v_media := array(select t.x from pg_catalog.unnest(coalesce(p_media_asset_ids, '{}'::uuid[])) with ordinality as t(x, o)
                   order by t.o);

  insert into public.distribution_contents (owner_id, story_slug)
  values (p_actor_id, p_story_slug)
  returning id into v_content_id;

  v_hash := public.distribution_compute_content_hash(v_content_id, p_title, p_body, p_target_path, v_refs, v_media);

  -- M1 INSERT 트리거: contents FOR UPDATE, version_no = 0+1 강제, AFTER 트리거가 포인터 전진.
  insert into public.distribution_content_versions (
    content_id, version_no, title, body, target_path, source_refs, media_asset_ids, content_hash, change_summary, created_by
  ) values (
    v_content_id, 1, p_title, p_body, p_target_path, v_refs, v_media, v_hash, nullif(btrim(p_change_summary), ''), p_actor_id
  )
  returning id into v_version_id;

  return pg_catalog.jsonb_build_object('content_id', v_content_id, 'version_id', v_version_id,
                                       'version_no', 1, 'content_hash', v_hash);
end;
$$;

-- 3.2 (b) 최신 버전 다음 버전 추가(과거 내용 복원도 새 버전). → {content_id, version_id, version_no, content_hash}
--     승인은 이동하지 않는다(새 행 = 새 해시, M1 (c)). 이전 버전 기반 리비전/작업은 stale로 파생된다.
create or replace function public.distribution_append_content_version(
  p_actor_id uuid,
  p_content_id uuid,
  p_expected_version_no integer,
  p_title text,
  p_body text,
  p_target_path text default null,
  p_source_refs jsonb default '[]'::jsonb,
  p_media_asset_ids uuid[] default '{}'::uuid[],
  p_change_summary text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_head record;
  v_refs jsonb := coalesce(p_source_refs, '[]'::jsonb);
  v_media uuid[];
  v_version_id uuid;
  v_hash text;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  perform public.distribution_assert_content_input(p_title, p_body, v_refs, coalesce(p_media_asset_ids, '{}'::uuid[]));
  v_media := array(select t.x from pg_catalog.unnest(coalesce(p_media_asset_ids, '{}'::uuid[])) with ordinality as t(x, o)
                   order by t.o);

  select c.id, c.current_version_no, c.archived_at into v_head
  from public.distribution_contents c where c.id = p_content_id
  for update;
  if not found then
    raise exception 'distribution content % not found', p_content_id using errcode = 'no_data_found';
  end if;
  if v_head.archived_at is not null then
    raise exception 'ARCHIVED: content % is archived', p_content_id using errcode = 'check_violation';
  end if;
  if p_expected_version_no is null or v_head.current_version_no <> p_expected_version_no then
    raise exception 'VERSION_CONFLICT: content % is at version % (expected %)',
      p_content_id, v_head.current_version_no, p_expected_version_no using errcode = 'P0001';
  end if;

  v_hash := public.distribution_compute_content_hash(p_content_id, p_title, p_body, p_target_path, v_refs, v_media);

  insert into public.distribution_content_versions (
    content_id, version_no, title, body, target_path, source_refs, media_asset_ids, content_hash, change_summary, created_by
  ) values (
    p_content_id, v_head.current_version_no + 1, p_title, p_body, p_target_path, v_refs, v_media, v_hash,
    nullif(btrim(p_change_summary), ''), p_actor_id
  )
  returning id into v_version_id;

  return pg_catalog.jsonb_build_object('content_id', p_content_id, 'version_id', v_version_id,
                                       'version_no', v_head.current_version_no + 1, 'content_hash', v_hash);
end;
$$;

-- 3.3 (c) 채널 초안 머리 생성(리비전 0). → {draft_id, content_id, channel}
--     (content_id, channel) unique — 보관된 초안이 있어도 같은 채널 새 초안은 만들 수 없다(M1 제약, 한계).
create or replace function public.distribution_create_channel_draft(
  p_actor_id uuid,
  p_content_id uuid,
  p_channel text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_archived timestamptz;
  v_existing uuid;
  v_draft_id uuid;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_channel is null or p_channel not in ('blog', 'threads', 'instagram') then
    raise exception 'invalid channel' using errcode = 'invalid_parameter_value';
  end if;

  -- 보관과의 경합 차단(archive_content는 FOR UPDATE)
  select c.archived_at into v_archived
  from public.distribution_contents c where c.id = p_content_id
  for share;
  if not found then
    raise exception 'distribution content % not found', p_content_id using errcode = 'no_data_found';
  end if;
  if v_archived is not null then
    raise exception 'ARCHIVED: content % is archived', p_content_id using errcode = 'check_violation';
  end if;

  select d.id into v_existing
  from public.distribution_channel_drafts d where d.content_id = p_content_id and d.channel = p_channel;
  if found then
    raise exception 'DUPLICATE: draft % already exists for this content/channel', v_existing using errcode = 'unique_violation';
  end if;

  insert into public.distribution_channel_drafts (content_id, channel)
  values (p_content_id, p_channel)
  returning id into v_draft_id;

  return pg_catalog.jsonb_build_object('draft_id', v_draft_id, 'content_id', p_content_id, 'channel', p_channel);
end;
$$;

-- 3.4 (d) 리비전 + 미디어 행을 한 트랜잭션에 추가. 원문 현재 버전에 고정.
--     → {draft_id, revision_id, revision_no, content_version_id, revision_hash, media_count}
create or replace function public.distribution_append_draft_revision(
  p_actor_id uuid,
  p_draft_id uuid,
  p_expected_revision_no integer,
  p_expected_content_version_id uuid,
  p_body text,
  p_link_url text default null,
  p_utm jsonb default '{}'::jsonb,
  p_target_connection_id uuid default null,
  p_target_external_account_id text default null,
  p_validation jsonb default '{}'::jsonb,
  p_media jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_content_id uuid;
  v_content record;
  v_draft record;
  v_content_hash text;
  v_utm jsonb := coalesce(p_utm, '{}'::jsonb);
  v_validation jsonb := coalesce(p_validation, '{}'::jsonb);
  v_media jsonb;
  v_hash text;
  v_revision_id uuid;
  v_media_n integer;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_body is null then
    raise exception 'body is required' using errcode = 'invalid_parameter_value';
  end if;
  perform public.distribution_assert_utm(v_utm);
  if pg_catalog.jsonb_typeof(v_validation) <> 'object' or pg_catalog.octet_length(v_validation::text) > 65536 then
    raise exception 'validation must be a json object (<= 64KiB)' using errcode = 'invalid_parameter_value';
  end if;
  v_media := public.distribution_normalize_media(p_media);

  -- 잠금 순서: contents → drafts. draft.content_id는 불변(M1 가드)이라 잠금 전 조회해도 된다.
  select d.content_id into v_content_id from public.distribution_channel_drafts d where d.id = p_draft_id;
  if not found then
    raise exception 'distribution draft % not found', p_draft_id using errcode = 'no_data_found';
  end if;
  select c.current_version_id, c.archived_at into v_content
  from public.distribution_contents c where c.id = v_content_id
  for share;                                     -- 새 원문 버전(M1 트리거 FOR UPDATE) 차단
  select d.channel, d.current_revision_no, d.archived_at into v_draft
  from public.distribution_channel_drafts d where d.id = p_draft_id
  for update;

  if v_content.archived_at is not null or v_draft.archived_at is not null then
    raise exception 'ARCHIVED: content or draft is archived' using errcode = 'check_violation';
  end if;
  if p_expected_revision_no is null or v_draft.current_revision_no <> p_expected_revision_no then
    raise exception 'REVISION_CONFLICT: draft % is at revision % (expected %)',
      p_draft_id, v_draft.current_revision_no, p_expected_revision_no using errcode = 'P0001';
  end if;
  if v_content.current_version_id is null then
    raise exception 'NO_CONTENT_VERSION: content % has no version', v_content_id using errcode = 'check_violation';
  end if;
  if p_expected_content_version_id is distinct from v_content.current_version_id then
    raise exception 'STALE_CONTENT_VERSION: latest content version is % (expected %)',
      v_content.current_version_id, p_expected_content_version_id using errcode = 'P0001';
  end if;

  select v.content_hash into v_content_hash
  from public.distribution_content_versions v where v.id = v_content.current_version_id;

  v_hash := public.distribution_compute_revision_hash(
    p_draft_id, v_content_id, v_draft.channel, v_content.current_version_id, v_content_hash,
    p_body, p_link_url, v_utm, p_target_connection_id, p_target_external_account_id, v_media);

  -- M1 INSERT 트리거: drafts FOR UPDATE, revision_no = 현재+1, created_xact_id 고정, AFTER가 포인터 전진.
  insert into public.distribution_draft_revisions (
    draft_id, content_id, revision_no, content_version_id, body, link_url, utm,
    target_connection_id, target_external_account_id, validation, revision_hash, created_by
  ) values (
    p_draft_id, v_content_id, v_draft.current_revision_no + 1, v_content.current_version_id, p_body, p_link_url, v_utm,
    p_target_connection_id, p_target_external_account_id, v_validation, v_hash, p_actor_id
  )
  returning id into v_revision_id;

  -- 같은 트랜잭션에서 미디어(M1 트리거가 xid8 동일성 검사). position = 배열 순서.
  insert into public.distribution_draft_revision_media (revision_id, position, asset_id, variant_id, alt_text)
  select v_revision_id, m.ord::integer, (m.e ->> 'asset_id')::uuid, (m.e ->> 'variant_id')::uuid, m.e ->> 'alt_text'
  from pg_catalog.jsonb_array_elements(v_media) with ordinality as m(e, ord);
  get diagnostics v_media_n = row_count;

  return pg_catalog.jsonb_build_object('draft_id', p_draft_id, 'revision_id', v_revision_id,
                                       'revision_no', v_draft.current_revision_no + 1,
                                       'content_version_id', v_content.current_version_id,
                                       'revision_hash', v_hash, 'media_count', v_media_n);
end;
$$;

-- 3.5 (e) 승인/반려 기록. 최신 버전/리비전만, 미보관만, 해시 재계산·일치 후.
--     → {approval_id, subject_type, subject_id, decision, subject_hash}
create or replace function public.distribution_decide_approval(
  p_actor_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_decision text,
  p_expected_subject_hash text,
  p_checklist jsonb default '{}'::jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_content_id uuid;
  v_draft_id uuid;
  v_rev_version_id uuid;
  v_head record;
  v_draft record;
  v_stored text;
  v_recomputed text;
  v_reason text := nullif(btrim(p_reason), '');
  v_checklist jsonb := coalesce(p_checklist, '{}'::jsonb);
  v_approval_id uuid;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected (use distribution_revoke_approval to revoke)'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_subject_type is null or p_subject_type not in ('content_version', 'draft_revision') then
    raise exception 'invalid subject type' using errcode = 'invalid_parameter_value';
  end if;
  if p_expected_subject_hash is null or p_expected_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'expected subject hash must be lowercase sha256 hex' using errcode = 'invalid_parameter_value';
  end if;
  perform public.distribution_assert_checklist(v_checklist, p_decision = 'approved');
  if p_decision = 'rejected' and v_reason is null then
    raise exception 'rejection needs a reason' using errcode = 'invalid_parameter_value';
  end if;

  if p_subject_type = 'content_version' then
    select v.content_id, v.content_hash into v_content_id, v_stored
    from public.distribution_content_versions v where v.id = p_subject_id;
    if not found then
      raise exception 'content version % not found', p_subject_id using errcode = 'no_data_found';
    end if;
    select c.current_version_id, c.archived_at into v_head
    from public.distribution_contents c where c.id = v_content_id
    for update;
    if v_head.archived_at is not null then
      raise exception 'ARCHIVED: content % is archived', v_content_id using errcode = 'check_violation';
    end if;
    if v_head.current_version_id is distinct from p_subject_id then
      raise exception 'NOT_LATEST: content version % is not the latest (%)', p_subject_id, v_head.current_version_id
        using errcode = 'P0001';
    end if;
  else
    select r.draft_id, r.content_id, r.content_version_id, r.revision_hash
      into v_draft_id, v_content_id, v_rev_version_id, v_stored
    from public.distribution_draft_revisions r where r.id = p_subject_id;
    if not found then
      raise exception 'draft revision % not found', p_subject_id using errcode = 'no_data_found';
    end if;
    select c.current_version_id, c.archived_at into v_head
    from public.distribution_contents c where c.id = v_content_id
    for share;
    select d.current_revision_id, d.archived_at into v_draft
    from public.distribution_channel_drafts d where d.id = v_draft_id
    for update;
    if v_head.archived_at is not null or v_draft.archived_at is not null then
      raise exception 'ARCHIVED: content or draft is archived' using errcode = 'check_violation';
    end if;
    if v_draft.current_revision_id is distinct from p_subject_id then
      raise exception 'NOT_LATEST: revision % is not the latest (%)', p_subject_id, v_draft.current_revision_id
        using errcode = 'P0001';
    end if;
    if v_head.current_version_id is distinct from v_rev_version_id then
      raise exception 'STALE_CONTENT_VERSION: revision % is based on % but latest content version is %',
        p_subject_id, v_rev_version_id, v_head.current_version_id using errcode = 'P0001';
    end if;
  end if;

  -- 저장 해시가 저장 내용의 진짜 SHA-256인지 재확인(입력/저장 해시 불신)
  v_recomputed := public.distribution_recompute_subject_hash(p_subject_type, p_subject_id);
  if v_recomputed is null or v_recomputed <> v_stored then
    raise exception 'HASH_INTEGRITY: stored hash of % % does not match its content', p_subject_type, p_subject_id
      using errcode = 'data_corrupted';
  end if;
  if p_expected_subject_hash <> v_stored then
    raise exception 'SUBJECT_CHANGED: reviewed hash does not match the subject' using errcode = 'P0001';
  end if;

  -- 한 트랜잭션에 대상당 결정 1개(M2 유효 승인 정렬 모호성 방지)
  if exists (
    select 1 from public.distribution_approvals a
    where a.decision in ('approved', 'rejected') and a.created_at = now()
      and ((p_subject_type = 'content_version' and a.content_version_id = p_subject_id)
        or (p_subject_type = 'draft_revision' and a.draft_revision_id = p_subject_id))
  ) then
    raise exception 'DECISION_IN_SAME_TRANSACTION: one decision per subject per transaction' using errcode = 'P0001';
  end if;
  if p_decision = 'approved'
     and public.distribution_effective_approval_id(p_subject_type, p_subject_id) is not null then
    raise exception 'ALREADY_APPROVED: subject already has an effective approval' using errcode = 'P0001';
  end if;

  insert into public.distribution_approvals (
    subject_type, content_version_id, draft_revision_id, subject_hash, decision, reason, checklist, actor_id
  ) values (
    p_subject_type,
    case when p_subject_type = 'content_version' then p_subject_id end,
    case when p_subject_type = 'draft_revision' then p_subject_id end,
    v_stored, p_decision, v_reason, v_checklist, p_actor_id
  )
  returning id into v_approval_id;

  return pg_catalog.jsonb_build_object('approval_id', v_approval_id, 'subject_type', p_subject_type,
                                       'subject_id', p_subject_id, 'decision', p_decision, 'subject_hash', v_stored);
end;
$$;

-- 3.6 (e) 승인 철회. 최신 여부·보관 여부와 무관하게 언제나 허용(안전 방향). 사유 필수.
--     해시 무결성 불일치여도 철회는 막지 않는다(fail-safe). → {approval_id, revokes_approval_id, subject_type, subject_id}
create or replace function public.distribution_revoke_approval(
  p_actor_id uuid,
  p_approval_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target record;
  v_content_id uuid;
  v_draft_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_new_id uuid;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if v_reason is null then
    raise exception 'revocation needs a reason' using errcode = 'invalid_parameter_value';
  end if;

  select a.id, a.subject_type, a.content_version_id, a.draft_revision_id, a.subject_hash, a.decision
    into v_target
  from public.distribution_approvals a where a.id = p_approval_id;
  if not found then
    raise exception 'approval % not found', p_approval_id using errcode = 'no_data_found';
  end if;
  if v_target.decision <> 'approved' then
    raise exception 'only an approved decision can be revoked' using errcode = 'check_violation';
  end if;

  -- 같은 잠금 순서로 대상 머리 직렬화
  if v_target.subject_type = 'content_version' then
    select v.content_id into v_content_id
    from public.distribution_content_versions v where v.id = v_target.content_version_id;
    perform 1 from public.distribution_contents c where c.id = v_content_id for update;
  else
    select r.content_id, r.draft_id into v_content_id, v_draft_id
    from public.distribution_draft_revisions r where r.id = v_target.draft_revision_id;
    perform 1 from public.distribution_contents c where c.id = v_content_id for share;
    perform 1 from public.distribution_channel_drafts d where d.id = v_draft_id for update;
  end if;

  if exists (select 1 from public.distribution_approvals r where r.revokes_approval_id = p_approval_id) then
    raise exception 'ALREADY_REVOKED: approval % was already revoked', p_approval_id using errcode = 'unique_violation';
  end if;

  -- M1 트리거가 subject_hash = 저장 해시, 철회 대상 = 같은 대상의 approved임을 재검증.
  insert into public.distribution_approvals (
    subject_type, content_version_id, draft_revision_id, subject_hash, decision, revokes_approval_id, reason, actor_id
  ) values (
    v_target.subject_type, v_target.content_version_id, v_target.draft_revision_id, v_target.subject_hash,
    'revoked', p_approval_id, v_reason, p_actor_id
  )
  returning id into v_new_id;

  return pg_catalog.jsonb_build_object('approval_id', v_new_id, 'revokes_approval_id', p_approval_id,
                                       'subject_type', v_target.subject_type,
                                       'subject_id', coalesce(v_target.content_version_id, v_target.draft_revision_id));
end;
$$;

-- 3.7 원문 보관(단방향). 사유·행위자 이력 행 + archived_at. 버전·승인·작업 이력은 보존.
--     이후 버전/초안/리비전 추가·승인/반려 불가, M2 claim/rerun은 'archived'로 hold. → {archive_event_id, content_id, archived_at}
create or replace function public.distribution_archive_content(
  p_actor_id uuid,
  p_content_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_archived timestamptz;
  v_reason text := nullif(btrim(p_reason), '');
  v_event_id uuid;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if v_reason is null then
    raise exception 'archive needs a reason' using errcode = 'invalid_parameter_value';
  end if;
  select c.archived_at into v_archived
  from public.distribution_contents c where c.id = p_content_id
  for update;
  if not found then
    raise exception 'distribution content % not found', p_content_id using errcode = 'no_data_found';
  end if;
  if v_archived is not null then
    raise exception 'ALREADY_ARCHIVED: content % is archived', p_content_id using errcode = 'check_violation';
  end if;

  insert into public.distribution_archive_events (subject_type, content_id, draft_id, reason, actor_id)
  values ('content', p_content_id, null, v_reason, p_actor_id)
  returning id into v_event_id;
  update public.distribution_contents set archived_at = now() where id = p_content_id;

  return pg_catalog.jsonb_build_object('archive_event_id', v_event_id, 'content_id', p_content_id, 'archived_at', now());
end;
$$;

-- 3.8 채널 초안 보관(단방향). → {archive_event_id, draft_id, content_id, archived_at}
create or replace function public.distribution_archive_channel_draft(
  p_actor_id uuid,
  p_draft_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_content_id uuid;
  v_archived timestamptz;
  v_reason text := nullif(btrim(p_reason), '');
  v_event_id uuid;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if v_reason is null then
    raise exception 'archive needs a reason' using errcode = 'invalid_parameter_value';
  end if;
  select d.content_id into v_content_id from public.distribution_channel_drafts d where d.id = p_draft_id;
  if not found then
    raise exception 'distribution draft % not found', p_draft_id using errcode = 'no_data_found';
  end if;
  perform 1 from public.distribution_contents c where c.id = v_content_id for share;
  select d.archived_at into v_archived
  from public.distribution_channel_drafts d where d.id = p_draft_id
  for update;
  if v_archived is not null then
    raise exception 'ALREADY_ARCHIVED: draft % is archived', p_draft_id using errcode = 'check_violation';
  end if;

  insert into public.distribution_archive_events (subject_type, content_id, draft_id, reason, actor_id)
  values ('channel_draft', v_content_id, p_draft_id, v_reason, p_actor_id)
  returning id into v_event_id;
  update public.distribution_channel_drafts set archived_at = now() where id = p_draft_id;

  return pg_catalog.jsonb_build_object('archive_event_id', v_event_id, 'draft_id', p_draft_id,
                                       'content_id', v_content_id, 'archived_at', now());
end;
$$;


-- ============================================================================
-- 4. 권한(GRANT)
-- ============================================================================

-- 4.1 M1 테이블: service_role 직접 쓰기 회수(SELECT 유지). 쓰기는 3절 DEFINER 함수(owner 권한)만.
--     M1이 이미 회수한 항목(불변 테이블 UPDATE/DELETE/TRUNCATE, 머리 TRUNCATE)은 중복 회수(무해).
revoke insert, update, delete on table
  public.distribution_contents, public.distribution_content_versions,
  public.distribution_channel_drafts, public.distribution_draft_revisions,
  public.distribution_draft_revision_media, public.distribution_approvals
from service_role;

-- 4.2 보관 이력: service_role 읽기만, authenticated 명시 열 읽기 + RLS, anon 없음.
revoke all on table public.distribution_archive_events from public, anon, authenticated, service_role;
grant select on table public.distribution_archive_events to service_role;
grant select (id, subject_type, content_id, draft_id, reason, actor_id, created_at)
  on public.distribution_archive_events to authenticated;

alter table public.distribution_archive_events enable row level security;
create policy distribution_archive_events_admin_read on public.distribution_archive_events
  for select to authenticated using ((select private.is_distribution_admin()));

-- 4.3 helper: owner 외 실행 불가
revoke all on function public.distribution_hash_field(text, text) from public, anon, authenticated, service_role;
revoke all on function public.distribution_compute_content_hash(uuid, text, text, text, jsonb, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.distribution_compute_revision_hash(uuid, uuid, text, uuid, text, text, text, jsonb, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.distribution_recompute_subject_hash(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.distribution_assert_content_input(text, text, jsonb, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.distribution_assert_utm(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.distribution_assert_checklist(jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function public.distribution_normalize_media(jsonb) from public, anon, authenticated, service_role;

-- 4.4 API: service_role만(최소 EXECUTE)
revoke all on function public.distribution_create_content(uuid, text, text, text, text, jsonb, uuid[], text)
  from public, anon, authenticated;
revoke all on function public.distribution_append_content_version(uuid, uuid, integer, text, text, text, jsonb, uuid[], text)
  from public, anon, authenticated;
revoke all on function public.distribution_create_channel_draft(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.distribution_append_draft_revision(uuid, uuid, integer, uuid, text, text, jsonb, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.distribution_decide_approval(uuid, text, uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.distribution_revoke_approval(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.distribution_archive_content(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.distribution_archive_channel_draft(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.distribution_create_content(uuid, text, text, text, text, jsonb, uuid[], text) to service_role;
grant execute on function public.distribution_append_content_version(uuid, uuid, integer, text, text, text, jsonb, uuid[], text)
  to service_role;
grant execute on function public.distribution_create_channel_draft(uuid, uuid, text) to service_role;
grant execute on function public.distribution_append_draft_revision(uuid, uuid, integer, uuid, text, text, jsonb, uuid, text, jsonb, jsonb)
  to service_role;
grant execute on function public.distribution_decide_approval(uuid, text, uuid, text, text, jsonb, text) to service_role;
grant execute on function public.distribution_revoke_approval(uuid, uuid, text) to service_role;
grant execute on function public.distribution_archive_content(uuid, uuid, text) to service_role;
grant execute on function public.distribution_archive_channel_draft(uuid, uuid, text) to service_role;


-- ============================================================================
-- API 목록 (service_role 전용 EXECUTE, 전부 p_actor_id 재검증)
--   원문    distribution_create_content · distribution_append_content_version · distribution_archive_content
--   초안    distribution_create_channel_draft · distribution_append_draft_revision · distribution_archive_channel_draft
--   승인    distribution_decide_approval(approved|rejected) · distribution_revoke_approval
--   → M2 distribution_create_job(p_actor_id, p_draft_revision_id, …)이 이 승인들을 유효 승인으로 선택한다.
--
-- DB 적용 전 필요한 별도 검증(이 작업에서 실행하지 않음)
--   * PGlite/로컬 Supabase에서 M0~M2 + 이 파일 순차 적용(구문, convert_to/sha256 가용성, collate "C" 해석).
--   * 해시 고정 벡터: 같은 입력 → 같은 해시, 필드 하나·미디어 순서·utm 키 변경 → 다른 해시, NULL vs '' 구분.
--   * 동시성: 같은 expected로 버전/리비전 동시 추가 → 하나만 성공, 승인 중 새 버전 → NOT_LATEST/STALE.
--   * ACL 매트릭스: anon/authenticated EXECUTE 거부, service_role 직접 INSERT/UPDATE/DELETE 거부, 미승인/정지 admin actor 거부.
--
-- rollback 메모(실행 안 함): 데이터 없을 때만 API 함수 → helper → archive_events drop, M1 테이블 service_role
--   INSERT/UPDATE/DELETE 재GRANT(M1 원래 상태: 불변 테이블은 INSERT만, 머리는 INSERT/UPDATE/DELETE).
--   데이터가 생긴 뒤에는 forward-fix로 수정한다(해시 규칙 변경은 v2 헤더 신규 함수).
-- ============================================================================
