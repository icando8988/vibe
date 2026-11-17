-- ============================================================================
-- 통합 배포 — Blog 확장 승인본 인계(handoff): 요청 · 선점 · 리스 연장 · 입력 결과
-- AUTOPOST-BLOG-HANDOFF-007 · 2026-11-17 · CC-ENG (Claude Code)
-- 참고 계약: 원본 Blog_Posting_Kit_v1.07 app/api/extension/{task, posts/[id]/heartbeat, posts/[id]/input-result},
--            utils/extensionTask.ts(30분 자동 시작 창, 3분 리스, run 번호, ALLOWED_PREVIOUS).
--            원본 코드는 복사하지 않았고 M2 작업·060000 토큰 위에 다시 작성했다.
-- 상태: 로컬 PGlite 대역(handoff-run.mjs)으로만 검증. 실제 Supabase 미적용.
-- 의존: M0~M2, 050000, 060000(distribution_authenticate_extension_token).
--
-- 설계
--   * 인계는 M2 작업 상태를 바꾸지 않는다. 별도 표 distribution_extension_handoffs가 인계 상태·리스·run을 가진다.
--     input-result는 어떤 경우에도 distribution_jobs를 갱신하지 않는다(published·awaiting_evidence 자동 전이 없음).
--     게시 표시·증거는 기존 M2 manual RPC(mark_manual_posted / record_manual_evidence)로 사람이 한다.
--   * 작업당 인계 1건(unique job_id). 리스가 만료되면 needs_check로 바꾸고, 자동 재입력·새 run 재발급을 하지 않는다
--     (이미 네이버에 입력됐을 수 있으므로 중복 입력 방지). 다시 보내려면 운영자가 상황을 확인해야 한다(별도 작업).
--   * 요청(request): 승인된 admin(D1)이 manual_ready blog 작업을 "확장으로 보내기". 요청자만 그 인계를 가져갈 수 있다.
--   * 선점(claim): 토큰 해시 → 060000 인증(철회·만료·소유자 D1 매번) → 소유자가 요청한 30분 이내 인계 1건을
--     FOR UPDATE SKIP LOCKED로 잠그고, 작업 상태·모드·채널·보류·대사 필요·최신성(stale)·승인 철회·보관을 다시 확인한다.
--     문제가 있으면 rejected(코드만 기록)로 끝내고 내용을 주지 않는다.
--     전달 내용 = 승인된 원문 버전 title + 승인된 리비전 body(작업에 고정된 ID 기준).
--   * 리스 연장(heartbeat)·입력 결과: 같은 토큰(token_id)·같은 run·같은 소유자만. 토큰 철회 후에는 인증 실패.
--   * 최소 기록: 상태, 시각, 오류 코드(대문자 토큰)만. 오류 문장·본문·응답 전체는 저장하지 않는다.
--   * 함수: SECURITY DEFINER, search_path='', PUBLIC 기본 EXECUTE 회수, service_role에만 EXECUTE.
--   * 테이블: 모든 역할 권한 회수 + RLS(정책 없음). 직접 조회·DML 불가.
-- 오류 접두어: UNAUTHENTICATED(28000) · SUPERSEDED(P0001) · HANDOFF_EXISTS(23505) · NOT_HANDOFFABLE(23514)
-- ============================================================================

create table public.distribution_extension_handoffs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.distribution_jobs (id) on delete restrict,
  requested_by uuid not null references auth.users (id) on delete restrict,
  requested_at timestamptz not null default now(),
  status text not null default 'requested' check (status in (
    'requested',     -- 확장으로 보냄(아직 가져가지 않음)
    'in_progress',   -- 확장이 가져가 입력 중
    'completed',     -- 본문 입력 완료(발행 설정 전)
    'publish_ready', -- 발행 직전까지 준비 완료(최종 발행은 사람이)
    'failed',        -- 확장이 실패 보고
    'needs_check',   -- 리스 만료: 입력됐을 수 있음 → 사람 확인 필요(자동 재입력 없음)
    'rejected'       -- 선점 시 재검사 실패(최신성·승인·보관·작업 상태). 내용 미전달
  )),
  token_id uuid references public.distribution_extension_tokens (id) on delete restrict,
  run_id uuid unique,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  finished_at timestamptz,
  last_code text check (last_code is null or last_code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  updated_at timestamptz not null default now(),
  constraint distribution_extension_handoffs_claim_shape check (
    (status in ('requested') and token_id is null and run_id is null and claimed_at is null)
    or (status = 'rejected' and run_id is null)
    or (status not in ('requested', 'rejected') and token_id is not null and run_id is not null and claimed_at is not null)
  )
);

