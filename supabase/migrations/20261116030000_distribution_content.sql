-- ============================================================================
-- 통합 배포 M1 — 배포 원문 버전 · 채널 초안 리비전 · 승인 기록 (추가 전용)
-- AUTOPOST-M1-CONTENT-001 · 2026-11-16 · CC-ENG (Claude Code)
-- 근거: .ai/decisions/DEC-AUTOPOST-DATA-001.md (D1), docs/AUTOPOST_INTEGRATION_PLAN.md §2.2,
--       .ai/results/AUTOPOST-DATA-001-CC-ENG.md §3.1 · §7 · §9(M1)
-- 상태: 어떤 DB에도 적용·실행 검증하지 않았다(작성만). 원격 적용은 별도 승인 게이트.
--
-- 범위
--   * private.is_distribution_admin(): admin 역할 AND profiles.approval_status='approved' (D1).
--     기존 private.is_admin()/is_approved_member()의 의미는 바꾸지 않는다.
--   * public.distribution_contents / _content_versions / _channel_drafts / _draft_revisions /
--     _draft_revision_media / _approvals
--   * 불변 기록(버전·리비전·리비전 미디어·승인): UPDATE/DELETE/TRUNCATE 거부(service_role 포함).
--   * 머리(head: contents, channel_drafts): 현재 포인터·메타데이터만. 포인터는 새 버전/리비전이
--     들어올 때 DB 트리거가 한 칸씩만 전진시킨다(되감기·건너뛰기 거부).
--   * 기존 public.set_updated_at() 재사용(재정의 없음). profiles/role_assignments/audit_events 변경 없음.
--
-- 범위 밖(후속 migration)
--   * 쓰기 함수(service_role 전용 server function), jobs/attempts/events/evidence(M2),
--     connections/secrets(M3), media assets/variants(M4) — 이 파일은 service-role 함수를 만들지 않는다.
--   * 따라서 M1 적용 직후 anon/authenticated 쓰기 경로는 없다. 쓰기는 M2 이후 함수로만 연다.
--   * target_connection_id(M3), asset_id/variant_id(M4)는 대상 테이블이 아직 없어 FK 없이 uuid로 둔다.
--     대상 테이블 생성 migration에서 FK를 추가한다(기존 행 검증 포함).
--
-- 해시 계약 (DB 보장 vs 서버 요구사항 분리)
--   DB가 보장하는 것
--     (a) content_hash/revision_hash/subject_hash 형식: 소문자 16진 64자(sha256 hex).
--     (b) 저장된 해시는 불변(행 UPDATE 거부).
--     (c) 승인 행의 subject_hash는 INSERT 시점에 대상 행에 저장된 해시와 같아야 한다
--         → 승인은 정확히 그 버전/리비전 행에 고정되며, 새 버전/리비전(새 행)에는 이전 승인이 적용되지 않는다.
--     (d) 리비전 미디어 행은 부모 리비전을 INSERT한 최상위 트랜잭션 안에서만 추가 가능(사후 미디어 끼워넣기 거부).
--         근거: 리비전 INSERT 트리거가 pg_current_xact_id()(xid8, PostgreSQL 13+; 에포크 포함 64비트라
--         같은 클러스터에서 wraparound로 재사용되지 않음)를 created_xact_id에 고정하고, 미디어 INSERT 트리거는
--         현재 최상위 트랜잭션 ID가 그 값과 같을 때만 허용한다. created_at = now()(트랜잭션 시작 시각)는
--         서로 다른 트랜잭션이 같은 값을 가질 수 있으므로 단독 근거로 쓰지 않고 보조 조건으로만 함께 비교한다.
--         한계: 같은 트랜잭션 안에서는 미디어를 몇 개든·어떤 순서로든 넣을 수 있다. 미디어 구성이
--         revision_hash와 일치하는지는 (e)(f)대로 쓰기 함수 책임이다. 트랜잭션 ID는 같은 클러스터 안에서만
--         유일하다(논리 덤프를 새 클러스터에 복원하면 재사용될 수 있음 — 복원은 트리거 비활성 + 열 값 그대로
--         적재를 전제로 하며, created_at 보조 비교가 복원 뒤 재사용 일치를 추가로 막는다).
--   DB가 보장하지 않는 것(후속 server function 필수 요구사항)
--     (e) content_hash가 실제로 title/body/target_path/source_refs/media_asset_ids의 정규화 직렬화에 대한
--         sha256인지, revision_hash가 body/link_url/utm/미디어 순서·variant/대상 계정/content_version_id의
--         sha256인지는 검증하지 않는다. 정규화(canonical) 형식은 아직 확정되지 않았다(M2 계약에서 확정).
--     (f) 따라서 쓰기 함수는 클라이언트/앱이 보낸 해시 값을 신뢰하지 말고, 저장할 값으로 서버(또는 DB 함수)에서
--         해시를 재계산해 넣어야 하며, 승인 시에도 대상 행 내용으로 재계산해 저장 해시와 대조한 뒤 기록한다.
--     (g) "최신 버전/리비전만 승인 가능", "보관(archived) 원문에 새 버전 금지", 자기 승인 제한,
--         stale 판정(revision.content_version_id ≠ 최신 버전)은 파생 판정/쓰기 함수 책임이다(저장하지 않음).
--
-- 권한 원칙(기존 migration과 동일)
--   * 새 테이블은 anon/authenticated/PUBLIC 권한을 모두 회수한 뒤 distribution_admin 읽기용 열만 GRANT.
--   * 클라이언트 INSERT/UPDATE/DELETE 권한·정책 없음.
--   * service_role(서버 전용, RLS 우회)은 Supabase 기본 권한을 유지하되, 불변 테이블의 UPDATE/DELETE/TRUNCATE와
--     머리 테이블의 TRUNCATE는 회수한다(트리거와 이중 보호).
--
-- 미결정(이 파일이 정하지 않음): D3~D14. actor FK는 기존 관례(on delete restrict)를 따르며,
--   사용자 삭제 절차(D9)가 정해지면 별도 migration으로 조정한다.
-- ============================================================================

