# DB 권한·불변식 검증 기록

DEV-003 · CC-ENG-01 · 2026-11-16. 대상 migration: `web/supabase/migrations/20261116000000_initial_foundation.sql`.

## 현재 판정: DB 실행 검증 **미실행**

| 항목 | 상태 |
|---|---|
| 로컬 격리 DB | 없음. Docker·Podman·psql·postgres·pg_ctl·Supabase CLI 미설치, PostgreSQL/Docker 서비스 없음, WSL 실행 파일만 있고 배포판 미설치(읽기 전용 확인). |
| 실제 Supabase(로컬/브랜치/원격) 적용 | 안 함. 원격·계정 연결 금지 범위. |
| SQL 정적 보강 | 완료(아래 변경). |
| 실행용 시험 스크립트 | 작성 완료(`web/tests/db/*.dbtest.ts`). PGlite 미설치로 **실행하지 않음**. 통과했다고 간주하지 않는다. |
| DB 없는 정적 동기화 시험 | `npm.cmd test`에 포함, 통과(57/57). |

MKT-003 우선순위 전환(msg_8efd6ef290bd)으로 DB 확장은 이 상태에서 멈췄다.

## 행 RLS만으로는 열을 보호하지 못한다 — 수정 내용

Supabase는 public 스키마 새 테이블에 anon/authenticated로 ALL 권한을 기본 부여한다. 테이블 단위 SELECT가 남아 있으면 RLS를 통과한 행의 **모든 열**이 보이고, 열 단위 REVOKE도 효과가 없다. DEV-001 판은 INSERT/UPDATE/DELETE만 회수해 다음 내부 열이 노출될 수 있었다.

| 테이블 | 노출되던 내부 열 | 조치 |
|---|---|---|
| campaigns(공개) | owner_id, reservation_ttl | 클라이언트 열 권한 제외 |
| profiles(본인) | approval_changed_by | 제외 |
| role_assignments(본인) | granted_by | 제외 |
| orders(본인) | inventory_released_at | 제외 |
| payment_records(본인) | reconciliation_ref, verified_by | 제외 |
| refunds(본인) | reason(내부·회원 혼용), payout_ref, processed_by | `reason`을 `member_reason`(공개)·`internal_note`(내부)로 분리, 내부 열 제외 |

방식: 대상 9개 테이블에 대해 `revoke all ... from public, anon, authenticated` → 노출 열만 `grant select (...)`. profiles는 `grant update (display_name)`만. 관리자도 클라이언트 경로에서는 허용 열 범위만 읽고, 내부 열·감사 기록은 DEV-007 서버(역할 재확인 후 service_role) 경로로만 읽는다.

결과적으로 클라이언트는 `select *`를 쓸 수 없고 열을 명시해야 한다(PostgREST `select=` 지정). 공개 캠페인의 1인 상한·입금기한·목표 기준은 계획 19.3절의 "사전 표시" 요구에 따라 공개 열로 남겼다.

## 그 밖의 보강

- 함수 EXECUTE: Postgres(PUBLIC)·Supabase(anon/authenticated) 기본 권한을 회수. `is_admin()`·`is_approved_member()`는 authenticated만 실행. 둘 다 security definer + `search_path=''`. 트리거 함수 실행 권한 없음.
- 시퀀스 `audit_events_id_seq` 클라이언트 권한 회수.
- `campaigns_public_read`: 책뿐 아니라 프로젝트까지 게시 상태일 때만 공개(상위 비공개 전파 누락 수정).
- `orders_guard` 트리거(service_role 직접 갱신에도 적용): 종료 상태 되돌리기 금지(cancelled/expired/completed, verified, delivered/released, 환불 completed/rejected), 종료 주문의 늦은 입금은 mismatch만, 금액·소유자·캠페인·멱등키 스냅샷 불변, 재고 복원 1회, 갱신마다 version +1.

## 실행 방법(실행기 준비 후)

```powershell
# PGlite(@electric-sql/pglite, Apache-2.0, 의존성 없음, 2026-11-16 기준 0.5.16)를 devDependency로 추가하는 것은 Master 승인 필요
npx vitest run --config tests/db/vitest.db.config.mts
```

- `tests/db/supabase-stub.sql`: **Supabase 대체 스텁**. anon/authenticated/service_role 역할, auth.users(id), `auth.uid()`=JWT sub, Supabase식 기본 권한을 흉내 낸다. GoTrue·JWT 서명·PostgREST·storage 등은 없다 → 실제 Supabase 로컬/브랜치에서 재검증 필요.
- `rls-matrix.dbtest.ts`: anon / 승인 회원 A·B / 승인 대기 P / 관리자의 실제 쿼리 매트릭스(공개 범위·상위 비공개 전파·내부 열 거절·`select *` 거절·자기 승인/승격 거절·display_name만 수정·타인 주문/입금/환불 0건·클라이언트 거래 쓰기 전부 거절·service_role 확인).
- `grants-invariants.dbtest.ts`: 기본 권한 대조군(새 테이블에 anon ALL이 실제로 생김을 증명) · 테이블 7종 권한 전부 false · 열 권한이 기대 목록과 정확히 일치 · 시퀀스 · RLS 활성 · 함수 보안 속성 · **TS `checkInvariants` ↔ DB CHECK 1,200개 전 조합 대조** · 종료 상태 보호 트리거.
- 시험은 행 내용을 출력하지 않고 건수와 SQLSTATE만 비교한다. 고정 UUID는 가짜 식별자다.

## 남은 일

