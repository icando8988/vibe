# AUTOPOST-DRYRUN-EXEC-020 — CC-ENG 결과

- 작업자: Claude Code(CC-ENG-01), handle term_67ce2ea3-ec00-4b76-985a-fad63d177b0a
- task_ce676f049157 / dispatch ctx_b526cb7c4ba3 / 2026-11-17
- 금지 준수: 기존 SQL·다른 러너·OAuth 본문·확장·package 미수정, guard 우회·트리거 해제 없음, 실DB·계정·키/env 열람·API·네트워크·외부 게시·commit/push 없음.
- **운영 상태: 관리자 수동 모의 실행기만 생겼다. 실플랫폼 호출 0, live gate 닫힘 유지. live 실행기·자동 스케줄러·리스 회수 실행기(Vercel Cron 등) 미구현. 실제 Supabase에 030000~110000 미적용, 서버 env 미등록 → 운영 화면에서는 아직 실행 불가(저장 준비 전).**

## 1. next.config.ts — OAuth 경로 no-referrer
- `{ source: "/api/distribution/oauth/:path*", headers: [Referrer-Policy: no-referrer] }`를 전역 규칙 **뒤**에 추가(같은 키는 뒤 항목이 덮음).
- 실제 `next start` HTTP 확인: callback 303 `Referrer-Policy: no-referrer`(Location은 `/admin/distribution/connections/threads?result=denied`, 쿠키 삭제, state·code 반사 없음), start POST 303 no-referrer, start GET 405 no-referrer, 다른 API(`/api/status`)·관리 화면은 전역 `strict-origin-when-cross-origin` 유지. 외부 URL·state·token 노출 없음.

## 2. dry_run 수동 실행기
**migration `20261116110000_distribution_dry_run_dispatch.sql`** — `distribution_claim_dry_run_job(p_actor_id, p_job_id, p_expected_version, p_worker_id, p_lease_seconds)`(service_role 전용 DEFINER, search_path='').
- 기존 `distribution_claim_jobs`는 조건 맞는 작업을 임의로 집어 다른 작업·live를 잡을 수 있어, **지정 job 1건만** 선점하는 최소 RPC를 추가.
- 검사: D1(assert_admin_actor) → worker id 형식 → `distribution_lock_job(FOR UPDATE, expected_version)` → mode=dry_run(아니면 MODE_MISMATCH) → channel=threads(아니면 CHANNEL_NOT_SUPPORTED, 미선점) → status=scheduled·hold 없음·reconciliation 아님(INVALID_TRANSITION) → 예약 도래(NOT_DUE) → `distribution_job_basis_problem`(문제면 claim_jobs와 같은 hold 매핑 'approval_revoked'/'stale'을 system 컨텍스트로 걸고 선점하지 않음).
- 선점 갱신은 claim_jobs scheduled 분기와 동일(worker 컨텍스트 'claimed', attempts+1, lease, last_attempt_at, attempt 행). 요청 관리자는 이벤트 summary에 남김. 반환: attempt id·channel·승인 리비전 본문(서버 내부).
- 이후 단계·완료는 **기존** `distribution_advance_phase`(container_requested→container_created→processing→ready→publish_requested, dry_run은 컨테이너 ID·상태 없음 — M2가 강제) / `distribution_complete_attempt(dry_run_ok)` → `dry_run_succeeded/done`. published·증거·외부 ID 없음.

**`src/server/distribution/dry-run/executor.ts`** — `runThreadsDryRun(deps, form)`
- import는 actor-core·errors·validation·write-runner·node:crypto뿐(외부 fetch·threads/client·oauth·connections·토큰 없음 — 테스트가 import 목록 고정).
- 모의 검사: Threads 텍스트(비어 있지 않음·500자 이하·줄바꿈 외 제어문자 없음). 실패 → complete(failed, never, DRY_RUN_INVALID_TEXT).
- 단계 오류 → 시도를 failed(operator_only, DRY_RUN_STEP_FAILED)로 닫기 1회 시도, 그것도 실패하면 **interrupted**(dispatching 유지 → 리스 만료 뒤 기존 회수 함수로 failed). 완료 응답 유실 → **uncertain**(성공 단정·재전송 없음). 자동 재시도 없음.
- 결과: succeeded / held(hold_reason) / failed(code, stage) / interrupted / uncertain, 실패 경로는 기존 WriteOutcome(denied·invalid·not_ready·db_error).

