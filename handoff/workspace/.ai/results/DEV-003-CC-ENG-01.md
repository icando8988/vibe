# DEV-003 — 격리 DB 실행 검증 및 권한 보강

- 책임 CC-ENG-01 / Orca task_b2907390e494, dispatch ctx_6cdc29f9b8d9 / 2026-11-16
- 상태: **blocked(실행기 없음) + 우선순위 전환으로 중단**. SQL 보강과 실행용 시험은 완료, DB 실행 검증은 미실행.
- 전환: Master msg_8efd6ef290bd에 따라 이 상태를 보존하고 MKT-003으로 넘어감. 진행 중인 명령·서버 없음.

## 환경 확인(읽기 전용)

docker·docker-compose·podman·psql·postgres·pg_ctl·supabase 명령 없음, PostgreSQL/Docker 서비스 없음, `C:\Program Files\PostgreSQL` 없음. `wsl.exe`는 있으나 배포판 미설치. 결과: **사용 가능한 로컬 격리 DB 없음.** 전역 설치·Docker 설정·원격 연결·비밀파일 접근은 하지 않았다.

## 변경 (허용 범위 안)

- `web/supabase/migrations/20261116000000_initial_foundation.sql` — 미적용 상태라 그 자리에서 수정: 기본 권한 전부 회수 후 열 단위 GRANT(내부 열 제외), refunds `reason`을 `member_reason`/`internal_note`로 분리, 함수·시퀀스 실행 권한 회수, 캠페인 공개 정책에 프로젝트 게시 조건 추가, `orders_guard` 트리거(종료 상태·늦은 입금·스냅샷 불변·재고 복원 1회·version).
- `web/tests/db/` — `supabase-stub.sql`(대체 스텁), `harness.mjs`(+`harness.d.mts`; 미설치 패키지가 typecheck를 깨지 않게 .mjs), `rls-matrix.dbtest.ts`, `grants-invariants.dbtest.ts`, `vitest.db.config.mts`(기본 `npm test`와 분리).
- `web/tests/domain/schema-sync.test.ts` — DB 없이 SQL CHECK 목록과 TS 상수 일치, REVOKE가 GRANT보다 먼저인지 확인.
- `docs/DB_VERIFICATION.md` — 설계·결함·실행 방법·남은 일.
- app/components/styles/package/lockfile/공용 .ai 미변경. `src/lib/domain` 변경 없음.

## 검증

| 명령 | 결과 |
|---|---|
| `npm.cmd run typecheck` | exit 0 |
| `npm.cmd test` | exit 0, 4 files / 57 tests (DEV-001 50 + schema-sync 7) |
| `npx vitest run --config tests/db/vitest.db.config.mts` | **미실행** — `@electric-sql/pglite` 미설치(새 패키지는 Master 승인 필요, MKT-003 지시상 신규 설치 금지) |

DB 시험은 작성만 했으므로 SQL 문법 오류나 기대값 오류가 있을 수 있다. 통과로 보고하지 않는다.

## 발견 결함(수정함, 실행 확인 전)

| ID | 내용 |
|---|---|
| DB-003-01 · P1 | 행 RLS만 있고 테이블 단위 SELECT가 남아 내부 열(owner_id, reconciliation_ref, verified_by, payout_ref, processed_by, granted_by, approval_changed_by, inventory_released_at, reservation_ttl)이 클라이언트에 노출될 수 있었음 |
| DB-003-02 · P2 | 함수 EXECUTE가 PUBLIC/anon에 기본 부여되는 점 미처리 |
| DB-003-03 · P2 | 비공개 프로젝트 아래 '게시' 책의 캠페인이 공개될 수 있었음(상위 전파 누락) |
| DB-003-04 · P2 | 환불 사유가 회원 공개 사유와 운영 내부 메모를 한 열에 섞음(계획 20절 위반) |
| DB-003-05 · P2 | service_role 직접 갱신으로 종료 주문 부활·스냅샷 변경이 가능했음 → 트리거 |

## 남은 결정 / 후속

1. 실행기: PGlite devDependency 추가 승인(추천: 계정·Docker 불필요, 실제 PostgreSQL 엔진) 또는 Docker/Supabase CLI 로컬 준비.
2. 실행 후 실패 수정 → 새 DB 재적용 검증 → 실제 Supabase 로컬에서 PostgREST 경로 재검증.
3. 클라이언트 `select *` 불가에 따른 앱 쿼리 규칙(열 명시)을 DEV-004에 반영.

## DEV-004 준비 조건

- 위 1·2 완료(권한 매트릭스 실행 통과).
- 그 시점 최신 `@supabase/ssr`·`@supabase/supabase-js` 버전 확인과 추가 승인.
- 가입 시 profiles 생성 트리거(security definer)와 auth 리디렉션 허용 목록 설계 확정. DEC-005(사전승인) 확인.
