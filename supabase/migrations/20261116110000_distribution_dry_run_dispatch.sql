-- ============================================================================
-- 통합 배포 — dry_run 작업 1건 관리자 수동 선점(claim)
-- AUTOPOST-DRYRUN-EXEC-020 · 2026-11-17 · CC-ENG (Claude Code)
-- 상태: 로컬 PGlite 대역(dry-run-exec-run.mjs)으로만 검증. 실제 Supabase 미적용.
-- 의존: 000000~100000. 기존 함수·트리거·가드는 바꾸지 않는다(guard 우회·트리거 해제 없음).
--
-- 왜 필요한가: 기존 distribution_claim_jobs는 조건에 맞는 작업을 임의로(오래된 순) 집는다 → 관리자가 고른 작업이 아니라
--   다른 작업·live 작업을 잡을 수 있다. 이 함수는 **지정한 job id 1건만**, 렌더된 expected_version·mode=dry_run·
--   승인된 관리자 actor(D1)를 확인한 뒤 distribution_claim_jobs와 같은 규칙으로 선점한다.
-- 동등성(claim_jobs의 scheduled 분기를 그대로 따른다)
--   * 대상 조건: status=scheduled, hold_reason 없음, reconciliation_required 아님, coalesce(scheduled_at, created_at) <= now().
--   * 근거 재검사: distribution_job_basis_problem(승인·철회·최신성·보관). 문제가 있으면 같은 hold 매핑을 걸고 선점하지 않는다
--     (system 컨텍스트 'claim_precheck_hold' — claim_jobs와 동일). live gate는 dry_run과 무관(live는 MODE_MISMATCH로 거부).
--   * 선점: worker 컨텍스트 'claimed'(가드가 scheduled→dispatching을 자동 주체에게만 허용), attempts+1, lease_owner/만료,
--     last_attempt_at, attempt 행 삽입 — claim_jobs와 같은 갱신. 이후 단계·완료는 기존 advance_phase / complete_attempt만 쓴다.
--   * 동시성: distribution_lock_job(FOR UPDATE)으로 같은 행을 직렬화 → 두 번째 호출은 VERSION_CONFLICT 또는 INVALID_TRANSITION.
-- 반환: 선점 성공 시 attempt와 실행에 필요한 승인 리비전 본문(서버 내부 전용 — service_role만 호출 가능).
-- ============================================================================

create or replace function public.distribution_claim_dry_run_job(
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_worker_id text,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.distribution_jobs;
  v_problem text;
  v_attempt_id uuid;
  v_body text;
  v_link text;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  perform public.distribution_assert_worker_ref(p_worker_id);
  if p_lease_seconds is null or p_lease_seconds not between 10 and 300 then
    raise exception 'lease_seconds must be 10..300' using errcode = 'invalid_parameter_value';
  end if;
  if p_expected_version is null then
    raise exception 'expected version is required' using errcode = 'invalid_parameter_value';
  end if;

  v_job := public.distribution_lock_job(p_job_id, p_expected_version);
  if v_job.mode <> 'dry_run' then
    raise exception 'MODE_MISMATCH: only dry-run jobs can be run manually' using errcode = 'check_violation';
  end if;
  -- 이번 실행기는 Threads 텍스트 모의 실행만 지원한다(다른 채널은 선점하지 않고 그대로 둔다)
  if v_job.channel <> 'threads' then
    raise exception 'CHANNEL_NOT_SUPPORTED: manual dry-run supports threads only' using errcode = 'check_violation';
  end if;
  if v_job.status <> 'scheduled' then
    raise exception 'INVALID_TRANSITION: job is % (only scheduled dry-run jobs run)', v_job.status using errcode = 'check_violation';
  end if;
  if v_job.hold_reason is not null then
    raise exception 'INVALID_TRANSITION: job is on hold (%)', v_job.hold_reason using errcode = 'check_violation';
  end if;
  if v_job.reconciliation_required then
    raise exception 'INVALID_TRANSITION: job needs reconciliation' using errcode = 'check_violation';
  end if;
  if coalesce(v_job.scheduled_at, v_job.created_at) > now() then
    raise exception 'NOT_DUE: job is scheduled for the future' using errcode = 'check_violation';
  end if;

  v_problem := public.distribution_job_basis_problem(v_job.draft_revision_id, v_job.approval_id, v_job.content_approval_id);
  if v_problem is not null then
    perform public.distribution_set_event_context('system', null, 'claim_precheck_hold', v_problem, p_worker_id);
    update public.distribution_jobs
       set hold_reason = case
             when v_problem in ('approval_mismatch', 'approval_revoked') then 'approval_revoked'
             else 'stale' end
     where id = v_job.id;
    return pg_catalog.jsonb_build_object('claimed', false,
      'hold_reason', case when v_problem in ('approval_mismatch', 'approval_revoked') then 'approval_revoked' else 'stale' end);
  end if;

  perform public.distribution_set_event_context('worker', null, 'claimed',
    pg_catalog.format('manual dry-run requested by admin %s', p_actor_id), p_worker_id);
  update public.distribution_jobs
     set status = 'dispatching',
         attempts = v_job.attempts + 1,
         lease_owner = p_worker_id,
         lease_expires_at = now() + pg_catalog.make_interval(secs => p_lease_seconds),
         last_attempt_at = now()
   where id = v_job.id;
  insert into public.distribution_job_attempts (job_id, attempt_no, mode, channel, worker_ref)
  values (v_job.id, v_job.attempts + 1, v_job.mode, v_job.channel, p_worker_id)
  returning id into v_attempt_id;

  select r.body, r.link_url into v_body, v_link from public.distribution_draft_revisions r where r.id = v_job.draft_revision_id;
  return pg_catalog.jsonb_build_object(
    'claimed', true, 'job_id', v_job.id, 'attempt_id', v_attempt_id, 'attempt_no', v_job.attempts + 1,
    'channel', v_job.channel, 'body', v_body, 'link_url', v_link);
end;
$$;

revoke all on function public.distribution_claim_dry_run_job(uuid, uuid, integer, text, integer) from public, anon, authenticated;
grant execute on function public.distribution_claim_dry_run_job(uuid, uuid, integer, text, integer) to service_role;
