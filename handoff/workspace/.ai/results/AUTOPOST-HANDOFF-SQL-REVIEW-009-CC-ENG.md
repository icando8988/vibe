# AUTOPOST-HANDOFF-SQL-REVIEW-009 — 080000 Blog 확장 인계 SQL 독립 검토 (CC-ENG)

- task_ef8fdecc6644 / ctx_12df970c0b70 · 2026-11-17 · 상태: **ready_review (잠정 검토)**
- **검토 기준 파일**: `web/supabase/migrations/20261116080000_distribution_extension_handoffs.sql`
  - sha256 `d9cfcaa71f1e2f28d90b083fd0397d12b93bd948aa04766abff02a850898867e`, 19154 bytes, 수정 시각 2026-11-17 01:16:51 +09:00
  - 읽은 시각 01:20:44, 실행 후 재확인 01:23:41에도 hash가 같았다.
  - 사본: `%TEMP%\autopost-local-db-verify-002\review009\080000.snapshot.sql`
- **원 담당이 아직 수정 중일 수 있다. 이 결과는 위 hash 기준이며, 최종 판단은 원 담당의 결과(최종 hash, handoff-run 결과)와 다시 대조해야 한다.** 러너가 시작할 때 디스크 hash와 기준 hash를 비교해 출력한다.
- 080000, 060000, 070000, `token-run.mjs`, `handoff-run.mjs`, `lib.mjs`, 앱은 수정하지 않았다. 네트워크, 키, commit 없음.

## 1. 실행

```
node web/scripts/distribution-local-verify/handoff-review-run.mjs --pglite-project %TEMP%\autopost-local-db-verify-002 \
  --snapshot %TEMP%\autopost-local-db-verify-002\review009\080000.snapshot.sql --json …\review009\result.json
```
- exit **0**. 안전 동작 기대 **95/95 일치**(FINDING 집계 4행 포함). FINDING 재현 4건은 F-1, F-1b, F-2, F-3이다.
- 기존 임시 PGlite 0.5.16(PostgreSQL 18.6)을 썼다. migration 000000~080000을 비superuser owner로 순서대로 적용했다. Supabase 대역이며 실제 Supabase가 아니고, 단일 연결이다.
- 시험 전용 조작: 180초 리스와 30분 요청 창을 기다리지 않으려고 superuser가 handoffs 표의 `lease_expires_at`/`requested_at`을 과거로 옮겼다. 이 표에는 가드 트리거가 없다.

## 2. 검토 항목별 판정

