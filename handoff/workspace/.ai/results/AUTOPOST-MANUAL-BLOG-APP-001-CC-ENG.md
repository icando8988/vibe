# AUTOPOST-MANUAL-BLOG-APP-001 — M2 SQL과 블로그 수동 게시 도메인 전이 (CC-ENG)

- 작업 ID: AUTOPOST-MANUAL-BLOG-APP-001 (상위 run run_eaedc8d53618, Orca task_5717d320773e)
- 작업자: CC-ENG (Claude Code)
- 날짜: 2026-11-16
- 상태: 구현 완료 / **검증 미실행**(지시대로 test·build·typecheck·lint·DB·PGlite 실행 안 함, 테스트 추가 안 함)

## 1. 수정 파일 (허용 범위 내)

| 파일 | 변경 |
|---|---|
| `web/src/lib/distribution/jobs.ts` | T16~T19 수동 전이 helper·증거 검증·`channelAllowsManual` 추가(기존 함수 본문 변경 없음) |
| `web/src/lib/distribution/late-evidence.ts` | `mode=manual` 수용 분기 추가, `externalId` 타입 `string \| null`로 확장(live 판정 동일) |
| `.ai/results/AUTOPOST-MANUAL-BLOG-APP-001-CC-ENG.md` | 본 보고서 |

`evidence-rules.ts`, `types.ts`, tests, UI, API, migration/RLS, 문서·공통 계약은 수정하지 않았다. (저장소가 git이 아니라 diff 명령 대신 수정 파일을 위 목록으로 한정했다.)

## 2. 공개 계약 (모든 수동 helper 공통 — 코드 주석에도 기록)

- 순수 도메인 판정이다. **권한 확인·영속 이벤트 기록·낙관적 version 비교·행 잠금·다른 작업과의 증거 충돌 검사를 대신하지 않는다.**
- 서버는 호출 전 `actorId`가 **승인된 배포 admin**(role_assignments.role='admin' AND profiles.approval_status='approved', DEC-AUTOPOST-DATA-001 D1)인지 현재 상태로 재확인하고, ok여도 실제 변경은 **대응 SQL RPC**(`p_expected_version` 포함)로만 한다.
- 반환 `PublishJob`은 RPC 성공 시 기대 상태 미리보기이며, 저장 진실은 RPC 반환/재조회 값이다.
- DB가 거부할 값을 성공으로 판정하지 않도록 DB와 같거나 더 엄격하게 검사한다.
- 오류는 모두 `DResult` 실패(`INVALID_INPUT` / `MODE_MISMATCH` / `INVALID_TRANSITION` / `NO_EVIDENCE` / `NOT_APPROVED`)로 일정하게 반환한다(예외 없음).

## 3. M2 함수·제약 ↔ helper 규칙 대응표

| 전이 | helper (jobs.ts) | M2 RPC | M2 조건 | helper 규칙 |
|---|---|---|---|---|
| T16 manual_ready → awaiting_evidence | `markManualPosted(job, {actorId, now})` | `distribution_mark_manual_posted` | admin actor, expected_version, status='manual_ready', 이벤트 `manual_posted_declared` | 공통 검사 + status='manual_ready'만. 복사/내보내기는 게시 아님(주석) |
| T17 awaiting_evidence → published | `recordManualEvidence(job, input)` → `{job, evidence}` / `validateManualEvidence` | `distribution_record_manual_evidence` | mode='manual' AND status='awaiting_evidence'; URL host allowlist; 충돌 시 거부; evidence operator_manual·accepted·recorded_by=actor | status='awaiting_evidence'만; ID 또는 URL 필수; ID·계정 ID `isValidExternalId`(trim 후); URL `isValidEvidenceUrl` + `manualEvidenceHostAllowed`(port 거부 등 DB보다 엄격, 앞뒤 공백 거부); URL 없으면 methodNote 1~1000 필수; observedAt 시간대 ISO·now+5분 이하. 반환 evidence는 RPC에 넘길 정규화 값(빈 값 null, observedAt UTC) |
| T18 manual_ready/awaiting_evidence → abandoned | `abandonManualJob(job, {actorId, reason, acknowledgeMayRemainExternal: true, now})` | `distribution_abandon_manual_job` | btrim(reason) 비어있지 않음, acknowledge is true, status ∈ {manual_ready, awaiting_evidence}, 이벤트 `manual_abandoned`(summary=left(reason,500)) | 두 상태만; reason trim 1~500 코드포인트(이벤트 summary 잘림 방지 → DB보다 엄격); acknowledge !== true → `NOT_APPROVED`; retryPolicy null, lastError 유지 |
| T19 awaiting_evidence → unknown | `markManualUncertain(job, {actorId, reason, now})` | `distribution_mark_manual_uncertain` | reason 필수, status='awaiting_evidence', last_error={MANUAL_OUTCOME_UNCERTAIN, left(reason,500), retryable false, autoRetry false} | awaiting_evidence만; reason trim 1~500; lastError 동일 모양(`MANUAL_OUTCOME_UNCERTAIN_CODE`), retryPolicy null. 이후 `reconcileUnknown`만 |

공통 검사 `checkManualCommon`:

| M2 근거 | 규칙 |
|---|---|
| `distribution_jobs_manual_blog`, `CHANNEL_MODES` | mode='manual' 아니면 `MODE_MISMATCH`, 채널이 manual 불허면 `MODE_MISMATCH` (`channelAllowsManual`) |
| `distribution_jobs_manual_shape` (attempts=0, scheduled_at null, phase none) | attempts≠0 또는 scheduledAt≠null이면 `INVALID_INPUT` |
| `p_actor_id uuid` + `distribution_assert_admin_actor` | actorId UUID 형식만 검사(권한 판정은 서버/DB) |
| 작업 ID | `isValidJobId` |
| 시각 | `now`는 `parseZonedTime` 통과 필수 |

