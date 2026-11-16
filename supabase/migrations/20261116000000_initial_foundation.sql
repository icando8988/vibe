-- =====================================================================
-- 초기 기반 migration
--   DEV-001 작성 (CC-ENG-01, 2026-11-16) · DEV-003 권한 보강 (같은 날)
-- 상태: 실제 Supabase 프로젝트에는 적용한 적 없음. 원격/계정 연결 금지 범위.
--       격리 실행 검증은 tests/db (Supabase 대체 스텁 + PGlite) 기준이며 결과는 docs/DB_VERIFICATION.md 참조.
--       이 파일은 아직 어떤 공유 DB에도 적용되지 않았으므로 DEV-003에서 새 migration을 덧붙이지 않고 직접 수정했다.
--
-- 범위: 사용자(profiles) · 역할 · 프로젝트 · 책 · 캠페인 · 주문(네 상태축) · 입금/환불 기록 · 감사.
-- 원칙:
--   * 금액은 원 단위 bigint, 수량은 양의 정수, 시각은 timestamptz(UTC 저장).
--   * 상태값은 enum 대신 text + check (정책 확정 시 migration으로 쉽게 조정).
--   * 행 보호 = RLS, 열 보호 = 권한(GRANT). RLS는 '어떤 행'만 거르고 '어떤 열'은 거르지 않으므로
--     Supabase 기본 권한(anon/authenticated에 테이블 ALL)을 먼저 모두 회수하고, 노출할 열만 다시 GRANT 한다.
--     → 클라이언트는 `select *`가 아니라 허용된 열을 명시해 조회해야 한다.
--   * 내부 열(대사 참조·처리자·지급 참조·내부 메모·소유자 등)은 클라이언트 역할에 열 권한을 주지 않는다.
--     관리자가 내부 열을 보는 경로는 DEV-007 서버(역할 재확인 후 service_role)로 한정한다.
--   * 클라이언트(anon/authenticated)의 거래 쓰기는 권한·정책 모두 없음. DEV-005의 검증 DB 함수로만 연다.
--   * POLICY-PENDING 주석: 사업 결정(DEC-001~005) 전이라 의도적으로 확정하지 않은 부분.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 공통: updated_at 자동 갱신 (트리거 전용)
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 사용자 프로필 (auth.users 1:1). 이메일은 auth 원본을 쓰고 복제하지 않는다.
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 40),
  -- 원문: 가입 후 관리자 승인. POLICY-PENDING(DEC-005): 사전승인 유지 여부.
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected', 'suspended')),
  approval_changed_by uuid references auth.users (id),   -- 내부 열
  approval_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 역할. 사용자가 스스로 admin/seller가 될 수 없도록 클라이언트 쓰기 권한 없음.
-- seller는 B안(DEC-001) 확정 전 부여하지 않는다.
-- ---------------------------------------------------------------------
create table public.role_assignments (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'seller')),
  granted_by uuid references auth.users (id),             -- 내부 열
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- 역할 확인 헬퍼. security definer + 빈 search_path(모든 참조는 스키마 지정). 호출자 본인만 판정한다.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.role_assignments ra
    where ra.user_id = (select auth.uid()) and ra.role = 'admin'
  );
$$;

create or replace function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.approval_status = 'approved'
  );
$$;