create schema if not exists private;

-- ----------------------------------------------------------------------------
-- 1. 배포 전용 관리자 판정 (D1)
--    기존 private.is_admin()과 같은 패턴: security definer, search_path='', 호출자 본인만 판정.
-- ----------------------------------------------------------------------------
create or replace function private.is_distribution_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_assignments ra
    join public.profiles p on p.id = ra.user_id
    where ra.user_id = (select auth.uid())
      and ra.role = 'admin'
      and p.approval_status = 'approved'
  );
$$;

revoke all on function private.is_distribution_admin() from public, anon, authenticated;
grant execute on function private.is_distribution_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. 배포 원문 머리 (가변: 포인터·메타데이터만)
-- ----------------------------------------------------------------------------
create table public.distribution_contents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,   -- MVP: 생성 관리자
  -- 공개 원문(StoryRecord)과의 느슨한 텍스트 참조. FK 없음(원문 저장소가 DB에 없음).
  story_slug text check (story_slug is null or story_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  current_version_id uuid,                          -- 아래 FK(같은 content의 버전만) 참조
  current_version_no integer not null default 0 check (current_version_no >= 0),
  archived_at timestamptz,                          -- 삭제 대신 보관
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint distribution_contents_pointer_pair check (
    (current_version_no = 0) = (current_version_id is null)
  )
);
create index distribution_contents_owner_idx on public.distribution_contents (owner_id, updated_at desc);
create index distribution_contents_story_slug_idx on public.distribution_contents (story_slug)
  where story_slug is not null;
create trigger distribution_contents_updated_at before update on public.distribution_contents
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. 배포 원문 버전 (불변 스냅샷)
-- ----------------------------------------------------------------------------
create table public.distribution_content_versions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.distribution_contents (id) on delete restrict,
  version_no integer not null check (version_no >= 1),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) <= 200000),
  -- 사이트 내부 경로. '/'로 시작, '//' 금지(프로토콜 상대 URL 차단), 공백·제어문자 금지.
  target_path text check (
    target_path is null
    or (target_path ~ '^/[^[:space:][:cntrl:]]*$' and position('//' in target_path) = 0)
  ),
  source_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array'),
  -- M4(media_assets) 전까지 FK 없음. null 원소 금지.
  media_asset_ids uuid[] not null default '{}'::uuid[]
    check (array_position(media_asset_ids, null) is null),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  change_summary text check (change_summary is null or char_length(change_summary) <= 500),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),   -- INSERT 트리거가 now()로 고정
  constraint distribution_content_versions_no_unique unique (content_id, version_no),
  -- 머리 포인터·리비전의 복합 FK 대상(같은 content 소속 보장)
  constraint distribution_content_versions_content_id_unique unique (content_id, id)
  -- content_hash는 content 내 unique로 두지 않는다(이전 내용으로 되돌림 = 새 버전 허용).
);