create index distribution_extension_handoffs_claim_idx
  on public.distribution_extension_handoffs (requested_by, requested_at) where status = 'requested';
create index distribution_extension_handoffs_lease_idx
  on public.distribution_extension_handoffs (lease_expires_at) where status in ('in_progress', 'completed');

alter table public.distribution_extension_handoffs enable row level security;
revoke all on table public.distribution_extension_handoffs from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 내부: 토큰 해시 → (user_id, token_id). 060000 인증 재사용(철회·만료·D1). 실패면 UNAUTHENTICATED.
-- ----------------------------------------------------------------------------
create or replace function public.distribution_handoff_token_owner(p_token_hash text, out o_user uuid, out o_token uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  select a.user_id, a.token_id into o_user, o_token
  from public.distribution_authenticate_extension_token(p_token_hash) a;
  if o_user is null then
    raise exception 'UNAUTHENTICATED: extension token is invalid, expired, revoked, or not an approved admin'
      using errcode = 'invalid_authorization_specification';
  end if;
end;
$$;

-- 내부: 만료된 리스 → needs_check (자동 재입력 없음). 대상 행만.
create or replace function public.distribution_handoff_expire(p_handoff_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.distribution_extension_handoffs
  set status = 'needs_check', last_code = 'LEASE_EXPIRED', finished_at = now(), lease_expires_at = null, updated_at = now()
  where id = p_handoff_id and status in ('in_progress', 'completed') and lease_expires_at <= now();
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- 내부: 인계 가능 여부(작업·최신성·승인·보관). null이면 가능.
create or replace function public.distribution_handoff_problem(p_job_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_basis text;
begin
  select j.status, j.mode, j.channel, j.hold_reason, j.reconciliation_required,
         j.draft_revision_id, j.approval_id, j.content_approval_id
    into v_job
  from public.distribution_jobs j where j.id = p_job_id;
  if not found then return 'JOB_MISSING'; end if;
  if v_job.channel <> 'blog' or v_job.mode <> 'manual' then return 'NOT_BLOG_MANUAL'; end if;
  if v_job.status <> 'manual_ready' then return 'NOT_MANUAL_READY'; end if;
  if v_job.hold_reason is not null then return 'ON_HOLD'; end if;
  if v_job.reconciliation_required then return 'RECONCILIATION_REQUIRED'; end if;
  v_basis := public.distribution_job_basis_problem(v_job.draft_revision_id, v_job.approval_id, v_job.content_approval_id);
  if v_basis is not null then return 'BASIS_' || upper(v_basis); end if;
  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. 요청: 승인된 admin이 manual_ready blog 작업을 확장으로 보낸다.
-- ----------------------------------------------------------------------------
create or replace function public.distribution_request_extension_handoff(p_actor_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_problem text;
  v_row public.distribution_extension_handoffs%rowtype;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  perform 1 from public.distribution_jobs j where j.id = p_job_id for share;
  v_problem := public.distribution_handoff_problem(p_job_id);
  if v_problem = 'JOB_MISSING' then
    raise exception 'distribution job not found' using errcode = 'no_data_found';
  end if;
  if v_problem is not null then
    raise exception 'NOT_HANDOFFABLE: %', v_problem using errcode = 'check_violation';
  end if;

  select * into v_row from public.distribution_extension_handoffs h where h.job_id = p_job_id for update;
  if found then
    if v_row.status = 'requested' and v_row.requested_by = p_actor_id then
      -- 아직 가져가지 않은 본인 요청은 자동 시작 창만 새로 연다.
      update public.distribution_extension_handoffs set requested_at = now(), updated_at = now() where id = v_row.id;
      return pg_catalog.jsonb_build_object('handoff_id', v_row.id, 'job_id', p_job_id, 'status', 'requested', 'refreshed', true);
    end if;
    -- F-2(REVIEW-009): 선점 재검사에서 거절된 인계는 run이 발급되지 않았고(run_id null) 선점된 적도 없다(claimed_at null)
    -- = 내용이 확장에 전달되지 않았음이 증명된다. 위에서 D1·작업 근거를 방금 다시 확인했으므로 요청을 재설정한다.
    -- needs_check·failed·in_progress·completed·publish_ready(전달됐을 수 있음)는 여전히 재인계하지 않는다.
    if v_row.status = 'rejected' and v_row.run_id is null and v_row.claimed_at is null then
      update public.distribution_extension_handoffs
      set status = 'requested', requested_by = p_actor_id, requested_at = now(),
          token_id = null, last_code = null, finished_at = null, lease_expires_at = null, updated_at = now()
      where id = v_row.id;
      return pg_catalog.jsonb_build_object('handoff_id', v_row.id, 'job_id', p_job_id, 'status', 'requested', 'refreshed', true);
    end if;
    -- 이미 가져갔거나(입력됐을 수 있음) 다른 admin이 요청한 인계는 자동으로 다시 보내지 않는다.
    raise exception 'HANDOFF_EXISTS: job already has a handoff (status %)', v_row.status using errcode = 'unique_violation';
  end if;

  insert into public.distribution_extension_handoffs (job_id, requested_by)
  values (p_job_id, p_actor_id)
  returning * into v_row;
  return pg_catalog.jsonb_build_object('handoff_id', v_row.id, 'job_id', p_job_id, 'status', 'requested', 'refreshed', false);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. 선점(task): 토큰 소유자가 요청한 30분 이내 인계 1건. 없으면 null.
-- ----------------------------------------------------------------------------
create or replace function public.distribution_claim_extension_handoff(p_token_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_token uuid;
  v_h public.distribution_extension_handoffs%rowtype;
  v_problem text;
  v_run uuid := gen_random_uuid();
  v_title text;
  v_body text;
begin
  select o.o_user, o.o_token into v_owner, v_token from public.distribution_handoff_token_owner(p_token_hash) o;

  select * into v_h
  from public.distribution_extension_handoffs h
  where h.status = 'requested'
    and h.requested_by = v_owner
    and h.requested_at >= now() - interval '30 minutes'
  order by h.requested_at, h.id
  limit 1
  for update skip locked;
  if not found then
    return null;
  end if;

  -- 작업 행도 잠가 같은 순간의 상태 변경과 직렬화한다.
  perform 1 from public.distribution_jobs j where j.id = v_h.job_id for share;
  v_problem := public.distribution_handoff_problem(v_h.job_id);
  if v_problem is not null then
    update public.distribution_extension_handoffs
    set status = 'rejected', token_id = v_token, last_code = left(v_problem, 40), finished_at = now(), updated_at = now()
    where id = v_h.id;
    return null;
  end if;

  select v.title, r.body into v_title, v_body
  from public.distribution_jobs j
  join public.distribution_content_versions v on v.id = j.content_version_id
  join public.distribution_draft_revisions r on r.id = j.draft_revision_id
  where j.id = v_h.job_id;

  update public.distribution_extension_handoffs
  set status = 'in_progress', token_id = v_token, run_id = v_run, claimed_at = now(),
      lease_expires_at = now() + interval '180 seconds', last_heartbeat_at = null, last_code = null, updated_at = now()
  where id = v_h.id;

  return pg_catalog.jsonb_build_object(
    'job_id', v_h.job_id, 'run_id', v_run, 'lease_seconds', 180, 'title', v_title, 'body', v_body);
end;
$$;

-- ----------------------------------------------------------------------------
-- 내부: 진행 요청 공통 — 같은 소유자·같은 토큰·같은 run의 인계를 잠가 돌려준다. 아니면 SUPERSEDED/없음.
-- ----------------------------------------------------------------------------
create or replace function public.distribution_handoff_lock_run(
  p_owner uuid, p_token uuid, p_job_id uuid, p_run_id uuid
)
returns public.distribution_extension_handoffs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_h public.distribution_extension_handoffs%rowtype;
begin
  select * into v_h from public.distribution_extension_handoffs h
  where h.job_id = p_job_id and h.requested_by = p_owner
  for update;
  if not found then
    raise exception 'handoff not found' using errcode = 'no_data_found';
  end if;
  if p_run_id is null or v_h.run_id is distinct from p_run_id or v_h.token_id is distinct from p_token then
    raise exception 'SUPERSEDED: run or token does not own this handoff' using errcode = 'P0001';
  end if;
  return v_h;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. 리스 연장(heartbeat): 소유 토큰·run, 입력 중/입력 완료 상태, 리스 미만료, 근거 최신일 때만.
-- ----------------------------------------------------------------------------
create or replace function public.distribution_heartbeat_extension_handoff(p_token_hash text, p_job_id uuid, p_run_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_token uuid;
  v_h public.distribution_extension_handoffs%rowtype;
  v_problem text;
begin
  select o.o_user, o.o_token into v_owner, v_token from public.distribution_handoff_token_owner(p_token_hash) o;
  v_h := public.distribution_handoff_lock_run(v_owner, v_token, p_job_id, p_run_id);
  if v_h.status not in ('in_progress', 'completed') then
    raise exception 'SUPERSEDED: handoff is %', v_h.status using errcode = 'P0001';
  end if;
  -- 상태를 기록해야 하는 거절은 예외 대신 결과로 돌려준다(예외는 트랜잭션을 되돌려 needs_check 기록이 사라진다).
  if public.distribution_handoff_expire(v_h.id) then
    return pg_catalog.jsonb_build_object('ok', false, 'superseded', true, 'reason', 'LEASE_EXPIRED');
  end if;
  v_problem := public.distribution_handoff_problem(p_job_id);
  if v_problem is not null then
    -- 입력 도중 원문·초안이 바뀌었거나 승인 철회·보관 → 중지시키고 사람 확인으로 둔다.
    update public.distribution_extension_handoffs
    set status = 'needs_check', last_code = left(v_problem, 40), finished_at = now(), lease_expires_at = null, updated_at = now()
    where id = v_h.id;
    return pg_catalog.jsonb_build_object('ok', false, 'superseded', true, 'reason', left(v_problem, 40));
  end if;
  update public.distribution_extension_handoffs
  set lease_expires_at = now() + interval '180 seconds', last_heartbeat_at = now(), updated_at = now()
  where id = v_h.id;
  return pg_catalog.jsonb_build_object('ok', true, 'lease_seconds', 180);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. 입력 결과: 상태 기록만(M2 작업 불변). 같은 상태 재보고는 unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.distribution_record_extension_input(
  p_token_hash text, p_job_id uuid, p_run_id uuid, p_status text, p_code text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_token uuid;
  v_h public.distribution_extension_handoffs%rowtype;
  v_code text;
begin
  if p_status is null or p_status not in ('in_progress', 'completed', 'publish_ready', 'failed') then
    raise exception 'unsupported input status' using errcode = 'invalid_parameter_value';
  end if;
  v_code := case when p_code is not null and p_code ~ '^[A-Z][A-Z0-9_]{0,39}$' then p_code else null end;

  select o.o_user, o.o_token into v_owner, v_token from public.distribution_handoff_token_owner(p_token_hash) o;
  v_h := public.distribution_handoff_lock_run(v_owner, v_token, p_job_id, p_run_id);

  -- F-1(REVIEW-009): 만료 검사를 같은 상태 재보고(unchanged)보다 먼저 한다. 리스를 잃은 run에 성공을 돌려주지 않는다.
  if v_h.status in ('in_progress', 'completed') and public.distribution_handoff_expire(v_h.id) then
    -- needs_check 기록을 남기기 위해 예외 대신 결과로 거절한다.
    return pg_catalog.jsonb_build_object('success', false, 'persisted', false, 'superseded', true, 'reason', 'LEASE_EXPIRED');
  end if;
  if v_h.status = p_status then
    return pg_catalog.jsonb_build_object('success', true, 'persisted', true, 'status', p_status, 'unchanged', true);
  end if;
  -- 원본 ALLOWED_PREVIOUS 기준(옛 보고가 새 상태를 덮지 않게). needs_check/rejected/requested에서는 받지 않는다.
  if not (
    (p_status = 'completed' and v_h.status in ('in_progress'))
    or (p_status = 'publish_ready' and v_h.status in ('in_progress', 'completed'))
    or (p_status = 'failed' and v_h.status in ('in_progress', 'completed'))
  ) then
    raise exception 'SUPERSEDED: cannot record % from %', p_status, v_h.status using errcode = 'P0001';
  end if;

  update public.distribution_extension_handoffs
  set status = p_status,
      last_code = case when p_status = 'failed' then coalesce(v_code, 'EXTENSION_FAILED') else null end,
      finished_at = case when p_status in ('publish_ready', 'failed') then now() else null end,
      lease_expires_at = case when p_status in ('publish_ready', 'failed') then null else now() + interval '180 seconds' end,
      updated_at = now()
  where id = v_h.id;
  return pg_catalog.jsonb_build_object('success', true, 'persisted', true, 'status', p_status, 'unchanged', false);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. 관리자 인계 상태 조회(F-3, REVIEW-009): 본인이 요청한 인계만, 코드·시각만(본문·토큰·해시·run 없음).
--    조회 시점에 본인 인계 중 정리할 것을 needs_check로 바꾼다(외부 스케줄러 불필요):
--      - 리스가 지난 in_progress/completed → LEASE_EXPIRED
--      - 리스가 남았어도 그 run의 토큰이 철회·만료됨 → TOKEN_REVOKED / TOKEN_EXPIRED (확장이 더는 진행 보고를 못 함)
--    needs_check는 사람 확인이 필요한 상태로 남고 자동 재요청·재인계는 없다.
-- ----------------------------------------------------------------------------
create or replace function public.distribution_list_extension_handoffs(p_actor_id uuid)
returns table (
  job_id uuid,
  status text,
  last_code text,
  requested_at timestamptz,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.distribution_assert_admin_actor(p_actor_id);

  update public.distribution_extension_handoffs h
  set status = 'needs_check',
      last_code = case
        when h.lease_expires_at <= now() then 'LEASE_EXPIRED'
        when t.revoked_at is not null then 'TOKEN_REVOKED'
        else 'TOKEN_EXPIRED' end,
      finished_at = now(), lease_expires_at = null, updated_at = now()
  from public.distribution_extension_tokens t
  where t.id = h.token_id
    and h.requested_by = p_actor_id
    and h.status in ('in_progress', 'completed')
    and (h.lease_expires_at <= now() or t.revoked_at is not null or t.expires_at <= now());

  return query
    select h.job_id, h.status, h.last_code, h.requested_at, h.claimed_at, h.lease_expires_at, h.finished_at, h.updated_at
    from public.distribution_extension_handoffs h
    where h.requested_by = p_actor_id
    order by h.requested_at desc, h.id desc
    limit 50;
end;
$$;

-- ----------------------------------------------------------------------------
-- ACL
-- ----------------------------------------------------------------------------
revoke all on function public.distribution_handoff_token_owner(text) from public, anon, authenticated, service_role;
revoke all on function public.distribution_handoff_expire(uuid) from public, anon, authenticated, service_role;
revoke all on function public.distribution_handoff_problem(uuid) from public, anon, authenticated, service_role;
revoke all on function public.distribution_handoff_lock_run(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function public.distribution_request_extension_handoff(uuid, uuid) from public, anon, authenticated;
revoke all on function public.distribution_claim_extension_handoff(text) from public, anon, authenticated;
revoke all on function public.distribution_heartbeat_extension_handoff(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.distribution_record_extension_input(text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.distribution_list_extension_handoffs(uuid) from public, anon, authenticated;
grant execute on function public.distribution_list_extension_handoffs(uuid) to service_role;

grant execute on function public.distribution_request_extension_handoff(uuid, uuid) to service_role;
grant execute on function public.distribution_claim_extension_handoff(text) to service_role;
grant execute on function public.distribution_heartbeat_extension_handoff(text, uuid, uuid) to service_role;
grant execute on function public.distribution_record_extension_input(text, uuid, uuid, text, text) to service_role;