-- ---------------------------------------------------------------------
-- 프로젝트(도전). 계획 값과 실적 값을 구분한다.
-- ---------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  summary text,
  planned_departure date,           -- 계획값. 실제 출발은 별도 기록(후속)
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 책
-- ---------------------------------------------------------------------
create table public.books (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  format text not null check (format in ('ebook', 'print')),
  description text,
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index books_project_idx on public.books (project_id);
create trigger books_updated_at before update on public.books
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 캠페인. 검토 상태 / 모집 상태 / 목표 / 재고를 분리한다.
-- 참여 전 사전 고지해야 하는 정책 필드(1인 상한·입금기한·목표 기준)는 공개 열이다(계획 19.3).
-- 운영 내부 열: owner_id, reservation_ttl(만료 계산용 내부 값; 고지는 화면 문구로), created/updated 메타.
-- ---------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete restrict,
  owner_id uuid references auth.users (id),   -- 내부 열. A안: 운영자. B안 seller는 DEC-001 후
  channel text not null check (channel in ('direct', 'external')),
  external_url text check (external_url is null or external_url ~ '^https://'),
  unit_price_krw bigint check (unit_price_krw is null or unit_price_krw >= 0),
  shipping_fee_krw bigint not null default 0 check (shipping_fee_krw >= 0),
  min_goal_qty integer check (min_goal_qty is null or min_goal_qty > 0),
  max_qty integer check (max_qty is null or max_qty > 0),   -- null = 무제한(남은 수량 표시 안 함)
  -- POLICY-PENDING(DEC-003): 목표 집계 기준. null이면 미확정이며 목표 알림·제작 확정을 하지 않는다.
  goal_basis text check (goal_basis is null or goal_basis in ('verified', 'applied')),
  -- POLICY-PENDING(DEC-003): 1인 상한·예약 만료·입금기한
  per_user_limit integer check (per_user_limit is null or per_user_limit > 0),
  reservation_ttl interval check (reservation_ttl is null or reservation_ttl > interval '0'),  -- 내부 열
  payment_deadline_at timestamptz,
  opens_at timestamptz,
  closes_at timestamptz,
  review_status text not null default 'draft'
    check (review_status in ('draft', 'pending_review', 'approved', 'rejected')),
  recruitment_status text not null default 'scheduled'
    check (recruitment_status in ('scheduled', 'open', 'closed', 'cancelled')),
  goal_first_reached_at timestamptz,   -- 최초 달성 1회 기록(재달성 자동 재알림 없음)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_window check (opens_at is null or closes_at is null or closes_at > opens_at),
  constraint campaigns_goal_le_max check (min_goal_qty is null or max_qty is null or max_qty >= min_goal_qty),
  constraint campaigns_channel_fields check (
    (channel = 'external' and external_url is not null)
    or (channel = 'direct' and external_url is null)
  ),
  -- 승인된 직접 판매는 가격·일정이 있어야 한다(가짜 금액으로 열지 않음).
  constraint campaigns_direct_ready check (
    not (channel = 'direct' and review_status = 'approved')
    or (unit_price_krw is not null and opens_at is not null and closes_at is not null)
  )
);
create index campaigns_book_idx on public.campaigns (book_id);
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 주문(참여). 네 상태축을 별도 열로 둔다. 금액은 주문 시점 스냅샷.
-- ---------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  book_format text not null check (book_format in ('ebook', 'print')),
  quantity integer not null check (quantity > 0),
  unit_price_krw bigint not null check (unit_price_krw >= 0),
  subtotal_krw bigint not null check (subtotal_krw >= 0),
  shipping_fee_krw bigint not null default 0 check (shipping_fee_krw >= 0),
  discount_krw bigint not null default 0 check (discount_krw >= 0),
  total_krw bigint not null check (total_krw >= 0),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  policy_version text,               -- 신청 시 동의한 정책 버전(DEC 확정 후 필수화)

  order_status text not null default 'active'
    check (order_status in ('active', 'cancellation_requested', 'cancelled', 'expired', 'completed')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'reported', 'verified', 'mismatch')),
  fulfillment_status text not null default 'not_ready'
    check (fulfillment_status in ('not_ready', 'preparing', 'ready', 'shipped', 'delivered', 'released')),
  refund_status text not null default 'none'
    check (refund_status in ('none', 'requested', 'processing', 'completed', 'rejected')),

  inventory_released_at timestamptz, -- 내부 열. 취소/만료 시 재고 복원 1회 기록(중복 복원 방지)
  expires_at timestamptz,            -- POLICY-PENDING(DEC-003) 예약 만료 시각
  version integer not null default 1, -- 낙관적 동시성(기대 버전 비교). 갱신 시 트리거가 +1
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_idempotency_unique unique (user_id, idempotency_key),
  constraint orders_amount_math check (
    subtotal_krw = unit_price_krw * quantity
    and total_krw = subtotal_krw + shipping_fee_krw - discount_krw
    and discount_krw <= subtotal_krw + shipping_fee_krw
  ),
  constraint orders_ebook_no_shipping check (book_format <> 'ebook' or shipping_fee_krw = 0),
  -- 아래 불변식은 src/lib/domain/order-states.ts checkInvariants와 동일하다(tests/db에서 전 조합 대조).
  constraint orders_fulfill_requires_verified check (
    fulfillment_status not in ('shipped', 'delivered', 'released') or payment_status = 'verified'
  ),
  constraint orders_format_fulfillment check (
    (book_format = 'ebook' and fulfillment_status not in ('shipped', 'delivered'))
    or (book_format = 'print' and fulfillment_status <> 'released')
  ),
  constraint orders_refund_requires_money check (
    refund_status = 'none' or payment_status in ('verified', 'mismatch')
  ),
  constraint orders_cancel_paid_needs_refund check (
    not (order_status = 'cancelled' and payment_status = 'verified' and refund_status = 'none')
  ),
  constraint orders_expired_not_verified check (
    not (order_status = 'expired' and payment_status = 'verified')
  ),
  constraint orders_completed_delivered check (
    order_status <> 'completed' or fulfillment_status in ('delivered', 'released')
  ),
  constraint orders_released_once check (
    inventory_released_at is null or order_status in ('cancelled', 'expired')
  )
);
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_campaign_active_idx on public.orders (campaign_id)
  where order_status in ('active', 'cancellation_requested', 'completed');
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- 종료 상태 보호: 어떤 경로(service_role 직접 갱신 포함)로도 종료 상태에서 되돌릴 수 없다.
-- TS 전이표(order-states.ts)의 종료 상태와 같다. 정상 전이 검증 자체는 DEV-005 함수가 담당한다.
-- 주문 금액·소유자·캠페인·멱등키 등 신청 시점 스냅샷도 변경 금지.
create or replace function public.orders_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.order_status in ('cancelled', 'expired', 'completed') and new.order_status <> old.order_status then
    raise exception 'order_status % is terminal', old.order_status using errcode = 'check_violation';
  end if;
  if old.payment_status = 'verified' and new.payment_status <> old.payment_status then
    raise exception 'payment_status verified is terminal' using errcode = 'check_violation';
  end if;
  if old.fulfillment_status in ('delivered', 'released') and new.fulfillment_status <> old.fulfillment_status then
    raise exception 'fulfillment_status % is terminal', old.fulfillment_status using errcode = 'check_violation';
  end if;
  if old.refund_status in ('completed', 'rejected') and new.refund_status <> old.refund_status then
    raise exception 'refund_status % is terminal', old.refund_status using errcode = 'check_violation';
  end if;
  -- 취소·만료 뒤 늦은 입금은 mismatch로만 기록(자동 verified 금지, M05).
  if new.order_status in ('cancelled', 'expired') and old.order_status = new.order_status
     and new.payment_status = 'verified' and old.payment_status <> 'verified' then
    raise exception 'late payment on closed order must be recorded as mismatch' using errcode = 'check_violation';
  end if;
  if row(new.campaign_id, new.user_id, new.book_format, new.quantity, new.unit_price_krw, new.subtotal_krw,
         new.shipping_fee_krw, new.discount_krw, new.total_krw, new.idempotency_key, new.created_at)
     is distinct from
     row(old.campaign_id, old.user_id, old.book_format, old.quantity, old.unit_price_krw, old.subtotal_krw,
         old.shipping_fee_krw, old.discount_krw, old.total_krw, old.idempotency_key, old.created_at) then
    raise exception 'order snapshot columns are immutable' using errcode = 'check_violation';
  end if;
  if old.inventory_released_at is not null and new.inventory_released_at is distinct from old.inventory_released_at then
    raise exception 'inventory already released' using errcode = 'check_violation';
  end if;
  new.version := old.version + 1;
  return new;
