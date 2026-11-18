-- ============================================================================
-- 통합 배포 — AI 초안 생성 요청 수 예약(사용량 한도) (forward only)
-- DRAFT-GEN-QUOTA · 2026-11-18 · Claude(Backend)
-- 상태: 로컬 PGlite 대역으로만 검증. 실제 Supabase 미적용(적용은 별도 승인). 기존 migration·함수는 바꾸지 않는다.
-- 의존: 000000~160000(public.distribution_assert_admin_actor 재사용).
--
-- 목적: 유료 생성 호출 **직전**에 요청 1건을 예약(기록)하고, 관리자별·프로젝트 전체 요청 수 상한을 원자적으로 강제한다.
--   * 요청 수 상한이지 비용(금액) 예산이 아니다. 금액 상한은 공급자 프로젝트 예산(hard limit)과 요청당 토큰 상한으로 따로 막는다.
--   * 예약은 공급자 결과와 무관하게 남는다(timeout·응답 유실도 과금됐을 수 있음 → 재시도로 한도를 넘지 못하게). 환불 없음.
--   * 저장하는 것: 예약 id·actor·채널·모델·시각뿐. 원문·초안 본문·토큰·키·공급자 응답은 저장하지 않는다.
-- 창(window): 최근 60초(분당)·최근 24시간(일당), 모두 now() 기준 이동 창(시간대 무관).
-- 원자성: 모든 예약을 트랜잭션 advisory lock 하나로 직렬화한 뒤 세고 넣는다 → 동시 호출에서도 상한을 넘지 않는다.
--   (생성은 사람 클릭 단위의 저빈도 작업이라 전역 직렬화 비용은 무시할 수준)
-- 권한: 테이블은 어떤 공개 역할도 직접 접근 불가(RLS + 권한 회수). 함수는 service_role만 실행.
-- ============================================================================

create table public.distribution_generation_reservations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users (id) on delete restrict,
  channel text not null check (channel in ('blog', 'threads', 'instagram', 'common')),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  created_at timestamptz not null default now()
);
create index distribution_generation_reservations_actor_idx on public.distribution_generation_reservations (actor_id, created_at desc);
create index distribution_generation_reservations_time_idx on public.distribution_generation_reservations (created_at desc);

alter table public.distribution_generation_reservations enable row level security;
revoke all on table public.distribution_generation_reservations from public, anon, authenticated, service_role;

-- 예약 불변(수정·삭제 금지 — 한도 우회 방지). 보존 기간 정리는 별도 운영 결정(소유자 권한 작업).
create or replace function public.distribution_generation_reservations_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'generation reservations are append-only' using errcode = 'restrict_violation';
end;
$$;
create trigger distribution_generation_reservations_no_update
  before update or delete on public.distribution_generation_reservations
  for each row execute function public.distribution_generation_reservations_immutable();

-- 반환: {reserved:true, reservation_id} | {reserved:false, scope, retry_after_seconds}
--   scope: actor_minute | actor_day | global_minute | global_day
create or replace function public.distribution_reserve_generation_quota(
  p_actor_id uuid,
  p_channel text,
  p_model text,
  p_actor_per_minute integer,
  p_actor_per_day integer,
  p_global_per_minute integer,
  p_global_per_day integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_n integer;
  v_limit integer;
  v_scope text;
  v_window interval;
  v_oldest timestamptz;
  v_id uuid;
  r record;
begin
  perform public.distribution_assert_admin_actor(p_actor_id);
  if p_channel is null or p_channel not in ('blog', 'threads', 'instagram', 'common') then
    raise exception 'invalid channel' using errcode = 'invalid_parameter_value';
  end if;
  if p_model is null or p_model !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' then
    raise exception 'invalid model' using errcode = 'invalid_parameter_value';
  end if;
  -- 상한 범위(앱 설정과 같은 규칙). 관리자 상한은 전체 상한 이하, 분당은 일당 이하.
  if p_actor_per_minute is null or p_actor_per_minute not between 1 and 30
     or p_actor_per_day is null or p_actor_per_day not between 1 and 500
     or p_global_per_minute is null or p_global_per_minute not between 1 and 120
     or p_global_per_day is null or p_global_per_day not between 1 and 5000
     or p_actor_per_minute > p_actor_per_day or p_global_per_minute > p_global_per_day
     or p_actor_per_minute > p_global_per_minute or p_actor_per_day > p_global_per_day then
    raise exception 'QUOTA_LIMITS_INVALID: generation limits out of range' using errcode = 'invalid_parameter_value';
  end if;

  -- 전역 직렬화(같은 트랜잭션 동안 다른 예약 대기)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('distribution_generation_quota', 0));

  for r in
    select * from (values
      ('actor_minute', p_actor_per_minute, interval '60 seconds', true),
      ('actor_day', p_actor_per_day, interval '24 hours', true),
      ('global_minute', p_global_per_minute, interval '60 seconds', false),
      ('global_day', p_global_per_day, interval '24 hours', false)
    ) as t(scope, lim, win, per_actor)
  loop
    v_scope := r.scope; v_limit := r.lim; v_window := r.win;
    select count(*) into v_n from public.distribution_generation_reservations g
    where g.created_at > v_now - v_window and (not r.per_actor or g.actor_id = p_actor_id);
    if v_n >= v_limit then
      -- 다시 1건이 비는 시각: 창 안 예약 중 (n - limit + 1)번째로 오래된 예약이 창을 벗어나는 때
      select g.created_at into v_oldest from public.distribution_generation_reservations g
      where g.created_at > v_now - v_window and (not r.per_actor or g.actor_id = p_actor_id)
      order by g.created_at asc, g.id asc
      offset (v_n - v_limit) limit 1;
      return pg_catalog.jsonb_build_object('reserved', false, 'scope', v_scope,
        'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_oldest + v_window - v_now)))::integer));
    end if;
  end loop;

  insert into public.distribution_generation_reservations (actor_id, channel, model)
  values (p_actor_id, p_channel, p_model)
  returning id into v_id;
  return pg_catalog.jsonb_build_object('reserved', true, 'reservation_id', v_id);
end;
$$;

revoke all on function public.distribution_generation_reservations_immutable() from public, anon, authenticated, service_role;
revoke all on function public.distribution_reserve_generation_quota(uuid, text, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.distribution_reserve_generation_quota(uuid, text, text, integer, integer, integer, integer) to service_role;
