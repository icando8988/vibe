# AUTOPOST-M2-APP-001 — M2 DB 계약에 맞춘 distribution 앱 도메인 정합화 (CC-ENG)

- 작업 ID: AUTOPOST-M2-APP-001 · 상위 run: run_eaedc8d53618 · Orca task: task_e8b8dcc86f0a
- 담당: Claude Code CC-ENG · Master: CX-MASTER-01 · 작성: 2026-11-16
- 상태: ready_review (코드 수정 완료, **검증 미실행**)
- 기준: `web/supabase/migrations/20261116040000_distribution_jobs.sql`(M2, 정적 승인·미실행), `.ai/decisions/DEC-AUTOPOST-DATA-001.md` D2

## 1. 변경 파일

| 파일 | 변경 |
|---|---|
| `web/src/lib/distribution/types.ts` | `PUBLISH_MODES`(+`manual`), `CHANNEL_MODES`, `JOB_STATUSES`(+`manual_ready`/`awaiting_evidence`/`abandoned`), `MODE_STATUSES`, `RETRY_POLICIES`/`RetryPolicy`, `PublishError.autoRetry?`, `PublishJob.retryPolicy?`/`lastReconciliationId?` |
| `web/src/lib/distribution/retry-policy.ts` (신규, 순수 helper 1개) | `classifyFailure(mode, error, publishRequested)`, `effectiveRetryPolicy(job)`, `CONFIRMED_ABSENT_CODE` |
| `web/src/lib/distribution/jobs.ts` | createJob 모드/채널 검사·manual 초기 상태, applyResult `publishRequested` 옵션·실패 분류, `autoRetryEligibility`(신규), `retryFailed`(auto 전용), `approveRerun`(신규), reconcileUnknown(confirmed_absent → operator_only), cancelJob(+manual_ready), summarize(+manual). retry-policy 공개 심볼을 re-export(`index.ts`를 수정하지 않기 위해) |
| `web/src/lib/distribution/idempotency.ts` | manual 키 허용, `OPEN_PUBLISHING_STATUSES`(DB partial unique와 동일), 열린 작업·재게시 판정을 live+manual로 |
| `.ai/results/AUTOPOST-M2-APP-001-CC-ENG.md` | 이 보고서 |

테스트, UI, API, migration, 문서/계약, `index.ts`, `result.ts`, `late-evidence.ts`, `adapters.ts`, 공용 .ai 파일은 건드리지 않았다.

## 2. 완료조건별 결과

### (3) confirmed_absent → 운영자 승인 없는 재시도 불가 (D2)
- `reconcileUnknown(confirmed_absent)` → `status=failed`, `retryPolicy='operator_only'`, `lastError={code:CONFIRMED_ABSENT, retryable:true, autoRetry:false}`, `lastReconciliationId=finding.reconciliationId ?? null`.
- `retryFailed`(자동 경로)는 operator_only에 `RETRY_NOT_ALLOWED`를 돌려준다. `effectiveRetryPolicy`가 CONFIRMED_ABSENT를 저장값과 관계없이 auto로 보지 않는다(`retryPolicy:'auto'`로 조작돼도 operator_only로 낮춘다). `classifyFailure`도 이 코드를 auto로 분류하지 않는다.
- 재실행 경로는 `approveRerun(job, {actorId, reason, basisRechecked: true, reconciliationId, scheduledAt?, now})`뿐이다. 조건은 failed(operator_only), 승인자와 사유 있음, `basisRechecked === true`(승인·권리·연결·중지를 다시 확인했다는 호출자 선언, DB `distribution_job_basis_problem`과 live gate 재검사에 대응), CONFIRMED_ABSENT면 `reconciliationId === job.lastReconciliationId`(비어 있으면 거부), live/dry_run이면 시도 한도 안. 결과는 manual이면 `manual_ready`, 그 밖에는 `scheduled`, `retryPolicy=null`(DB `distribution_approve_rerun`과 같다).

### (4) 게시 요청 전/후 구분, unknown 자동 재시도 차단
- `ApplyResultOptions.publishRequested?: boolean`(DB attempts.publish_requested_at 기록 여부)
  - `false`: published와 unknown 결과는 `INVALID_TRANSITION`으로 거부한다(DB 4c: 요청 전 불확실성은 failed로 기록). retryable 실패는 `auto`가 된다.
  - `true`이거나 생략(모름): retryable 실패도 `operator_only`가 된다. 자동 재시도는 하지 않는다.
  - dry_run은 외부 게시가 없으므로 retryable이면 auto다.
