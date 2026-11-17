-- ============================================================================
-- 통합 배포 M2 — 게시 작업 · 단계별 시도 · 불변 이벤트 · 게시 증거 · 대사 기록 + server-only mutation API
-- AUTOPOST-M2-JOBS-001 · 2026-11-16 · CC-ENG (Claude Code)
-- 보완: AUTOPOST-M2-REVIEW-FIX-001 · 2026-11-16 (provider publish 전이 가드 — 시도·컨테이너 절 "보강" 참고)
-- 근거: .ai/decisions/DEC-AUTOPOST-DATA-001.md (D1, D2), docs/AUTOPOST_INTEGRATION_PLAN.md §2.2,
--       .ai/results/AUTOPOST-DATA-001-CC-ENG.md §3.3 · §4 · §5 · §7 · §8 · §9(M2),
--       M1 web/supabase/migrations/20261116030000_distribution_content.sql (열·제약 이름 대조 후 작성)
-- 상태: 어떤 DB에도 적용·실행 검증하지 않았다(작성만, 정적 검토만). 원격 적용은 별도 승인 게이트.
--
-- 범위
--   * public.distribution_jobs              (가변 머리: 상태 캐시 + 허용 전이 가드 + 낙관적 version)
--   * public.distribution_job_attempts      (시도별 원격 단계. 컨테이너 ID 1회 기록·선커밋 강제)
--   * public.distribution_job_events        (불변. jobs INSERT/UPDATE 트리거가 같은 트랜잭션에서 자동 기록)
--   * public.distribution_publication_evidence (불변 + 상태 열만 제한 전이. job당 accepted 1개)
--   * public.distribution_reconciliations   (불변 대사 기록. confirmed_absent 근거 필수)
--   * service_role 전용 mutation 함수(아래 "API 목록"), 내부 helper, 트리거 함수, grants/RLS
--
-- 범위 밖 (이 파일이 만들지 않음)
--   * 스케줄러(Vercel Cron / pg_cron) 선택·등록 — D3 미결정. claim 함수의 원자적 인터페이스만 제공하고
--     호출 주체는 비워 둔다. scheduler_runs(M5), runtime_controls(중지 스위치)도 후속.
--   * 연결/OAuth/비밀(M3), 미디어·권리(M4), provider HTTP 호출, UI, 앱 코드.
--   * M1 테이블 쓰기 함수(버전·리비전·승인 기록) — 별도 작업.
--   * 기존 private.is_admin()/is_approved_member()/is_distribution_admin(), orders 계약,
--     public.set_updated_at(), M1 객체는 변경·재정의하지 않는다(재사용만: set_updated_at,
--     distribution_reject_mutation, M1 테이블 FK/unique).
--
-- ----------------------------------------------------------------------------
-- 권한·역할 경계 (불변조건 8)
--   * anon/authenticated: 새 테이블 쓰기 권한·정책 없음. authenticated는 명시 열 SELECT +
--     RLS(private.is_distribution_admin())로 승인된 배포 admin만 읽는다. anon 권한 없음.
--   * service_role: 새 테이블은 SELECT만(INSERT/UPDATE/DELETE/TRUNCATE 회수). 데이터 변경은 아래 API 함수만.
--   * API 함수 = SECURITY DEFINER.
--       이유: service_role의 직접 DML을 회수해 "함수만이 쓰기 경로"를 역할 수준에서 강제하기 위해서다
--       (M1은 service_role INSERT를 남겼지만 M2는 상태 기계라 직접 DML 우회를 막는다).
--       owner: 이 migration을 실행하는 역할(Supabase에서는 postgres = 테이블 owner). owner는 RLS 대상이 아니다.
--       search_path = '' 고정, 모든 객체는 schema-qualified(public./auth./private. — pg_catalog는 암묵 포함).
--       EXECUTE: PUBLIC/anon/authenticated 회수, service_role에만 GRANT. Supabase는 public 스키마 새 함수에
--       anon/authenticated EXECUTE를 기본 부여하므로 함수마다 명시 회수한다. PostgREST /rpc 경로에는 보이지만
--       service_role 외에는 실행할 수 없다(Security Advisor "signed-in users can execute SECURITY DEFINER" 비대상).
--   * actor ID를 받는 함수는 public.distribution_assert_admin_actor()로 role_assignments.role='admin' AND
--     profiles.approval_status='approved'(D1과 같은 조건)를 호출 시점에 재검증한다. 트리거도 admin 컨텍스트면
--     한 번 더 검증한다(이중화). 주의: private.is_distribution_admin()은 auth.uid() 기반이라 service_role
--     호출에서는 쓸 수 없으므로 같은 조건의 actor 인자형 helper를 별도로 둔다(private 함수는 건드리지 않음).
--   * 내부 helper/트리거 함수: PUBLIC/anon/authenticated/service_role 모두 EXECUTE 회수(owner만 실행 →
--     DEFINER 함수 안에서만 호출됨). 트리거 함수는 SECURITY INVOKER(M1 패턴) — DEFINER 함수 안 DML이므로
--     owner 권한으로 실행된다.
--
-- 이벤트 컨텍스트 (불변조건 5)
--   * API 함수는 jobs를 바꾸기 직전 distribution_set_event_context()로 트랜잭션 로컬 GUC
--     (distribution.ctx_*)에 actor_kind/actor_id/reason/summary/worker/reconciliation/evidence를 넣는다.
--   * jobs BEFORE 가드는 컨텍스트가 없으면 거부하고, AFTER 트리거가 distribution_job_events에 한 행
--     (seq = jobs.version)을 같은 트랜잭션에서 추가한 뒤 컨텍스트를 지운다 → 이벤트 누락 불가.
--   * 모든 jobs 변경(상태·단계·lease·hold·플래그)이 이벤트 1행을 만든다(unique(job_id, seq)).
--
-- 멱등키·중복 제약 (불변조건 3) — 기존 순수 함수와 비교
--   * 키 형식은 makeIdempotencyKey와 동일: 'pub:<content_id>:v<version_no>:<channel>:<mode>'.
--     DB가 FK로 고정된 열(content_id, content_version_no, channel, mode)에서 INSERT 트리거로 계산한다
--     (클라이언트 값 불신). content_id는 uuid(36자)로 TS ID_PATTERN(^[A-Za-z0-9_-]{1,64}$)을 통과한다.
--     차이: TS makeIdempotencyKey는 아직 mode 'manual'을 거절한다 → 앱 계약 갱신 필요(§8, 이 작업 범위 밖).
--   * distribution_jobs_idempotency_open_unique: unique(idempotency_key) WHERE status <> 'cancelled'
--     = checkDuplicate "같은 키 + cancelled 아님이면 중복". 차이: 신규 종료 상태 abandoned도 키를 점유한다
--     (외부에 남았을 수 있으므로 같은 버전 수동 작업 재생성을 막음; 재게시는 새 버전으로).
--   * distribution_jobs_open_per_channel_unique: unique(content_id, channel)
--       WHERE mode IN ('live','manual') AND status IN (scheduled, dispatching, unknown, failed,
--                                                       manual_ready, awaiting_evidence)
--     = checkDuplicate의 열린 live 작업 집합 {scheduled, dispatching, unknown, failed} + manual 열린 상태.
--   * checkDuplicate의 "이미 published면 allowRepublish 필요"는 제약이 아니라 create 함수의 p_allow_republish
--     사전 검사로 둔다(정상 재게시를 제약으로 막을 수 없으므로).
--   * dry_run은 열린 작업 제약 대상이 아니다(TS와 같음: 모의 실행이 실제 게시 판정을 막지 않음).
--
-- 시도·컨테이너 (불변조건 4)
--   * attempt는 별도 행(job_id, attempt_no). claim이 scheduled→dispatching 때마다 새 attempt를 만든다.
--   * provider_container_id는 attempt당 1회만 기록(null→값). 기록 시 트리거가 container_recorded_xact_id =
--     pg_current_xact_id()를 고정하고, publish_requested_at 기록은 컨테이너가 다른(이전) 트랜잭션에서
--     기록된 경우에만 허용 → "컨테이너 ID 커밋 후 publish 요청" 순서를 DB가 강제한다.
--   * unique(channel, provider_container_id): 같은 컨테이너를 다른 시도/작업에서 재사용 불가(G-T3 전 보수안).
--   * 공급자 API idempotency key 지원을 가정하지 않는다(해당 열 없음). 중복 방지는 사이트 멱등키 +
--     write-ahead phase + unknown 대사로만 한다.
--   보강 (AUTOPOST-M2-REVIEW-FIX-001 — 함수 검사 + 테이블 check/트리거 가드 이중 강제, service_role 호출만 믿지 않음)
--   * 4a 컨테이너 준비: live는 저장된 컨테이너 상태가 단계를 따른다 — processing=IN_PROGRESS,
--     ready·publish_requested·confirming·done=FINISHED(조회 시각 필수), 생성 전/직후·dry_run=null.
--     job phase 진입 시 가드가 현재 attempt의 phase_reached·컨테이너 ID·상태를 대조하므로 FINISHED 확인 없이
--     ready/publish_requested로 갈 수 없다. ERROR/EXPIRED는 시도 failed → 새 attempt, PUBLISHED는 대사로만.
--   * 4b 성공 종료 단계: phase=done ⇔ live published 또는 dry_run_succeeded. 워커 결과·대사 found_published·
--     늦은 증거 수락 모든 live published 진입이 done으로 끝난다. manual published는 none.
--   * 4c publish 요청 선행: attempt outcome published/unknown과 job dispatching→published/unknown(live)은
--     publish_requested_at 기록 이후에만. live unknown job은 publish_requested/confirming 단계에만 존재.
--     live accepted 증거는 publish 요청이 기록된 attempt에 귀속돼야 한다. publish 요청 전 불확실성은 failed.
--
-- unknown · confirmed_absent · 재실행 (불변조건 6, D2)
--   * unknown에서는 자동 전이·자동 재시도 없음. 허용 전이는 unknown→published(증거 + 대사/늦은 증거 수락),
--     unknown→failed(admin confirmed_absent 대사 행 필수), unknown→unknown(대사 기록)뿐. unknown→scheduled 불가.
--   * confirmed_absent는 admin decided_by + method + checked_scope{account, period} + observed_at + observation
--     필수(check 제약). 워커는 still_unknown/absence_candidate(+ 목록 매칭 found_published)만 기록 가능.
--   * confirmed_absent 결과 job은 failed(retry_policy='operator_only', autoRetry=false). 자동 requeue 불가.
--     재실행은 distribution_approve_rerun(admin)만 — 이벤트 reason 'operator_rerun_approved' + 해당 대사 ID가
--     가드에서 확인되고, 이후 claim이 새 attempt(=새 컨테이너)를 만든다.
--   * 워커 자동 재시도(retry_policy='auto', last_error.autoRetry=true)는 publish 요청 전 실패에만 허용.
--
-- live 게이트 (불변조건 2)
--   * public.distribution_live_gate()는 현재 항상 false → live 작업 생성·claim 모두 거부(fail closed).
--     M3(연결·capability)·M4(미디어 권리)·runtime_controls·validation 계약이 생기면 그 migration에서
--     CREATE OR REPLACE로 실제 검사를 넣는다(TODO 목록은 함수 주석).
--   * 지금 DB가 확인하는 생성 근거(모든 모드): 리비전이 초안의 현재 리비전, 리비전의 원문 버전이 원문의
--     현재 버전(stale 아님), 원문·초안 미보관, 리비전과 원문 버전 각각의 "유효 승인"(최신 승인/반려 결정이
--     approved이고 철회되지 않음)이 존재하며 subject_hash가 저장 해시와 일치. 같은 검사를 claim·rerun 때 재실행.
--   * DB가 확인하지 않는 것(서버 필수): 해시가 내용의 진짜 sha256인지(M1 (e)(f)), validation 결과 판정,
--     수동 증거 URL 허용 호스트의 최종 목록(D7 — 현재 helper 기본값), 자기 승인 제한.
--
-- FK 삭제 정책: 모든 FK on delete restrict(M1·기존 감사 보존 계약과 동일). jobs/attempts/evidence/
--   reconciliations/events는 DELETE/TRUNCATE 거부 트리거(service_role 포함). 사용자 삭제(D9)는 별도 migration.
--
-- 미결정(이 파일이 정하지 않음): D3 스케줄러, D7 허용 호스트 최종안, D9 삭제, D10 dry_run 정리/집계 분모,
--   D12 지연 SLA. job id는 D6 권고대로 uuid.
-- ============================================================================