| 항목 | 판정 | 근거(시나리오) |
|---|---|---|
| SECURITY DEFINER · owner/service ACL | 적합 | 함수 8개 모두 DEFINER, `search_path=""`, owner supa_owner. 공개 4개(request, claim, heartbeat, record_input)는 service_role만 실행할 수 있고, 내부 4개는 owner 전용이다. service_role이 내부 helper(problem, lock_run)를 직접 호출하면 42501이다. authenticated(admin JWT)의 claim 실행은 42501이다 |
| RLS · 표 권한 | 적합 | RLS가 켜져 있고 정책은 0개다. anon, authenticated, service_role 모두 SELECT·UPDATE가 없어 직접 조회와 DML이 42501이다 |
| D1 재검사 | 적합 | 요청: 정지 admin과 역할 없는 회원은 42501. 선점·heartbeat·입력: 소유자 정지나 admin 역할 회수 시 매 호출에서 UNAUTHENTICATED(28000)이고, 복구하면 정상이다 |
| token 소유권 | 적합 | B 토큰은 A가 요청한 인계를 선점하지 못한다(null, 상태 불변). 형식 불량이나 미등록 해시는 UNAUTHENTICATED. 토큰을 철회하면 선점과 heartbeat 모두 UNAUTHENTICATED |
| runId 위조 | 적합 | 임의 run이나 null run은 SUPERSEDED. 같은 소유자의 다른 토큰에 올바른 run을 넣어도 SUPERSEDED. 다른 소유자 토큰에 올바른 run을 넣으면 P0002. 다른 작업 ID는 P0002. 위조 시도 후에도 상태는 그대로다 |
| 승인·최신성·보관 재검사 | 적합 | 요청 뒤 승인 철회 → 선점이 null이고 rejected(BASIS_APPROVAL_REVOKED, run 없음)라 **내용이 전달되지 않는다**. 진행 중 리비전 승인 철회, 새 원문 버전(stale), 초안 보관, 작업 취소 → heartbeat가 ok=false와 각 코드를 돌려주고 needs_check가 되며, 이후 입력 결과는 SUPERSEDED |
| 전달 내용 고정 | 적합 | 작업에 고정된 승인 원문 버전의 title과 승인 리비전의 body다. lease는 180초 |
| 선점·리스 | 적합(단일 연결 한정) | 같은 인계를 다시 선점하면 null. 만료 후 heartbeat는 결과 반환 방식으로 needs_check를 기록한다(예외 롤백으로 기록이 사라지지 않음). 다른 상태 보고는 success=false LEASE_EXPIRED |
| 만료 후 자동 재인계 방지 | 적합 | needs_check 뒤 재요청은 HANDOFF_EXISTS이고 재선점은 null이라 새 run이 발급되지 않는다. 31분 지난 요청은 선점 대상이 아니며, 요청자가 다시 요청해 창을 갱신해야 한다 |
| 결과의 published 비전환 | 적합 | completed → publish_ready를 거쳐도 M2 작업 행(status, version, phase, 증거)과 이벤트 수가 **완전히 그대로**다. 게시 선언은 기존 manual RPC로만 할 수 있다. `published` 입력은 22023. 상태 역행(completed→in_progress)과 종료 후 변경(publish_ready→failed, failed→completed) 거부. 형식이 불량한 오류 코드는 원문을 저장하지 않고 EXTENSION_FAILED로 남는다 |
| 070000과의 상호작용 | 충돌 없음 | 080000은 070000 함수를 재정의하지 않는다(recover 격리와 canonical 비교 유지). 인계 publish_ready 후 사람이 증거를 기록할 때도 대문자 호스트 같은 URL은 canonical 충돌로 거부된다. recover는 manual 작업과 인계를 건드리지 않는다. 인계 상태는 M2 published와 독립이다 |

## 3. 결함과 미완성 (재현 · 위치 · 수정 제안)

### F-1 / F-1b 논리 결함 — 리스 만료 뒤 같은 상태를 다시 보고하면 성공으로 응답한다 (중간)
- 위치: `distribution_record_extension_input`(080000 302~350행). `if v_h.status = p_status then return … 'unchanged'`(325~327행)가 만료 검사(328~331행)보다 **먼저** 실행된다.
- 재현(그룹 8): 선점 후 리스를 만료시킨 다음 `record_extension_input(…, 'in_progress')`를 호출하면 `success:true, persisted:true, unchanged:true`가 돌아오고 상태는 in_progress로 남는다(needs_check가 기록되지 않음). completed 상태에서 `'completed'`를 다시 보고해도 마찬가지다(F-1b).
- 영향: 확장이 리스를 잃었는데도 성공 응답을 받아, 계속 입력해도 된다고 오해할 수 있다. 사람 확인 상태(needs_check)로의 전환도 늦어진다. 게시 상태 전이는 없어서 데이터 손상은 없다.
- 수정 제안: in_progress/completed이면 `distribution_handoff_expire()` 검사를 unchanged 분기 **앞으로** 옮긴다. `'in_progress'`는 unchanged 외에 받을 전이가 없으므로 허용 입력 목록에서 빼는 것도 검토한다.

### F-2 논리 결함(설계 확인 필요) — 일시적 조건으로 거절된 인계가 영구히 막힌다 (중간)
- 위치: claim의 거절 분기(208~213행)가 `status='rejected'`로 끝나고, request(154~163행)는 requested가 아닌 기존 행을 모두 HANDOFF_EXISTS로 거부한다(`job_id unique`).
- 재현(그룹 9): manual_ready blog 작업을 요청한다. 늦은 증거가 들어와 reconciliation_required가 되면 선점이 null(rejected RECONCILIATION_REQUIRED)이다. 증거를 반려하면 작업은 manual_ready로 돌아오고 플래그도 해제되지만, 재요청은 **HANDOFF_EXISTS**다. 이 작업은 다시 인계할 수 없다(새 작업 생성도 같은 버전 manual 키 점유 규칙과 얽힌다).
- 수정 제안: rejected는 run이 발급되지 않아 **내용이 전달된 적이 없으므로** 재요청을 허용해도 중복 입력 위험이 없다. request에서 `status='rejected'`인 행을 requested로 되돌린다(token_id, last_code, finished_at 초기화, requested_by 갱신). needs_check, failed, in_progress, completed, publish_ready는 지금처럼 막는다.