alter table public.distribution_contents
  add constraint distribution_contents_current_version_fk
  foreign key (id, current_version_id)
  references public.distribution_content_versions (content_id, id)
  on delete restrict;

-- ----------------------------------------------------------------------------
-- 4. 채널 초안 머리 (가변: 포인터·메타데이터만)
--    대상 연결(target_connection_id)은 승인 대상인 리비전 스냅샷에만 둔다.
-- ----------------------------------------------------------------------------
create table public.distribution_channel_drafts (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.distribution_contents (id) on delete restrict,
  channel text not null check (channel in ('blog', 'threads', 'instagram')),
  current_revision_id uuid,
  current_revision_no integer not null default 0 check (current_revision_no >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint distribution_channel_drafts_channel_unique unique (content_id, channel),
  constraint distribution_channel_drafts_content_id_unique unique (id, content_id),
  constraint distribution_channel_drafts_pointer_pair check (
    (current_revision_no = 0) = (current_revision_id is null)
  )
);
create trigger distribution_channel_drafts_updated_at before update on public.distribution_channel_drafts
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. 채널 초안 리비전 (불변 스냅샷, 원문 버전 고정)
-- ----------------------------------------------------------------------------
create table public.distribution_draft_revisions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null,
  content_id uuid not null,                         -- draft·content_version이 같은 원문 소속임을 FK로 보장
  revision_no integer not null check (revision_no >= 1),
  content_version_id uuid not null,
  body text not null check (char_length(body) <= 200000),            -- 채널 게시 본문
  -- 자격정보(userinfo) 없는 https URL만. 채널별 길이·도메인 규칙은 validation/쓰기 함수 책임.
  link_url text check (
    link_url is null
    or (char_length(link_url) <= 2048 and link_url ~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$')
  ),
  utm jsonb not null default '{}'::jsonb check (jsonb_typeof(utm) = 'object'),
  target_connection_id uuid,                        -- M3(channel_connections) 전까지 FK 없음
  target_external_account_id text
    check (target_external_account_id is null or char_length(target_external_account_id) between 1 and 200),
  validation jsonb not null default '{}'::jsonb check (jsonb_typeof(validation) = 'object'),
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),   -- INSERT 트리거가 now()로 고정
  -- 내부 전용: 리비전을 INSERT한 최상위 트랜잭션 ID(INSERT 트리거가 pg_current_xact_id()로 고정, 이후 UPDATE 거부).
  -- 리비전 미디어 동일 트랜잭션 검증에만 쓴다. authenticated에 GRANT하지 않는다(아래 권한 절).
  created_xact_id xid8 not null default pg_current_xact_id(),
  constraint distribution_draft_revisions_no_unique unique (draft_id, revision_no),
  constraint distribution_draft_revisions_draft_id_unique unique (draft_id, id),
  constraint distribution_draft_revisions_draft_fk
    foreign key (draft_id, content_id)
    references public.distribution_channel_drafts (id, content_id) on delete restrict,
  constraint distribution_draft_revisions_version_fk
    foreign key (content_id, content_version_id)
    references public.distribution_content_versions (content_id, id) on delete restrict
);
create index distribution_draft_revisions_version_idx
  on public.distribution_draft_revisions (content_version_id);

alter table public.distribution_channel_drafts
  add constraint distribution_channel_drafts_current_revision_fk
  foreign key (id, current_revision_id)
  references public.distribution_draft_revisions (draft_id, id)
  on delete restrict;

-- ----------------------------------------------------------------------------
-- 6. 리비전 미디어 순서 (불변, 부모 리비전을 INSERT한 최상위 트랜잭션에서만 추가)
-- ----------------------------------------------------------------------------
create table public.distribution_draft_revision_media (
  revision_id uuid not null references public.distribution_draft_revisions (id) on delete restrict,
  position integer not null check (position >= 1),
  asset_id uuid not null,                           -- M4(media_assets) 전까지 FK 없음
  variant_id uuid,                                  -- M4(media_variants) 전까지 FK 없음
  alt_text text check (alt_text is null or char_length(alt_text) <= 1000),
  created_at timestamptz not null default now(),   -- INSERT 트리거가 now()로 고정
  primary key (revision_id, position)
);
create index distribution_draft_revision_media_asset_idx
  on public.distribution_draft_revision_media (asset_id);