end;
$$;
create trigger orders_guard before update on public.orders
  for each row execute function public.orders_guard_update();

-- ---------------------------------------------------------------------
-- 입금 기록 (관리자 대사). 금융정보 원문(계좌번호 등)은 저장하지 않는다.
-- 회원에게 보이는 열: 기대액·확인액·상태·회원 메모·확인 시각. 내부 열: reconciliation_ref, verified_by.
-- ---------------------------------------------------------------------
create table public.payment_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  expected_krw bigint not null check (expected_krw >= 0),
  received_krw bigint check (received_krw is null or received_krw >= 0),
  status text not null check (status in ('reported', 'verified', 'mismatch', 'rejected')),
  reconciliation_ref text,          -- 내부 열. 대사 참조(내부 메모 번호 등). 은행 원문 금지
  member_note text check (member_note is null or char_length(member_note) <= 200),
  verified_by uuid references auth.users (id),   -- 내부 열
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payment_verified_fields check (
    status <> 'verified' or (verified_by is not null and verified_at is not null and received_krw is not null)
  )
);
create index payment_records_order_idx on public.payment_records (order_id);

-- ---------------------------------------------------------------------
-- 환불 기록. 실지급 확인 뒤 completed. 누적 한도(확인 입금액 이하)는 DEV-005 함수에서 잠금과 함께 검증.
-- 회원 사유(member_reason)와 운영 내부 메모(internal_note)를 분리한다(계획 20절: 내부 메모와 공개 사유 분리).
-- 회원에게 보이는 열: 금액·상태·회원 사유·처리 시각. 내부 열: internal_note, payout_ref, processed_by.
-- ---------------------------------------------------------------------
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  amount_krw bigint not null check (amount_krw > 0),
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'completed', 'rejected')),
  member_reason text check (member_reason is null or char_length(member_reason) <= 500),
  internal_note text check (internal_note is null or char_length(internal_note) <= 1000),  -- 내부 열
  payout_ref text,                                   -- 내부 열
  processed_by uuid references auth.users (id),      -- 내부 열
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint refunds_completed_fields check (
    status <> 'completed' or (processed_by is not null and processed_at is not null and payout_ref is not null)
  )
);
create index refunds_order_idx on public.refunds (order_id);

