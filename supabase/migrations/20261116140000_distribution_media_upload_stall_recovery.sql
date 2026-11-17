-- ============================================================================
-- 통합 배포 — 미디어 직접 업로드: 소비 후 고착 자산 복구(forward only)
-- BE-UPLOAD-RECOVERY-030 · 2026-11-17 · CC-BACKEND-01 Claude(Backend)
-- 상태: 로컬 PGlite 대역(upload-recovery 시험)으로만 검증. 실제 Supabase 미적용. Cron 등 호출 주체 없음.
-- 의존: 120000(distribution_media_assets·가드), 130000(distribution_media_upload_grants). 기존 객체는 바꾸지 않는다.
--
-- 문제(BE-UPLOAD-RESUME-026 PGlite 재현)
--   완료 흐름이 grant를 consumed로 소비한 뒤 처리 결과(mark_received / complete / fail)를 기록하지 못하면
--   자산이 pending_upload 또는 processing으로 남는다. 130000의 만료 정리는 status='issued' grant만 보므로 닫지 않고,
--   대기 자산 상한(MEDIA_PENDING_LIMIT 20, pending_upload+processing)을 계속 점유한다.
--
-- 복구 전이
--   자산 pending_upload | processing → failed(failure_code 'UPLOAD_STALLED'), row_version + 1. grant는 consumed 그대로(130000 가드상 불변).
--
-- 대상(잠근 뒤의 최신 행으로 평가)
--   grant.status = 'consumed' AND grant.consumed_at <= now() - stall
--   AND asset.updated_at <= now() - stall            -- mark_received가 updated_at을 갱신 → 진행 중 processing 제외
--   AND asset.id = grant.asset_id AND asset.owner_id = grant.actor_id
--   AND asset.archived_at IS NULL AND asset.status IN ('pending_upload','processing')
--   비대상: ready · failed · archived · issued/cancelled/expired grant · grant 없는 자산(서버 직접 업로드 경로).
--
-- stall 기준
--   완료 라우트 maxDuration 60초, sharp 제한 10초 → 하한 600초(10배), 상한 86400초. 권장 호출값 900초.
--   자가 호스팅 등 maxDuration이 강제되지 않는 실행에서는 600초 넘게 살아 있는 처리가 실패 처리될 수 있다(덮어쓰기는 아래로 방지).
--
-- 잠금·경합
--   * 자산 행만 FOR UPDATE OF a SKIP LOCKED — 대기하지 않으므로 정상 완료·취소·만료 정리와 교착이 생기지 않는다.
--     consumed grant는 종단 상태(가드가 변경 거부)라 잠그지 않는다(FOR SHARE도 불필요).
--   * 갱신은 WHERE id AND row_version = 잠근 값 AND status IN (...) — 이중 조건.
--   * 정상 전이(mark_received·complete·fail)는 모두 expected row_version + FOR UPDATE:
--       복구가 먼저 커밋 → 늦은 정상 전이는 VERSION_CONFLICT(앱 uncertain, ready 덮어쓰기 불가, 원본 삭제 없음).
--       정상 전이가 먼저 커밋 → 복구가 잠근 뒤 재평가에서 ready/failed 또는 updated_at 최신이라 건너뜀.
--   * 반복 실행 멱등: 이미 failed면 대상이 아니다.
--   * Storage 원본·변형 삭제는 하지 않는다(후속 sweep 범위).
-- 오류: 인자 범위 위반 invalid_parameter_value(22023).
-- ============================================================================

create index if not exists distribution_media_upload_grants_consumed_idx
  on public.distribution_media_upload_grants (consumed_at) where status = 'consumed';

create or replace function public.distribution_recover_stalled_media_uploads(p_limit integer, p_stall_seconds integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
  v_cutoff timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'limit must be 1..500' using errcode = 'invalid_parameter_value';
  end if;
  if p_stall_seconds is null or p_stall_seconds not between 600 and 86400 then
    raise exception 'stall seconds must be 600..86400' using errcode = 'invalid_parameter_value';
  end if;
  v_cutoff := now() - pg_catalog.make_interval(secs => p_stall_seconds);
  for r in
    select a.id, a.row_version
      from public.distribution_media_assets a
      join public.distribution_media_upload_grants g on g.asset_id = a.id
     where g.status = 'consumed'
       and g.consumed_at <= v_cutoff
       and g.actor_id = a.owner_id
       and a.archived_at is null
       and a.status in ('pending_upload', 'processing')
       and a.updated_at <= v_cutoff
     order by g.consumed_at, a.id
     limit p_limit
     for update of a skip locked
  loop
    update public.distribution_media_assets x
       set status = 'failed', failure_code = 'UPLOAD_STALLED', row_version = x.row_version + 1
     where x.id = r.id and x.row_version = r.row_version
       and x.archived_at is null and x.status in ('pending_upload', 'processing');
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.distribution_recover_stalled_media_uploads(integer, integer) from public, anon, authenticated;
grant execute on function public.distribution_recover_stalled_media_uploads(integer, integer) to service_role;