-- ----------------------------------------------------------------------------
-- 7. 승인·반려·철회 (불변 기록, 대상 해시 고정)
--    다형 subject_id 대신 대상별 FK 열 두 개 + subject_type 일치 check(참조 무결성 확보).
-- ----------------------------------------------------------------------------
create table public.distribution_approvals (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('content_version', 'draft_revision')),
  content_version_id uuid references public.distribution_content_versions (id) on delete restrict,
  draft_revision_id uuid references public.distribution_draft_revisions (id) on delete restrict,
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  decision text not null check (decision in ('approved', 'rejected', 'revoked')),
  revokes_approval_id uuid references public.distribution_approvals (id) on delete restrict,
  reason text check (reason is null or char_length(reason) <= 1000),
  checklist jsonb not null default '{}'::jsonb check (jsonb_typeof(checklist) = 'object'),
  actor_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),   -- INSERT 트리거가 now()로 고정
  constraint distribution_approvals_subject_match check (
    (subject_type = 'content_version' and content_version_id is not null and draft_revision_id is null)
    or (subject_type = 'draft_revision' and draft_revision_id is not null and content_version_id is null)
  ),
  -- 철회는 정확히 하나의 이전 승인을 가리킨다. 승인/반려는 가리키지 않는다.
  constraint distribution_approvals_revoke_target check (
    (decision = 'revoked') = (revokes_approval_id is not null)
  ),
  -- 반려·철회는 사유 필수.
  constraint distribution_approvals_reason_required check (
    decision = 'approved' or (reason is not null and char_length(btrim(reason)) >= 1)
  )
);
create index distribution_approvals_content_version_idx
  on public.distribution_approvals (content_version_id, created_at desc)
  where content_version_id is not null;
create index distribution_approvals_draft_revision_idx
  on public.distribution_approvals (draft_revision_id, created_at desc)
  where draft_revision_id is not null;
-- 같은 승인을 두 번 철회하지 않는다.
create unique index distribution_approvals_revokes_once
  on public.distribution_approvals (revokes_approval_id)
  where revokes_approval_id is not null;

-- ============================================================================
-- 트리거 함수 — 기존 orders_guard_update 패턴(public, security invoker, search_path='',
-- 클라이언트 EXECUTE 회수). 트리거 발동은 EXECUTE 권한을 다시 검사하지 않는다.
-- ============================================================================

-- 불변 기록: UPDATE/DELETE(행)와 TRUNCATE(문장) 거부. service_role 직접 갱신에도 적용.
create or replace function public.distribution_reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'check_violation';
end;
$$;

-- 원문 버전 INSERT: 머리를 잠그고 version_no = 현재+1 강제, created_at 고정.
create or replace function public.distribution_content_versions_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_current integer;
begin
  select c.current_version_no into v_current
  from public.distribution_contents c
  where c.id = new.content_id
  for update;
  if not found then
    raise exception 'distribution content % not found', new.content_id using errcode = 'foreign_key_violation';
  end if;
  if new.version_no <> v_current + 1 then
    raise exception 'version_no must be % (got %)', v_current + 1, new.version_no using errcode = 'check_violation';
  end if;
  new.created_at := now();
  return new;
end;
$$;

-- 원문 버전 INSERT 후: 머리 포인터 전진.
create or replace function public.distribution_content_versions_after_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.distribution_contents
     set current_version_id = new.id,
         current_version_no = new.version_no
   where id = new.content_id;
  return null;
end;
$$;

-- 원문 머리 UPDATE 보호: 식별·소유·생성 시각 불변, 포인터는 같은 원문의 바로 다음 버전으로만 전진.
create or replace function public.distribution_contents_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(new.id, new.owner_id, new.created_at) is distinct from row(old.id, old.owner_id, old.created_at) then
    raise exception 'distribution_contents identity columns are immutable' using errcode = 'check_violation';
  end if;
  if row(new.current_version_id, new.current_version_no)
     is distinct from row(old.current_version_id, old.current_version_no) then
    if new.current_version_no <> old.current_version_no + 1
       or not exists (
         select 1 from public.distribution_content_versions v
         where v.id = new.current_version_id
           and v.content_id = new.id
           and v.version_no = new.current_version_no
       ) then
      raise exception 'current version pointer may only advance to the next inserted version'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- 리비전 INSERT: 초안 머리를 잠그고 revision_no = 현재+1 강제, created_at 고정.
