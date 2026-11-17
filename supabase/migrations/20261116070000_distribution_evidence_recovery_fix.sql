-- ============================================================================
-- 통합 배포 M2 보정 — 증거 URL 정규화 충돌 경계(D-1) · 리스 만료 회수 정합성/격리(D-2, D-2b)
-- AUTOPOST-M2-FIX-006 · 2026-11-17 · CC-ENG (Claude Code)
-- 근거: .ai/results/AUTOPOST-M2-VERIFY-003-CC-ENG.md §4 (D-1, D-2, D-2b 재현), Codex master 수정 배정.
-- 상태: 로컬 PGlite 대역(web/scripts/distribution-local-verify)으로만 검증. 실제 Supabase 미적용.
-- 의존: M0~M2+050000(+060000과 독립 — 060000 객체를 참조·변경하지 않음).
--
-- D-1 (증거 URL 충돌을 원문 문자열로 비교 → 호스트 대소문자로 같은 게시물 중복 accepted)
--   * public.distribution_canonical_url(text): scheme·host(포트 포함 authority)만 소문자로 바꾼다.
--     경로·쿼리·프래그먼트는 그대로 둔다(대소문자 구분 유지). 포트는 지우거나 바꾸지 않는다.
--     사용자정보(@)·공백이 든 authority, https가 아닌 값은 바꾸지 않고 그대로 돌려준다
--     (형식 판정은 기존 테이블 check와 허용 호스트 규칙이 계속 담당하며, 이 함수는 규칙을 약화하지 않는다).
--   * 충돌 helper(distribution_evidence_conflicts)와 accepted URL UNIQUE 경계가 같은 canonical 값을 쓴다.
--     UNIQUE는 표현식 인덱스로 바꾼다. 원문 열(external_url)·불변 트리거·기존 행은 건드리지 않는다
--     (감사 증거 원문 보존: UPDATE·트리거 우회 없음, 열 추가·테이블 재작성 없음).
--   * 사전 점검: 기존 accepted 증거에 canonical 기준 중복이 있으면 이 migration은 명시적으로 실패한다
--     (D1_CANONICAL_URL_DUPLICATES, unique_violation). 자동 삭제·재배정·정규화 갱신은 하지 않는다.
--     → 운영자가 resolve/correct 절차로 정리한 뒤 다시 적용한다.
--
-- D-2 (dry_run이 publish_requested 이후 만료 → recover가 retry_policy='auto'를 넣다가 가드에 거부)
--   * 최소안 (a): dry_run publish 요청 후 만료는 failed + retry_policy='operator_only' +
--     last_error {code:'LEASE_EXPIRED_AFTER_PUBLISH_REQUEST', retryable:true, autoRetry:false}.
--     가드("publish 요청 후 auto 금지")와 complete_attempt 규칙은 바꾸지 않는다.
--     live publish 요청 후 만료 → unknown, 컨테이너 전 만료 → failed(auto) 규칙은 그대로 유지한다.
-- D-2b (한 작업 오류가 배치 전체를 롤백하고, 만료 순서 맨 앞에 남아 이후 작업 회수를 계속 막음)
--   * 작업별 처리를 서브트랜잭션(BEGIN … EXCEPTION)으로 격리한다. 실패한 작업은 그 작업만 롤백하고
--     다음 작업을 계속 처리한다.
--   * 침묵 은폐 금지: 실패한 작업도 결과 행으로 돌려준다 —
--       recovered_job_id = 그 작업 ID, recovered_status = 'recovery_failed:<SQLSTATE>'
--     (오류 메시지 본문은 넣지 않는다: 비밀·원문 노출 방지). 같은 내용을 RAISE WARNING으로도 남긴다.
--     호출 서버는 'recovery_failed:' 접두어를 경보로 처리해야 한다. 실패 작업은 dispatching에 남으므로
--     다음 호출에서도 다시 보고된다(조용히 사라지지 않음).
--   * 한계: p_limit 안이 전부 실패 작업이면 그 호출에서는 뒤 작업까지 닿지 않는다(실패 행이 그만큼 반환되어
--     드러난다). 실패 작업을 순서에서 건너뛰는 상태 표시는 별도 설계가 필요해 이번 최소안에 넣지 않았다.
--
-- 호환: 함수 이름·인자·반환 타입 동일(CREATE OR REPLACE — 기존 ACL 유지, search_path = '' 유지).
--   새 helper distribution_canonical_url은 owner 외 EXECUTE 없음(다른 helper와 같은 원칙).
-- rollback 메모(실행 안 함): 이전 정의로 CREATE OR REPLACE, canonical 인덱스 drop 후 원래 raw 인덱스 재생성.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. D-1 canonical URL helper
-- ----------------------------------------------------------------------------
create or replace function public.distribution_canonical_url(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_url is null then null
           -- https + authority(사용자정보·공백·구분자 없음)일 때만 scheme·authority를 소문자로. 나머지는 원문 그대로.
           when p_url ~* '^https://[^/?#@[:space:]]+([/?#].*)?$'
             then 'https://'
                  || lower(substring(p_url from '^(?:[Hh][Tt][Tt][Pp][Ss])://([^/?#@[:space:]]+)'))
                  || coalesce(substring(p_url from '^(?:[Hh][Tt][Tt][Pp][Ss])://[^/?#@[:space:]]+(.*)$'), '')
           else p_url
         end;
$$;

revoke all on function public.distribution_canonical_url(text) from public, anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2. D-1 사전 점검: 기존 accepted 증거의 canonical 중복이 있으면 명시 실패(데이터 무변경)
-- ----------------------------------------------------------------------------
do $$
declare
  v_groups integer;
  v_rows integer;
begin
  select count(*), coalesce(sum(d.n), 0) into v_groups, v_rows
  from (
    select e.channel, public.distribution_canonical_url(e.external_url) as c, count(*) as n
    from public.distribution_publication_evidence e
    where e.status = 'accepted' and e.external_url is not null
    group by 1, 2
    having count(*) > 1
  ) d;
  if v_groups > 0 then
    raise exception 'D1_CANONICAL_URL_DUPLICATES: % group(s) / % accepted evidence row(s) share a canonical URL', v_groups, v_rows
      using errcode = 'unique_violation',
            hint = 'No data was changed. Review with: select channel, public.distribution_canonical_url(external_url), array_agg(id) '
                || 'from public.distribution_publication_evidence where status = ''accepted'' and external_url is not null '
                || 'group by 1, 2 having count(*) > 1; resolve via distribution_correct_evidence, then re-apply.';
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. D-1 UNIQUE 경계 교체: raw external_url → canonical 표현식(같은 helper)
--    raw가 같으면 canonical도 같으므로 새 경계는 기존보다 엄격하다(약화 없음).
-- ----------------------------------------------------------------------------
create unique index distribution_publication_evidence_accepted_url_canonical_unique
  on public.distribution_publication_evidence (channel, public.distribution_canonical_url(external_url))
  where status = 'accepted' and external_url is not null;
drop index public.distribution_publication_evidence_accepted_url_unique;


-- ----------------------------------------------------------------------------
-- 4. D-1 충돌 helper: URL 비교를 canonical로(시그니처·반환·ACL 동일)
-- ----------------------------------------------------------------------------
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
        or (p_external_url is not null
            and public.distribution_canonical_url(e.external_url) = public.distribution_canonical_url(p_external_url)))
  );