-- ============================================================================
-- 1. 테이블
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1.1 게시 작업 (가변 머리)
-- ----------------------------------------------------------------------------
create table public.distribution_jobs (
  id uuid primary key default gen_random_uuid(),
  -- INSERT 트리거가 계산(클라이언트 값 무시). makeIdempotencyKey와 같은 형식.
  idempotency_key text not null check (
    idempotency_key ~ '^pub:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:v[1-9][0-9]*:(blog|threads|instagram):(live|dry_run|manual)$'
  ),
  -- 스냅샷(생성 후 불변): 원문·버전·초안·리비전·승인·채널·모드·대상 계정
  content_id uuid not null references public.distribution_contents (id) on delete restrict,
  content_version_id uuid not null,
  content_version_no integer not null check (content_version_no >= 1),   -- INSERT 트리거가 버전 행에서 복사
  draft_id uuid not null,
  draft_revision_id uuid not null,
  approval_id uuid not null references public.distribution_approvals (id) on delete restrict,          -- 리비전 승인
  content_approval_id uuid not null references public.distribution_approvals (id) on delete restrict,  -- 원문 버전 승인
  channel text not null check (channel in ('blog', 'threads', 'instagram')),                            -- 트리거가 초안에서 복사
  mode text not null check (mode in ('live', 'dry_run', 'manual')),
  target_connection_id uuid,                        -- 리비전 스냅샷 복사. M3(channel_connections) 전까지 FK 없음
  target_external_account_id text
    check (target_external_account_id is null or char_length(target_external_account_id) between 1 and 200),
  -- 상태(§4.1) · 단계(§4.2) · 보조 표시(§4.5)
  status text not null check (status in (
    'scheduled', 'dispatching', 'published', 'dry_run_succeeded', 'failed', 'unknown', 'cancelled',
    'manual_ready', 'awaiting_evidence', 'abandoned'
  )),
  phase text not null default 'none' check (phase in (
    'none', 'container_requested', 'container_created', 'processing', 'ready', 'publish_requested', 'confirming', 'done'
  )),
  hold_reason text check (hold_reason is null or hold_reason in (
    'stale', 'approval_revoked', 'reauth_required', 'paused', 'rights_blocked', 'capability_unverified',
    'awaiting_operator', 'live_gate_closed'
  )),
  scheduled_at timestamptz,                         -- UTC. null = 즉시
  schedule_tz text check (schedule_tz is null or char_length(schedule_tz) between 1 and 64),  -- 표시용 IANA
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  retry_policy text check (retry_policy is null or retry_policy in ('auto', 'operator_only', 'never')),
  lease_owner text check (lease_owner is null or lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  cancel_requested_at timestamptz,
  -- 게시 결과 캐시(정본은 accepted evidence 행)
  accepted_evidence_id uuid,
  external_id text check (external_id is null or external_id ~ '^[^[:space:][:cntrl:]]{1,200}$'),
  external_url text check (
    external_url is null
    or (char_length(external_url) <= 2048 and external_url ~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$')
  ),
  has_issues boolean not null default false,        -- published_with_issues = published + has_issues
  issues jsonb not null default '[]'::jsonb,        -- 경고 코드 문자열 배열(성공 사실과 분리 보존)
  last_error jsonb,                                 -- {code, message?, retryable, autoRetry}
  reconciliation_required boolean not null default false,
  last_reconciliation_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  version integer not null default 1 check (version >= 1),   -- 갱신마다 가드가 +1, 이벤트 seq와 동일
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- M1 복합 키로 소속 일치 보장
  constraint distribution_jobs_draft_fk
    foreign key (draft_id, content_id)
    references public.distribution_channel_drafts (id, content_id) on delete restrict,
  constraint distribution_jobs_revision_fk
    foreign key (draft_id, draft_revision_id)
    references public.distribution_draft_revisions (draft_id, id) on delete restrict,
  constraint distribution_jobs_version_fk
    foreign key (content_id, content_version_id)
    references public.distribution_content_versions (content_id, id) on delete restrict,

  -- 채널·모드 (불변조건 1: blog는 MVP에서 manual/dry_run만, manual은 blog만)
  constraint distribution_jobs_blog_modes check (channel <> 'blog' or mode in ('manual', 'dry_run')),
  constraint distribution_jobs_manual_blog check (mode <> 'manual' or channel = 'blog'),
  constraint distribution_jobs_mode_status check (
    (mode = 'live' and status in ('scheduled', 'dispatching', 'published', 'failed', 'unknown', 'cancelled'))
    or (mode = 'dry_run' and status in ('scheduled', 'dispatching', 'dry_run_succeeded', 'failed', 'cancelled'))
    or (mode = 'manual' and status in ('manual_ready', 'awaiting_evidence', 'published', 'failed', 'unknown',
                                       'cancelled', 'abandoned'))
  ),
  constraint distribution_jobs_manual_shape check (
    mode <> 'manual' or (phase = 'none' and attempts = 0 and scheduled_at is null)
  ),
  constraint distribution_jobs_attempts_range check (attempts >= 0 and attempts <= max_attempts),
  constraint distribution_jobs_idle_phase check (
    status not in ('scheduled', 'manual_ready', 'awaiting_evidence') or phase = 'none'
  ),
  constraint distribution_jobs_lease_pair check ((lease_owner is null) = (lease_expires_at is null)),
  constraint distribution_jobs_lease_status check ((status = 'dispatching') = (lease_owner is not null)),
  constraint distribution_jobs_hold_status check (hold_reason is null or status = 'scheduled'),
  constraint distribution_jobs_retry_policy_status check ((status = 'failed') = (retry_policy is not null)),
  constraint distribution_jobs_error_required check (status not in ('failed', 'unknown') or last_error is not null),
  -- NULL 결과가 check를 통과하지 않도록 coalesce(…, false)로 감싼다.
  constraint distribution_jobs_last_error_shape check (
    last_error is null or coalesce(
      jsonb_typeof(last_error) = 'object'
      and jsonb_typeof(last_error -> 'code') = 'string'
      and (last_error ->> 'code') ~ '^[A-Z][A-Z0-9_]{0,63}$'
      and jsonb_typeof(last_error -> 'retryable') = 'boolean'
      and jsonb_typeof(last_error -> 'autoRetry') = 'boolean'
      and (not (last_error ? 'message')
           or (jsonb_typeof(last_error -> 'message') = 'string' and char_length(last_error ->> 'message') <= 500))
      and (last_error - array['code', 'message', 'retryable', 'autoRetry']) = '{}'::jsonb,
      false)
  ),
  -- D2: 자동 재시도(auto)와 운영자 재실행(operator_only)을 별도 정책으로 구분
  constraint distribution_jobs_retry_policy_error check (
    retry_policy is null or coalesce(
      (retry_policy = 'auto' and (last_error ->> 'retryable') = 'true' and (last_error ->> 'autoRetry') = 'true')
      or (retry_policy = 'operator_only' and (last_error ->> 'retryable') = 'true' and (last_error ->> 'autoRetry') = 'false')
      or (retry_policy = 'never' and (last_error ->> 'autoRetry') = 'false'),
      false)
  ),
  -- 불변조건 5: published ⇔ accepted evidence 포인터, 외부 식별자/URL 필수, live는 외부 ID 필수
  constraint distribution_jobs_published_evidence check ((status = 'published') = (accepted_evidence_id is not null)),
  constraint distribution_jobs_published_identifier check (
    status <> 'published' or external_id is not null or external_url is not null
  ),
  constraint distribution_jobs_live_published_id check (status <> 'published' or mode <> 'live' or external_id is not null),
  constraint distribution_jobs_external_only_published check (
    status = 'published' or (external_id is null and external_url is null)
  ),
  constraint distribution_jobs_issues_shape check (
    case when jsonb_typeof(issues) = 'array'
         then has_issues = (jsonb_array_length(issues) > 0) and jsonb_array_length(issues) <= 50
         else false end
  ),
  constraint distribution_jobs_issues_published check (not has_issues or status = 'published'),
  constraint distribution_jobs_dry_run_no_reconcile check (mode <> 'dry_run' or not reconciliation_required),
  -- 불변조건 4b(REVIEW-FIX-001): phase=done ⇔ 성공 종료(live published · dry_run_succeeded).
  --   live published는 어떤 경로(워커 결과·대사·늦은 증거 수락)로 들어와도 done, manual published는 none(manual_shape).
  constraint distribution_jobs_done_phase check (
    (phase = 'done') = ((status = 'published' and mode = 'live') or status = 'dry_run_succeeded')
  ),
  -- 불변조건 4c: live unknown은 publish 요청 기록 이후 단계에서만 생긴다(요청 전 불확실성은 failed로 분류).
  constraint distribution_jobs_live_unknown_phase check (
    status <> 'unknown' or mode <> 'live' or phase in ('publish_requested', 'confirming')
  )
);

-- 중복 방지 (불변조건 3)
create unique index distribution_jobs_idempotency_open_unique
  on public.distribution_jobs (idempotency_key)
  where status <> 'cancelled';
create unique index distribution_jobs_open_per_channel_unique
  on public.distribution_jobs (content_id, channel)
  where mode in ('live', 'manual')
    and status in ('scheduled', 'dispatching', 'unknown', 'failed', 'manual_ready', 'awaiting_evidence');
-- 운영 조회
create index distribution_jobs_due_idx
  on public.distribution_jobs ((coalesce(scheduled_at, created_at)))
  where status = 'scheduled' and hold_reason is null and not reconciliation_required;
create index distribution_jobs_lease_idx
  on public.distribution_jobs (lease_expires_at)
  where status = 'dispatching';
create index distribution_jobs_reconcile_queue_idx
  on public.distribution_jobs (updated_at)
  where status = 'unknown' or reconciliation_required;
create index distribution_jobs_content_channel_idx
  on public.distribution_jobs (content_id, channel, created_at desc);
create index distribution_jobs_revision_idx on public.distribution_jobs (draft_revision_id);

create trigger distribution_jobs_updated_at before update on public.distribution_jobs
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 1.2 시도 (원격 단계 기록)
-- ----------------------------------------------------------------------------
create table public.distribution_job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.distribution_jobs (id) on delete restrict,
  attempt_no integer not null check (attempt_no between 1 and 10),
  mode text not null check (mode in ('live', 'dry_run')),                  -- 트리거가 job에서 복사
  channel text not null check (channel in ('blog', 'threads', 'instagram')),-- 트리거가 job에서 복사
  worker_ref text not null check (worker_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),  -- claim한 워커
  phase_reached text not null default 'none' check (phase_reached in (
    'none', 'container_requested', 'container_created', 'processing', 'ready', 'publish_requested', 'confirming', 'done'
  )),
  provider_container_id text check (provider_container_id is null or provider_container_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  container_recorded_at timestamptz,
  -- 내부 전용: 컨테이너 ID를 기록한 최상위 트랜잭션 ID(트리거 고정). authenticated에 GRANT하지 않는다.
  container_recorded_xact_id xid8,
  container_status text check (container_status is null or container_status in (
    'IN_PROGRESS', 'FINISHED', 'PUBLISHED', 'ERROR', 'EXPIRED'
  )),
  container_checked_at timestamptz,
  publish_requested_at timestamptz,
  publish_response_at timestamptz,
  outcome text not null default 'pending' check (outcome in (
    'pending', 'published', 'dry_run_ok', 'failed', 'unknown', 'cancelled'
  )),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint distribution_job_attempts_no_unique unique (job_id, attempt_no),
  constraint distribution_job_attempts_container_pair check (
    (provider_container_id is null) = (container_recorded_at is null)
    and (provider_container_id is null) = (container_recorded_xact_id is null)
  ),
  constraint distribution_job_attempts_dry_run_no_container check (mode = 'live' or provider_container_id is null),
  constraint distribution_job_attempts_publish_after_container check (
    publish_requested_at is null or mode = 'dry_run' or provider_container_id is not null
  ),
  constraint distribution_job_attempts_response_after_request check (
    publish_response_at is null or publish_requested_at is not null
  ),
  constraint distribution_job_attempts_finished_pair check ((outcome = 'pending') = (finished_at is null)),
  constraint distribution_job_attempts_outcome_mode check (
    (outcome not in ('published', 'unknown') or mode = 'live')
    and (outcome <> 'dry_run_ok' or mode = 'dry_run')
  ),
  constraint distribution_job_attempts_cancel_before_publish check (
    outcome <> 'cancelled' or publish_requested_at is null
  ),
  -- 불변조건 4c(REVIEW-FIX-001): 게시 결과(published · 충돌 unknown)와 unknown은 publish 요청 기록 이후에만.
  constraint distribution_job_attempts_result_after_publish_request check (
    outcome not in ('published', 'unknown') or publish_requested_at is not null
  ),
  -- live: publish 요청 기록 ⇔ publish_requested 이후 단계
  constraint distribution_job_attempts_live_publish_phase check (
    mode <> 'live' or (publish_requested_at is not null) = (phase_reached in ('publish_requested', 'confirming', 'done'))
  ),
  -- live: container_created 이후 단계는 컨테이너 ID 필수
  constraint distribution_job_attempts_live_container_phase check (
    mode <> 'live' or phase_reached in ('none', 'container_requested') or provider_container_id is not null
  ),
  -- 불변조건 4a: 저장 가능한 컨테이너 상태는 단계가 정한다(조회 시각 쌍 필수).
  --   dry_run·컨테이너 생성 전/직후 = null, processing = IN_PROGRESS, ready 이후(publish_requested·confirming·done)
  --   = FINISHED. 단계가 전진만 하므로 FINISHED→IN_PROGRESS 같은 역순 상태도 저장되지 않는다.
  --   ERROR/EXPIRED/PUBLISHED는 열 도메인에는 남지만 저장 경로가 없다(ERROR/EXPIRED → 시도 failed 후 새 attempt,
  --   PUBLISHED → 대사 기록).
  constraint distribution_job_attempts_container_status_phase check (
    (container_status is null) = (container_checked_at is null)
    and case
      when mode <> 'live' or phase_reached in ('none', 'container_requested', 'container_created')
        then container_status is null
      when phase_reached = 'processing' then coalesce(container_status = 'IN_PROGRESS', false)
      else coalesce(container_status = 'FINISHED', false)
    end
  )
);
-- 불변조건 4: 같은 컨테이너 ID를 다른 시도/작업에서 재사용 금지
create unique index distribution_job_attempts_container_unique
  on public.distribution_job_attempts (channel, provider_container_id)
  where provider_container_id is not null;

-- ----------------------------------------------------------------------------
-- 1.3 게시 증거 (불변 + 상태 열 제한 전이)
-- ----------------------------------------------------------------------------
create table public.distribution_publication_evidence (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.distribution_jobs (id) on delete restrict,
  channel text not null check (channel in ('blog', 'threads', 'instagram')),   -- 트리거가 job에서 복사
  attempt_no integer,
  source text not null check (source in ('provider_response', 'provider_lookup', 'operator_manual', 'late_arrival')),
  status text not null check (status in ('accepted', 'conflict', 'pending_review', 'superseded', 'rejected')),
  external_post_id text check (external_post_id is null or external_post_id ~ '^[^[:space:][:cntrl:]]{1,200}$'),
  external_url text check (
    external_url is null
    or (char_length(external_url) <= 2048 and external_url ~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$')
  ),
  url_host text,                                    -- 트리거가 external_url에서 소문자로 파생
  external_account_id text
    check (external_account_id is null or external_account_id ~ '^[^[:space:][:cntrl:]]{1,200}$'),
  observed_at timestamptz not null,
  recorded_by uuid references auth.users (id) on delete restrict,   -- admin 기록(수동·정정)
  method_note text check (method_note is null or char_length(method_note) <= 1000),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  supersedes_id uuid,
  correction_reason text check (correction_reason is null or char_length(correction_reason) between 1 and 1000),
  status_changed_at timestamptz,
  status_changed_by uuid references auth.users (id) on delete restrict,
  status_reason text check (status_reason is null or char_length(status_reason) <= 1000),
  created_at timestamptz not null default now(),
  constraint distribution_publication_evidence_id_job_unique unique (id, job_id),
  constraint distribution_publication_evidence_attempt_fk
    foreign key (job_id, attempt_no)
    references public.distribution_job_attempts (job_id, attempt_no) on delete restrict,
  constraint distribution_publication_evidence_supersedes_fk
    foreign key (supersedes_id, job_id)
    references public.distribution_publication_evidence (id, job_id) on delete restrict,
  constraint distribution_publication_evidence_identifier check (external_post_id is not null or external_url is not null),
  constraint distribution_publication_evidence_url_host_pair check ((external_url is null) = (url_host is null)),
  constraint distribution_publication_evidence_manual_actor check (source <> 'operator_manual' or recorded_by is not null),
  -- 수동 증거가 외부 ID만 있으면 확인 위치·방법 메모 필수(§4.4 T17)
  constraint distribution_publication_evidence_manual_id_note check (
    source <> 'operator_manual' or external_url is not null
    or (method_note is not null and char_length(btrim(method_note)) >= 1)
  ),
  constraint distribution_publication_evidence_correction_pair check ((supersedes_id is null) = (correction_reason is null))
);
create unique index distribution_publication_evidence_accepted_per_job
  on public.distribution_publication_evidence (job_id)
  where status = 'accepted';
-- 다른 작업이 같은 외부 게시물을 주장하면 accepted 불가(conflict 행으로 보존)
create unique index distribution_publication_evidence_accepted_post_unique
  on public.distribution_publication_evidence (channel, coalesce(external_account_id, ''), external_post_id)
  where status = 'accepted' and external_post_id is not null;
create unique index distribution_publication_evidence_accepted_url_unique
  on public.distribution_publication_evidence (channel, external_url)
  where status = 'accepted' and external_url is not null;
create unique index distribution_publication_evidence_supersedes_once
  on public.distribution_publication_evidence (supersedes_id)
  where supersedes_id is not null;
create index distribution_publication_evidence_job_idx
  on public.distribution_publication_evidence (job_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 1.4 대사 기록 (불변)
-- ----------------------------------------------------------------------------
create table public.distribution_reconciliations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.distribution_jobs (id) on delete restrict,
  attempt_no integer,
  actor_kind text not null check (actor_kind in ('admin', 'worker')),
  decided_by uuid references auth.users (id) on delete restrict,
  method text not null check (method in ('provider_container_status', 'provider_recent_posts', 'operator_manual')),
  finding text not null check (finding in ('found_published', 'confirmed_absent', 'still_unknown', 'absence_candidate')),
  checked_scope jsonb not null default '{}'::jsonb check (jsonb_typeof(checked_scope) = 'object'),
  observed_at timestamptz not null,
  observation text check (observation is null or char_length(observation) <= 1000),
  evidence_id uuid,
  next_check_at timestamptz,
  next_check_owner text check (next_check_owner is null or next_check_owner in ('admin', 'worker')),
  created_at timestamptz not null default now(),
  constraint distribution_reconciliations_id_job_unique unique (id, job_id),
  constraint distribution_reconciliations_attempt_fk
    foreign key (job_id, attempt_no)
    references public.distribution_job_attempts (job_id, attempt_no) on delete restrict,
  constraint distribution_reconciliations_evidence_fk
    foreign key (evidence_id, job_id)
    references public.distribution_publication_evidence (id, job_id) on delete restrict,
  constraint distribution_reconciliations_actor_pair check ((actor_kind = 'admin') = (decided_by is not null)),
  -- 워커: 부재 확정·수동 방법 불가. 목록 매칭(provider_recent_posts)으로만 found_published.
  -- 컨테이너 상태만으로 게시 확정 금지(G-T3).
  constraint distribution_reconciliations_worker_limits check (
    actor_kind = 'admin'
    or (finding in ('still_unknown', 'absence_candidate', 'found_published')
        and method <> 'operator_manual'
        and (finding <> 'found_published' or method = 'provider_recent_posts'))
  ),
  constraint distribution_reconciliations_found_evidence check ((finding = 'found_published') = (evidence_id is not null)),
  -- 불변조건 6: confirmed_absent = admin 확인자 + 방법 + 범위(account, period) + 관찰 시각 + 근거 텍스트
  constraint distribution_reconciliations_absent_basis check (
    finding <> 'confirmed_absent' or coalesce(
      actor_kind = 'admin'
      and decided_by is not null
      and checked_scope ?& array['account', 'period']
      and observation is not null
      and char_length(btrim(observation)) >= 1,
      false)
  )
);
create index distribution_reconciliations_job_idx
  on public.distribution_reconciliations (job_id, created_at desc);

-- jobs → evidence / reconciliation 포인터(같은 job 소속 보장, 순환 FK라 테이블 생성 후 추가)
alter table public.distribution_jobs
  add constraint distribution_jobs_accepted_evidence_fk
  foreign key (accepted_evidence_id, id)
  references public.distribution_publication_evidence (id, job_id) on delete restrict;
alter table public.distribution_jobs
  add constraint distribution_jobs_last_reconciliation_fk
  foreign key (last_reconciliation_id, id)
  references public.distribution_reconciliations (id, job_id) on delete restrict;

-- ----------------------------------------------------------------------------
-- 1.5 작업 이벤트 (불변, 트리거만 기록)
--     summary에는 토큰·OAuth 응답·서명 URL·원격 응답 원문을 넣지 않는다(서버 책임, 길이 500 제한).
-- ----------------------------------------------------------------------------
create table public.distribution_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.distribution_jobs (id) on delete restrict,
  seq integer not null check (seq >= 1),            -- = jobs.version
  from_status text,
  to_status text not null,
  from_phase text,
  to_phase text not null,
  from_hold text,
  to_hold text,
  actor_kind text not null check (actor_kind in ('admin', 'worker', 'scheduler', 'system')),
  actor_id uuid references auth.users (id) on delete restrict,
  worker_ref text check (worker_ref is null or worker_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  attempt_no integer,
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  summary text check (summary is null or char_length(summary) <= 500),
  reconciliation_id uuid references public.distribution_reconciliations (id) on delete restrict,
  evidence_id uuid references public.distribution_publication_evidence (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint distribution_job_events_seq_unique unique (job_id, seq),
  constraint distribution_job_events_actor_pair check ((actor_kind = 'admin') = (actor_id is not null))
);
create index distribution_job_events_job_idx on public.distribution_job_events (job_id, created_at);


-- ============================================================================
-- 2. 내부 helper (EXECUTE: owner만. DEFINER API 함수·트리거 안에서만 호출)
-- ============================================================================

-- D1 조건의 actor 인자형 판정. service_role 호출에서 auth.uid()가 없으므로 private.is_distribution_admin()을
-- 대신한다(그 함수는 변경하지 않음).
create or replace function public.distribution_assert_admin_actor(p_actor_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_actor_id is null or not exists (
    select 1
    from public.role_assignments ra
    join public.profiles p on p.id = ra.user_id
    where ra.user_id = p_actor_id
      and ra.role = 'admin'
      and p.approval_status = 'approved'
  ) then
    raise exception 'actor is not an approved distribution admin' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function public.distribution_assert_worker_ref(p_worker_id text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' then
    raise exception 'invalid worker id' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create or replace function public.distribution_assert_issues(p_issues jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_issues is null or jsonb_typeof(p_issues) <> 'array' then
    raise exception 'issues must be a json array' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_issues) > 50 then
    raise exception 'too many issues' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_issues) as e(v)
    where jsonb_typeof(e.v) <> 'string' or char_length(e.v #>> '{}') not between 1 and 100
  ) then
    raise exception 'issues must be non-empty strings (<= 100 chars)' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- 트랜잭션 로컬 이벤트 컨텍스트. jobs 가드/이벤트 트리거가 읽고, 이벤트 트리거가 지운다.
create or replace function public.distribution_set_event_context(
  p_actor_kind text,
  p_actor_id uuid,
  p_reason text,
  p_summary text default null,
  p_worker_ref text default null,
  p_reconciliation_id uuid default null,
  p_evidence_id uuid default null
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_actor_kind is null or p_actor_kind not in ('admin', 'worker', 'scheduler', 'system') then
    raise exception 'invalid actor kind' using errcode = 'invalid_parameter_value';
  end if;
  if p_reason is null or p_reason !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'invalid reason code' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_catalog.set_config('distribution.ctx_actor_kind', p_actor_kind, true);
  perform pg_catalog.set_config('distribution.ctx_actor_id', coalesce(p_actor_id::text, ''), true);
  perform pg_catalog.set_config('distribution.ctx_reason', p_reason, true);
  perform pg_catalog.set_config('distribution.ctx_summary', coalesce(left(p_summary, 500), ''), true);
  perform pg_catalog.set_config('distribution.ctx_worker', coalesce(p_worker_ref, ''), true);
  perform pg_catalog.set_config('distribution.ctx_reconciliation_id', coalesce(p_reconciliation_id::text, ''), true);
  perform pg_catalog.set_config('distribution.ctx_evidence_id', coalesce(p_evidence_id::text, ''), true);
end;
$$;

create or replace function public.distribution_clear_event_context()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('distribution.ctx_actor_kind', '', true);
  perform pg_catalog.set_config('distribution.ctx_actor_id', '', true);
  perform pg_catalog.set_config('distribution.ctx_reason', '', true);
  perform pg_catalog.set_config('distribution.ctx_summary', '', true);
  perform pg_catalog.set_config('distribution.ctx_worker', '', true);
  perform pg_catalog.set_config('distribution.ctx_reconciliation_id', '', true);
  perform pg_catalog.set_config('distribution.ctx_evidence_id', '', true);
end;
$$;

-- 유효 승인: 대상의 최신 approved/rejected 결정(created_at desc, id desc)이 approved이고 철회되지 않았으면 그 ID.
-- 보수적 정의: 최신 결정이 반려이거나 최신 승인이 철회됐으면 null(이전 승인으로 되돌아가지 않음).
-- 한계: 같은 트랜잭션(created_at 동일) 안의 여러 결정은 id 순서로 임의 정렬된다 — 쓰기 함수가 한 번에 하나만 기록.
create or replace function public.distribution_effective_approval_id(p_subject_type text, p_subject_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
           when a.decision = 'approved'
                and not exists (select 1 from public.distribution_approvals r where r.revokes_approval_id = a.id)
           then a.id
         end
  from public.distribution_approvals a
  where a.decision in ('approved', 'rejected')
    and ((p_subject_type = 'content_version' and a.content_version_id = p_subject_id)
      or (p_subject_type = 'draft_revision' and a.draft_revision_id = p_subject_id))
  order by a.created_at desc, a.id desc
  limit 1;
$$;

-- 작업 근거 검사(생성·claim·재실행 공통). null = 통과, 아니면 문제 코드.
create or replace function public.distribution_job_basis_problem(
  p_draft_revision_id uuid,
  p_approval_id uuid,
  p_content_approval_id uuid
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rev record;
  v_draft record;
  v_content record;
  v_content_hash text;
  v_appr record;
begin
  select r.id, r.draft_id, r.content_id, r.content_version_id, r.revision_hash into v_rev
  from public.distribution_draft_revisions r where r.id = p_draft_revision_id;
  if not found then return 'revision_missing'; end if;

  select d.current_revision_id, d.archived_at into v_draft
  from public.distribution_channel_drafts d where d.id = v_rev.draft_id;
  select c.current_version_id, c.archived_at into v_content
  from public.distribution_contents c where c.id = v_rev.content_id;
  if v_draft.archived_at is not null or v_content.archived_at is not null then return 'archived'; end if;
  if v_draft.current_revision_id is distinct from v_rev.id
     or v_content.current_version_id is distinct from v_rev.content_version_id then
    return 'stale';
  end if;

  select v.content_hash into v_content_hash
  from public.distribution_content_versions v where v.id = v_rev.content_version_id;

  -- 리비전 승인
  select a.decision, a.subject_type, a.draft_revision_id, a.subject_hash into v_appr
  from public.distribution_approvals a where a.id = p_approval_id;
  if not found or v_appr.decision <> 'approved' or v_appr.subject_type <> 'draft_revision'
     or v_appr.draft_revision_id is distinct from v_rev.id or v_appr.subject_hash <> v_rev.revision_hash then
    return 'approval_mismatch';
  end if;
  if exists (select 1 from public.distribution_approvals r where r.revokes_approval_id = p_approval_id)
     or public.distribution_effective_approval_id('draft_revision', v_rev.id) is null then
    return 'approval_revoked';
  end if;

  -- 원문 버전 승인
  select a.decision, a.subject_type, a.content_version_id, a.subject_hash into v_appr
  from public.distribution_approvals a where a.id = p_content_approval_id;
  if not found or v_appr.decision <> 'approved' or v_appr.subject_type <> 'content_version'
     or v_appr.content_version_id is distinct from v_rev.content_version_id or v_appr.subject_hash <> v_content_hash then
    return 'approval_mismatch';
  end if;
  if exists (select 1 from public.distribution_approvals r where r.revokes_approval_id = p_content_approval_id)
     or public.distribution_effective_approval_id('content_version', v_rev.content_version_id) is null then
    return 'approval_revoked';
  end if;

  return null;
end;
$$;

-- live 게이트 (불변조건 2). 현재 항상 false → live 생성·claim·재실행 거부(fail closed).
-- TODO(M3/M4/운영 제어 migration에서 CREATE OR REPLACE로 교체; 모두 통과해야 true):
--   1) 연결: 리비전 target_connection_id의 connection이 connected, external_account_id가 리비전 스냅샷과 일치,
--      reauth/refresh 상태 아님(M3).
--   2) capability: 채널의 게시 capability가 supported(capability_verifications, unverified면 차단)(M3).
--   3) 미디어 권리: 리비전 미디어 원본 전부 rights approved, valid_until 미경과, allowed_channels 포함,
--      필요한 variant 존재(M4).
--   4) validation: 리비전 validation에 fix 항목 없음, unverified 규칙은 차단(validation 계약 확정 후).
--   5) runtime_controls: 전역/채널 live_paused=false.
--   6) 앱 코드 상수 DISTRIBUTION_LIVE_ENABLED(서버 측, DB 밖) — DB 게이트와 별개로 유지.
create or replace function public.distribution_live_gate(p_draft_revision_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select false;
$$;

-- 수동 증거 URL 허용 호스트 (D7 미결정 — 결과 문서 권고 기본값). 최종 결정 시 CREATE OR REPLACE로 교체.
create or replace function public.distribution_manual_evidence_host_allowed(p_channel text, p_host text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_channel = 'blog' and p_host in ('blog.naver.com', 'm.blog.naver.com'), false);
$$;

-- 다른 작업의 accepted 증거와 같은 외부 게시물(계정+ID 또는 URL)인지
create or replace function public.distribution_evidence_conflicts(
  p_job_id uuid,
  p_channel text,
  p_external_account_id text,
  p_external_post_id text,
  p_external_url text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.distribution_publication_evidence e
    where e.status = 'accepted'
      and e.job_id <> p_job_id
      and e.channel = p_channel
      and ((p_external_post_id is not null
            and e.external_post_id = p_external_post_id
            and coalesce(e.external_account_id, '') = coalesce(p_external_account_id, ''))
        or (p_external_url is not null and e.external_url = p_external_url))
  );
$$;

-- 증거 INSERT(값 정규화 후 저장 행 반환 — 호출자는 반환 행의 값으로 job 캐시를 채운다)
create or replace function public.distribution_insert_evidence(
  p_job_id uuid,
  p_attempt_no integer,
  p_source text,
  p_status text,
  p_external_post_id text,
  p_external_url text,
  p_external_account_id text,
  p_observed_at timestamptz,
  p_recorded_by uuid,
  p_method_note text,
  p_issues jsonb,
  p_supersedes_id uuid default null,
  p_correction_reason text default null
)
returns public.distribution_publication_evidence
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_row public.distribution_publication_evidence;
begin
  perform public.distribution_assert_issues(coalesce(p_issues, '[]'::jsonb));
  insert into public.distribution_publication_evidence (
    job_id, attempt_no, source, status, external_post_id, external_url, external_account_id,
    observed_at, recorded_by, method_note, issues, supersedes_id, correction_reason
  ) values (
    p_job_id, p_attempt_no, p_source, p_status,
    nullif(btrim(p_external_post_id), ''), nullif(btrim(p_external_url), ''), nullif(btrim(p_external_account_id), ''),
    coalesce(p_observed_at, now()), p_recorded_by, nullif(btrim(p_method_note), ''),
    coalesce(p_issues, '[]'::jsonb), p_supersedes_id, nullif(btrim(p_correction_reason), '')
  )
  returning * into v_row;
  return v_row;
end;
$$;

-- 작업 잠금 + 낙관적 version 비교(p_expected_version이 null이면 비교 생략 — 워커 경로)
create or replace function public.distribution_lock_job(p_job_id uuid, p_expected_version integer)
returns public.distribution_jobs
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
begin
  select * into v_job from public.distribution_jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'distribution job % not found', p_job_id using errcode = 'no_data_found';
  end if;
  if p_expected_version is not null and v_job.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: job % is at version % (expected %)', p_job_id, v_job.version, p_expected_version
      using errcode = 'P0001';
  end if;
  return v_job;
end;
$$;

-- 오류 JSON 정규화: {code, message?, retryable, autoRetry}만 남긴다.
create or replace function public.distribution_normalize_error(p_error jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_error is null or jsonb_typeof(p_error) <> 'object'
     or jsonb_typeof(p_error -> 'code') is distinct from 'string'
     or jsonb_typeof(p_error -> 'retryable') is distinct from 'boolean'
     or jsonb_typeof(p_error -> 'autoRetry') is distinct from 'boolean' then
    raise exception 'error must be {code:string, message?:string, retryable:boolean, autoRetry:boolean}'
      using errcode = 'invalid_parameter_value';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'code', p_error ->> 'code',
    'message', left(p_error ->> 'message', 500),
    'retryable', p_error -> 'retryable',
    'autoRetry', p_error -> 'autoRetry'
  ));
end;
$$;


-- ============================================================================
-- 3. 트리거 함수 (SECURITY INVOKER, search_path='', 클라이언트 EXECUTE 회수)
-- ============================================================================

-- 3.1 jobs INSERT: 스냅샷 고정·근거 검증·초기값 강제·멱등키 계산
create or replace function public.distribution_jobs_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := nullif(current_setting('distribution.ctx_actor_kind', true), '');
  v_actor uuid := nullif(current_setting('distribution.ctx_actor_id', true), '')::uuid;
  v_rev record;
  v_problem text;
begin
  if v_kind is distinct from 'admin' or v_actor is distinct from new.created_by then
    raise exception 'distribution jobs are created only by distribution_create_job (admin context)'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.distribution_assert_admin_actor(new.created_by);

  select r.draft_id, r.content_id, r.content_version_id, r.target_connection_id, r.target_external_account_id
    into v_rev
  from public.distribution_draft_revisions r where r.id = new.draft_revision_id;
  if not found then
    raise exception 'draft revision % not found', new.draft_revision_id using errcode = 'foreign_key_violation';
  end if;
  if v_rev.draft_id <> new.draft_id or v_rev.content_id <> new.content_id
     or v_rev.content_version_id <> new.content_version_id then
    raise exception 'job snapshot does not match the draft revision' using errcode = 'check_violation';
  end if;

  select d.channel into new.channel from public.distribution_channel_drafts d where d.id = new.draft_id;
  select v.version_no into new.content_version_no
  from public.distribution_content_versions v where v.id = new.content_version_id;
  new.target_connection_id := v_rev.target_connection_id;
  new.target_external_account_id := v_rev.target_external_account_id;

  v_problem := public.distribution_job_basis_problem(new.draft_revision_id, new.approval_id, new.content_approval_id);
  if v_problem is not null then
    raise exception 'job basis check failed: %', v_problem using errcode = 'check_violation';
  end if;
  if new.mode = 'live' and not public.distribution_live_gate(new.draft_revision_id) then
    raise exception 'LIVE_GATE_CLOSED: live jobs are not enabled (connections/rights/validation gates pending)'
      using errcode = 'feature_not_supported';
  end if;

  new.idempotency_key := format('pub:%s:v%s:%s:%s', new.content_id, new.content_version_no, new.channel, new.mode);
  new.status := case when new.mode = 'manual' then 'manual_ready' else 'scheduled' end;
  new.phase := 'none';
  new.hold_reason := null;
  new.attempts := 0;
  new.retry_policy := null;
  new.lease_owner := null;
  new.lease_expires_at := null;
  new.last_attempt_at := null;
  new.cancel_requested_at := null;
  new.accepted_evidence_id := null;
  new.external_id := null;
  new.external_url := null;
  new.has_issues := false;
  new.issues := '[]'::jsonb;
  new.last_error := null;
  new.reconciliation_required := false;
  new.last_reconciliation_id := null;
  new.version := 1;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

-- 3.2 jobs UPDATE 가드: 스냅샷 불변 · 허용 전이 목록 · actor 경계 · 단계 순서 · 증거 조건
create or replace function public.distribution_jobs_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := nullif(current_setting('distribution.ctx_actor_kind', true), '');
  v_actor uuid := nullif(current_setting('distribution.ctx_actor_id', true), '')::uuid;
  v_reason text := nullif(current_setting('distribution.ctx_reason', true), '');
  v_rec_id uuid := nullif(current_setting('distribution.ctx_reconciliation_id', true), '')::uuid;
  v_auto boolean;
  v_changed text[];
  v_pair text;
  v_att record;
  v_rec record;
  v_ev record;
begin
  if v_kind is null or v_reason is null then
    raise exception 'distribution_jobs may only change through distribution mutation functions'
      using errcode = 'insufficient_privilege';
  end if;
  if v_kind = 'admin' then
    perform public.distribution_assert_admin_actor(v_actor);
  end if;
  v_auto := v_kind in ('worker', 'scheduler', 'system');

  -- 스냅샷 열 불변 (불변조건 2)
  if row(new.id, new.idempotency_key, new.content_id, new.content_version_id, new.content_version_no,
         new.draft_id, new.draft_revision_id, new.approval_id, new.content_approval_id, new.channel, new.mode,
         new.target_connection_id, new.target_external_account_id, new.max_attempts, new.created_by, new.created_at)
     is distinct from
     row(old.id, old.idempotency_key, old.content_id, old.content_version_id, old.content_version_no,
         old.draft_id, old.draft_revision_id, old.approval_id, old.content_approval_id, old.channel, old.mode,
         old.target_connection_id, old.target_external_account_id, old.max_attempts, old.created_by, old.created_at) then
    raise exception 'distribution_jobs snapshot columns are immutable' using errcode = 'check_violation';
  end if;

  new.version := old.version + 1;

  select coalesce(array_agg(n.key order by n.key), '{}'::text[]) into v_changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o on o.key = n.key
  where n.value is distinct from o.value
    and n.key not in ('version', 'updated_at');

  -- 공통 필드 규칙 ------------------------------------------------------------
  if old.reconciliation_required and not new.reconciliation_required and v_kind <> 'admin' then
    raise exception 'only an admin may clear reconciliation_required' using errcode = 'insufficient_privilege';
  end if;
  if new.attempts <> old.attempts
     and not (old.status = 'scheduled' and new.status = 'dispatching' and new.attempts = old.attempts + 1) then
    raise exception 'attempts may only increase by one on claim' using errcode = 'check_violation';
  end if;
  if new.last_attempt_at is distinct from old.last_attempt_at
     and not (old.status = 'scheduled' and new.status = 'dispatching') then
    raise exception 'last_attempt_at changes only on claim' using errcode = 'check_violation';
  end if;
  if old.cancel_requested_at is not null and new.cancel_requested_at is distinct from old.cancel_requested_at then
    raise exception 'cancel_requested_at is set once' using errcode = 'check_violation';
  end if;
  if old.cancel_requested_at is null and new.cancel_requested_at is not null
     and not (old.status = 'dispatching' and new.status = 'dispatching' and v_kind = 'admin') then
    raise exception 'cancel may only be requested by an admin while dispatching' using errcode = 'check_violation';
  end if;
  if new.last_reconciliation_id is distinct from old.last_reconciliation_id and old.status <> 'unknown' then
    raise exception 'reconciliation pointer changes only while unknown' using errcode = 'check_violation';
  end if;
  if new.accepted_evidence_id is distinct from old.accepted_evidence_id
     and not (new.status = 'published'
              and (old.status <> 'published' or (v_kind = 'admin' and v_reason = 'evidence_corrected'))) then
    raise exception 'accepted evidence changes only on publish or admin correction' using errcode = 'check_violation';
  end if;
  if (new.has_issues, new.issues) is distinct from (old.has_issues, old.issues)
     and not (new.status = 'published' and old.status <> 'published') then
    raise exception 'issues are recorded only when entering published' using errcode = 'check_violation';
  end if;
  if (new.scheduled_at is distinct from old.scheduled_at or new.schedule_tz is distinct from old.schedule_tz)
     and not ((old.status = 'scheduled' and new.status = 'scheduled' and v_kind = 'admin')
              or (old.status = 'failed' and new.status = 'scheduled')) then
    raise exception 'schedule changes only by admin reschedule or requeue' using errcode = 'check_violation';
  end if;
  if new.hold_reason is distinct from old.hold_reason and new.status = 'scheduled' then
    if old.hold_reason in ('stale', 'approval_revoked') then
      raise exception 'hold % cannot be released; cancel and create a new job', old.hold_reason
        using errcode = 'check_violation';
    end if;
    if old.status = 'scheduled' and v_kind not in ('system', 'admin') then
      raise exception 'hold changes only by system or admin' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if (new.lease_owner, new.lease_expires_at) is distinct from (old.lease_owner, old.lease_expires_at)
     and old.status = 'dispatching' and new.status = 'dispatching' then
    if not v_auto then
      raise exception 'lease changes only by workers' using errcode = 'insufficient_privilege';
    end if;
    if new.lease_owner is distinct from old.lease_owner and old.lease_expires_at > now() then
      raise exception 'lease is held by another worker' using errcode = 'lock_not_available';
    end if;
  end if;

  -- 단계(phase) 규칙 ----------------------------------------------------------
  if new.phase is distinct from old.phase then
    if old.status = 'dispatching' and new.status = 'dispatching' then
      if not v_auto or (old.phase || '>' || new.phase) not in (
        'none>container_requested', 'container_requested>container_created', 'container_created>processing',
        'container_created>ready', 'processing>ready', 'ready>publish_requested', 'publish_requested>confirming'
      ) then
        raise exception 'phase transition % -> % not allowed', old.phase, new.phase using errcode = 'check_violation';
      end if;
    elsif old.status = 'dispatching' and new.status in ('published', 'dry_run_succeeded') and new.phase = 'done' then
      null;
    elsif old.status in ('unknown', 'failed') and new.status = 'published' and new.mode = 'live' and new.phase = 'done' then
      null;   -- 대사(found_published)·늦은 증거 수락으로 live 게시 확정 → done (manual은 none 유지)
    elsif old.status = 'failed' and new.status in ('scheduled', 'manual_ready') and new.phase = 'none' then
      null;
    else
      raise exception 'phase may not change on % -> %', old.status, new.status using errcode = 'check_violation';
    end if;
  end if;
  -- dispatching 중 단계 진입: 현재 attempt 기록이 같은 단계 + 컨테이너 상태 + publish 요청 기록과 일치해야 한다
  -- (불변조건 4a/4c). advance_phase는 attempt를 먼저 갱신한 뒤 job을 갱신한다.
  if new.status = 'dispatching' and new.phase is distinct from old.phase then
    select a.phase_reached, a.provider_container_id, a.container_status, a.container_checked_at, a.publish_requested_at
      into v_att
    from public.distribution_job_attempts a where a.job_id = new.id and a.attempt_no = new.attempts;
    if not found or v_att.phase_reached is distinct from new.phase then
      raise exception 'job phase % must match the current attempt phase', new.phase using errcode = 'check_violation';
    end if;
    if new.mode = 'live' then
      if new.phase in ('container_created', 'processing', 'ready', 'publish_requested', 'confirming')
         and v_att.provider_container_id is null then
        raise exception 'phase % requires the provider container id', new.phase using errcode = 'check_violation';
      end if;
      if new.phase = 'processing' and v_att.container_status is distinct from 'IN_PROGRESS' then
        raise exception 'processing requires stored container status IN_PROGRESS' using errcode = 'check_violation';
      end if;
      if new.phase in ('ready', 'publish_requested', 'confirming')
         and (v_att.container_status is distinct from 'FINISHED' or v_att.container_checked_at is null) then
        raise exception 'CONTAINER_NOT_READY: phase % requires stored container status FINISHED', new.phase
          using errcode = 'check_violation';
      end if;
    end if;
    if new.phase in ('publish_requested', 'confirming') and v_att.publish_requested_at is null then
      raise exception 'publish_requested phase requires the attempt publish request record (container committed first)'
        using errcode = 'check_violation';
    end if;
  end if;

  -- 같은 상태 안 변경: 허용 열만 ------------------------------------------------
  if new.status = old.status then
    if not (v_changed <@ case old.status
        when 'scheduled' then array['scheduled_at', 'schedule_tz', 'hold_reason', 'reconciliation_required']
        when 'dispatching' then array['phase', 'lease_owner', 'lease_expires_at', 'cancel_requested_at',
                                      'reconciliation_required']
        when 'unknown' then array['last_reconciliation_id', 'reconciliation_required']
        when 'published' then array['accepted_evidence_id', 'external_id', 'external_url', 'reconciliation_required']
        else array['reconciliation_required']
      end) then
      raise exception 'columns % may not change while %', v_changed, old.status using errcode = 'check_violation';
    end if;
    if old.status = 'published' and v_changed && array['accepted_evidence_id', 'external_id', 'external_url']
       and not (v_kind = 'admin' and v_reason = 'evidence_corrected') then
      raise exception 'published result changes only through admin evidence correction' using errcode = 'check_violation';
    end if;
  else
    -- 상태 전이 허용 목록 (§4.4) ----------------------------------------------
    v_pair := old.status || '>' || new.status;
    case
      when v_pair = 'scheduled>dispatching' then
        if not v_auto or old.hold_reason is not null or old.reconciliation_required then
          raise exception 'claim requires a worker and an unheld job' using errcode = 'check_violation';
        end if;

      when v_pair in ('scheduled>cancelled', 'failed>cancelled', 'manual_ready>cancelled',
                      'manual_ready>awaiting_evidence', 'manual_ready>abandoned',
                      'awaiting_evidence>abandoned', 'awaiting_evidence>unknown') then
        if v_kind <> 'admin' then
          raise exception '% requires an admin', v_pair using errcode = 'insufficient_privilege';
        end if;

      when v_pair = 'dispatching>cancelled' then
        select a.publish_requested_at into v_att
        from public.distribution_job_attempts a where a.job_id = new.id and a.attempt_no = new.attempts;
        if not v_auto or old.cancel_requested_at is null or v_att.publish_requested_at is not null then
          raise exception 'dispatching job may be cancelled only on request and before publish request'
            using errcode = 'check_violation';
        end if;

      when v_pair in ('dispatching>published', 'dispatching>dry_run_succeeded', 'dispatching>failed', 'dispatching>unknown') then
        if not v_auto then
          raise exception '% is recorded by workers', v_pair using errcode = 'insufficient_privilege';
        end if;
        -- 불변조건 4c: live 게시 결과/unknown은 현재 attempt의 publish 요청 기록 이후에만
        if new.mode = 'live' and v_pair in ('dispatching>published', 'dispatching>unknown') then
          select a.publish_requested_at into v_att
          from public.distribution_job_attempts a where a.job_id = new.id and a.attempt_no = new.attempts;
          if not found or v_att.publish_requested_at is null or old.phase not in ('publish_requested', 'confirming') then
            raise exception 'PUBLISH_NOT_REQUESTED: % requires a recorded publish request', v_pair
              using errcode = 'check_violation';
          end if;
        end if;
        if v_pair = 'dispatching>failed' and new.retry_policy = 'auto' then
          select a.publish_requested_at into v_att
          from public.distribution_job_attempts a where a.job_id = new.id and a.attempt_no = new.attempts;
          if v_att.publish_requested_at is not null then
            raise exception 'automatic retry is not allowed after a publish request' using errcode = 'check_violation';
          end if;
        end if;

      when v_pair in ('failed>scheduled', 'failed>manual_ready') then
        if old.reconciliation_required then
          raise exception 'reconciliation required before rerun' using errcode = 'check_violation';
        end if;
        if old.retry_policy = 'operator_only' then
          if v_kind <> 'admin' or v_reason <> 'operator_rerun_approved' then
            raise exception 'operator_only failure requires an admin rerun approval' using errcode = 'insufficient_privilege';
          end if;
          if old.last_error ->> 'code' = 'CONFIRMED_ABSENT' then
            select r.finding into v_rec
            from public.distribution_reconciliations r
            where r.id = v_rec_id and r.job_id = new.id;
            if v_rec_id is null or v_rec_id is distinct from old.last_reconciliation_id
               or not found or v_rec.finding <> 'confirmed_absent' then
              raise exception 'rerun after unknown requires the confirmed_absent reconciliation'
                using errcode = 'check_violation';
            end if;
          end if;
        elsif old.retry_policy = 'auto' then
          select a.publish_requested_at into v_att
          from public.distribution_job_attempts a where a.job_id = new.id and a.attempt_no = old.attempts;
          if v_pair <> 'failed>scheduled' or not v_auto
             or coalesce((old.last_error ->> 'autoRetry')::boolean, false) is not true
             or old.attempts >= old.max_attempts
             or v_att.publish_requested_at is not null then
            raise exception 'automatic retry not allowed for this failure' using errcode = 'check_violation';
          end if;
        else
          raise exception 'retry_policy % does not allow rerun', old.retry_policy using errcode = 'check_violation';
        end if;

      when v_pair = 'unknown>failed' then
        select r.finding, r.decided_by into v_rec
        from public.distribution_reconciliations r
        where r.id = v_rec_id and r.job_id = new.id;
        if v_kind <> 'admin' or new.retry_policy is distinct from 'operator_only' or new.reconciliation_required
           or v_rec_id is null or v_rec_id is distinct from new.last_reconciliation_id
           or not found or v_rec.finding <> 'confirmed_absent' or v_rec.decided_by is null then
          raise exception 'unknown -> failed requires an admin confirmed_absent reconciliation and operator_only policy'
            using errcode = 'check_violation';
        end if;

      when v_pair = 'unknown>published' then
        if v_reason = 'reconciled_found_published' then
          select r.finding, r.evidence_id into v_rec
          from public.distribution_reconciliations r
          where r.id = v_rec_id and r.job_id = new.id;
          if not found or v_rec.finding <> 'found_published' or v_rec.evidence_id is distinct from new.accepted_evidence_id
             or v_rec_id is distinct from new.last_reconciliation_id then
            raise exception 'unknown -> published requires a found_published reconciliation' using errcode = 'check_violation';
          end if;
        elsif not (v_kind = 'admin' and v_reason = 'late_evidence_accepted') then
          raise exception 'unknown -> published requires reconciliation or admin evidence acceptance'
            using errcode = 'check_violation';
        end if;

      when v_pair = 'failed>published' then
        if not (v_kind = 'admin' and v_reason = 'late_evidence_accepted') then
          raise exception 'failed -> published requires admin acceptance of late evidence' using errcode = 'check_violation';
        end if;

      when v_pair = 'awaiting_evidence>published' then
        if v_kind <> 'admin' then
          raise exception 'manual evidence is recorded by an admin' using errcode = 'insufficient_privilege';
        end if;

      else
        raise exception 'job status transition % -> % is not allowed', old.status, new.status
          using errcode = 'check_violation';
    end case;
  end if;

  -- 종료 상태: 늦은 증거 플래그 외 변경 금지
  if old.status in ('dry_run_succeeded', 'cancelled', 'abandoned')
     and not (new.status = old.status and v_changed <@ array['reconciliation_required']) then
    raise exception 'terminal job (%) may not change', old.status using errcode = 'check_violation';
  end if;

  -- published 진입/정정: accepted 증거와 캐시 일치 (불변조건 5)
  if new.status = 'published'
     and (old.status <> 'published' or new.accepted_evidence_id is distinct from old.accepted_evidence_id) then
    select e.status, e.external_post_id, e.external_url, e.attempt_no into v_ev
    from public.distribution_publication_evidence e
    where e.id = new.accepted_evidence_id and e.job_id = new.id;
    if not found or v_ev.status <> 'accepted'
       or v_ev.external_post_id is distinct from new.external_id
       or v_ev.external_url is distinct from new.external_url then
      raise exception 'published requires accepted evidence matching the external id/url' using errcode = 'check_violation';
    end if;
    -- 불변조건 4c: live 게시 증거는 publish 요청이 기록된 attempt에 귀속돼야 한다(모든 진입 경로·정정 공통)
    if new.mode = 'live' then
      select a.publish_requested_at into v_att
      from public.distribution_job_attempts a where a.job_id = new.id and a.attempt_no = v_ev.attempt_no;
      if v_ev.attempt_no is null or not found or v_att.publish_requested_at is null then
        raise exception 'PUBLISH_NOT_REQUESTED: live publication evidence must belong to an attempt with a recorded publish request'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- 3.3 jobs AFTER INSERT/UPDATE: 같은 트랜잭션에서 이벤트 1행 기록 후 컨텍스트 삭제
create or replace function public.distribution_jobs_record_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := nullif(current_setting('distribution.ctx_actor_kind', true), '');
  v_actor uuid := nullif(current_setting('distribution.ctx_actor_id', true), '')::uuid;
  v_reason text := nullif(current_setting('distribution.ctx_reason', true), '');
  v_summary text := nullif(current_setting('distribution.ctx_summary', true), '');
  v_worker text := nullif(current_setting('distribution.ctx_worker', true), '');
  v_rec uuid := nullif(current_setting('distribution.ctx_reconciliation_id', true), '')::uuid;
  v_ev uuid := nullif(current_setting('distribution.ctx_evidence_id', true), '')::uuid;
begin
  if v_kind is null or v_reason is null then
    raise exception 'missing distribution event context' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    insert into public.distribution_job_events (
      job_id, seq, from_status, to_status, from_phase, to_phase, from_hold, to_hold,
      actor_kind, actor_id, worker_ref, attempt_no, reason_code, summary, reconciliation_id, evidence_id
    ) values (
      new.id, new.version, null, new.status, null, new.phase, null, new.hold_reason,
      v_kind, case when v_kind = 'admin' then v_actor end, v_worker, nullif(new.attempts, 0),
      v_reason, v_summary, v_rec, v_ev
    );
  else
    insert into public.distribution_job_events (
      job_id, seq, from_status, to_status, from_phase, to_phase, from_hold, to_hold,
      actor_kind, actor_id, worker_ref, attempt_no, reason_code, summary, reconciliation_id, evidence_id
    ) values (
      new.id, new.version, old.status, new.status, old.phase, new.phase, old.hold_reason, new.hold_reason,
      v_kind, case when v_kind = 'admin' then v_actor end, v_worker, nullif(new.attempts, 0),
      v_reason, v_summary, v_rec, v_ev
    );
  end if;
  perform public.distribution_clear_event_context();
  return null;
end;
$$;

-- 3.4 커밋 시점 일관성(지연 제약 트리거): published ⇔ accepted 증거 1개 + 캐시 일치, superseded는 대체 행 필요
create or replace function public.distribution_assert_job_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_job record;
  v_ev record;
begin
  if tg_table_name = 'distribution_jobs' then
    v_job_id := new.id;
  else
    v_job_id := new.job_id;
  end if;

  select j.status, j.accepted_evidence_id, j.external_id, j.external_url into v_job
  from public.distribution_jobs j where j.id = v_job_id;

  if v_job.status = 'published' then
    select e.status, e.external_post_id, e.external_url into v_ev
    from public.distribution_publication_evidence e
    where e.id = v_job.accepted_evidence_id and e.job_id = v_job_id;
    if not found or v_ev.status <> 'accepted'
       or v_ev.external_post_id is distinct from v_job.external_id
       or v_ev.external_url is distinct from v_job.external_url then
      raise exception 'job % is published without matching accepted evidence', v_job_id using errcode = 'check_violation';
    end if;
  elsif exists (
    select 1 from public.distribution_publication_evidence e where e.job_id = v_job_id and e.status = 'accepted'
  ) then
    raise exception 'accepted evidence exists for non-published job %', v_job_id using errcode = 'check_violation';
  end if;

  if tg_table_name = 'distribution_publication_evidence' and new.status = 'superseded'
     and not exists (select 1 from public.distribution_publication_evidence s where s.supersedes_id = new.id) then
    raise exception 'superseded evidence % has no replacement', new.id using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

-- 3.5 attempts INSERT: claim 직후 현재 시도만, 초기값 강제
create or replace function public.distribution_job_attempts_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_job record;
begin
  select j.status, j.mode, j.channel, j.attempts, j.lease_owner into v_job
  from public.distribution_jobs j where j.id = new.job_id;
  if not found then
    raise exception 'distribution job % not found', new.job_id using errcode = 'foreign_key_violation';
  end if;
  if v_job.status <> 'dispatching' or v_job.mode not in ('live', 'dry_run') or new.attempt_no <> v_job.attempts then
    raise exception 'attempt must be the current attempt of a dispatching job' using errcode = 'check_violation';
  end if;
  new.mode := v_job.mode;
  new.channel := v_job.channel;
  new.worker_ref := v_job.lease_owner;
  new.phase_reached := 'none';
  new.provider_container_id := null;
  new.container_recorded_at := null;
  new.container_recorded_xact_id := null;
  new.container_status := null;
  new.container_checked_at := null;
  new.publish_requested_at := null;
  new.publish_response_at := null;
  new.outcome := 'pending';
  new.error_code := null;
  new.finished_at := null;
  new.created_at := now();
  return new;
end;
$$;

-- 3.6 attempts UPDATE: 컨테이너 1회 기록 + 선커밋 강제, 단계 전진만, 결과 확정 후 불변
create or replace function public.distribution_job_attempts_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rank_old integer;
  v_rank_new integer;
  v_order constant text[] := array['none', 'container_requested', 'container_created', 'processing', 'ready',
                                   'publish_requested', 'confirming', 'done'];
begin
  if row(new.id, new.job_id, new.attempt_no, new.mode, new.channel, new.worker_ref, new.created_at)
     is distinct from row(old.id, old.job_id, old.attempt_no, old.mode, old.channel, old.worker_ref, old.created_at) then
    raise exception 'attempt identity columns are immutable' using errcode = 'check_violation';
  end if;
  if old.outcome <> 'pending' then
    raise exception 'attempt % is finished and immutable', old.id using errcode = 'check_violation';
  end if;

  -- 컨테이너 ID: null → 값 1회. 기록 트랜잭션 고정.
  if old.provider_container_id is not null then
    if new.provider_container_id is distinct from old.provider_container_id then
      raise exception 'provider_container_id is recorded once' using errcode = 'check_violation';
    end if;
    new.container_recorded_at := old.container_recorded_at;
    new.container_recorded_xact_id := old.container_recorded_xact_id;
  elsif new.provider_container_id is not null then
    new.container_recorded_at := now();
    new.container_recorded_xact_id := pg_current_xact_id();
  else
    new.container_recorded_at := null;
    new.container_recorded_xact_id := null;
  end if;

  -- publish 요청 기록: 1회, live는 컨테이너가 이전 트랜잭션에서 커밋된 뒤에만 (불변조건 4)
  if old.publish_requested_at is not null then
    if new.publish_requested_at is distinct from old.publish_requested_at then
      raise exception 'publish_requested_at is recorded once' using errcode = 'check_violation';
    end if;
  elsif new.publish_requested_at is not null then
    if new.mode = 'live'
       and (old.provider_container_id is null or old.container_recorded_xact_id = pg_current_xact_id()) then
      raise exception 'publish request requires a container id committed in an earlier transaction'
        using errcode = 'check_violation';
    end if;
    new.publish_requested_at := now();
  end if;

  if old.publish_response_at is not null and new.publish_response_at is distinct from old.publish_response_at then
    raise exception 'publish_response_at is recorded once' using errcode = 'check_violation';
  end if;

  v_rank_old := array_position(v_order, old.phase_reached);
  v_rank_new := array_position(v_order, new.phase_reached);
  if v_rank_new < v_rank_old then
    raise exception 'attempt phase may only advance' using errcode = 'check_violation';
  end if;

  if new.outcome <> 'pending' then
    new.finished_at := now();
  end if;
  return new;
end;
$$;

-- 3.7 evidence INSERT: 채널·호스트 파생, 삽입 가능 상태 제한, admin 기록자 검증
create or replace function public.distribution_publication_evidence_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_job record;
  v_old_status text;
begin
  select j.channel, j.mode into v_job from public.distribution_jobs j where j.id = new.job_id;
  if not found then
    raise exception 'distribution job % not found', new.job_id using errcode = 'foreign_key_violation';
  end if;
  if v_job.mode = 'dry_run' then
    raise exception 'dry-run jobs have no publication evidence' using errcode = 'check_violation';
  end if;
  if new.status not in ('accepted', 'pending_review', 'conflict') then
    raise exception 'evidence is inserted as accepted, pending_review or conflict' using errcode = 'check_violation';
  end if;
  if new.source = 'late_arrival' and new.status = 'accepted' then
    raise exception 'late evidence must be reviewed before acceptance' using errcode = 'check_violation';
  end if;
  if new.recorded_by is not null then
    perform public.distribution_assert_admin_actor(new.recorded_by);
  end if;
  if new.observed_at > now() + interval '5 minutes' then
    raise exception 'observed_at is in the future' using errcode = 'check_violation';
  end if;
  if new.supersedes_id is not null then
    select e.status into v_old_status
    from public.distribution_publication_evidence e where e.id = new.supersedes_id and e.job_id = new.job_id;
    if v_old_status is distinct from 'superseded' then
      raise exception 'superseded evidence must be marked superseded first' using errcode = 'check_violation';
    end if;
  end if;
  new.channel := v_job.channel;
  new.url_host := case when new.external_url is null then null
                       else lower(substring(new.external_url from '^https://([^/?#:@]+)')) end;
  new.status_changed_at := null;
  new.status_changed_by := null;
  new.status_reason := null;
  new.created_at := now();
  return new;
end;
$$;

-- 3.8 evidence UPDATE: 상태 열만, 허용 전이만, admin 기록
create or replace function public.distribution_publication_evidence_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status', 'status_changed_at', 'status_changed_by', 'status_reason'])
     is distinct from (to_jsonb(old) - array['status', 'status_changed_at', 'status_changed_by', 'status_reason']) then
    raise exception 'evidence is immutable except its status' using errcode = 'check_violation';
  end if;
  if (old.status || '>' || new.status) not in (
    'accepted>superseded', 'pending_review>accepted', 'pending_review>rejected', 'conflict>rejected'
  ) then
    raise exception 'evidence status % -> % not allowed', old.status, new.status using errcode = 'check_violation';
  end if;
  if new.status_changed_by is null then
    raise exception 'evidence status changes require an admin' using errcode = 'insufficient_privilege';
  end if;
  perform public.distribution_assert_admin_actor(new.status_changed_by);
  new.status_changed_at := now();
  return new;
end;
$$;

-- 3.9 reconciliation INSERT: unknown 작업만, 관찰 시각 검증, admin 재검증
create or replace function public.distribution_reconciliations_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select j.status into v_status from public.distribution_jobs j where j.id = new.job_id;
  if v_status is distinct from 'unknown' then
    raise exception 'reconciliation is recorded only for unknown jobs' using errcode = 'check_violation';
  end if;
  if new.observed_at > now() + interval '5 minutes' then
    raise exception 'observed_at is in the future' using errcode = 'check_violation';
  end if;
  if new.decided_by is not null then
    perform public.distribution_assert_admin_actor(new.decided_by);
  end if;
  new.created_at := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 트리거 연결 (BEFORE 트리거는 이름순: *_guard → *_updated_at)
-- ----------------------------------------------------------------------------
create trigger distribution_jobs_insert before insert on public.distribution_jobs
  for each row execute function public.distribution_jobs_before_insert();
create trigger distribution_jobs_guard before update on public.distribution_jobs
  for each row execute function public.distribution_jobs_guard_update();
create trigger distribution_jobs_event after insert or update on public.distribution_jobs
  for each row execute function public.distribution_jobs_record_event();
create constraint trigger distribution_jobs_evidence_consistency
  after insert or update on public.distribution_jobs
  deferrable initially deferred
  for each row execute function public.distribution_assert_job_evidence();
create trigger distribution_jobs_no_delete before delete on public.distribution_jobs
  for each row execute function public.distribution_reject_mutation();
create trigger distribution_jobs_no_truncate before truncate on public.distribution_jobs
  for each statement execute function public.distribution_reject_mutation();

create trigger distribution_job_attempts_insert before insert on public.distribution_job_attempts
  for each row execute function public.distribution_job_attempts_before_insert();
create trigger distribution_job_attempts_guard before update on public.distribution_job_attempts
  for each row execute function public.distribution_job_attempts_guard_update();
create trigger distribution_job_attempts_no_delete before delete on public.distribution_job_attempts
  for each row execute function public.distribution_reject_mutation();
create trigger distribution_job_attempts_no_truncate before truncate on public.distribution_job_attempts
  for each statement execute function public.distribution_reject_mutation();

create trigger distribution_publication_evidence_insert before insert on public.distribution_publication_evidence
  for each row execute function public.distribution_publication_evidence_before_insert();
create trigger distribution_publication_evidence_guard before update on public.distribution_publication_evidence
  for each row execute function public.distribution_publication_evidence_guard_update();
create constraint trigger distribution_publication_evidence_consistency
  after insert or update on public.distribution_publication_evidence
  deferrable initially deferred
  for each row execute function public.distribution_assert_job_evidence();
create trigger distribution_publication_evidence_no_delete before delete on public.distribution_publication_evidence
  for each row execute function public.distribution_reject_mutation();
create trigger distribution_publication_evidence_no_truncate before truncate on public.distribution_publication_evidence
  for each statement execute function public.distribution_reject_mutation();

create trigger distribution_reconciliations_insert before insert on public.distribution_reconciliations
  for each row execute function public.distribution_reconciliations_before_insert();
create trigger distribution_reconciliations_immutable before update or delete on public.distribution_reconciliations
  for each row execute function public.distribution_reject_mutation();
create trigger distribution_reconciliations_no_truncate before truncate on public.distribution_reconciliations
  for each statement execute function public.distribution_reject_mutation();

create trigger distribution_job_events_immutable before update or delete on public.distribution_job_events
  for each row execute function public.distribution_reject_mutation();
create trigger distribution_job_events_no_truncate before truncate on public.distribution_job_events
  for each statement execute function public.distribution_reject_mutation();


-- ============================================================================
-- 4. service_role 전용 API 함수 (SECURITY DEFINER — 머리 주석 "권한·역할 경계" 참조)
-- ============================================================================

-- 4.1 작업 생성 (T1 scheduled / T2 manual_ready). 승인은 함수가 유효 승인으로 선택하고 트리거가 재검증.
--     접수 응답 유실 시 서버는 재요청하지 말고 idempotency_key로 기존 작업을 조회한다.
create or replace function public.distribution_create_job(
  p_actor_id uuid,
  p_draft_revision_id uuid,
  p_mode text,
  p_scheduled_at timestamptz default null,
  p_schedule_tz text default null,
  p_max_attempts integer default 3,
  p_allow_republish boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rev record;
  v_channel text;
  v_version_no integer;
  v_approval uuid;
  v_content_approval uuid;
  v_key text;
  v_existing record;
  v_republish boolean := false;
  v_job_id uuid;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_mode is null or p_mode not in ('live', 'dry_run', 'manual') then
    raise exception 'invalid mode' using errcode = 'invalid_parameter_value';
  end if;

  select r.id, r.draft_id, r.content_id, r.content_version_id into v_rev
  from public.distribution_draft_revisions r where r.id = p_draft_revision_id;
  if not found then
    raise exception 'draft revision % not found', p_draft_revision_id using errcode = 'no_data_found';
  end if;
  -- 머리 행 공유 잠금: 검사~INSERT 사이 새 버전/리비전 커밋(M1 INSERT 트리거의 FOR UPDATE)을 막는다.
  select d.channel into v_channel from public.distribution_channel_drafts d where d.id = v_rev.draft_id for share;
  perform 1 from public.distribution_contents c where c.id = v_rev.content_id for share;
  select v.version_no into v_version_no from public.distribution_content_versions v where v.id = v_rev.content_version_id;

  if (v_channel = 'blog' and p_mode = 'live') or (p_mode = 'manual' and v_channel <> 'blog') then
    raise exception 'mode % is not allowed for channel %', p_mode, v_channel using errcode = 'check_violation';
  end if;
  if p_mode = 'live' and not public.distribution_live_gate(p_draft_revision_id) then
    raise exception 'LIVE_GATE_CLOSED: live jobs are not enabled (connections/rights/validation gates pending)'
      using errcode = 'feature_not_supported';
  end if;
  if p_mode = 'manual' and p_scheduled_at is not null then
    raise exception 'manual jobs are not scheduled' using errcode = 'invalid_parameter_value';
  end if;
  if p_scheduled_at is not null and p_scheduled_at <= now() then
    raise exception 'scheduled_at must be in the future' using errcode = 'invalid_parameter_value';
  end if;
  if p_schedule_tz is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_schedule_tz) then
    raise exception 'unknown time zone %', p_schedule_tz using errcode = 'invalid_parameter_value';
  end if;
  if p_max_attempts is null or p_max_attempts not between 1 and 10 then
    raise exception 'max_attempts must be 1..10' using errcode = 'invalid_parameter_value';
  end if;

  v_approval := public.distribution_effective_approval_id('draft_revision', v_rev.id);
  v_content_approval := public.distribution_effective_approval_id('content_version', v_rev.content_version_id);
  if v_approval is null or v_content_approval is null then
    raise exception 'NOT_APPROVED: revision and content version need an effective approval' using errcode = 'check_violation';
  end if;

  -- 친절한 사전 중복 판정(경합은 partial unique 인덱스가 최종 보장)
  v_key := format('pub:%s:v%s:%s:%s', v_rev.content_id, v_version_no, v_channel, p_mode);
  select j.id, j.status into v_existing
  from public.distribution_jobs j where j.idempotency_key = v_key and j.status <> 'cancelled' limit 1;
  if found then
    raise exception 'DUPLICATE: job % already exists for this content/version/channel/mode (status %)',
      v_existing.id, v_existing.status using errcode = 'unique_violation';
  end if;
  if p_mode in ('live', 'manual') then
    select j.id, j.status, j.content_version_no as ver_no into v_existing
    from public.distribution_jobs j
    where j.content_id = v_rev.content_id and j.channel = v_channel and j.mode in ('live', 'manual')
      and j.status in ('scheduled', 'dispatching', 'unknown', 'failed', 'manual_ready', 'awaiting_evidence')
    limit 1;
    if found then
      raise exception 'DUPLICATE: open job % (v%, %) exists on this channel; cancel or reconcile it first',
        v_existing.id, v_existing.ver_no, v_existing.status using errcode = 'unique_violation';
    end if;
    v_republish := exists (
      select 1 from public.distribution_jobs j
      where j.content_id = v_rev.content_id and j.channel = v_channel and j.mode in ('live', 'manual')
        and j.status = 'published'
    );
    if v_republish and not coalesce(p_allow_republish, false) then
      raise exception 'REPUBLISH_CONFIRMATION_REQUIRED: this channel already has a published version'
        using errcode = 'check_violation';
    end if;
  end if;

  perform public.distribution_set_event_context(
    'admin', p_actor_id, case when v_republish then 'job_created_republish' else 'job_created' end);
  insert into public.distribution_jobs (
    content_id, content_version_id, draft_id, draft_revision_id, approval_id, content_approval_id,
    mode, scheduled_at, schedule_tz, max_attempts, created_by
  ) values (
    v_rev.content_id, v_rev.content_version_id, v_rev.draft_id, v_rev.id, v_approval, v_content_approval,
    p_mode, p_scheduled_at, p_schedule_tz, p_max_attempts, p_actor_id
  )
  returning id into v_job_id;
  return v_job_id;
end;
$$;

-- 4.2 원자적 claim (T3, T6 재개). 호출 주체(스케줄러 tick/운영자 수동 tick)는 D3 결정까지 비워 둔다.
--     FOR UPDATE SKIP LOCKED로 중복 tick에도 같은 작업을 두 워커가 잡지 않는다.
--     claim 시점 재검사: 근거(승인·stale·보관) + live 게이트. 실패하면 hold_reason을 걸고 건너뛴다.
--     TODO(runtime_controls 도입 시): 전역/채널 중지 확인은 distribution_live_gate 또는 여기서 hold='paused'.
create or replace function public.distribution_claim_jobs(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 120
)
returns table (claimed_job_id uuid, claimed_attempt_id uuid, claimed_attempt_no integer, resumed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
  v_problem text;
  v_attempt_id uuid;
begin
  perform public.distribution_assert_worker_ref(p_worker_id);
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'limit must be 1..50' using errcode = 'invalid_parameter_value';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 10 and 900 then
    raise exception 'lease_seconds must be 10..900' using errcode = 'invalid_parameter_value';
  end if;

  for v_job in
    select j.*
    from public.distribution_jobs j
    where (j.status = 'scheduled' and j.hold_reason is null and not j.reconciliation_required
           and coalesce(j.scheduled_at, j.created_at) <= now())
       or (j.status = 'dispatching' and j.lease_expires_at <= now()
           and j.phase in ('container_created', 'processing', 'ready'))
    order by coalesce(j.scheduled_at, j.created_at), j.id
    limit p_limit
    for update of j skip locked
  loop
    if v_job.status = 'scheduled' then
      v_problem := public.distribution_job_basis_problem(v_job.draft_revision_id, v_job.approval_id, v_job.content_approval_id);
      if v_problem is null and v_job.mode = 'live' and not public.distribution_live_gate(v_job.draft_revision_id) then
        v_problem := 'live_gate_closed';
      end if;
      if v_problem is not null then
        perform public.distribution_set_event_context('system', null, 'claim_precheck_hold', v_problem, p_worker_id);
        update public.distribution_jobs
           set hold_reason = case
                 when v_problem in ('approval_mismatch', 'approval_revoked') then 'approval_revoked'
                 when v_problem = 'live_gate_closed' then 'live_gate_closed'
                 else 'stale' end
         where id = v_job.id;
        continue;
      end if;

      perform public.distribution_set_event_context('worker', null, 'claimed', null, p_worker_id);
      update public.distribution_jobs
         set status = 'dispatching',
             attempts = v_job.attempts + 1,
             lease_owner = p_worker_id,
             lease_expires_at = now() + make_interval(secs => p_lease_seconds),
             last_attempt_at = now()
       where id = v_job.id;
      insert into public.distribution_job_attempts (job_id, attempt_no, mode, channel, worker_ref)
      values (v_job.id, v_job.attempts + 1, v_job.mode, v_job.channel, p_worker_id)
      returning id into v_attempt_id;

      claimed_job_id := v_job.id;
      claimed_attempt_id := v_attempt_id;
      claimed_attempt_no := v_job.attempts + 1;
      resumed := false;
      return next;
    else
      -- T6: 컨테이너 생성~ready 단계에서 lease 만료 → publish 요청 전이므로 같은 attempt·같은 컨테이너로 재개
      select a.id into v_attempt_id
      from public.distribution_job_attempts a
      where a.job_id = v_job.id and a.attempt_no = v_job.attempts
        and a.outcome = 'pending' and a.publish_requested_at is null;
      if not found then
        continue;
      end if;
      perform public.distribution_set_event_context('worker', null, 'lease_resumed', null, p_worker_id);
      update public.distribution_jobs
         set lease_owner = p_worker_id,
             lease_expires_at = now() + make_interval(secs => p_lease_seconds)
       where id = v_job.id;

      claimed_job_id := v_job.id;
      claimed_attempt_id := v_attempt_id;
      claimed_attempt_no := v_job.attempts;
      resumed := true;
      return next;
    end if;
  end loop;
end;
$$;

-- 4.3 단계 진행 (T4, write-ahead). 원격 HTTP 전에 이 함수를 커밋한다.
--     container_requested(요청 전) → container_created(받은 ID 즉시 커밋) → processing/ready(상태 조회)
--     → publish_requested(게시 요청 전, 컨테이너가 이전 트랜잭션에서 커밋돼 있어야 함) → confirming.
--     같은 phase로 호출하면 컨테이너 상태 갱신 + lease 연장만 한다. 유효한 lease 보유자만 호출 가능.
--     p_container_status 계약(live, 불변조건 4a — 테이블 check·job 가드가 같은 규칙을 이중 강제):
--       processing ⇐ 'IN_PROGRESS'만, ready ⇐ 'FINISHED'만(필수). 그 외 단계는 null.
--       'ERROR'/'EXPIRED' → 거부: distribution_complete_attempt(failed)로 시도를 끝내고 새 attempt(새 컨테이너).
--         publish 요청 전이므로 retry_policy 'auto' 가능.
--       'PUBLISHED' → 거부(진행 단계가 아니라 게시 사실): unknown 이후 distribution_record_reconciliation으로 기록.
--       역순(ready에서 processing 등)·미지원 값 거부. publish_requested는 attempt가 ready이고 저장된 상태가
--       FINISHED일 때만. dry_run은 컨테이너가 없으므로 상태 인자 null.
create or replace function public.distribution_advance_phase(
  p_job_id uuid,
  p_attempt_id uuid,
  p_worker_id text,
  p_to_phase text,
  p_provider_container_id text default null,
  p_container_status text default null,
  p_lease_seconds integer default 120
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
  v_att public.distribution_job_attempts;
  v_version integer;
begin
  perform public.distribution_assert_worker_ref(p_worker_id);
  if p_to_phase is null or p_to_phase not in (
    'container_requested', 'container_created', 'processing', 'ready', 'publish_requested', 'confirming'
  ) then
    raise exception 'invalid phase %', p_to_phase using errcode = 'invalid_parameter_value';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 10 and 900 then
    raise exception 'lease_seconds must be 10..900' using errcode = 'invalid_parameter_value';
  end if;

  v_job := public.distribution_lock_job(p_job_id, null);
  if v_job.status <> 'dispatching' or v_job.lease_owner is distinct from p_worker_id or v_job.lease_expires_at <= now() then
    raise exception 'LEASE_NOT_HELD: worker does not hold a valid lease on job %', p_job_id using errcode = 'lock_not_available';
  end if;
  select * into v_att from public.distribution_job_attempts a
  where a.id = p_attempt_id and a.job_id = p_job_id and a.attempt_no = v_job.attempts
  for update;
  if not found or v_att.outcome <> 'pending' then
    raise exception 'attempt % is not the current pending attempt', p_attempt_id using errcode = 'check_violation';
  end if;
  if p_to_phase = 'publish_requested' and v_job.cancel_requested_at is not null then
    raise exception 'CANCEL_REQUESTED: do not send the publish request' using errcode = 'check_violation';
  end if;
  if p_to_phase = 'container_created' then
    if v_job.mode = 'live' and p_provider_container_id is null then
      raise exception 'container_created requires the provider container id' using errcode = 'invalid_parameter_value';
    end if;
    if v_job.mode = 'dry_run' and p_provider_container_id is not null then
      raise exception 'dry-run attempts have no provider container' using errcode = 'invalid_parameter_value';
    end if;
  elsif p_provider_container_id is not null then
    raise exception 'container id is recorded only at container_created' using errcode = 'invalid_parameter_value';
  end if;

  -- 컨테이너 상태: 목표 단계가 허용하는 값만 (불변조건 4a)
  if p_container_status is not null
     and p_container_status not in ('IN_PROGRESS', 'FINISHED', 'PUBLISHED', 'ERROR', 'EXPIRED') then
    raise exception 'unsupported container status %', p_container_status using errcode = 'invalid_parameter_value';
  end if;
  if v_job.mode = 'dry_run' then
    if p_container_status is not null then
      raise exception 'dry-run attempts have no provider container status' using errcode = 'invalid_parameter_value';
    end if;
  elsif p_container_status in ('ERROR', 'EXPIRED') then
    raise exception 'CONTAINER_FAILED: record the attempt as failed via distribution_complete_attempt; a new attempt creates a new container'
      using errcode = 'check_violation';
  elsif p_container_status = 'PUBLISHED' then
    raise exception 'container status PUBLISHED is not a progress phase; record it through reconciliation'
      using errcode = 'check_violation';
  elsif p_to_phase = 'processing' and p_container_status is distinct from 'IN_PROGRESS' then
    raise exception 'processing requires container status IN_PROGRESS' using errcode = 'invalid_parameter_value';
  elsif p_to_phase = 'ready' and p_container_status is distinct from 'FINISHED' then
    raise exception 'ready requires container status FINISHED' using errcode = 'invalid_parameter_value';
  elsif p_to_phase not in ('processing', 'ready') and p_container_status is not null then
    raise exception 'container status is reported only at processing or ready' using errcode = 'invalid_parameter_value';
  end if;
  if v_job.mode = 'live' and p_to_phase = 'publish_requested' and v_job.phase <> 'publish_requested'
     and (v_att.phase_reached <> 'ready' or v_att.container_status is distinct from 'FINISHED'
          or v_att.container_checked_at is null) then
    raise exception 'CONTAINER_NOT_READY: publish request requires a stored FINISHED container status at ready'
      using errcode = 'check_violation';
  end if;

  update public.distribution_job_attempts
     set phase_reached = p_to_phase,
         provider_container_id = coalesce(provider_container_id, p_provider_container_id),
         container_status = coalesce(p_container_status, container_status),
         container_checked_at = case when p_container_status is not null then now() else container_checked_at end,
         publish_requested_at = case when p_to_phase = 'publish_requested'
                                     then coalesce(publish_requested_at, now()) else publish_requested_at end
   where id = v_att.id;

  perform public.distribution_set_event_context('worker', null, 'phase_advanced', p_to_phase, p_worker_id);
  update public.distribution_jobs
     set phase = p_to_phase,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where id = p_job_id
  returning version into v_version;
  return v_version;
end;
$$;

-- 4.4 시도 결과 반영 (T5/T7/T8/T9, 취소 요청 존중).
--     lease가 만료됐어도 lease_owner가 그대로면(재개·회수 전) 결과를 반영한다. 다른 워커가 재개했거나
--     회수돼 거부되면 서버는 결과를 버리지 말고 distribution_record_late_evidence로 남긴다.
--     published: provider_response 증거(accepted) + 외부 ID 필수. 다른 작업과 같은 게시물이면 conflict 증거를
--     남기고 unknown + reconciliation_required. 경고는 issues로 별도 보존(published_with_issues).
--     failed: retry_policy는 publish 요청 후 'auto' 불가. unknown: live만.
--     published/unknown(불변조건 4c): 현재 attempt에 publish_requested_at이 기록되고 job phase가
--     publish_requested/confirming일 때만(PUBLISH_NOT_REQUESTED). publish 요청 전 불확실성(컨테이너 생성 응답 유실,
--     상태 조회 실패, ERROR/EXPIRED)은 공개 게시물을 만들 수 없으므로 unknown이 아니라 failed로 기록한다
--     (고아 컨테이너는 게시 요청 없이는 공개되지 않으며 새 attempt가 새 컨테이너를 만든다).
create or replace function public.distribution_complete_attempt(
  p_job_id uuid,
  p_attempt_id uuid,
  p_worker_id text,
  p_outcome text,
  p_error jsonb default null,
  p_retry_policy text default null,
  p_external_post_id text default null,
  p_external_url text default null,
  p_external_account_id text default null,
  p_issues jsonb default '[]'::jsonb,
  p_summary text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
  v_att public.distribution_job_attempts;
  v_ev public.distribution_publication_evidence;
  v_error jsonb;
  v_conflict boolean;
begin
  perform public.distribution_assert_worker_ref(p_worker_id);
  v_job := public.distribution_lock_job(p_job_id, null);
  if v_job.status <> 'dispatching' or v_job.lease_owner is distinct from p_worker_id then
    raise exception 'LEASE_NOT_HELD: worker does not own job %', p_job_id using errcode = 'lock_not_available';
  end if;
  select * into v_att from public.distribution_job_attempts a
  where a.id = p_attempt_id and a.job_id = p_job_id and a.attempt_no = v_job.attempts
  for update;
  if not found or v_att.outcome <> 'pending' then
    raise exception 'attempt % is not the current pending attempt', p_attempt_id using errcode = 'check_violation';
  end if;
  if p_outcome in ('published', 'unknown')
     and (v_att.publish_requested_at is null or v_job.phase not in ('publish_requested', 'confirming')) then
    raise exception 'PUBLISH_NOT_REQUESTED: % requires a recorded publish request; record failed before the publish request',
      p_outcome using errcode = 'check_violation';
  end if;

  if p_outcome = 'published' then
    if v_job.mode <> 'live' then
      raise exception 'MODE_MISMATCH: only live jobs publish' using errcode = 'check_violation';
    end if;
    if nullif(btrim(p_external_post_id), '') is null then
      raise exception 'NO_EVIDENCE: published requires the external post id' using errcode = 'check_violation';
    end if;
    v_conflict := public.distribution_evidence_conflicts(
      p_job_id, v_job.channel, nullif(btrim(p_external_account_id), ''),
      nullif(btrim(p_external_post_id), ''), nullif(btrim(p_external_url), ''));
    v_ev := public.distribution_insert_evidence(
      p_job_id, v_att.attempt_no, 'provider_response', case when v_conflict then 'conflict' else 'accepted' end,
      p_external_post_id, p_external_url, p_external_account_id, now(), null, null, coalesce(p_issues, '[]'::jsonb));

    update public.distribution_job_attempts
       set outcome = case when v_conflict then 'unknown' else 'published' end,
           publish_response_at = coalesce(publish_response_at, now()),
           phase_reached = 'done'
     where id = v_att.id;

    if v_conflict then
      perform public.distribution_set_event_context('worker', null, 'evidence_conflict', p_summary, p_worker_id, null, v_ev.id);
      update public.distribution_jobs
         set status = 'unknown', reconciliation_required = true,
             last_error = jsonb_build_object('code', 'EVIDENCE_CONFLICT',
                                             'message', 'another job already holds this external post',
                                             'retryable', false, 'autoRetry', false),
             lease_owner = null, lease_expires_at = null
       where id = p_job_id;
      return 'unknown';
    end if;

    perform public.distribution_set_event_context('worker', null, 'attempt_published', p_summary, p_worker_id, null, v_ev.id);
    update public.distribution_jobs
       set status = 'published', phase = 'done',
           accepted_evidence_id = v_ev.id, external_id = v_ev.external_post_id, external_url = v_ev.external_url,
           has_issues = jsonb_array_length(v_ev.issues) > 0, issues = v_ev.issues,
           last_error = null, lease_owner = null, lease_expires_at = null
     where id = p_job_id;
    return 'published';

  elsif p_outcome = 'dry_run_ok' then
    if v_job.mode <> 'dry_run' then
      raise exception 'MODE_MISMATCH: dry-run result for a non dry-run job' using errcode = 'check_violation';
    end if;
    update public.distribution_job_attempts set outcome = 'dry_run_ok', phase_reached = 'done' where id = v_att.id;
    perform public.distribution_set_event_context('worker', null, 'dry_run_succeeded', p_summary, p_worker_id);
    update public.distribution_jobs
       set status = 'dry_run_succeeded', phase = 'done', last_error = null, lease_owner = null, lease_expires_at = null
     where id = p_job_id;
    return 'dry_run_succeeded';

  elsif p_outcome = 'failed' then
    v_error := public.distribution_normalize_error(p_error);
    if p_retry_policy is null or p_retry_policy not in ('auto', 'operator_only', 'never') then
      raise exception 'failed requires retry_policy auto|operator_only|never' using errcode = 'invalid_parameter_value';
    end if;
    if p_retry_policy = 'auto' and v_att.publish_requested_at is not null then
      raise exception 'automatic retry is not allowed after a publish request' using errcode = 'check_violation';
    end if;
    update public.distribution_job_attempts set outcome = 'failed', error_code = v_error ->> 'code' where id = v_att.id;
    perform public.distribution_set_event_context('worker', null, 'attempt_failed', p_summary, p_worker_id);
    update public.distribution_jobs
       set status = 'failed', retry_policy = p_retry_policy, last_error = v_error,
           lease_owner = null, lease_expires_at = null
     where id = p_job_id;
    return 'failed';

  elsif p_outcome = 'unknown' then
    if v_job.mode <> 'live' then
      raise exception 'only live jobs can become unknown' using errcode = 'check_violation';
    end if;
    update public.distribution_job_attempts set outcome = 'unknown' where id = v_att.id;
    perform public.distribution_set_event_context('worker', null, 'attempt_unknown', p_summary, p_worker_id);
    update public.distribution_jobs
       set status = 'unknown',
           last_error = jsonb_strip_nulls(jsonb_build_object('code', 'UNKNOWN_OUTCOME', 'message', left(p_summary, 500),
                                                             'retryable', false, 'autoRetry', false)),
           lease_owner = null, lease_expires_at = null
     where id = p_job_id;
    return 'unknown';

  elsif p_outcome = 'cancelled' then
    if v_job.cancel_requested_at is null or v_att.publish_requested_at is not null then
      raise exception 'cancel honored only on request and before publish request' using errcode = 'check_violation';
    end if;
    update public.distribution_job_attempts set outcome = 'cancelled' where id = v_att.id;
    perform public.distribution_set_event_context('worker', null, 'cancel_honored', p_summary, p_worker_id);
    update public.distribution_jobs
       set status = 'cancelled', lease_owner = null, lease_expires_at = null
     where id = p_job_id;
    return 'cancelled';
  end if;

  raise exception 'invalid outcome %', p_outcome using errcode = 'invalid_parameter_value';
end;
$$;

-- 4.5 만료 lease 회수 (T5/T7 분류). 컨테이너 생성~ready 단계는 claim이 재개(T6)하므로 여기서 건드리지 않는다.
--     publish 요청 기록 이후: live → unknown(자동 재전송 금지), dry_run → failed(auto).
--     컨테이너 ID 수신 전: failed(auto) — 게시 요청이 나가지 않았으므로 공개 게시물 생성 불가.
create or replace function public.distribution_recover_expired_leases(p_limit integer default 20)
returns table (recovered_job_id uuid, recovered_status text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
  v_att public.distribution_job_attempts;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'limit must be 1..100' using errcode = 'invalid_parameter_value';
  end if;
  for v_job in
    select j.*
    from public.distribution_jobs j
    where j.status = 'dispatching' and j.lease_expires_at <= now()
      and j.phase not in ('container_created', 'processing', 'ready')
    order by j.lease_expires_at, j.id
    limit p_limit
    for update of j skip locked
  loop
    select * into v_att from public.distribution_job_attempts a
    where a.job_id = v_job.id and a.attempt_no = v_job.attempts
    for update;
    if not found or v_att.outcome <> 'pending' then
      raise exception 'job % has no pending current attempt', v_job.id using errcode = 'check_violation';
    end if;

    if v_att.publish_requested_at is not null or v_job.phase in ('publish_requested', 'confirming') then
      if v_job.mode = 'live' then
        update public.distribution_job_attempts set outcome = 'unknown' where id = v_att.id;
        perform public.distribution_set_event_context('system', null, 'lease_expired_after_publish_request');
        update public.distribution_jobs
           set status = 'unknown',
               last_error = jsonb_build_object('code', 'LEASE_EXPIRED_AFTER_PUBLISH_REQUEST',
                                               'retryable', false, 'autoRetry', false),
               lease_owner = null, lease_expires_at = null
         where id = v_job.id;
        recovered_job_id := v_job.id; recovered_status := 'unknown';
      else
        update public.distribution_job_attempts set outcome = 'failed', error_code = 'LEASE_EXPIRED' where id = v_att.id;
        perform public.distribution_set_event_context('system', null, 'lease_expired');
        update public.distribution_jobs
           set status = 'failed', retry_policy = 'auto',
               last_error = jsonb_build_object('code', 'LEASE_EXPIRED', 'retryable', true, 'autoRetry', true),
               lease_owner = null, lease_expires_at = null
         where id = v_job.id;
        recovered_job_id := v_job.id; recovered_status := 'failed';
      end if;
    else
      update public.distribution_job_attempts
         set outcome = 'failed', error_code = 'LEASE_EXPIRED_BEFORE_CONTAINER' where id = v_att.id;
      perform public.distribution_set_event_context('system', null, 'lease_expired_before_container');
      update public.distribution_jobs
         set status = 'failed', retry_policy = 'auto',
             last_error = jsonb_build_object('code', 'LEASE_EXPIRED_BEFORE_CONTAINER', 'retryable', true, 'autoRetry', true),
             lease_owner = null, lease_expires_at = null
       where id = v_job.id;
      recovered_job_id := v_job.id; recovered_status := 'failed';
    end if;
    return next;
  end loop;
end;
$$;

-- 4.6 자동 재시도 재예약 (T14). retry_policy='auto' + autoRetry + 횟수 한도 + publish 요청 전 실패만.
create or replace function public.distribution_requeue_auto_retry(
  p_job_id uuid,
  p_not_before timestamptz default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
begin
  v_job := public.distribution_lock_job(p_job_id, null);
  if v_job.status <> 'failed' or v_job.retry_policy <> 'auto' or v_job.reconciliation_required
     or v_job.attempts >= v_job.max_attempts then
    raise exception 'RETRY_NOT_ALLOWED: job % is not eligible for automatic retry', p_job_id using errcode = 'check_violation';
  end if;
  perform public.distribution_set_event_context('system', null, 'auto_retry_requeued');
  update public.distribution_jobs
     set status = 'scheduled', retry_policy = null, phase = 'none',
         scheduled_at = case when p_not_before > now() then p_not_before else null end
   where id = p_job_id;
end;
$$;

-- 4.7 취소 (T15). scheduled/failed/manual_ready → cancelled. dispatching은 cancel_requested_at만 기록
--     (워커가 publish 요청 전에만 존중). unknown·published·awaiting_evidence는 취소 불가.
create or replace function public.distribution_cancel_job(
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_reason text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_expected_version is null then
    raise exception 'expected_version is required' using errcode = 'invalid_parameter_value';
  end if;
  v_job := public.distribution_lock_job(p_job_id, p_expected_version);
  if v_job.status in ('scheduled', 'failed', 'manual_ready') then
    perform public.distribution_set_event_context('admin', p_actor_id, 'job_cancelled', p_reason);
    update public.distribution_jobs
       set status = 'cancelled', hold_reason = null, retry_policy = null
     where id = p_job_id;
    return 'cancelled';
  elsif v_job.status = 'dispatching' then
    if v_job.cancel_requested_at is null then
      perform public.distribution_set_event_context('admin', p_actor_id, 'cancel_requested', p_reason);
      update public.distribution_jobs set cancel_requested_at = now() where id = p_job_id;
    end if;
    return 'cancel_requested';
  end if;
  raise exception 'INVALID_TRANSITION: % jobs cannot be cancelled', v_job.status using errcode = 'check_violation';
end;
$$;

-- 4.8 예약 시각 변경 (S4). scheduled만, 해제 불가 hold(stale/approval_revoked)는 거부, awaiting_operator는 해제.
create or replace function public.distribution_reschedule_job(
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_scheduled_at timestamptz,
  p_schedule_tz text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_expected_version is null then
    raise exception 'expected_version is required' using errcode = 'invalid_parameter_value';
  end if;
  v_job := public.distribution_lock_job(p_job_id, p_expected_version);
  if v_job.status <> 'scheduled' or v_job.hold_reason in ('stale', 'approval_revoked') then
    raise exception 'INVALID_TRANSITION: only unheld scheduled jobs can be rescheduled' using errcode = 'check_violation';
  end if;
  if p_scheduled_at is not null and p_scheduled_at <= now() then
    raise exception 'scheduled_at must be in the future' using errcode = 'invalid_parameter_value';
  end if;
  if p_schedule_tz is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_schedule_tz) then
    raise exception 'unknown time zone %', p_schedule_tz using errcode = 'invalid_parameter_value';
  end if;
  perform public.distribution_set_event_context('admin', p_actor_id, 'job_rescheduled');
  update public.distribution_jobs
     set scheduled_at = p_scheduled_at,
         schedule_tz = coalesce(p_schedule_tz, schedule_tz),
         hold_reason = case when hold_reason = 'awaiting_operator' then null else hold_reason end
   where id = p_job_id;
end;
$$;

-- 4.9 수동: 게시 마침 선언 (T16) manual_ready → awaiting_evidence. 내보내기/복사는 게시가 아니다.
create or replace function public.distribution_mark_manual_posted(
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_expected_version is null then
    raise exception 'expected_version is required' using errcode = 'invalid_parameter_value';
  end if;
  v_job := public.distribution_lock_job(p_job_id, p_expected_version);
  if v_job.status <> 'manual_ready' then
    raise exception 'INVALID_TRANSITION: job is %', v_job.status using errcode = 'check_violation';
  end if;
  perform public.distribution_set_event_context('admin', p_actor_id, 'manual_posted_declared');
  update public.distribution_jobs set status = 'awaiting_evidence' where id = p_job_id;
end;
$$;

-- 4.10 수동: 증거 확정 (T17) awaiting_evidence → published.
--      URL(허용 호스트, D7 기본값) 또는 외부 ID + 방법 메모. 서버 크롤링 없음. 같은 게시물을 다른 작업이 가졌으면 거부.
create or replace function public.distribution_record_manual_evidence(
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_external_post_id text,
  p_external_url text,
  p_external_account_id text,
  p_observed_at timestamptz,
  p_method_note text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
  v_ev public.distribution_publication_evidence;
  v_url text := nullif(btrim(p_external_url), '');
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_expected_version is null then
    raise exception 'expected_version is required' using errcode = 'invalid_parameter_value';
  end if;
  v_job := public.distribution_lock_job(p_job_id, p_expected_version);
  if v_job.mode <> 'manual' or v_job.status <> 'awaiting_evidence' then
    raise exception 'INVALID_TRANSITION: manual evidence requires awaiting_evidence' using errcode = 'check_violation';
  end if;
  if v_url is not null and not public.distribution_manual_evidence_host_allowed(
       v_job.channel, lower(substring(v_url from '^https://([^/?#:@]+)'))) then
    raise exception 'evidence URL host is not allowed for %', v_job.channel using errcode = 'check_violation';
  end if;
  if public.distribution_evidence_conflicts(p_job_id, v_job.channel, nullif(btrim(p_external_account_id), ''),
                                            nullif(btrim(p_external_post_id), ''), v_url) then
    raise exception 'EVIDENCE_CONFLICT: another job already holds this external post' using errcode = 'unique_violation';
  end if;
  v_ev := public.distribution_insert_evidence(
    p_job_id, null, 'operator_manual', 'accepted', p_external_post_id, v_url, p_external_account_id,
    p_observed_at, p_actor_id, p_method_note, '[]'::jsonb);
  perform public.distribution_set_event_context('admin', p_actor_id, 'manual_evidence_accepted', null, null, null, v_ev.id);
  update public.distribution_jobs
     set status = 'published', accepted_evidence_id = v_ev.id,
         external_id = v_ev.external_post_id, external_url = v_ev.external_url
   where id = p_job_id;
  return v_ev.id;
end;
$$;

-- 4.11 수동: 중단 (T18) manual_ready/awaiting_evidence → abandoned. 사유 + "외부에 남았을 수 있음" 확인 필수.
create or replace function public.distribution_abandon_manual_job(
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_reason text,
  p_acknowledge_may_remain_external boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_expected_version is null then
    raise exception 'expected_version is required' using errcode = 'invalid_parameter_value';
  end if;
  if nullif(btrim(p_reason), '') is null or p_acknowledge_may_remain_external is not true then
    raise exception 'abandon requires a reason and the external-remains acknowledgement' using errcode = 'invalid_parameter_value';
  end if;
  v_job := public.distribution_lock_job(p_job_id, p_expected_version);
  if v_job.status not in ('manual_ready', 'awaiting_evidence') then
    raise exception 'INVALID_TRANSITION: job is %', v_job.status using errcode = 'check_violation';
  end if;
  perform public.distribution_set_event_context('admin', p_actor_id, 'manual_abandoned', p_reason);
  update public.distribution_jobs set status = 'abandoned' where id = p_job_id;
end;
$$;

-- 4.12 수동: 게시 여부 불확실 (T19) awaiting_evidence → unknown (이후 대사로만 진행).
create or replace function public.distribution_mark_manual_uncertain(
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_expected_version is null or nullif(btrim(p_reason), '') is null then
    raise exception 'expected_version and reason are required' using errcode = 'invalid_parameter_value';
  end if;
  v_job := public.distribution_lock_job(p_job_id, p_expected_version);
  if v_job.status <> 'awaiting_evidence' then
    raise exception 'INVALID_TRANSITION: job is %', v_job.status using errcode = 'check_violation';
  end if;
  perform public.distribution_set_event_context('admin', p_actor_id, 'manual_outcome_uncertain', p_reason);
  update public.distribution_jobs
     set status = 'unknown',
         last_error = jsonb_build_object('code', 'MANUAL_OUTCOME_UNCERTAIN', 'message', left(p_reason, 500),
                                         'retryable', false, 'autoRetry', false)
   where id = p_job_id;
end;
$$;

-- 4.13 대사 기록 (T10/T11/T12). unknown 작업만.
--      worker: still_unknown / absence_candidate / found_published(provider_recent_posts 목록 매칭만).
--      admin: 모든 finding. confirmed_absent → failed(operator_only, autoRetry=false). 재실행은 4.14로만.
--      늦은 증거·충돌로 reconciliation_required이면 confirmed_absent 거부.
--      found_published(live): 귀속 attempt(p_attempt_no, 기본 현재 시도)에 publish 요청 기록 필수, phase → done.
--      manual은 phase none 유지. 나머지 finding은 phase를 바꾸지 않는다(live unknown = publish_requested/confirming).
create or replace function public.distribution_record_reconciliation(
  p_actor_kind text,
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_method text,
  p_finding text,
  p_checked_scope jsonb,
  p_observed_at timestamptz,
  p_observation text,
  p_attempt_no integer default null,
  p_external_post_id text default null,
  p_external_url text default null,
  p_external_account_id text default null,
  p_next_check_at timestamptz default null,
  p_next_check_owner text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
  v_ev public.distribution_publication_evidence;
  v_rec uuid;
  v_attempt integer;
  v_url text := nullif(btrim(p_external_url), '');
  v_post text := nullif(btrim(p_external_post_id), '');
begin
  if p_actor_kind = 'admin' then
    perform public.distribution_assert_admin_actor(p_actor_id);
  elsif p_actor_kind = 'worker' then
    if p_actor_id is not null then
      raise exception 'worker reconciliation has no actor id' using errcode = 'invalid_parameter_value';
    end if;
    if p_finding not in ('still_unknown', 'absence_candidate', 'found_published') or p_method = 'operator_manual'
       or (p_finding = 'found_published' and p_method <> 'provider_recent_posts') then
      raise exception 'workers may not record % via %', p_finding, p_method using errcode = 'insufficient_privilege';
    end if;
  else
    raise exception 'invalid actor kind' using errcode = 'invalid_parameter_value';
  end if;
  if p_expected_version is null then
    raise exception 'expected_version is required' using errcode = 'invalid_parameter_value';
  end if;

  v_job := public.distribution_lock_job(p_job_id, p_expected_version);
  if v_job.status <> 'unknown' then
    raise exception 'INVALID_TRANSITION: reconciliation requires unknown (job is %)', v_job.status using errcode = 'check_violation';
  end if;
  v_attempt := coalesce(p_attempt_no, nullif(v_job.attempts, 0));

  if p_finding = 'found_published' then
    if v_post is null and v_url is null then
      raise exception 'NO_EVIDENCE: found_published requires an external id or url' using errcode = 'check_violation';
    end if;
    if v_job.mode = 'live' and v_post is null then
      raise exception 'NO_EVIDENCE: live publication requires the external post id' using errcode = 'check_violation';
    end if;
    if v_job.mode = 'live' and not exists (
         select 1 from public.distribution_job_attempts a
         where a.job_id = p_job_id and a.attempt_no = v_attempt and a.publish_requested_at is not null) then
      raise exception 'PUBLISH_NOT_REQUESTED: live publication must belong to an attempt with a recorded publish request'
        using errcode = 'check_violation';
    end if;
    if v_job.mode = 'manual' and v_url is not null and not public.distribution_manual_evidence_host_allowed(
         v_job.channel, lower(substring(v_url from '^https://([^/?#:@]+)'))) then
      raise exception 'evidence URL host is not allowed for %', v_job.channel using errcode = 'check_violation';
    end if;
    if public.distribution_evidence_conflicts(p_job_id, v_job.channel, nullif(btrim(p_external_account_id), ''), v_post, v_url) then
      raise exception 'EVIDENCE_CONFLICT: another job already holds this external post' using errcode = 'unique_violation';
    end if;
    v_ev := public.distribution_insert_evidence(
      p_job_id, v_attempt, case when p_method = 'operator_manual' then 'operator_manual' else 'provider_lookup' end,
      'accepted', v_post, v_url, p_external_account_id, p_observed_at,
      case when p_actor_kind = 'admin' then p_actor_id end, p_observation, '[]'::jsonb);
  elsif p_finding = 'confirmed_absent' and v_job.reconciliation_required then
    raise exception 'late or conflicting evidence must be resolved before confirming absence' using errcode = 'check_violation';
  end if;

  insert into public.distribution_reconciliations (
    job_id, attempt_no, actor_kind, decided_by, method, finding, checked_scope, observed_at, observation,
    evidence_id, next_check_at, next_check_owner
  ) values (
    p_job_id, v_attempt, p_actor_kind, case when p_actor_kind = 'admin' then p_actor_id end, p_method, p_finding,
    coalesce(p_checked_scope, '{}'::jsonb), p_observed_at, nullif(btrim(p_observation), ''),
    v_ev.id, p_next_check_at, p_next_check_owner
  )
  returning id into v_rec;

  if p_finding = 'found_published' then
    perform public.distribution_set_event_context(p_actor_kind, p_actor_id, 'reconciled_found_published', null, null, v_rec, v_ev.id);
    update public.distribution_jobs
       set status = 'published', accepted_evidence_id = v_ev.id,
           external_id = v_ev.external_post_id, external_url = v_ev.external_url,
           phase = case when v_job.mode = 'live' then 'done' else phase end,
           last_reconciliation_id = v_rec, last_error = null
     where id = p_job_id;
  elsif p_finding = 'confirmed_absent' then
    perform public.distribution_set_event_context('admin', p_actor_id, 'reconciled_confirmed_absent', null, null, v_rec);
    update public.distribution_jobs
       set status = 'failed', retry_policy = 'operator_only', last_reconciliation_id = v_rec,
           last_error = jsonb_build_object('code', 'CONFIRMED_ABSENT', 'message', 'absence confirmed by admin reconciliation',
                                           'retryable', true, 'autoRetry', false)
     where id = p_job_id;
  else
    perform public.distribution_set_event_context(p_actor_kind, p_actor_id, 'reconciliation_recorded', p_finding, null, v_rec);
    update public.distribution_jobs set last_reconciliation_id = v_rec where id = p_job_id;
  end if;
  return v_rec;
end;
$$;

-- 4.14 운영자 재실행 승인 (T13, D2). failed(operator_only) → scheduled(live/dry_run) | manual_ready(manual).
--      근거 재검사(승인·stale·보관·live 게이트) 실패 시 거부 → 취소 후 새 작업.
--      CONFIRMED_ABSENT 실패는 그 confirmed_absent 대사 ID를 명시해야 한다(가드도 확인).
--      이후 claim이 새 attempt(=새 컨테이너)를 만든다. attempts가 max면 거부.
create or replace function public.distribution_approve_rerun(
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_reason text,
  p_reconciliation_id uuid default null,
  p_scheduled_at timestamptz default null,
  p_schedule_tz text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
  v_problem text;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_expected_version is null or nullif(btrim(p_reason), '') is null then
    raise exception 'expected_version and reason are required' using errcode = 'invalid_parameter_value';
  end if;
  v_job := public.distribution_lock_job(p_job_id, p_expected_version);
  if v_job.status <> 'failed' or v_job.retry_policy <> 'operator_only' then
    raise exception 'INVALID_TRANSITION: rerun approval requires failed(operator_only)' using errcode = 'check_violation';
  end if;
  if v_job.reconciliation_required then
    raise exception 'reconciliation required before rerun' using errcode = 'check_violation';
  end if;
  if v_job.last_error ->> 'code' = 'CONFIRMED_ABSENT'
     and (p_reconciliation_id is null or p_reconciliation_id is distinct from v_job.last_reconciliation_id) then
    raise exception 'rerun after unknown must cite the confirmed_absent reconciliation' using errcode = 'check_violation';
  end if;
  v_problem := public.distribution_job_basis_problem(v_job.draft_revision_id, v_job.approval_id, v_job.content_approval_id);
  if v_problem is not null then
    raise exception 'job basis check failed (%): cancel and create a new job', v_problem using errcode = 'check_violation';
  end if;
  if v_job.mode = 'live' and not public.distribution_live_gate(v_job.draft_revision_id) then
    raise exception 'LIVE_GATE_CLOSED' using errcode = 'feature_not_supported';
  end if;
  if v_job.mode in ('live', 'dry_run') and v_job.attempts >= v_job.max_attempts then
    raise exception 'ATTEMPTS_EXHAUSTED: cancel and create a new job' using errcode = 'check_violation';
  end if;
  if v_job.mode = 'manual' and p_scheduled_at is not null then
    raise exception 'manual jobs are not scheduled' using errcode = 'invalid_parameter_value';
  end if;
  if p_scheduled_at is not null and p_scheduled_at <= now() then
    raise exception 'scheduled_at must be in the future' using errcode = 'invalid_parameter_value';
  end if;
  if p_schedule_tz is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_schedule_tz) then
    raise exception 'unknown time zone %', p_schedule_tz using errcode = 'invalid_parameter_value';
  end if;

  perform public.distribution_set_event_context('admin', p_actor_id, 'operator_rerun_approved', p_reason, null, p_reconciliation_id);
  update public.distribution_jobs
     set status = case when v_job.mode = 'manual' then 'manual_ready' else 'scheduled' end,
         retry_policy = null,
         phase = 'none',
         scheduled_at = case when v_job.mode = 'manual' then null else p_scheduled_at end,
         schedule_tz = case when v_job.mode = 'manual' then schedule_tz else coalesce(p_schedule_tz, schedule_tz) end
   where id = p_job_id;
end;
$$;

-- 4.15 늦은 증거 기록 (T21). 상태를 바꾸지 않고 pending_review(또는 conflict) 증거 + reconciliation_required=true.
--      종료 상태 작업에도 플래그만 기록(외부에 게시가 남았다는 사실 보존). dry_run 불가.
--      상태·phase 전이는 하지 않는다(사실 보존 우선이라 attempt 귀속도 여기서 거부하지 않음). live 증거를
--      published로 확정하는 수락(4.16)과 jobs 가드가 publish 요청 기록 attempt 귀속 + phase done을 강제한다.
create or replace function public.distribution_record_late_evidence(
  p_job_id uuid,
  p_external_post_id text,
  p_external_url text,
  p_external_account_id text,
  p_observed_at timestamptz,
  p_note text default null,
  p_attempt_no integer default null,
  p_issues jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
  v_ev public.distribution_publication_evidence;
  v_conflict boolean;
begin
  v_job := public.distribution_lock_job(p_job_id, null);
  if v_job.mode = 'dry_run' then
    raise exception 'dry-run jobs have no publication evidence' using errcode = 'check_violation';
  end if;
  v_conflict := public.distribution_evidence_conflicts(
    p_job_id, v_job.channel, nullif(btrim(p_external_account_id), ''),
    nullif(btrim(p_external_post_id), ''), nullif(btrim(p_external_url), ''));
  v_ev := public.distribution_insert_evidence(
    p_job_id, p_attempt_no, 'late_arrival', case when v_conflict then 'conflict' else 'pending_review' end,
    p_external_post_id, p_external_url, p_external_account_id, p_observed_at, null, p_note,
    coalesce(p_issues, '[]'::jsonb));
  if not v_job.reconciliation_required then
    perform public.distribution_set_event_context('system', null, 'late_evidence_recorded', null, null, null, v_ev.id);
    update public.distribution_jobs set reconciliation_required = true where id = p_job_id;
  end if;
  return v_ev.id;
end;
$$;

-- 4.16 증거 검토 (admin). reject: pending_review/conflict → rejected.
--      accept: pending_review → accepted, 작업 unknown/awaiting_evidence/failed → published(reason late_evidence_accepted).
--      남은 pending_review/conflict가 없으면 reconciliation_required 해제.
--      live 수락: 증거 attempt_no가 publish 요청이 기록된 attempt여야 하고(null이면 수락 불가 → reject 후 대사로
--      귀속 기록), phase → done. manual은 phase none 유지.
create or replace function public.distribution_resolve_evidence(
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_evidence_id uuid,
  p_decision text,
  p_reason text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
  v_ev public.distribution_publication_evidence;
  v_remaining boolean;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_expected_version is null or nullif(btrim(p_reason), '') is null then
    raise exception 'expected_version and reason are required' using errcode = 'invalid_parameter_value';
  end if;
  if p_decision is null or p_decision not in ('accept', 'reject') then
    raise exception 'decision must be accept or reject' using errcode = 'invalid_parameter_value';
  end if;
  v_job := public.distribution_lock_job(p_job_id, p_expected_version);
  select * into v_ev from public.distribution_publication_evidence e
  where e.id = p_evidence_id and e.job_id = p_job_id
  for update;
  if not found or v_ev.status not in ('pending_review', 'conflict') then
    raise exception 'evidence % is not awaiting review', p_evidence_id using errcode = 'check_violation';
  end if;

  if p_decision = 'reject' then
    update public.distribution_publication_evidence
       set status = 'rejected', status_changed_by = p_actor_id, status_reason = p_reason
     where id = v_ev.id;
  else
    if v_ev.status <> 'pending_review' then
      raise exception 'conflicting evidence cannot be accepted' using errcode = 'check_violation';
    end if;
    if v_job.status not in ('unknown', 'awaiting_evidence', 'failed') then
      raise exception 'INVALID_TRANSITION: evidence cannot be accepted while job is %', v_job.status
        using errcode = 'check_violation';
    end if;
    if v_job.mode = 'live' and v_ev.external_post_id is null then
      raise exception 'NO_EVIDENCE: live publication requires the external post id' using errcode = 'check_violation';
    end if;
    if v_job.mode = 'live' and (v_ev.attempt_no is null or not exists (
         select 1 from public.distribution_job_attempts a
         where a.job_id = p_job_id and a.attempt_no = v_ev.attempt_no and a.publish_requested_at is not null)) then
      raise exception 'PUBLISH_NOT_REQUESTED: live evidence must belong to an attempt with a recorded publish request'
        using errcode = 'check_violation';
    end if;
    if v_job.mode = 'manual' and v_ev.external_url is not null
       and not public.distribution_manual_evidence_host_allowed(v_job.channel, v_ev.url_host) then
      raise exception 'evidence URL host is not allowed for %', v_job.channel using errcode = 'check_violation';
    end if;
    if public.distribution_evidence_conflicts(p_job_id, v_job.channel, v_ev.external_account_id,
                                              v_ev.external_post_id, v_ev.external_url) then
      raise exception 'EVIDENCE_CONFLICT: another job already holds this external post' using errcode = 'unique_violation';
    end if;
    update public.distribution_publication_evidence
       set status = 'accepted', status_changed_by = p_actor_id, status_reason = p_reason
     where id = v_ev.id;
  end if;

  v_remaining := exists (
    select 1 from public.distribution_publication_evidence e
    where e.job_id = p_job_id and e.status in ('pending_review', 'conflict')
  );

  if p_decision = 'accept' then
    perform public.distribution_set_event_context('admin', p_actor_id, 'late_evidence_accepted', p_reason, null, null, v_ev.id);
    update public.distribution_jobs
       set status = 'published', accepted_evidence_id = v_ev.id,
           external_id = v_ev.external_post_id, external_url = v_ev.external_url,
           has_issues = jsonb_array_length(v_ev.issues) > 0, issues = v_ev.issues,
           phase = case when v_job.mode = 'live' then 'done' else phase end,
           retry_policy = null, last_error = null, reconciliation_required = v_remaining
     where id = p_job_id;
    return 'published';
  elsif v_job.reconciliation_required and not v_remaining then
    perform public.distribution_set_event_context('admin', p_actor_id, 'reconciliation_cleared', p_reason, null, null, v_ev.id);
    update public.distribution_jobs set reconciliation_required = false where id = p_job_id;
  end if;
  return v_job.status;
end;
$$;

-- 4.17 게시 증거 정정 (T20, admin). published 유지, 이전 accepted → superseded, 새 accepted(operator_manual).
--      issues는 이전 증거에서 승계. 상태 역전 없음.
create or replace function public.distribution_correct_evidence(
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_external_post_id text,
  p_external_url text,
  p_external_account_id text,
  p_observed_at timestamptz,
  p_correction_reason text,
  p_method_note text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
  v_old public.distribution_publication_evidence;
  v_new public.distribution_publication_evidence;
  v_url text := nullif(btrim(p_external_url), '');
  v_post text := nullif(btrim(p_external_post_id), '');
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_expected_version is null or nullif(btrim(p_correction_reason), '') is null then
    raise exception 'expected_version and correction_reason are required' using errcode = 'invalid_parameter_value';
  end if;
  v_job := public.distribution_lock_job(p_job_id, p_expected_version);
  if v_job.status <> 'published' then
    raise exception 'INVALID_TRANSITION: only published jobs have evidence to correct' using errcode = 'check_violation';
  end if;
  if v_job.mode = 'live' and v_post is null then
    raise exception 'NO_EVIDENCE: live publication requires the external post id' using errcode = 'check_violation';
  end if;
  if v_job.mode = 'manual' and v_url is not null and not public.distribution_manual_evidence_host_allowed(
       v_job.channel, lower(substring(v_url from '^https://([^/?#:@]+)'))) then
    raise exception 'evidence URL host is not allowed for %', v_job.channel using errcode = 'check_violation';
  end if;
  if public.distribution_evidence_conflicts(p_job_id, v_job.channel, nullif(btrim(p_external_account_id), ''), v_post, v_url) then
    raise exception 'EVIDENCE_CONFLICT: another job already holds this external post' using errcode = 'unique_violation';
  end if;

  select * into v_old from public.distribution_publication_evidence e
  where e.id = v_job.accepted_evidence_id and e.job_id = p_job_id
  for update;
  update public.distribution_publication_evidence
     set status = 'superseded', status_changed_by = p_actor_id, status_reason = p_correction_reason
   where id = v_old.id;
  v_new := public.distribution_insert_evidence(
    p_job_id, v_old.attempt_no, 'operator_manual', 'accepted', v_post, v_url, p_external_account_id,
    p_observed_at, p_actor_id, p_method_note, v_old.issues, v_old.id, p_correction_reason);

  perform public.distribution_set_event_context('admin', p_actor_id, 'evidence_corrected', p_correction_reason, null, null, v_new.id);
  update public.distribution_jobs
     set accepted_evidence_id = v_new.id, external_id = v_new.external_post_id, external_url = v_new.external_url
   where id = p_job_id;
  return v_new.id;
end;
$$;


-- ============================================================================
-- 5. 권한(GRANT) — 열 보호
-- ============================================================================
revoke all on table
  public.distribution_jobs, public.distribution_job_attempts, public.distribution_job_events,
  public.distribution_publication_evidence, public.distribution_reconciliations
from public, anon, authenticated, service_role;
revoke all on sequence public.distribution_job_events_id_seq from public, anon, authenticated, service_role;

-- service_role: 읽기만. 쓰기는 4절 함수만(DEFINER = owner 권한).
grant select on table
  public.distribution_jobs, public.distribution_job_attempts, public.distribution_job_events,
  public.distribution_publication_evidence, public.distribution_reconciliations
to service_role;

-- distribution_admin 읽기: authenticated 명시 열 SELECT(행은 RLS). anon 없음.
-- distribution_job_attempts.container_recorded_xact_id(내부 트랜잭션 ID)는 의도적으로 제외.
grant select (id, idempotency_key, content_id, content_version_id, content_version_no, draft_id, draft_revision_id,
              approval_id, content_approval_id, channel, mode, target_connection_id, target_external_account_id,
              status, phase, hold_reason, scheduled_at, schedule_tz, attempts, max_attempts, retry_policy,
              lease_owner, lease_expires_at, last_attempt_at, cancel_requested_at, accepted_evidence_id,
              external_id, external_url, has_issues, issues, last_error, reconciliation_required,
              last_reconciliation_id, created_by, version, created_at, updated_at)
  on public.distribution_jobs to authenticated;
grant select (id, job_id, attempt_no, mode, channel, worker_ref, phase_reached, provider_container_id,
              container_recorded_at, container_status, container_checked_at, publish_requested_at,
              publish_response_at, outcome, error_code, finished_at, created_at)
  on public.distribution_job_attempts to authenticated;
grant select (id, job_id, seq, from_status, to_status, from_phase, to_phase, from_hold, to_hold, actor_kind,
              actor_id, worker_ref, attempt_no, reason_code, summary, reconciliation_id, evidence_id, created_at)
  on public.distribution_job_events to authenticated;
grant select (id, job_id, channel, attempt_no, source, status, external_post_id, external_url, url_host,
              external_account_id, observed_at, recorded_by, method_note, issues, supersedes_id,
              correction_reason, status_changed_at, status_changed_by, status_reason, created_at)
  on public.distribution_publication_evidence to authenticated;
grant select (id, job_id, attempt_no, actor_kind, decided_by, method, finding, checked_scope, observed_at,
              observation, evidence_id, next_check_at, next_check_owner, created_at)
  on public.distribution_reconciliations to authenticated;

-- 내부 helper·트리거 함수: owner 외 실행 불가
revoke all on function public.distribution_assert_admin_actor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.distribution_assert_worker_ref(text) from public, anon, authenticated, service_role;
revoke all on function public.distribution_assert_issues(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.distribution_set_event_context(text, uuid, text, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.distribution_clear_event_context() from public, anon, authenticated, service_role;
revoke all on function public.distribution_effective_approval_id(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.distribution_job_basis_problem(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.distribution_live_gate(uuid) from public, anon, authenticated, service_role;
revoke all on function public.distribution_manual_evidence_host_allowed(text, text) from public, anon, authenticated, service_role;
revoke all on function public.distribution_evidence_conflicts(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.distribution_insert_evidence(uuid, integer, text, text, text, text, text, timestamptz,
                                                           uuid, text, jsonb, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.distribution_lock_job(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.distribution_normalize_error(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.distribution_jobs_before_insert() from public, anon, authenticated, service_role;
revoke all on function public.distribution_jobs_guard_update() from public, anon, authenticated, service_role;
revoke all on function public.distribution_jobs_record_event() from public, anon, authenticated, service_role;
revoke all on function public.distribution_assert_job_evidence() from public, anon, authenticated, service_role;
revoke all on function public.distribution_job_attempts_before_insert() from public, anon, authenticated, service_role;
revoke all on function public.distribution_job_attempts_guard_update() from public, anon, authenticated, service_role;
revoke all on function public.distribution_publication_evidence_before_insert() from public, anon, authenticated, service_role;
revoke all on function public.distribution_publication_evidence_guard_update() from public, anon, authenticated, service_role;
revoke all on function public.distribution_reconciliations_before_insert() from public, anon, authenticated, service_role;

-- API 함수: service_role만 (최소 EXECUTE)
revoke all on function public.distribution_create_job(uuid, uuid, text, timestamptz, text, integer, boolean)
  from public, anon, authenticated;
revoke all on function public.distribution_claim_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.distribution_advance_phase(uuid, uuid, text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.distribution_complete_attempt(uuid, uuid, text, text, jsonb, text, text, text, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.distribution_recover_expired_leases(integer) from public, anon, authenticated;
revoke all on function public.distribution_requeue_auto_retry(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.distribution_cancel_job(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.distribution_reschedule_job(uuid, uuid, integer, timestamptz, text) from public, anon, authenticated;
revoke all on function public.distribution_mark_manual_posted(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.distribution_record_manual_evidence(uuid, uuid, integer, text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.distribution_abandon_manual_job(uuid, uuid, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.distribution_mark_manual_uncertain(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.distribution_record_reconciliation(text, uuid, uuid, integer, text, text, jsonb, timestamptz,
                                                                 text, integer, text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.distribution_approve_rerun(uuid, uuid, integer, text, uuid, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.distribution_record_late_evidence(uuid, text, text, text, timestamptz, text, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.distribution_resolve_evidence(uuid, uuid, integer, uuid, text, text) from public, anon, authenticated;
revoke all on function public.distribution_correct_evidence(uuid, uuid, integer, text, text, text, timestamptz, text, text)
  from public, anon, authenticated;

grant execute on function public.distribution_create_job(uuid, uuid, text, timestamptz, text, integer, boolean) to service_role;
grant execute on function public.distribution_claim_jobs(text, integer, integer) to service_role;
grant execute on function public.distribution_advance_phase(uuid, uuid, text, text, text, text, integer) to service_role;
grant execute on function public.distribution_complete_attempt(uuid, uuid, text, text, jsonb, text, text, text, text, jsonb, text)
  to service_role;
grant execute on function public.distribution_recover_expired_leases(integer) to service_role;
grant execute on function public.distribution_requeue_auto_retry(uuid, timestamptz) to service_role;
grant execute on function public.distribution_cancel_job(uuid, uuid, integer, text) to service_role;
grant execute on function public.distribution_reschedule_job(uuid, uuid, integer, timestamptz, text) to service_role;
grant execute on function public.distribution_mark_manual_posted(uuid, uuid, integer) to service_role;
grant execute on function public.distribution_record_manual_evidence(uuid, uuid, integer, text, text, text, timestamptz, text)
  to service_role;
grant execute on function public.distribution_abandon_manual_job(uuid, uuid, integer, text, boolean) to service_role;
grant execute on function public.distribution_mark_manual_uncertain(uuid, uuid, integer, text) to service_role;
grant execute on function public.distribution_record_reconciliation(text, uuid, uuid, integer, text, text, jsonb, timestamptz,
                                                                    text, integer, text, text, text, timestamptz, text)
  to service_role;
grant execute on function public.distribution_approve_rerun(uuid, uuid, integer, text, uuid, timestamptz, text) to service_role;
grant execute on function public.distribution_record_late_evidence(uuid, text, text, text, timestamptz, text, integer, jsonb)
  to service_role;
grant execute on function public.distribution_resolve_evidence(uuid, uuid, integer, uuid, text, text) to service_role;
grant execute on function public.distribution_correct_evidence(uuid, uuid, integer, text, text, text, timestamptz, text, text)
  to service_role;


-- ============================================================================
-- 6. RLS — 승인된 배포 관리자 읽기만. 쓰기 정책 없음.
-- ============================================================================
alter table public.distribution_jobs enable row level security;
alter table public.distribution_job_attempts enable row level security;
alter table public.distribution_job_events enable row level security;
alter table public.distribution_publication_evidence enable row level security;
alter table public.distribution_reconciliations enable row level security;

create policy distribution_jobs_admin_read on public.distribution_jobs
  for select to authenticated using ((select private.is_distribution_admin()));
create policy distribution_job_attempts_admin_read on public.distribution_job_attempts
  for select to authenticated using ((select private.is_distribution_admin()));
create policy distribution_job_events_admin_read on public.distribution_job_events
  for select to authenticated using ((select private.is_distribution_admin()));
create policy distribution_publication_evidence_admin_read on public.distribution_publication_evidence
  for select to authenticated using ((select private.is_distribution_admin()));
create policy distribution_reconciliations_admin_read on public.distribution_reconciliations
  for select to authenticated using ((select private.is_distribution_admin()));

-- ============================================================================
-- API 목록 (service_role 전용 EXECUTE)
--   생성      distribution_create_job
--   워커      distribution_claim_jobs · distribution_advance_phase · distribution_complete_attempt ·
--             distribution_recover_expired_leases · distribution_requeue_auto_retry ·
--             distribution_record_late_evidence · distribution_record_reconciliation('worker', …)
--   admin     distribution_cancel_job · distribution_reschedule_job · distribution_mark_manual_posted ·
--             distribution_record_manual_evidence · distribution_abandon_manual_job ·
--             distribution_mark_manual_uncertain · distribution_record_reconciliation('admin', …) ·
--             distribution_approve_rerun · distribution_resolve_evidence · distribution_correct_evidence
--
-- DB 적용 전 필요한 별도 검증(이 작업에서 실행하지 않음)
--   * PGlite/로컬 Supabase에서 M0~M2 순차 적용(구문·순환 FK·지연 제약 트리거·identity 시퀀스 이름).
--   * 전이표 전 조합(허용/거부) · actor 경계 · 컨테이너 선커밋(같은/다른 트랜잭션) · partial unique 경합 ·
--     confirmed_absent 필수 필드 · rerun 가드 · 늦은 증거 → 플래그 → resolve 시험.
--   * grants/RLS 매트릭스: anon/authenticated(비admin·미승인 admin·승인 admin)/service_role 직접 DML 거부,
--     API 함수 EXECUTE가 service_role만인지, xid8 열 비노출.
--   * Supabase 실제 owner/기본 권한(postgres 소유, service_role BYPASSRLS, public 스키마 기본 EXECUTE) 확인.
--   * 앱 계약 갱신(별도 작업): PublishMode에 manual, JobStatus 3종, PublishError.autoRetry, checkDuplicate 열린 집합.
--
-- rollback 메모(실행 안 함): 데이터가 없을 때만 역순 drop(API 함수 → 트리거/트리거 함수 → events →
--   jobs의 evidence/reconciliation FK 해제 → reconciliations → evidence → attempts → jobs → helper).
--   증거·이벤트가 생긴 뒤에는 drop하지 않고 함수 교체(forward-fix)로 수정한다.
-- ============================================================================