**화면(jobs)**: 상세 페이지에 `actions.runDryRun`(dry_run·scheduled·보류 없음·검토 아님·예약 도래)일 때만 "모의 실행" 폼 — 확인 체크 필수, 렌더된 expectedVersion hidden, ActionForm(처리 중 잠금·입력 유지). 결과는 `?dryrun=<허용 코드>` 안내 + 실제 작업 상태. `jobs-dto`: phase·scheduledAt·leaseExpiresAt·attempts 추가(authenticated GRANT 열), 상태 표시 "모의 실행 대기(수동 실행)/모의 실행 중/모의 실행 보류/모의 실행 완료(외부 게시 아님)", 안내: 예약 전·보류·실행 중·리스 만료로 멈춤(성공 아님)·LEASE_EXPIRED 회수 실패·검사 실패·성공도 외부 게시 아님. `recovery_failed:<SQLSTATE>` 같은 문자열은 계속 unrecognized(행동 0). Blog manual 행동·문구 변화 없음. 작업 생성만으로 성공 표시 없음.

## 3. 검증
| 항목 | 결과 |
|---|---|
| dry-run-exec-run.mjs (PGlite, 000000~110000 12개) | 7/7 |
| oauth 6/6 · connections 5/5 · threads-connect 3/3 · blog-flow 5/5 · content-connect 2/2 | 통과 |
| run 209/209 · m2-run 334/334 · token-run 77/77 · handoff-run 91/91 · handoff-review-run 104/104 | 통과 |
| vitest 전체(작업 트리) | 23 files · 499 passed · 28 skipped(PGlite 전용) |
| tsc / lint / build | 0 / 0 error(기존 경고 3) / 성공 |
| next start HTTP | OAuth 경로 no-referrer 적용, 그 외 전역 유지 |

- PGlite: RPC ACL(service_role만), 생성 직후 scheduled·attempt 0(성공 아님), 비승인 actor denied, 실행 → dry_run_succeeded/done·attempt dry_run_ok·컨테이너 ID 없음·증거 0·외부 ID 없음, 이벤트 claimed/phase_advanced/dry_run_succeeded, **다른 작업 비선점(attempts 0 유지)**, 낡은 version conflict·완료 후 재실행 invalid_transition, 같은 version 두 요청 → succeeded 1 + conflict 1(attempt 1개), 승인 철회 → held(approval_revoked, 미선점)·이후 거부, 원문 새 버전 → held(stale), 취소 후 거부, 미래 예약 NOT_DUE(작업 불변), Blog manual 작업 MODE_MISMATCH(manual_ready 유지), Blog dry_run CHANNEL_NOT_SUPPORTED, live 생성은 LIVE_GATE_CLOSED, 긴 본문 failed(never), 단계 실패 → failed(operator_only), 단계+닫기 실패 → interrupted(dispatching) → 리스 만료 → 기존 recover → 그 작업만 failed(LEASE_EXPIRED_BEFORE_CONTAINER), 전체 시험 동안 globalThis.fetch 호출 0.
- 단위(12): import 경계, 텍스트 검사, D1·확인·형식 RPC 0회, 호출 순서·인자(증거 인자 없음), held, 검사 실패, 단계 실패 닫기/interrupted, 완료 유실 uncertain(재전송 0), 거부 토큰 안내, 화면 판정·안내, next.config 규칙 순서.
- **PGlite는 단일 연결이라 "동시" 시험도 직렬 실행이다 — 다중 connection 동시성 증명이 아니다.** 하네스가 비동기 호출의 begin/commit을 섞던 문제를 트랜잭션 단위 직렬화로 고쳤다(실제 DB의 요청별 트랜잭션과 같은 모양). 행 잠금(FOR UPDATE)·버전 검사 논리만 확인한 것.
- 보조 수정: 기존 PGlite 시험 2개의 "마지막 migration" 단언을 "포함" 단언으로(새 migration 추가 때문), threads 시험 2곳의 옛 문구("실행기 없음") 갱신.

## 4. 미완료·후속
- live 실행기(Threads 공급자 호출·컨테이너 선기록·unknown 처리), 자동 스케줄러, 만료 리스 회수 실행기(현재는 회수 함수만 있고 호출 주체 없음 → interrupted 작업은 운영 회수 전까지 dispatching), dry_run 결과 미리보기 저장, 실패 작업 재실행 승인 UI.
- 실제 Supabase: migration 000000~110000 적용, `SUPABASE_SECRET_KEY` 등록(없으면 실행 폼 비활성·저장 준비 전).
- 공개 release 관점: 이번 파일(dry-run 실행기·110000·jobs 화면·next.config·테스트)은 키트 문구가 없는 자체 코드이고 키트 파생 모듈을 import하지 않는다(별도 판단은 Master).