$$;


-- ----------------------------------------------------------------------------
-- 5. D-2 / D-2b 리스 만료 회수(시그니처·반환 타입·ACL 동일)
-- ----------------------------------------------------------------------------
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
  v_status text;
  v_state text;
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
    begin  -- 작업별 서브트랜잭션: 이 작업 실패는 이 작업 변경만 롤백
      select * into v_att from public.distribution_job_attempts a
      where a.job_id = v_job.id and a.attempt_no = v_job.attempts
      for update;
      if not found or v_att.outcome <> 'pending' then
        raise exception 'job % has no pending current attempt', v_job.id using errcode = 'check_violation';
      end if;

      if v_att.publish_requested_at is not null or v_job.phase in ('publish_requested', 'confirming') then
        if v_job.mode = 'live' then
          -- live: publish 요청 후 만료 → unknown(자동 재전송 금지, 대사로만 진행). 기존 규칙 유지.
          update public.distribution_job_attempts set outcome = 'unknown' where id = v_att.id;
          perform public.distribution_set_event_context('system', null, 'lease_expired_after_publish_request');
          update public.distribution_jobs
             set status = 'unknown',
                 last_error = jsonb_build_object('code', 'LEASE_EXPIRED_AFTER_PUBLISH_REQUEST',
                                                 'retryable', false, 'autoRetry', false),
                 lease_owner = null, lease_expires_at = null
           where id = v_job.id;
          v_status := 'unknown';
        else
          -- dry_run: publish 요청 후 만료 → failed(operator_only, autoRetry=false). 가드의 "publish 요청 후 auto 금지" 유지.
          update public.distribution_job_attempts
             set outcome = 'failed', error_code = 'LEASE_EXPIRED_AFTER_PUBLISH_REQUEST' where id = v_att.id;
          perform public.distribution_set_event_context('system', null, 'lease_expired_after_publish_request');
          update public.distribution_jobs
             set status = 'failed', retry_policy = 'operator_only',
                 last_error = jsonb_build_object('code', 'LEASE_EXPIRED_AFTER_PUBLISH_REQUEST',
                                                 'retryable', true, 'autoRetry', false),
                 lease_owner = null, lease_expires_at = null
           where id = v_job.id;
          v_status := 'failed';
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
        v_status := 'failed';
      end if;
    exception when others then
      -- 침묵 은폐 금지: 실패 작업 ID + SQLSTATE만 보고(메시지 본문 제외). 이벤트 컨텍스트 잔여물 제거.
      get stacked diagnostics v_state = returned_sqlstate;
      perform public.distribution_clear_event_context();
      raise warning 'distribution_recover_expired_leases: job % recovery failed (SQLSTATE %)', v_job.id, v_state;
      v_status := 'recovery_failed:' || v_state;
    end;
    recovered_job_id := v_job.id;
    recovered_status := v_status;
    return next;
  end loop;
end;
$$;

-- 명시 재확인(CREATE OR REPLACE는 ACL을 유지하지만 계약을 문서화한다)
revoke all on function public.distribution_recover_expired_leases(integer) from public, anon, authenticated;
grant execute on function public.distribution_recover_expired_leases(integer) to service_role;
revoke all on function public.distribution_evidence_conflicts(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