create or replace function public.distribution_draft_revisions_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_current integer;
begin
  select d.current_revision_no into v_current
  from public.distribution_channel_drafts d
  where d.id = new.draft_id
  for update;
  if not found then
    raise exception 'distribution draft % not found', new.draft_id using errcode = 'foreign_key_violation';
  end if;
  if new.revision_no <> v_current + 1 then
    raise exception 'revision_no must be % (got %)', v_current + 1, new.revision_no using errcode = 'check_violation';
  end if;
  new.created_at := now();
  -- 호출자가 넣은 값은 무시하고 현재 최상위 트랜잭션 ID로 고정(SAVEPOINT/서브트랜잭션 안에서도 최상위 ID).
  new.created_xact_id := pg_current_xact_id();
  return new;
end;
$$;

-- 리비전 INSERT 후: 초안 머리 포인터 전진.
create or replace function public.distribution_draft_revisions_after_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.distribution_channel_drafts
     set current_revision_id = new.id,
         current_revision_no = new.revision_no
   where id = new.draft_id;
  return null;
end;
$$;

-- 초안 머리 UPDATE 보호: 식별·원문·채널·생성 시각 불변, 포인터는 바로 다음 리비전으로만 전진.
create or replace function public.distribution_channel_drafts_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(new.id, new.content_id, new.channel, new.created_at)
     is distinct from row(old.id, old.content_id, old.channel, old.created_at) then
    raise exception 'distribution_channel_drafts identity columns are immutable' using errcode = 'check_violation';
  end if;
  if row(new.current_revision_id, new.current_revision_no)
     is distinct from row(old.current_revision_id, old.current_revision_no) then
    if new.current_revision_no <> old.current_revision_no + 1
       or not exists (
         select 1 from public.distribution_draft_revisions r
         where r.id = new.current_revision_id
           and r.draft_id = new.id
           and r.revision_no = new.current_revision_no
       ) then
      raise exception 'current revision pointer may only advance to the next inserted revision'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- 리비전 미디어 INSERT: 부모 리비전을 INSERT한 최상위 트랜잭션에서만(머리 주석 (d)).
--   주 조건: 리비전 created_xact_id = pg_current_xact_id() (xid8 동등 비교, PostgreSQL 13+).
--   보조 조건: 리비전 created_at = now() (같은 트랜잭션이면 항상 같음; 단독으로는 동일 트랜잭션 증명 불가).
-- revision_hash가 미디어 순서를 포함하므로, 리비전 커밋 후 미디어를 덧붙여 승인 대상을 바꾸는 것을 막는다.
-- 같은 트랜잭션 안의 미디어 구성이 revision_hash와 맞는지는 검증하지 않는다(쓰기 함수 책임).
create or replace function public.distribution_draft_revision_media_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_created timestamptz;
  v_xact xid8;
begin
  select r.created_at, r.created_xact_id into v_created, v_xact
  from public.distribution_draft_revisions r
  where r.id = new.revision_id;
  if not found then
    raise exception 'distribution revision % not found', new.revision_id using errcode = 'foreign_key_violation';
  end if;
  if v_xact <> pg_current_xact_id() or v_created <> now() then
    raise exception 'revision media must be inserted in the same transaction as its revision'
      using errcode = 'check_violation';
  end if;
  new.created_at := now();
  return new;
end;
$$;

-- 승인 INSERT: subject_hash = 대상 행의 저장 해시(DB가 검증 가능한 범위), 철회 대상 일치, created_at 고정.
-- 해시가 내용의 진짜 sha256인지는 검증하지 않는다(머리 주석 (e)(f) — 쓰기 함수가 재계산).
create or replace function public.distribution_approvals_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_hash text;
  v_target record;