1. 실행기 결정: PGlite devDependency 추가(Master 승인) 또는 Docker/Supabase CLI 로컬. 이후 위 명령으로 실행하고 실패를 고친 뒤 새 DB에 다시 적용해 검증.
2. 실제 Supabase 로컬에서 같은 매트릭스를 PostgREST 경로로 재검증(JWT 역할 전환, `select=` 열 지정).
3. 확장 테이블은 의존성 확정 후: 재고 원장(DEV-005·DEC-003), shipping_addresses(DEC-003·개인정보 보유기간), digital_entitlements·storage(AS03 자료), notification_outbox(이메일 제공자·DEV-008), consent_records(정책 문서 확정), assets·content_posts(DEC-004·MKT 결과에 따라 재설계 가능).

## 실제 Supabase 적용·검증 (2026-11-16, 사용자 지시)

대상: 서울(`ap-northeast-2`) 빈 프로젝트 `vibe`(`pudkzpmvafkapammevbz`). 대시보드 SQL Editor(postgres 역할)로 실행. 키·DB 비밀번호는 쓰지 않았다.

**적용**: `20261116000000_initial_foundation.sql`을 `begin; … commit;`으로 감싸 실행 → Success. 주의: CLI가 아니라 SQL Editor로 적용했으므로 `supabase_migrations.schema_migrations`에 기록이 없다. 이후 Supabase CLI를 쓰면 `supabase migration repair --status applied 20261116000000`로 맞춘다.

**구조 점검(카탈로그 조회)**

| 항목 | 결과 |
|---|---|
| 테이블 9개 RLS | 전부 활성 |
| anon/authenticated/PUBLIC 테이블 단위 권한 | **0건**(기본 권한 회수 확인) |
| 열 단위 권한 | SELECT 11쌍(공개 3테이블 anon·authenticated, 회원 테이블 authenticated), 비SELECT는 `profiles.display_name` UPDATE 1건뿐 |
| 정책 | books 2 · campaigns 2 · orders 2 · payment_records 2 · profiles 3 · projects 2 · refunds 2 · role_assignments 1 · audit_events 0(클라이언트 전면 차단 의도) |
| 함수 | `is_admin`·`is_approved_member` security definer + `search_path=""`, 실행권한 authenticated만(anon·PUBLIC 없음). 트리거 함수 2개도 `search_path=""` |
| 트리거 | orders_guard + updated_at 5개 |

**역할 전환 동작 점검**(`set local role`, 트랜잭션 rollback으로 흔적 없음) — 18항목 모두 기대와 일치:
- anon: orders·profiles·audit_events 조회 거절(42501), projects 공개 열 조회 허용, projects 쓰기 거절, `is_admin()` 실행 거절.
- authenticated: orders·payment_records `select *` 거절(내부 열 미허용 → 앱은 열을 명시해야 함), 허용 열 조회 성공, orders insert/delete 거절, profiles 승인 상태 변경 거절, display_name 변경 허용, role_assignments insert 거절, audit_events 조회 거절, `is_admin()` 실행 허용.
- 한계: `auth.uid()`가 비어 있는 상태라 '본인 행만 보임' 같은 행 단위 정책은 이번에 확인하지 않았다(행 0건 기준). 데이터·JWT를 넣는 매트릭스(`tests/db/rls-matrix`)는 여전히 미실행.

**Security Advisor**: 오류 0 · 경고 2 · 참고 1
- 경고: `is_admin()`·`is_approved_member()`를 로그인 사용자가 실행 가능한 SECURITY DEFINER. RLS 정책이 호출하므로 실행권한은 의도된 것이고 반환값은 호출자 자신의 불리언뿐이다. 다만 public 스키마라 `/rest/v1/rpc/`로도 호출된다 → **후속 권장**: 비노출 스키마(예: `private`)로 옮기는 migration.
- 참고: `audit_events` RLS 활성·정책 없음 — 의도(클라이언트 접근 전면 차단, service_role 전용).

### 후속 migration 2건 적용 (2026-11-16)

- `20261116010000_private_role_functions.sql`: `is_admin`·`is_approved_member`를 `private` 스키마로 이동(정책은 OID 참조라 자동 추종). anon은 private 스키마 USAGE 없음. → Security Advisor **경고 0**(참고 1: audit_events 정책 없음, 의도).
- `20261116020000_profile_on_signup.sql`: `auth.users` insert 시 `private.handle_new_user()`(security definer, search_path='')가 `profiles(pending)` 생성. 클라이언트 실행권한 없음.

### 행 단위 RLS 매트릭스 — 실제 프로젝트 **77/77 통과**

`tests/db/live/rls-matrix-live.sql`(PGlite 시험 `rls-matrix.dbtest.ts` 이식). 가짜 사용자 4명(승인 A·B, 대기 P, 관리자)과 시드를 트랜잭션 안에서 만들고 `request.jwt.claim(s)`로 역할·sub를 바꿔 실행한 뒤 **전체 rollback**(DB 흔적 없음).
- 공개 범위(상위 비공개 전파), 내부 열·`select *` 거절, 본인 행만(프로필·주문·입금·환불·역할), 자기 승인/승격 거절, display_name만 수정, 클라이언트 거래 쓰기 전부 거절(회원·관리자), 관리자 읽기 범위, service_role 우회 확인.
- 추가: public에 security definer 함수 0개, anon의 private USAGE 없음, 가입 트리거 → pending 프로필, 트리거 함수 클라이언트 실행 불가.
- PGlite 시험(`tests/db/*.dbtest.ts`)은 여전히 실행기 없음(미실행). 실제 DB 매트릭스가 같은 기대값을 대신 확인했다.