- `rejected` → `never`. unknown 결과는 live에서만 받고 dry_run은 `MODE_MISMATCH`(DB mode_status에 맞춤).
- `autoRetryEligibility(job)`는 `reconcile_required`(unknown) / `not_failed` / `operator_approval_required` / `not_retryable` / `invalid_attempts` / `attempts_exhausted` / eligible을 구분한다. DB `distribution_requeue_auto_retry` 조건과 같다.

### (5) DB partial unique · 중복 정책 대조

| 항목 | DB (M2) | TS (변경 후) | 일치 |
|---|---|---|---|
| 키 형식 | `pub:<uuid>:v<n>:<channel>:<live\|dry_run\|manual>` | 같은 형식, manual 허용 | ✅ (TS ID_PATTERN이 더 넓다. uuid가 아닌 ID도 허용) |
| 같은 키 점유 | `status <> 'cancelled'` (abandoned도 점유) | 같음 | ✅ |
| 채널당 열린 작업 | `(content_id, channel)` WHERE mode∈{live,manual} AND status∈{scheduled,dispatching,unknown,failed,manual_ready,awaiting_evidence} | `OPEN_PUBLISHING_STATUSES` 같은 집합, live+manual | ✅ (이전 TS는 live만, manual 상태 없음 → 불일치였음) |
| 재게시 확인 | create 함수에서 live/manual published가 있으면 `p_allow_republish` 필요 | live+manual published | ✅ (이전 TS는 live만) |
| dry_run | 키만 | 키만 | ✅ |

**불일치와 미결정 항목**
1. TS 판정은 호출자가 넘긴 `existing`이 완전할 때만 정확하다. 경합과 최종 보장은 DB unique 인덱스가 맡는다. 서버 연결 시 DB `unique_violation`/`DUPLICATE:`/`REPUBLISH_CONFIRMATION_REQUIRED:` 메시지를 앱 코드로 매핑해야 한다(미구현).
2. 재게시 오류 코드가 다르다. DB는 `REPUBLISH_CONFIRMATION_REQUIRED`, TS는 `DUPLICATE`다. `result.ts`가 수정 범위 밖이라 그대로 두었다.
3. failed가 열린 상태라서 confirmed_absent 이후 operator_only로 남은 v1 작업은 v2 생성을 막는다. 취소하거나 재실행 승인해야 풀린다. DB와 같은 동작이지만 운영 UX를 정해야 한다(결정 미확정).
4. abandoned는 같은 키를 영구 점유한다. 같은 버전으로 수동 작업을 다시 만들 수 없고 새 버전이 필요하다. DB와 같으며 운영 정책 확인이 필요하다.
5. hold_reason, reconciliation_required(늦은 증거 플래그), live gate는 TS PublishJob에 없다. `retryFailed`/`approveRerun`은 이 조건들을 확인하지 못하므로 서버가 확인해야 한다.

### (2) 기존 public API와 호출자 영향

| API | 변경 | 호출자 영향 |
|---|---|---|
| `PublishMode`, `JobStatus`, `JOB_STATUSES` | union 확장 | `content-distribution-preview.tsx`는 dry_run만 쓰므로 영향 없음. JobStatus/Mode로 exhaustive switch를 하는 코드는 현재 없음(grep으로 확인) |
| `PublishError.autoRetry?`, `PublishJob.retryPolicy?`/`lastReconciliationId?` | optional 추가 | 기존 객체 리터럴은 그대로 컴파일될 것으로 보임(미검증) |
| `createJob` | blog+live, manual+비blog → `MODE_MISMATCH`. manual+scheduledAt → `INVALID_INPUT`. manual은 `manual_ready`로 생성 | **blog live를 쓰던 테스트가 깨짐**(§4) |
| `applyResult` | `publishRequested` 옵션 추가. retryable 실패의 기본값이 operator_only로 바뀜. dry_run unknown 거부 | live 워커 연결 시 `publishRequested`를 반드시 넘겨야 함. 미리보기 컴포넌트는 영향 없음 |
| `retryFailed` | auto 전용 (operator_only → `RETRY_NOT_ALLOWED`) | 테스트 영향(§4) |
| `reconcileUnknown` | confirmed_absent → operator_only. found_published를 manual에도 허용. finding에 `reconciliationId?` 추가 | 테스트 영향 |
| `cancelJob` | manual_ready 취소 허용, retryPolicy 초기화 | — |
| `summarizeBatch`/`summarizeContentVersion` | manual을 실제 게시 집계에 포함. abandoned는 failed 쪽, manual_ready/awaiting_evidence는 pending | blog 수동 게시가 요약에 나타남(의도) |
| 신규 | `approveRerun`, `RerunApproval`, `autoRetryEligibility`, `AutoRetryEligibility`, `classifyFailure`, `effectiveRetryPolicy`, `CONFIRMED_ABSENT_CODE`, `CHANNEL_MODES`, `MODE_STATUSES`, `PUBLISH_MODES`, `RETRY_POLICIES`, `OPEN_PUBLISHING_STATUSES` | `index.ts`의 `export * from "./jobs"`/`"./idempotency"`/`"./types"`로 노출 |