begin
  if new.subject_type = 'content_version' then
    select v.content_hash into v_hash
    from public.distribution_content_versions v where v.id = new.content_version_id;
  elsif new.subject_type = 'draft_revision' then
    select r.revision_hash into v_hash
    from public.distribution_draft_revisions r where r.id = new.draft_revision_id;
  end if;
  if v_hash is null then
    raise exception 'approval subject not found' using errcode = 'foreign_key_violation';
  end if;
  if new.subject_hash <> v_hash then
    raise exception 'approval subject_hash does not match the stored subject hash'
      using errcode = 'check_violation';
  end if;

  if new.decision = 'revoked' then
    select a.decision, a.subject_type, a.content_version_id, a.draft_revision_id, a.subject_hash
      into v_target
    from public.distribution_approvals a
    where a.id = new.revokes_approval_id;
    if not found then
      raise exception 'revoked approval % not found', new.revokes_approval_id using errcode = 'foreign_key_violation';
    end if;
    if v_target.decision <> 'approved'
       or v_target.subject_type <> new.subject_type
       or v_target.content_version_id is distinct from new.content_version_id
       or v_target.draft_revision_id is distinct from new.draft_revision_id
       or v_target.subject_hash <> new.subject_hash then
      raise exception 'revocation must target an approved decision on the same subject'
        using errcode = 'check_violation';
    end if;
  end if;

  new.created_at := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 트리거 연결
-- ----------------------------------------------------------------------------
create trigger distribution_contents_guard before update on public.distribution_contents
  for each row execute function public.distribution_contents_guard_update();
create trigger distribution_contents_no_truncate before truncate on public.distribution_contents
  for each statement execute function public.distribution_reject_mutation();

create trigger distribution_content_versions_insert before insert on public.distribution_content_versions
  for each row execute function public.distribution_content_versions_before_insert();
create trigger distribution_content_versions_advance after insert on public.distribution_content_versions
  for each row execute function public.distribution_content_versions_after_insert();
create trigger distribution_content_versions_immutable before update or delete on public.distribution_content_versions
  for each row execute function public.distribution_reject_mutation();
create trigger distribution_content_versions_no_truncate before truncate on public.distribution_content_versions
  for each statement execute function public.distribution_reject_mutation();

create trigger distribution_channel_drafts_guard before update on public.distribution_channel_drafts
  for each row execute function public.distribution_channel_drafts_guard_update();
create trigger distribution_channel_drafts_no_truncate before truncate on public.distribution_channel_drafts
  for each statement execute function public.distribution_reject_mutation();

create trigger distribution_draft_revisions_insert before insert on public.distribution_draft_revisions
  for each row execute function public.distribution_draft_revisions_before_insert();
create trigger distribution_draft_revisions_advance after insert on public.distribution_draft_revisions
  for each row execute function public.distribution_draft_revisions_after_insert();
create trigger distribution_draft_revisions_immutable before update or delete on public.distribution_draft_revisions
  for each row execute function public.distribution_reject_mutation();
create trigger distribution_draft_revisions_no_truncate before truncate on public.distribution_draft_revisions
  for each statement execute function public.distribution_reject_mutation();

create trigger distribution_draft_revision_media_insert before insert on public.distribution_draft_revision_media
  for each row execute function public.distribution_draft_revision_media_before_insert();
create trigger distribution_draft_revision_media_immutable before update or delete on public.distribution_draft_revision_media
  for each row execute function public.distribution_reject_mutation();
create trigger distribution_draft_revision_media_no_truncate before truncate on public.distribution_draft_revision_media
  for each statement execute function public.distribution_reject_mutation();

create trigger distribution_approvals_insert before insert on public.distribution_approvals
  for each row execute function public.distribution_approvals_before_insert();
create trigger distribution_approvals_immutable before update or delete on public.distribution_approvals
  for each row execute function public.distribution_reject_mutation();
create trigger distribution_approvals_no_truncate before truncate on public.distribution_approvals
  for each statement execute function public.distribution_reject_mutation();

-- ============================================================================
-- 권한(GRANT) — 열 보호
-- Supabase 기본 권한(public 스키마 새 객체에 anon/authenticated ALL)을 먼저 전부 회수한다.
-- ============================================================================
revoke all on table
  public.distribution_contents, public.distribution_content_versions,
  public.distribution_channel_drafts, public.distribution_draft_revisions,
  public.distribution_draft_revision_media, public.distribution_approvals
from public, anon, authenticated;

-- service_role: 불변 테이블은 수정·삭제·비우기 권한 회수, 머리 테이블은 비우기만 회수(트리거와 이중 보호).
revoke update, delete, truncate on table
  public.distribution_content_versions, public.distribution_draft_revisions,
  public.distribution_draft_revision_media, public.distribution_approvals