-- ---------------------------------------------------------------------
-- 감사 기록. 관리자 승인·입금·취소·내보내기 이력. 비밀값 기록 금지. 클라이언트 접근 없음.
-- ---------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id),
  actor_kind text not null check (actor_kind in ('member', 'admin', 'system')),
  action text not null,
  target_type text not null,
  target_id text not null,
  reason text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_target_idx on public.audit_events (target_type, target_id, created_at desc);

-- =====================================================================
-- 권한(GRANT) — 열 보호
-- Supabase는 public 스키마 새 객체에 anon/authenticated/service_role로 ALL 권한을 기본 부여한다.
-- 테이블 단위 SELECT가 남아 있으면 열 단위 REVOKE가 효과가 없으므로 먼저 전부 회수한다.
-- service_role은 RLS를 우회하는 서버 전용 역할로 기본 권한을 유지한다(서버 코드에서만 사용).
-- =====================================================================
revoke all on table
  public.profiles, public.role_assignments, public.projects, public.books, public.campaigns,
  public.orders, public.payment_records, public.refunds, public.audit_events
from public, anon, authenticated;
revoke all on sequence public.audit_events_id_seq from public, anon, authenticated;

-- 공개 콘텐츠: 행은 RLS가 published/approved로 거르고, 열은 아래 목록만.
grant select (id, slug, title, summary, planned_departure, publication_status, created_at, updated_at)
  on public.projects to anon, authenticated;
grant select (id, project_id, slug, title, format, description, publication_status, created_at, updated_at)
  on public.books to anon, authenticated;