`late-evidence.ts`의 `preserveLateEvidence`는 `mode !== "live"`면 거부한다. 그래서 DB가 허용하는 manual 늦은 증거를 TS에서는 받지 않는다. 수정 범위 밖이라 그대로 두었다. `adapters.getAdapter(_, "manual")`은 UnconnectedAdapter를 돌려주고 NOT_CONNECTED로 거절한다. manual 작업은 dispatch되지 않으므로 지금은 문제없다.

## 3. 결정과 가정
- A1. `publishRequested` 생략은 "보냈을 수 있다"로 보수적으로 해석한다(자동 재시도 금지). 기존 호출과 테스트 호환성보다 D2를 우선했다.
- A2. 필드가 생기기 전 작업(retryPolicy undefined)은 lastError에서 유도한다. `autoRetry===true`면 auto, `autoRetry`가 없을 때 dry_run+retryable이면 auto, 그 밖에는 operator_only, retryable=false면 never. 알 수 없는 저장값은 never(fail closed).
- A3. 오류 코드는 `result.ts`가 범위 밖이라 기존 코드를 재사용했다. operator 승인 필요는 `RETRY_NOT_ALLOWED`, 대사 인용 누락은 `RECONCILE_REQUIRED`, 게시 요청 전 결과는 `INVALID_TRANSITION`, 채널/모드 불가는 `MODE_MISMATCH`, basis 미확인은 `NOT_APPROVED`다. 메시지로 구분한다.
- A4. `approveRerun`은 actor 권한(D1)과 basis 재검사를 할 수 없다. `basisRechecked: true` 리터럴 타입으로 호출자 책임을 드러냈다. 실제 보장은 DB `distribution_approve_rerun`이 한다.
- A5. 재시도·재실행 뒤에도 lastError를 남긴다(DB도 last_error를 지우지 않음). retryPolicy만 null로 만든다.
- A6. manual 전이(manual_ready→awaiting_evidence→published/unknown/abandoned)를 다루는 순수 함수는 추가하지 않았다(최소 변경). 상태와 타입만 표현한다.