### F-3 미완성 — 확장이 사라지거나 토큰이 철회되면 만료된 in_progress가 그대로 남는다 (낮음~중간)
- 위치: 만료 처리 `distribution_handoff_expire`는 같은 토큰·run의 heartbeat와 record_input 안에서만 호출된다. 일괄 처리(sweeper)나 관리자 경로가 없다.
- 재현(그룹 6): 선점 후 토큰을 철회하고 리스가 1시간 지나도 status=in_progress다. 재요청은 HANDOFF_EXISTS이고, 표가 RLS로 막혀 있어 관리자가 상태를 볼 RPC도 없다.
- 안전 측면: 자동 재인계는 일어나지 않으므로 중복 입력 위험은 없다. 다만 실제로는 "확인 필요"인데 화면에는 "입력 중"으로 보일 수 있다.
- 제안(후속 구현): 다음 RPC를 별도 작업으로 추가한다. 모두 service_role 전용이고 D1 actor를 검사한다.
  - 만료된 in_progress/completed를 needs_check로 바꾸는 일괄 RPC(관리자 조회 시점이나 스케줄러)
  - 인계 상태 조회 RPC(코드만, 본문 없음)
  - needs_check/failed 해소(사람 확인 후 재요청 허용) RPC

### 관찰 (결함 아님 / 낮음)
- O-1: 내부 helper 4개(token_owner, expire, problem, lock_run)는 DEFINER 안에서만 쓰이므로 SECURITY INVOKER로도 충분하다. 지금은 owner 전용 EXECUTE라 실해는 없고, 권한 면적을 줄이는 정리 항목이다.
- O-2: claim은 첫 후보가 거절되면 다음 후보를 보지 않고 null을 돌려준다. 다음 폴링에서 처리되므로 지연만 생긴다.
- O-3: 다른 admin이 요청한 requested 인계는 그 요청자가 가져가지 않는 한 HANDOFF_EXISTS로 남는다(만료·취소 API 없음). F-3의 관리자 API와 함께 다루면 된다.
- O-4(정적 분석): 잠금 순서. request는 jobs FOR SHARE 다음 handoffs FOR UPDATE, claim은 handoffs(SKIP LOCKED) 다음 jobs FOR SHARE 순이다. SHARE끼리는 충돌하지 않고 claim이 SKIP LOCKED라 교착 경로는 찾지 못했다. 다중 연결로는 검증하지 않았다.

## 4. 구분: 구현 미완성 vs 논리 결함
- **논리 결함**: F-1/F-1b(검사 순서), F-2(rejected 영구화. 설계 의도 확인이 필요하지만 내용 미전달 상태까지 막는 것은 과잉 차단으로 판단).
- **미완성**: F-3, O-3(관리자 조회·해소·sweeper 부재). 지금 SQL에서 오류를 내는 구현 누락은 발견하지 못했다. 적용·실행이 정상이고, 함수 시그니처 오류나 미정의 참조도 없다.

## 5. 미검증 범위
- 다중 연결 동시 선점(SKIP LOCKED), heartbeat와 M2 RPC의 동시 경합
- 실제 Supabase(PostgREST /rpc, Bearer → 해시 변환을 하는 앱 서버 코드, PG 15/17)
- 확장 쪽 클라이언트 동작, 30분·180초의 실제 시간 경과(시간 이동으로 대체)
- 원 담당 `handoff-run.mjs`는 실행·수정하지 않았다(독립 검토).

## 6. 변경 파일
- 추가: `web/scripts/distribution-local-verify/handoff-review-run.mjs`, 이 결과 파일
- 임시(저장소 밖): `%TEMP%\autopost-local-db-verify-002\review009\{080000.snapshot.sql, run.log, result.json}`