grant select (id, book_id, channel, external_url, unit_price_krw, shipping_fee_krw, min_goal_qty, max_qty,
              goal_basis, per_user_limit, payment_deadline_at, opens_at, closes_at,
              review_status, recruitment_status, goal_first_reached_at)
  on public.campaigns to anon, authenticated;

-- 회원 본인 데이터: authenticated만. 내부 열 제외.
grant select (id, display_name, approval_status, approval_changed_at, created_at, updated_at)
  on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select (user_id, role, granted_at) on public.role_assignments to authenticated;
grant select (id, campaign_id, user_id, book_format, quantity, unit_price_krw, subtotal_krw, shipping_fee_krw,
              discount_krw, total_krw, idempotency_key, policy_version,
              order_status, payment_status, fulfillment_status, refund_status,
              expires_at, version, created_at, updated_at)
  on public.orders to authenticated;
grant select (id, order_id, expected_krw, received_krw, status, member_note, verified_at, created_at)
  on public.payment_records to authenticated;
grant select (id, order_id, amount_krw, status, member_reason, processed_at, created_at)
  on public.refunds to authenticated;
-- audit_events: 클라이언트 권한 없음.

-- 함수 실행 권한. Postgres는 PUBLIC에, Supabase는 anon/authenticated에 기본 EXECUTE를 준다.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.orders_guard_update() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.is_approved_member() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_approved_member() to authenticated;

-- =====================================================================
-- RLS — 행 보호
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.role_assignments enable row level security;
alter table public.projects enable row level security;
alter table public.books enable row level security;
alter table public.campaigns enable row level security;
alter table public.orders enable row level security;
alter table public.payment_records enable row level security;
alter table public.refunds enable row level security;
alter table public.audit_events enable row level security;

-- 공개 콘텐츠: 게시·승인된 것만. 상위가 비공개면 하위도 숨긴다.
create policy projects_public_read on public.projects
  for select to anon, authenticated
  using (publication_status = 'published');

create policy books_public_read on public.books
  for select to anon, authenticated
  using (
    publication_status = 'published'
    and exists (select 1 from public.projects p where p.id = project_id and p.publication_status = 'published')
  );

create policy campaigns_public_read on public.campaigns
  for select to anon, authenticated
  using (
    review_status = 'approved'
    and exists (
      select 1 from public.books b
      join public.projects p on p.id = b.project_id
      where b.id = book_id and b.publication_status = 'published' and p.publication_status = 'published'
    )
  );

-- 관리자 읽기(허용 열 범위 안). 내부 열과 쓰기는 DEV-007 서버 경로에서 역할 재확인 후.
create policy projects_admin_read on public.projects for select to authenticated using ((select public.is_admin()));
create policy books_admin_read on public.books for select to authenticated using ((select public.is_admin()));
create policy campaigns_admin_read on public.campaigns for select to authenticated using ((select public.is_admin()));

-- 프로필: 본인 읽기, 관리자 읽기. 본인은 display_name 열만 수정(열 권한).
create policy profiles_self_read on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_admin_read on public.profiles
  for select to authenticated using ((select public.is_admin()));
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- POLICY-PENDING(DEV-004): 가입 시 profiles 생성은 auth 트리거(security definer)로 추가. 클라이언트 insert 권한 없음.

-- 역할: 본인 역할 읽기만.
create policy role_assignments_self_read on public.role_assignments
  for select to authenticated using (user_id = (select auth.uid()));

-- 주문·입금·환불: 본인 행 + 관리자 읽기. 클라이언트 쓰기 권한·정책 없음.
create policy orders_self_read on public.orders
  for select to authenticated using (user_id = (select auth.uid()));
create policy orders_admin_read on public.orders
  for select to authenticated using ((select public.is_admin()));

create policy payment_records_self_read on public.payment_records
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));
create policy payment_records_admin_read on public.payment_records
  for select to authenticated using ((select public.is_admin()));

create policy refunds_self_read on public.refunds
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));
create policy refunds_admin_read on public.refunds
  for select to authenticated using ((select public.is_admin()));

-- audit_events: 정책·권한 없음 = anon/authenticated 접근 불가.