## 4. 기존 테스트 계약 격차 (수정·실행하지 않음, 정적 판독)
- `tests/distribution/jobs.test.ts:72` blog+live createJob이 "OK"를 기대하지만 이제 `MODE_MISMATCH`.
- `jobs.test.ts:134` confirmed_absent 뒤 `retryFailed`→scheduled를 기대하지만 이제 `RETRY_NOT_ALLOWED`(D2 의도). `approveRerun` 경로로 다시 써야 한다.
- `jobs.test.ts:147-155` live retryable 실패 뒤 `retryFailed`를 기대하지만 `applyLive`가 `publishRequested`를 넘기지 않아 operator_only가 되고 `must()`에서 throw. `{ attempt, publishRequested: false }`가 필요하다.
- `qa-boundaries.test.ts`, `qa-decisions.test.ts`: `draft()` 기본 채널이 **blog**이고 대부분 `mode:"live"`라서 해당 createJob이 대량으로 `MODE_MISMATCH`가 된다(D3 열린 작업, D4, D5, #2 늦은 증거 등). 채널을 threads/instagram으로 바꿔야 한다. `qa-boundaries:104`와 `qa-decisions:79`는 retryFailed 재시도라서 위와 같이 `publishRequested:false`도 필요하다.
- `adapters-utm.test.ts:39,56`: blog draft로 live createJob을 기대하지만 `MODE_MISMATCH`. live 어댑터 거절 시나리오는 threads draft로 바꿔야 한다.
- `qa-boundaries:92`(D4 오염)와 `qa-decisions:127`(잘못된 ID → INVALID_INPUT)은 계속 기대대로 동작할 것으로 판단한다.
- 신규 테스트가 필요하다: approveRerun 거부/허용 매트릭스, classifyFailure 표, effectiveRetryPolicy 조작 방어, manual 생성·중복, publishRequested=false일 때 published/unknown 거부.

## 5. 후속 연결 필요사항
1. 테스트 계약 개정 작업(위 §4). D2가 "검증은 별도 승인 시"라고 정했으므로 Master 배정이 필요하다.
2. `result.ts`에 전용 오류 코드 추가 검토: `OPERATOR_APPROVAL_REQUIRED`, `PUBLISH_NOT_REQUESTED`, `REPUBLISH_CONFIRMATION_REQUIRED`, `MODE_NOT_ALLOWED`.
3. `late-evidence.ts` manual 지원(DB는 dry_run만 거부).
4. 서버/워커 연결: DB 행(snake_case, last_error jsonb {code,message?,retryable,autoRetry})과 `PublishJob` 매퍼, DB 예외 → DResult 코드 매핑, 워커에서 `publishRequested`를 attempts.publish_requested_at에서 채우기.
5. PublishJob에 `phase`/`holdReason`/`reconciliationRequired`/`version` 표현 여부 결정(현재는 서버가 확인해야 할 항목).
6. manual 전이 순수 함수(markManualPosted / recordManualEvidence / abandon / markUncertain)가 필요한지 결정.

## 6. 검증
- **미실행**: build, typecheck, lint, vitest, SQL/PGlite/DB, 외부 호출 모두 실행하지 않았다(지시에 따른 금지). 타입 정합성은 정적으로 판독만 했다. `tsconfig`의 strict, noUncheckedIndexedAccess, isolatedModules를 고려했지만 컴파일러로 확인하지는 않았다.
- 패키지를 설치하지 않았고 자격정보 파일을 열지 않았다.

---

## 7. 보완 (정적 리뷰 지적 2건 · Orca task_5338bc2f2175 · 2026-11-16)

### 7.1 멱등키 콘텐츠 ID 형식 (지적 1)
- **소스에서 확인한 사실**
  - DB `distribution_contents.id`는 `uuid default gen_random_uuid()`이다(M1 `20261116030000_distribution_content.sql:89`).
  - jobs의 `idempotency_key`는 INSERT 트리거가 uuid 열로 계산한다(클라이언트 값은 쓰지 않음).
  - check 정규식은 `^pub:<소문자 8-4-4-4-12>:v[1-9][0-9]*:(blog|threads|instagram):(live|dry_run|manual)$`이다(M2 `:132`).
  - 앱이 지금 실제로 쓰는 ID는 로컬 일반 문자열뿐이다. 미리보기 컴포넌트는 `'local-preview'`/`local-job-N`(`content-distribution-preview.tsx:58,109`), 테스트는 `c1`/`c-why`를 쓴다. DB에서 ID를 읽어 오는 매퍼는 아직 없다.
- **변경 (`idempotency.ts`, `jobs.ts`)**
  - `makeIdempotencyKey(params, { idFormat?: "local" | "db" })`. 기본값은 `local`(기존 동작 유지)이다.
  - `db`는 소문자 uuid만 허용하고 버전은 PostgreSQL integer 상한 이하로 제한한다. 대문자 uuid는 정규화하지 않고 거부한다. 생성한 키가 `DB_IDEMPOTENCY_KEY_PATTERN`(SQL check와 같은 정규식)을 통과하지 않으면 실패한다.
  - `isDbIdempotencyKey(key)`를 공개했다. `CreateJobInput.idFormat?`은 그대로 전달만 한다.
- **유지 결정과 한계**
  - `local` 형식은 미리보기와 테스트용으로 유지한다. 주석에 SQL 호환을 보장하지 않는다고 명시했다.
  - `local` 키가 DB 형식이라고 주장하지 않는다. DB와 맞물리는 서버 경로와 매퍼는 반드시 `idFormat: "db"`를 써야 한다.
  - DB 매퍼(미구현)는 DB가 돌려준 `uuid::text`와 `content_version_no`를 그대로 넘겨야 한다. DB 행의 `idempotency_key`는 DB 값을 정본으로 쓴다(TS에서 다시 계산하지 않음).
  - 작업 ID(`isValidJobId`, 로컬 형식)도 DB의 uuid와 다르다. 이번 지적 범위 밖이라 그대로 두었고, 매퍼 작업에서 같은 방식으로 처리해야 한다.

### 7.2 manual 증거 URL·외부 ID (지적 2)
- **DB 근거**
  - `public.distribution_manual_evidence_host_allowed(channel, host)`는 channel이 `'blog'`이고 host가 `blog.naver.com`/`m.blog.naver.com` 중 하나일 때만 허용한다. 지적문에는 `private.`로 적혀 있지만 실제 스키마는 **public**이다(M2 `:732`).
  - host는 `lower(substring(url from '^https://([^/?#:@]+)'))`로 추출한다. 이 함수를 쓰는 곳은 manual 증거, 대사, 수락, 정정이다(`:2290,2449,2672,2744`).
  - `external_url` check는 2048자 이하, 정규식 `^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$`이다. `external_post_id`는 `^[^[:space:][:cntrl:]]{1,200}$`이다.
  - evidence `manual_id_note` 제약상 operator_manual 증거에 URL이 없으면 method_note가 필수다.
- **신규 helper `evidence-rules.ts`** (재노출은 `jobs.ts`가 담당)
  - `isDbShapedEvidenceUrl`: DB URL 정규식과 길이를 그대로 검사한다.
  - `isValidExternalId`: 공백, C0/DEL/C1 제어문자를 거부하고 UTF-16 기준 200자 이하로 제한한다. DB와 같거나 더 엄격하다.
  - `MANUAL_EVIDENCE_HOSTS`, `manualEvidenceHostAllowed(channel, url)`, `MANUAL_METHOD_NOTE_MAX`를 추가했다.
  - 처리 기준:

    | 항목 | 처리 |
    |---|---|
    | 대소문자 | host만 소문자로 비교해 `BLOG.NAVER.COM`도 허용한다(DB와 같음). scheme은 DB 정규식처럼 소문자 `https://`만 허용한다. |
    | port | DB는 `:` 앞에서 잘라서 `blog.naver.com:8443`도 허용하지만, 앱은 port가 있으면 **거부**한다(더 엄격). |
    | credential | authority에 `@`가 있으면 거부한다. 일반 검사에서도 username/password를 거부한다. |
    | 기타 host | 끝에 점이 붙은 host, 하위 도메인 변형, `\` 변형은 정확히 일치하지 않으므로 거부한다. |
    | path/query/fragment | DB처럼 공백이 없으면 제한하지 않는다. |
- **`jobs.ts` 반영**
  - `isValidEvidenceUrl`이 기존 URL 파싱 검사에 더해 DB URL 형태도 요구한다. live, 대사, 늦은 증거에 공통으로 적용된다.
  - `applyResult(published)`와 `reconcileUnknown(found_published)`는 trim한 뒤 `isValidExternalId`로 검사한다.
  - `reconcileUnknown(found_published)`가 manual 작업이면 추가로 검사한다.
    - URL이 있으면 `manualEvidenceHostAllowed`를 통과해야 한다. 실패하면 `NO_EVIDENCE`다.
    - URL 없이 외부 ID만 있으면 `methodNote`(새 optional 필드, trim 후 1~1000자)가 있어야 한다. DB `manual_id_note`와 reconciliation observation 계약에 맞춘 것이다.
  - 외부 ID 필수는 기존 앱 계약을 유지했다. DB는 manual URL만 있는 증거도 허용하지만, 앱이 더 엄격한 쪽이므로 안전하다(격차로 기록).
- **기존 테스트 영향 (정적 판독)**
  - 테스트가 허용을 기대하는 URL(`https://example.invalid`, `/p/1`, utm 쿼리)은 모두 DB 형태를 통과한다. 거부를 기대하는 URL(`http:`, credential 포함)은 계속 거부된다. 대상은 `qa-decisions.test.ts:107-113`, `adapters-utm.test.ts:86-99`이다.
  - `makeIdempotencyKey` 테스트(`adapters-utm.test.ts:65-72`)는 기본 `local`을 쓰므로 기대가 바뀌지 않는다.
  - manual found_published 테스트는 없다.
- **남은 격차와 위험**
  - (a) manual URL만 있는 증거는 앱에서 표현할 수 없다(`externalId` 타입 필수).
  - (b) D7 허용 호스트 최종안이 정해지면 DB 함수와 `MANUAL_EVIDENCE_HOSTS`를 함께 바꿔야 한다.
  - (c) `late-evidence.ts`는 아직 trim 후 비어 있는지만 확인한다(범위 밖). URL 검사는 `isValidEvidenceUrl`을 통해 강화됐다.
  - (d) PG `[:space:]`/`[:cntrl:]`의 locale 의존 범위는 JS `\s`와 제어문자 범위로 근사했다. 같은지 실행으로 검증하지 않았다.
  - (e) ESLint `no-control-regex` 규칙이 켜져 있으면 `evidence-rules.ts`의 `\x00-\x1f`가 경고될 수 있다(lint 미실행).

### 7.3 변경 파일 (보완분)
- `web/src/lib/distribution/idempotency.ts`, `jobs.ts`, `evidence-rules.ts`(신규), 이 보고서 §7. `retry-policy.ts`는 변경하지 않았다.

### 7.4 검증
- **미실행**: build, typecheck, lint, test, SQL/PGlite. 테스트는 추가하지 않았다. diff와 SQL·호출부 정적 대조만 했다.