evidence 제약 대응: `distribution_publication_evidence_identifier`(ID 또는 URL), external_post_id/account_id 정규식, external_url 정규식·2048자, `manual_id_note`, method_note ≤1000, 트리거 `observed_at <= now()+5분`, `distribution_manual_evidence_host_allowed`(blog.naver.com, m.blog.naver.com — D7 미결정 기본값).

## 4. late-evidence.ts (mode=manual)

- `dry_run`만 `MODE_MISMATCH`로 거부. live 분기는 코드 변경 없음(동일 판정·메시지).
- manual 규칙 (M2 `distribution_record_late_evidence` T21, `distribution_resolve_evidence` 수락 조건 대응):
  - 채널이 manual 허용(blog)이어야 함.
  - ID 또는 URL 하나 이상, ID는 `isValidExternalId`, URL은 `isValidEvidenceUrl` + 수동 호스트 allowlist. 아니면 `NO_EVIDENCE`(manual expected shape 불일치 거부).
  - `confirmedAt`은 `parseZonedTime`(live보다 엄격).
  - **attempt는 null이어야 함**: manual은 attempts=0·attempt 행 없음 → 값이 있으면 evidence attempt FK가 거부하므로 `INVALID_INPUT`.
  - `awaiting_evidence` → `INVALID_TRANSITION`(운영자 증거는 `recordManualEvidence`/T17로. 늦은 증거는 recorded_by 없는 pending_review라 actor 정책을 대신하지 못함). live의 "현재 시도 정상 결과는 applyResult로" 규칙과 대칭.
  - `published` → `already_published`; 들어온 식별자(ID·URL) 중 값 있는 것이 모두 확정값과 같으면 `duplicateOfConfirmed`, 하나라도 다르면 `conflict`.
  - 그 외(manual_ready/failed/unknown/cancelled/abandoned) → 기존 사유 `job_not_dispatching` 재사용(새 사유 추가 없음). `older_attempt`/`attempt_unknown`은 manual에서 발생하지 않음.
  - ok는 "보존 대상" 판정이지 게시 확정이 아님. 저장은 `distribution_record_late_evidence`, 확정은 admin `distribution_resolve_evidence(accept)`만.
- 타입 영향: `IncomingEvidence.externalId`/`LateEvidenceRecord.externalId`가 `string | null`. live 결과는 항상 문자열. 현재 소비자는 tests/distribution/qa-decisions.test.ts뿐이며 값 비교만 하므로 정적 영향 없음으로 판단(미실행).

## 5. 정적 영향 점검

- `summarizeBatch`/`summarizeContentVersion`/`summarize`: 미변경. manual awaiting_evidence=pending, abandoned=failed, manual unknown=needs_reconcile 기존 집계 그대로.
- `createJob`/`startDispatch`/`applyResult`/`retryFailed`/`approveRerun`/`reconcileUnknown`/`cancelJob`: 미변경. T19 이후 `reconcileUnknown`(manual found_published 호스트·메모 규칙) → `approveRerun`(manual → manual_ready) 흐름과 연결됨.
- live late evidence: 분기 순서만 앞에 manual 분기 추가. qa-decisions.test.ts의 live/dry_run 기대값(사유·코드)은 코드상 동일.
- index.ts `export *` 이름 충돌: 신규 export(`channelAllowsManual`, `MANUAL_REASON_MAX`, `MANUAL_OUTCOME_UNCERTAIN_CODE`, 수동 helper·타입)는 다른 모듈과 중복 없음(grep 확인).
- 순환 import: late-evidence → jobs/evidence-rules 단방향(기존과 같음).

## 6. DB와의 차이·남은 저장소 연결 과제

1. **RPC 연결 없음**: 서버 액션/API에서 admin 재확인 → 각 helper 사전 판정 → 해당 RPC 호출 → 재조회 경로가 필요(미구현, 범위 밖).
2. **expected_version**: `PublishJob`에 version 필드가 없어 도메인이 검증·전달하지 못한다. 저장소 매핑 시 job 행 version을 함께 다뤄야 함(types.ts 변경은 금지라 미반영).
3. **증거 충돌**(`distribution_evidence_conflicts`)과 admin 존재·승인 상태, 미래 observed_at의 DB 시계 기준은 데이터/DB 시각이 필요해 순수 함수로 판정 불가 → RPC 오류(`EVIDENCE_CONFLICT`, insufficient_privilege, check_violation)를 DResult로 매핑하는 저장소 계층 필요.
4. T19 last_error.message: DB는 원문 `left(p_reason,500)`, 앱은 trim 후 ≤500(초과는 거부). 표시 차이만 있음.
5. 늦은 증거 중복 통지: DB는 같은 식별자여도 pending_review 행 + `reconciliation_required=true`. 앱의 `requiresReconciliation=false`는 표시용이며 DB 플래그 해제가 아님(주석 명시).
6. live late evidence는 기존대로 ID 형태(`isValidExternalId`)를 검사하지 않는다(“기존 live 동작 불변” 지시). DB가 거부할 ID를 보존 대상으로 판정할 수 있으므로 별도 작업에서 강화 검토 권고.
7. 수동 호스트 allowlist는 D7 미결정 기본값. 최종 결정 시 DB 함수와 `MANUAL_EVIDENCE_HOSTS`를 함께 변경.
8. 테스트 미작성: T16~T19 helper, manual late evidence 분기에 대한 단위 테스트는 별도 승인 시 추가 필요.

## 7. 검증

- 실행한 검증 없음(지시상 금지). 정적 코드 검토와 grep 기반 사용처 확인만 수행.