from service_role;
revoke truncate on table
  public.distribution_contents, public.distribution_channel_drafts
from service_role;

-- distribution_admin 읽기: authenticated에 명시 열 SELECT만(행은 아래 RLS가 거른다). anon 권한 없음.
-- distribution_draft_revisions.created_xact_id(내부 트랜잭션 ID)는 의도적으로 GRANT 목록에서 제외한다
--   → 사용자 API(PostgREST)로 조회 불가. 클라이언트는 select=* 대신 명시 열을 요청해야 한다.
grant select (id, owner_id, story_slug, current_version_id, current_version_no, archived_at, created_at, updated_at)
  on public.distribution_contents to authenticated;
grant select (id, content_id, version_no, title, body, target_path, source_refs, media_asset_ids,
              content_hash, change_summary, created_by, created_at)
  on public.distribution_content_versions to authenticated;
grant select (id, content_id, channel, current_revision_id, current_revision_no, archived_at, created_at, updated_at)
  on public.distribution_channel_drafts to authenticated;
grant select (id, draft_id, content_id, revision_no, content_version_id, body, link_url, utm,
              target_connection_id, target_external_account_id, validation, revision_hash, created_by, created_at)
  on public.distribution_draft_revisions to authenticated;
grant select (revision_id, position, asset_id, variant_id, alt_text, created_at)
  on public.distribution_draft_revision_media to authenticated;
grant select (id, subject_type, content_version_id, draft_revision_id, subject_hash, decision,
              revokes_approval_id, reason, checklist, actor_id, created_at)
  on public.distribution_approvals to authenticated;
-- 클라이언트 INSERT/UPDATE/DELETE 권한 없음(M2 이후 service_role 전용 함수로만 쓰기).

-- 트리거 함수: 클라이언트 실행 권한 없음.
revoke all on function public.distribution_reject_mutation() from public, anon, authenticated;
revoke all on function public.distribution_content_versions_before_insert() from public, anon, authenticated;
revoke all on function public.distribution_content_versions_after_insert() from public, anon, authenticated;
revoke all on function public.distribution_contents_guard_update() from public, anon, authenticated;
revoke all on function public.distribution_draft_revisions_before_insert() from public, anon, authenticated;
revoke all on function public.distribution_draft_revisions_after_insert() from public, anon, authenticated;
revoke all on function public.distribution_channel_drafts_guard_update() from public, anon, authenticated;
revoke all on function public.distribution_draft_revision_media_before_insert() from public, anon, authenticated;
revoke all on function public.distribution_approvals_before_insert() from public, anon, authenticated;

-- ============================================================================
-- RLS — 행 보호: 승인된 배포 관리자 읽기만. 쓰기 정책 없음.
-- ============================================================================
alter table public.distribution_contents enable row level security;
alter table public.distribution_content_versions enable row level security;
alter table public.distribution_channel_drafts enable row level security;
alter table public.distribution_draft_revisions enable row level security;
alter table public.distribution_draft_revision_media enable row level security;
alter table public.distribution_approvals enable row level security;

create policy distribution_contents_admin_read on public.distribution_contents
  for select to authenticated using ((select private.is_distribution_admin()));
create policy distribution_content_versions_admin_read on public.distribution_content_versions
  for select to authenticated using ((select private.is_distribution_admin()));
create policy distribution_channel_drafts_admin_read on public.distribution_channel_drafts
  for select to authenticated using ((select private.is_distribution_admin()));
create policy distribution_draft_revisions_admin_read on public.distribution_draft_revisions
  for select to authenticated using ((select private.is_distribution_admin()));
create policy distribution_draft_revision_media_admin_read on public.distribution_draft_revision_media
  for select to authenticated using ((select private.is_distribution_admin()));
create policy distribution_approvals_admin_read on public.distribution_approvals
  for select to authenticated using ((select private.is_distribution_admin()));

-- ============================================================================
-- rollback 메모(실행 안 함): 데이터가 없을 때만 역순 drop
--   (approvals → revision_media → draft_revisions/channel_drafts의 상호 FK 해제 → content_versions/contents
--    상호 FK 해제 → 트리거 함수 → private.is_distribution_admin()).
--   데이터가 생긴 뒤에는 drop하지 않고 기능 플래그 off + forward-fix migration으로 수정한다.
-- ============================================================================
