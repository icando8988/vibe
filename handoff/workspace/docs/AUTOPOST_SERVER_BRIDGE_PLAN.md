# AUTOPOST-SERVER-BRIDGE-PLAN-001 — 콘텐츠 배포 콘솔 UI → 서버 → DB 연결 명세

작성 2026-11-16 · Claude Code(CC-ENG-01) · Master CX-MASTER-01 · task_e4a6b9150278 / dispatch ctx_91996d36ebed.
상태: **설계 명세(ready_review).** 이 문서의 파일·함수·액션 이름은 구현 제안이며, 어떤 것도 아직 만들어지지 않았다. 운영 준비 완료나 저장 가능 상태를 뜻하지 않는다.

근거(로컬 정적 열람만):
- `docs/AUTOPOST_CONSOLE_UI_PLAN.md`(W1~W9)
- 현행 콘솔 UI: `web/src/app/admin/distribution/**`, `web/src/components/distribution-console/*`
- SQL(어떤 DB에도 미적용·미실행):
  - M1 `20261116030000_distribution_content.sql`
  - M2 `20261116040000_distribution_jobs.sql`
  - 050000 `20261116050000_distribution_content_write_api.sql`
- 인증 서버 패턴: `web/src/lib/supabase/server.ts`, `web/src/lib/auth/viewer.ts`, `web/src/app/login/actions.ts`
- 앱 도메인: `web/src/lib/distribution/*`

네트워크, DB, env·키 파일 열람, 코드·SQL 수정은 없었다.

---

## 0. 선행 차단과 분리 가능한 작업

| 구분 | 내용 |
|---|---|
| **선행 차단 B1** | 로컬 DB 실행기 없음(psql·postgres·Docker·WSL·PGlite 모두 없음, `.ai/results/AUTOPOST-M1-VERIFY-001-CC-ENG.md`). M0~M2와 050000의 **SQL 실행 검증 0건**. 구문, 트리거, RLS, ACL, 해시 함수가 실제로 동작하는지 모른다. |
| **선행 차단 B2** | 실제 Supabase(서울)에 M1/M2/050000 미적용. 적용하려면 사용자 승인과 B1 검증 결과가 먼저 필요하다. |
| **선행 차단 B3** | service_role(secret) 키를 서버 env에 두지 않았다. 지금 Vercel에는 공개 변수 2개만 있다. 쓰기 RPC는 전부 `grant execute … to service_role`이라, 키 없이는 어떤 쓰기도 할 수 없다. 키 발급·보관·Vercel 등록은 사용자 결정이다. |
| **DB 없이 가능(P0)** | 서버 전용 모듈의 경계와 타입, actor 도출, 오류 매핑 순수 함수, DTO 변환 순수 함수, 입력 검증, 가짜 Supabase 클라이언트로 하는 단위 테스트, 서버 액션의 골격(실행하면 "준비 전"을 돌려주는 상태). §7 P0 참조. |

B1~B3가 풀리기 전에는 콘솔의 어떤 버튼도 활성화하지 않는다(현행 `DATA_SOURCE_CONNECTED=false` 유지).

---

## 1. 경계 구조

```
[브라우저]  ──form POST(서버 액션)──▶  [Next 서버: app/admin/distribution/**]
    ▲                                   │ 1) createSupabaseServerClient()  (사용자 세션 쿠키, publishable 키)
    │                                   │ 2) auth.getUser()  → 검증된 user.id = actor
    │  redirect + notice 코드           │ 3) D1 재검사(앱): getViewer → decideDistributionAccess
    │                                   │
    │      조회: 사용자 세션 클라이언트 ─┼──▶ PostgREST SELECT (명시 열) ─▶ RLS: private.is_distribution_admin()
    │                                   │
    │      쓰기: service-role 클라이언트 ┼──▶ rpc(distribution_*, {p_actor_id: actor, …})
    │                                   │        └▶ DB: distribution_assert_admin_actor(actor)  (D1 3차)
```

- **조회는 service_role을 쓰지 않는다.** M1/M2가 `authenticated`에 열 단위 SELECT를 주고, 행은 RLS `private.is_distribution_admin()`(auth.uid() 기준 admin + approved)으로 거른다. 사용자 세션 클라이언트로 조회하면 DB가 D1을 한 번 더 강제한다.
- **쓰기는 service_role 전용 RPC만 쓴다.** M1 테이블의 직접 DML은 050000에서 service_role까지 회수됐고, M2 테이블도 DML 권한이 없다.
- **actor 위조 방지:** `p_actor_id`는 서버가 `auth.getUser()`로 검증한 `user.id`만 넣는다. 폼, 쿼리, 헤더 값은 절대 쓰지 않는다. DB는 그 actor가 승인된 admin인지까지만 확인하므로(050000 헤더 주석), 위조 방지는 "service_role 키가 서버에만 있다"는 사실에 의존한다.
- **D1 검사 3겹:**
  1. page 렌더(현행 `denyUnlessDistributionAdmin`)
  2. 서버 액션 진입 시 재검사(같은 판정 함수)
  3. DB의 `distribution_assert_admin_actor` / RLS

  서버 액션은 page 접근 판정을 믿지 않는다. 서버 액션 POST는 page를 거치지 않고 직접 들어올 수 있기 때문이다.

---

## 2. 신규 서버 모듈 (구현 파일 범위)

모든 신규 파일은 서버 전용이다. 클라이언트 컴포넌트에서 import하면 안 된다.

| 파일(제안) | 역할 | DB 필요 |
|---|---|---|
| `web/src/lib/supabase/admin.ts` | `createSupabaseServiceClient()`: env `SUPABASE_SECRET_KEY`(이름 제안, 값 `sb_secret_…`)와 기존 `NEXT_PUBLIC_SUPABASE_URL`로 만든다. `auth: { persistSession:false, autoRefreshToken:false }`, 쿠키 없음. 키가 없거나 형식이 틀리면 **null**(앱은 "준비 전"). 공개 변수에 secret이 들어가면 쓰지 않는 기존 `parseSupabaseConfig` 규칙과 짝을 이룬다 | 키만 |
| `web/src/server/distribution/actor.ts` | `requireDistributionActor()`: `createSupabaseServerClient` → `auth.getUser()` → `getViewer()` → `decideDistributionAccess`. 반환값은 `{ok:true, actorId}` 또는 `{ok:false, reason}` | 세션 |
| `web/src/server/distribution/errors.ts` | `mapDistributionDbError(PostgrestError) → ConsoleErrorCode`(§5). 원문 메시지는 로그·응답에 넣지 않는다 | 없음(순수) |
| `web/src/server/distribution/rpc.ts` | §4의 RPC별 타입 래퍼. jsonb 반환값을 zod 없이 수동으로 좁혀 DTO로 만든다 | service |
| `web/src/server/distribution/read.ts` | §3의 조회 함수(명시 열, 페이지 크기 상한) | 세션 |
| `web/src/server/distribution/dto.ts` | DB 행 → 화면 DTO 순수 변환(유효 승인 판정 포함, §3.4) | 없음(순수) |
| `web/src/app/admin/distribution/**/actions.ts` | 화면별 `"use server"` 액션(§4). 각 액션 첫 줄에서 `requireDistributionActor()`를 부른다 | service |
| `web/tests/distribution-server/*.test.ts` | 오류 매핑, actor 도출, DTO 변환, 액션 입력 검증. Supabase 클라이언트는 주입한 가짜를 쓴다 | 없음 |

**서버 전용 강제 방법(결정 필요):** `server-only` 패키지가 없다. 패키지 추가는 승인 사항이다.
- 대안 ①: Next가 번들 시 alias로 제공하는 `import "server-only"`를 쓰고, vitest에는 alias를 따로 둔다.
- 대안 ②: `admin.ts`를 `"use server"` 파일에서만 import하도록 ESLint `no-restricted-imports`를 설정하고, 모듈 상단에서 `typeof window !== "undefined"`이면 throw한다.

어느 쪽이든, client bundle에 `SUPABASE_SECRET_KEY` 문자열이 없는지 build 산출물에서 grep하는 것을 수락 조건으로 둔다.

**하지 않는 것:** HTTP API 라우트(`/api/distribution/*`)를 새로 열지 않는다. 화면 조회는 서버 컴포넌트가 직접 하고, 쓰기는 서버 액션으로 한다. 외부 워커용 엔드포인트는 §6.3의 별도 결정이다.

---

## 3. 조회 (서버 컴포넌트에서 사용자 세션으로)

공통 규칙:
- `select=*`는 금지하고 GRANT에 있는 열만 명시한다. `created_xact_id`, `container_recorded_xact_id`는 GRANT에서 빠져 있다.
- 목록은 `limit` 상한 50, `order` 고정(아래 표).
- 조회 실패는 구획별 오류로 표시하고 게시 실패로 바꾸지 않는다.
- 결과가 0건이면 "조회 성공·없음"으로 표시해, 지금의 "미연결"과 구분한다.

### 3.1 화면별 조회

| 화면 | 함수(제안) | 테이블·열 | 필터·정렬 | 출력 DTO |
|---|---|---|---|---|
| W2 `/contents` | `listContents({q?, channel?, review?, cursor?})` | `distribution_contents`(id, current_version_id, current_version_no, archived_at, updated_at)과 현재 버전 `distribution_content_versions`(title) | `archived_at is null` 기본, `updated_at desc, id desc`, 키셋 커서 | `{id, title, versionNo, updatedAt, channels:{[c]:{draftId?, reviewState}}}` |
| W3 `/contents/[id]` | `getContent(id)` | contents 1행 + 현재 버전(title, body, target_path, source_refs, media_asset_ids, content_hash, change_summary, created_by, created_at) + 버전 이력(id, version_no, change_summary, created_at, content_hash) + 채널 초안 3행 + 관련 jobs 요약 | 이력 `version_no desc` limit 20 | `{content, currentVersion, versions[], drafts{blog,threads,instagram}, approvalOfCurrent, jobs[]}` |
| W4 `/channels/[c]` | `getDraft(contentId, channel)` | `distribution_channel_drafts`(id, current_revision_id, current_revision_no, archived_at) + 현재 리비전(body, link_url, utm, target_*, validation, revision_hash, content_version_id) + `distribution_draft_revision_media` | 초안이 없으면 `null` → "초안 만들기" | `{draft?, revision?, media[], basedOnLatest:boolean, expected:{revisionNo, contentVersionId}}` |
| W4 `/review` | `getReviewSubject(contentId, channel)` | W4 데이터 + 대상 리비전의 `revision_hash` + 원문 현재 버전 `content_hash` + 해당 대상 approvals 이력 | — | `{subjectType, subjectId, subjectHash, effectiveApproval?, history[]}`. **`subjectHash`는 검토 화면에 보인 값 그대로 승인 액션의 `expected_subject_hash`로 넘긴다** |
| W9 `/prepare` | `getPrepare(contentId)` | 채널별 현재 리비전, 유효 승인(리비전·원문 버전 둘 다), 기존 jobs(status, mode, hold_reason) | — | 채널별 `{approvedRevisionId?, contentApproved, existingJob?, blockedReasons[]}` |
| W7 `/jobs` | `listJobs({channel?, status?, mode?, cursor?})` | `distribution_jobs`(id, content_id, content_version_no, channel, mode, status, phase, hold_reason, scheduled_at, schedule_tz, retry_policy, has_issues, reconciliation_required, version, updated_at) | 조치 필요 우선: `reconciliation_required desc`, status 순위(unknown → failed → scheduled+hold) → `updated_at desc`. 정렬은 앱에서 하되 limit 안에서 | `{id, channel, mode, status, phase, hold, issues:boolean, scheduledAt, tz, version}` |
| W8 `/jobs/[id]` | `getJob(id)` | jobs 1행(GRANT 열 전부) + attempts + events(`seq asc`) + evidence + reconciliations | events limit 200 | `{job, attempts[], events[], evidence[], reconciliations[], expectedVersion: job.version}` |
| W8 `/manual` | `getManualJob(id)` | getJob과 승인 리비전 본문(제목/본문 복사용) | mode ≠ manual이면 안내 | `{job, approvedText, evidence[]}` |
| W8 `/reconcile` | getJob 재사용 | — | status ≠ unknown이면 기록 비활성 | 동일 |
| W5 `/connections` | 없음 | M3 미구현 | — | 현행 정적 표시 유지 |
| W6 `/media` | 없음 | M4 미구현(미디어 자산 테이블 없음. `media_asset_ids`는 아직 참조할 대상이 없다) | — | 현행 유지 |
| W1 개요 | `getOverview()` | listJobs 상위 10건(조치 필요) | — | 건수 집계는 하지 않음(성공률·차트 금지) |

### 3.2 PostgREST 임베드 주의
`distribution_contents.current_version_id`는 "같은 content의 버전만" 참조하는 FK다(M1 93행). PostgREST가 이 관계를 임베드 대상으로 인식하는지는 **미확인**이다(B1). 인식하지 못하면 2단계 조회로 처리한다: contents → `in(current_version_id)`로 versions. 이 경우에도 새 view는 필요 없다.

### 3.3 검색
제목 검색은 현재 버전 title에 대해 `ilike`로 한다. 그러려면 2단계 조회를 해야 해서 페이지 경계가 흔들린다. **필요 작업 N1(선택):** `security_invoker = true` view `distribution_content_list`(contents + 현재 버전 title, RLS 그대로). 검색을 출시 범위에서 빼면 필요 없다.

### 3.4 유효 승인 판정 (중요)
DB의 `distribution_effective_approval_id(subject_type, subject_id)`는 **service_role까지 EXECUTE가 회수된 내부 helper**다(M2 2817행). 따라서 조회 경로에서는 호출할 수 없다. 화면은 `distribution_approvals` 행(authenticated SELECT 허용)으로 같은 규칙을 앱에서 재현해야 한다.
- **필요 작업 N2:** M2 helper의 판정 규칙(`created_at desc, id desc` 최신 결정, `revoked`가 대상 승인을 무효화)을 `dto.ts` 순수 함수로 옮기고, 같은 입력으로 SQL과 일치하는지 DB 검증(B1 해소 후)에 포함한다.
- 대안: `security_invoker` view `distribution_effective_approvals`를 신규 migration으로 만든다. SQL 변경이라 별도 승인이 필요하다.
- 화면 표시는 참고용이다. 실제 판정은 언제나 쓰기 RPC(`create_job`의 NOT_APPROVED, `decide_approval`의 ALREADY_APPROVED)가 한다.

---

## 4. 쓰기 (서버 액션 → service-role RPC)

모든 액션의 공통 순서:
1. `requireDistributionActor()` — 실패하면 거부 notice로 끝나고 RPC를 호출하지 않는다.
2. FormData를 앱에서 검증(형식·길이만, §4.3). 통과하지 못하면 RPC 없이 `invalid_input`.
3. `createSupabaseServiceClient()` — null이면 `not_ready`.
4. `rpc(name, {p_actor_id: actorId, …})` — 오류는 §5 매핑.
5. 성공하면 `revalidatePath(해당 화면)` 후 `redirect(화면?notice=…)`. 실패하면 같은 화면으로 `notice=<code>`. 입력 원문은 URL에 싣지 않는다.

입력 보존(충돌 시)은 별도 결정이다. 서버 액션의 `useActionState`로 입력을 돌려주려면 그 폼만 클라이언트 컴포넌트가 된다. 우선 출시에서는 "최신 내용을 다시 불러온 뒤 다시 입력"으로 안내하는 것을 권장한다.

### 4.1 우선 출시 경로 (원문 → 초안 → 승인 → Blog manual / dry_run)

| # | 화면·액션(제안) | 실제 RPC 시그니처 (SQL 대조) | 폼 → 인자 | 동시성 토큰 | 반환(jsonb/형) → UI |
|---|---|---|---|---|---|
| A1 | `/contents/new` `createContentAction` | `distribution_create_content(p_actor_id uuid, p_title text, p_body text, p_story_slug text=null, p_target_path text=null, p_source_refs jsonb='[]', p_media_asset_ids uuid[]='{}', p_change_summary text=null) returns jsonb` | title, body, target_path(내부 경로만, `safeReturnTo`와 같은 규칙), source_refs(구조 결정 전에는 `[]`), change_summary | 없음(신규) | `{content_id, version_id, version_no:1, content_hash}` → `/contents/{content_id}?notice=content_created` |
| A2 | `/contents/[id]` `appendContentVersionAction` | `distribution_append_content_version(p_actor_id, p_content_id uuid, p_expected_version_no integer, p_title, p_body, p_target_path=null, p_source_refs='[]', p_media_asset_ids='{}', p_change_summary=null) returns jsonb` | hidden `expectedVersionNo`(화면 렌더 시점 `current_version_no`) | **expected_version_no** | `{content_id, version_id, version_no, content_hash}`. 성공하면 이전 승인과 초안이 stale이 됨을 안내 |
| A3 | `/channels/[c]` `createDraftAction` | `distribution_create_channel_draft(p_actor_id, p_content_id uuid, p_channel text) returns jsonb` | channel(path, `isChannel` 확인) | DUPLICATE로 중복 방지 | `{draft_id, content_id, channel}` |
| A4 | `/channels/[c]` `appendDraftRevisionAction` | `distribution_append_draft_revision(p_actor_id, p_draft_id uuid, p_expected_revision_no integer, p_expected_content_version_id uuid, p_body text, p_link_url=null, p_utm jsonb='{}', p_target_connection_id uuid=null, p_target_external_account_id text=null, p_validation jsonb='{}', p_media jsonb='[]') returns jsonb` | Blog는 제목+본문. **결정 필요 N3:** 리비전에 title 열이 없다(body만). Blog 제목을 body 첫 줄 규칙으로 할지, 열을 추가하는 migration을 할지 정해야 한다. hidden `expectedRevisionNo`, `expectedContentVersionId` | **expected_revision_no + expected_content_version_id** | `{draft_id, revision_id, revision_no, content_version_id, revision_hash, media_count}` |
| A5 | `/review`(원문) `decideContentApprovalAction` | `distribution_decide_approval(p_actor_id, p_subject_type text, p_subject_id uuid, p_decision text, p_expected_subject_hash text, p_checklist jsonb='{}', p_reason text=null) returns jsonb` | subject_type=`content_version`, subject_id=현재 버전 id, decision=approved/rejected, hidden `expectedSubjectHash`=화면에 보인 `content_hash`, checklist(체크박스 → `{snake_key:true}`), 반려 사유 | **expected_subject_hash** + 최신 확인(NOT_LATEST) | `{approval_id, subject_type, subject_id, decision, subject_hash}` |
| A6 | `/review`(채널) 같은 액션 | 같은 RPC, subject_type=`draft_revision` | expectedSubjectHash=`revision_hash` | 위와 같음 + STALE_CONTENT_VERSION | 위와 같음 |
| A7 | `/review` `revokeApprovalAction` | `distribution_revoke_approval(p_actor_id, p_approval_id uuid, p_reason text) returns jsonb` | approval_id, reason(필수) | ALREADY_REVOKED | `{approval_id, revokes_approval_id, subject_type, subject_id}`. **UI 설계(W4)에 철회 버튼이 없다 → 디자인 추가 필요** |
| A8 | `/prepare` `createBlogManualJobAction` | `distribution_create_job(p_actor_id uuid, p_draft_revision_id uuid, p_mode text, p_scheduled_at timestamptz=null, p_schedule_tz text=null, p_max_attempts integer=3, p_allow_republish boolean=false) returns uuid` | revision_id=승인된 현재 리비전, mode=`manual`, schedule는 보내지 않음(manual은 예약 불가, SQL 확인) | DUPLICATE, NOT_APPROVED, REPUBLISH_CONFIRMATION_REQUIRED | job uuid. 초기 status는 INSERT 트리거가 `manual_ready`로 정한다 → `/jobs/{id}/manual` |
| A9 | `/manual` `markManualPostedAction` | `distribution_mark_manual_posted(p_actor_id, p_job_id uuid, p_expected_version integer) returns void` | hidden `expectedVersion`=job.version | **expected_version** | → awaiting_evidence. "게시 확인 아님" 문구 유지 |
| A10 | `/manual` `recordManualEvidenceAction` | `distribution_record_manual_evidence(p_actor_id, p_job_id, p_expected_version integer, p_external_post_id text, p_external_url text, p_external_account_id text, p_observed_at timestamptz, p_method_note text=null) returns uuid` | url은 앱에서 먼저 `manualEvidenceHostAllowed`(evidence-rules.ts) 검사. DB의 `distribution_manual_evidence_host_allowed`는 blog.naver.com과 m.blog.naver.com만 허용한다. observed_at은 `datetime-local` + 시간대 → UTC | expected_version, EVIDENCE_CONFLICT | evidence uuid → published |
| A11 | `/manual` `abandonManualJobAction` | `distribution_abandon_manual_job(p_actor_id, p_job_id, p_expected_version, p_reason text, p_acknowledge_may_remain_external boolean) returns void` | 확인 체크박스 필수 | expected_version | → abandoned(키 점유 유지 안내) |
| A12 | `/manual` `markManualUncertainAction` | `distribution_mark_manual_uncertain(p_actor_id, p_job_id, p_expected_version, p_reason) returns void` | — | expected_version | → unknown(대사 화면 안내) |
| A13 | `/reconcile` `recordReconciliationAction` | `distribution_record_reconciliation(p_actor_kind text, p_actor_id uuid, p_job_id uuid, p_expected_version integer, p_method text, p_finding text, p_checked_scope jsonb, p_observed_at timestamptz, p_observation text, p_attempt_no integer=null, p_external_post_id text=null, p_external_url text=null, p_external_account_id text=null, p_next_check_at timestamptz=null, p_next_check_owner text=null) returns uuid` | **p_actor_kind는 서버가 `'admin'`으로 고정한다(폼 값 금지).** finding = 게시 확인/부재 확인/여전히 불명 | expected_version | 대사 uuid. 부재 확인이 재게시 허가가 아님을 유지 |
| A14 | `/jobs/[id]` `cancelJobAction` | `distribution_cancel_job(p_actor_id, p_job_id, p_expected_version, p_reason text=null) returns text` | — | expected_version, CANCEL_REQUESTED | 결과 상태 text(요청과 확정을 구분해 표시) |
| A15 | 보관(설계 화면 없음) | `distribution_archive_content(p_actor_id, p_content_id, p_reason) returns jsonb`, `distribution_archive_channel_draft(p_actor_id, p_draft_id, p_reason) returns jsonb` | — | ALREADY_ARCHIVED | 우선 출시 범위 밖. 디자인 확정 후 |

### 4.2 Blog dry_run — **필요 작업 N4(실행기)**
`distribution_create_job(…, p_mode='dry_run')`은 status `scheduled`인 작업만 만든다. 실제 모의 실행은 다음 세 함수를 쓰는 **워커**가 해야 한다(모두 service_role).
- `distribution_claim_jobs(p_worker_id text, p_limit int=1, p_lease_seconds int=120) returns table(claimed_job_id, claimed_attempt_id, claimed_attempt_no, resumed)`
- `distribution_advance_phase(…)`
- `distribution_complete_attempt(p_job_id, p_attempt_id, p_worker_id, p_outcome, …) returns text`

지금은 워커와 스케줄러가 모두 없다. 그리고 `claim_jobs`는 전역 큐에서 꺼내므로 "방금 만든 그 작업"을 지정할 수 없다. 선택지는 아래와 같다(결정은 Master·사용자).
- (a) 서버 액션 안에서 `claim_jobs(worker_id='console-dryrun:<요청ID>', limit=1)` → 꺼낸 작업이 dry_run이면 `DryRunAdapter`(adapters.ts)로 미리보기 → `complete_attempt(outcome=dry_run_succeeded)`. **다른 작업을 꺼낼 위험**이 있으므로 live gate가 닫혀 있고 dry_run 외 scheduled 작업이 없다는 전제가 필요하다. 권장하지 않는다.
- (b) **신규 SQL N4:** `distribution_claim_job(p_worker_id text, p_job_id uuid, p_lease_seconds int)` — 특정 작업만 선점. migration 변경이라 별도 승인과 검증이 필요하다.
- (c) Vercel Cron 등 별도 워커. 비용과 운영 결정이 필요하다.

권장: 우선 출시는 **Blog manual(A8~A13)만 먼저** 하고, dry_run은 N4 결정 뒤로 미룬다. 그 전까지 W9의 "모의 실행" 버튼은 현재처럼 비활성으로 둔다.

### 4.3 앱 쪽 입력 검증 (DB 검증과 중복이지만 오류 문구를 정확히 하려고 둔다)
- title/body는 필수. 길이 상한은 DB 제약(M1 테이블 check)과 같은 값을 쓴다. 값은 B1 검증 때 확정한다.
- 아래는 **DB 규칙을 그대로 옮긴다**(050000).
  - utm: 소문자 키 10개 이하, 값은 1~200자 문자열
  - checklist: snake_case 키 50개 이하에 boolean만. 승인할 때는 비어 있지 않고 모두 true
  - media: 20개 이하, `{asset_id, variant_id?, alt_text?≤1000}`
- 텍스트는 정규화하지 않는다(trim·NFC 없음). 해시가 저장 값 그대로를 기준으로 하기 때문이다(050000 해시 v1).
- uuid 형식은 앱에서 먼저 확인한다(현행 `isWellFormedId`보다 엄격한 UUID 검사가 필요하다).

### 4.4 후속 채널 (우선 출시 이후)
- **Threads:**
  - 필요: M3(연결·자격정보·계정 일치), live 어댑터, `distribution_live_gate()` 해제 migration(지금은 `select false`)
  - 그다음 A8의 mode=`live` + 예약(`distribution_reschedule_job`)
  - 워커(N4/c) 필수
- **Instagram:**
  - Threads의 조건 모두
  - M4 미디어 자산·권리 테이블과 업로드 경로(`p_media`의 asset_id가 참조할 대상이 지금 없다)
  - 컨테이너 단계(`advance_phase`), 늦은 증거(`distribution_record_late_evidence`, `distribution_resolve_evidence`, `distribution_correct_evidence`)
- 재실행 승인 `distribution_approve_rerun(p_actor_id, p_job_id, p_expected_version, p_reason, p_reconciliation_id=null, p_scheduled_at=null, p_schedule_tz=null) returns void`는 live 작업에만 의미가 있다. gate가 닫혀 있으면 LIVE_GATE_CLOSED(feature_not_supported)로 실패한다.

---

## 5. 오류 매핑

PostgREST 오류는 `code`(SQLSTATE)와 `message`로 온다. 매핑 순서:
1. message가 `^[A-Z][A-Z_]+:` 형태(또는 정확히 `LIVE_GATE_CLOSED`)면 그 **토큰**으로 매핑한다.
2. 토큰이 없으면 SQLSTATE로 매핑한다.
3. 둘 다 없으면 `unexpected`.

message 본문(내부 ID·해시 포함)은 화면에 보이지 않는다. 서버 로그에도 토큰과 SQLSTATE만 남긴다.

| 토큰 / SQLSTATE | 출처 | UI 코드 | 화면 처리 |
|---|---|---|---|
| `42501` insufficient_privilege | `distribution_assert_admin_actor` | `forbidden` | 거부 화면. 앱 D1과 DB 판정이 어긋났다는 뜻이므로 경고 로그 |
| `VERSION_CONFLICT` | append_content_version, lock_job(M2 모든 expected_version 함수) | `conflict_version` | "다른 곳에서 먼저 바뀌었습니다. 최신 내용을 다시 불러오세요" + 새로고침 링크. 자동 재시도 금지 |
| `REVISION_CONFLICT` | append_draft_revision | `conflict_revision` | 위와 같음 |
| `STALE_CONTENT_VERSION` | append_draft_revision, decide_approval | `stale_content` | "원문이 새 버전으로 바뀌었습니다. 최신 원문 기준으로 초안을 다시 저장하세요" |
| `NOT_LATEST` | decide_approval | `not_latest` | "검토한 대상이 최신이 아닙니다" |
| `SUBJECT_CHANGED` (P0001) | decide_approval | `subject_changed` | "검토 화면을 연 뒤 내용이 바뀌었습니다. 다시 검토하세요" |
| `HASH_INTEGRITY` (XX001 data_corrupted) | decide_approval, 재계산 | `integrity_error` | 승인을 막고 운영 확인 요청. 사용자 조치로 해결되지 않는다 |
| `ALREADY_APPROVED` / `DECISION_IN_SAME_TRANSACTION` (P0001) | decide_approval | `already_decided` | 현재 승인 상태 다시 표시 |
| `ALREADY_REVOKED` (23505) | revoke_approval | `already_revoked` | 같음 |
| `CHECKLIST_INCOMPLETE` | assert_checklist | `checklist_incomplete` | 체크 항목 강조 |
| `ARCHIVED` / `ALREADY_ARCHIVED` (23514) | 050000 여러 곳 | `archived` | 편집 비활성 |
| `NO_CONTENT_VERSION` | append_draft_revision | `no_content_version` | 원문 먼저 저장 |
| `DUPLICATE` (23505) | create_channel_draft, create_job | `duplicate` | 기존 초안·작업으로 이동 링크(메시지의 ID는 보이지 않고 다시 조회해서 찾는다) |
| `NOT_APPROVED` | create_job | `not_approved` | W9 차단 사유 |
| `REPUBLISH_CONFIRMATION_REQUIRED` | create_job | `republish_confirmation` | 우선 출시에서는 재게시 확인 UI를 두지 않는다. 안내만 |
| `LIVE_GATE_CLOSED` (0A000 등) | create_job, approve_rerun | `live_gate_closed` | "실제 게시 gate 닫힘" |
| `INVALID_TRANSITION` / `MODE_MISMATCH` / `NO_EVIDENCE` / `CANCEL_REQUESTED` / `ATTEMPTS_EXHAUSTED` / `RETRY_NOT_ALLOWED` | M2 상태 전이 | `invalid_transition` | 최신 상태 다시 불러오기 |
| `EVIDENCE_CONFLICT` | 증거 기록 | `evidence_conflict` | "다른 작업에 이미 같은 게시물이 증거로 기록돼 있습니다" |
| `LEASE_NOT_HELD` / `55P03` / `CONTAINER_*` / `PUBLISH_NOT_REQUESTED` | 워커 전용 | `worker_error` | 콘솔 액션에서는 나오면 안 된다. 나오면 로그 |
| `P0002` no_data_found | 여러 곳 | `not_found` | 목록으로 |
| `22023` invalid_parameter_value | 입력 검증 | `invalid_input` | 앱 검증이 놓친 경우. 필드 지정 없이 일반 안내 |
| `23514` check_violation(토큰 없음) | 제약 | `invalid_input` | 같음 |
| `23503` foreign_key_violation | 참조 | `not_found` | 같음 |
| 네트워크·타임아웃 | — | `unavailable` | **쓰기는 결과 불명.** 같은 요청을 자동으로 재전송하지 않는다. "최신 상태를 확인하세요"(설계 7절 submitting 규칙) |

---

## 6. 동시성·멱등·보안 세부

### 6.1 기대값 토큰
- 원문: `expected_version_no`
- 초안: `expected_revision_no` + `expected_content_version_id`
- 승인: `expected_subject_hash`(+ 최신 대상 확인)
- 작업: `expected_version`(jobs.version. 가드가 갱신마다 +1)

토큰은 **페이지 렌더 시점의 값을 hidden input으로** 넣는다. 서버 액션에서 다시 조회해 채우면 충돌 검사가 무의미해지므로 금지한다.

### 6.2 중복 제출
- 버튼은 제출 중 비활성(`useFormStatus`는 클라이언트 컴포넌트가 필요하니 결정 사항).
- DB 쪽: create는 DUPLICATE, 상태 전이는 VERSION_CONFLICT로 두 번째 요청이 실패한다. 응답이 유실되면 다시 조회해서 확인한다.

### 6.3 service_role 격리
- 키 이름은 `NEXT_PUBLIC_` 접두가 붙지 않은 것만 쓴다.
- `admin.ts` 외에서 `createClient(…secret…)`를 금지한다.
- 서버 액션의 반환값에 DB 행 원문을 담지 않는다(ID와 notice만).
- 워커 엔드포인트(N4/c)를 만든다면 별도 서명·비밀(Cron secret)이 필요하다. 사람 세션 경로와 섞지 않는다.

### 6.4 캐시
- 콘솔은 이미 `force-dynamic`이고 `/admin/:path*`에 `no-store`가 붙어 있다.
- 쓰기 뒤에는 `revalidatePath`를 하고, 조회에 `unstable_cache`를 쓰지 않는다(사용자별 RLS 결과라서).

### 6.5 actor_kind
`record_reconciliation`의 `p_actor_kind`, 이벤트 컨텍스트의 actor_kind는 서버 상수 `'admin'`으로만 넣는다.

---

## 7. UI 연결 순서

| 단계 | 내용 | 선행 | 수락 조건 |
|---|---|---|---|
| **P0** (지금 가능, DB 불필요) | §2의 actor.ts, errors.ts, dto.ts(유효 승인 판정 N2 포함), 입력 검증, admin.ts(키가 없으면 null), 서버 액션 골격(키·DB가 없으면 `not_ready`) | 없음. 단 서버 전용 강제 방법 결정 필요 | 단위 테스트: (1) actor는 `getUser().id`만 쓰고 폼 값 무시 (2) D1 4케이스 거부 시 RPC 호출 0회 (3) §5 표의 모든 토큰·SQLSTATE 매핑 (4) 유효 승인 판정(승인 → 철회 → 재승인, 같은 시각 id 정렬) (5) client bundle에 secret 문자열 없음(build 산출물 grep). lint·typecheck·build 0 |
| P1 | B1 해소: 로컬 실행기로 M0~M2+050000 시나리오 검증(M1-VERIFY 계획) | B1 | 시나리오 전부 통과 기록 |
| P2 | B2·B3: 실제 DB 적용(사용자 승인), secret 키 서버 env 등록(사용자) | P1 | Advisor 경고 0, 실DB RLS 매트릭스(distribution 테이블 포함) 통과 |
| P3 | 조회 연결 W2·W3·W4·W7·W8(§3), `DATA_SOURCE_CONNECTED`를 화면별 플래그로 교체 | P2 | 비관리자·비승인 admin 세션으로 조회 시 0행(RLS), 승인 admin은 행 표시, 미연결/0건/오류 3상태 구분 |
| P4 | A1·A2 원문 저장 | P3 | 성공 시 version_no 증가, 다른 탭에서 저장 후 원래 탭 저장 → `conflict_version` |
| P5 | A3·A4 채널 초안 | P4, N3 결정 | 원문 새 버전 후 이전 화면 저장 → `stale_content` |
| P6 | A5~A7 승인·반려·철회 | P5 | 검토 후 초안 수정 → 승인 시 `subject_changed`. 철회 후 재승인 가능. 체크리스트 미완 → `checklist_incomplete` |
| P7 | A8~A14 Blog manual | P6 | manual_ready → awaiting_evidence → (blog.naver.com URL) published. 비허용 호스트 거부, EVIDENCE_CONFLICT, abandoned 키 점유, unknown → 대사, 재게시 CTA 없음 |
| P8 | Blog dry_run | N4 결정·구현 | dry_run_succeeded가 게시 집계에 섞이지 않음 |
| P9 | Threads | M3, live gate 해제 결정, 워커 | 별도 명세 |
| P10 | Instagram | P9 + M4 | 별도 명세 |

각 단계는 별도 배정·승인으로 진행한다. 이 문서는 어느 단계의 착수 승인도 아니다.

---

## 8. 필요 작업 목록 (현재 없는 것)

| ID | 필요 | 종류 | 막는 단계 |
|---|---|---|---|
| B1 | 로컬 DB 실행기(PGlite 설치 승인 또는 PostgreSQL 제공) | 환경·결정 | P1~ |
| B2 | 실제 DB 적용 승인 | 사용자 | P2~ |
| B3 | secret 키 발급·서버 env 등록 | 사용자 | P2~(쓰기) |
| N1 | 검색용 `security_invoker` view(선택) | SQL | W2 검색만 |
| N2 | 유효 승인 판정 앱 재현 + SQL 일치 검증(또는 view) | 앱(+SQL 선택) | P3·P6 표시 |
| N3 | Blog 제목 저장 방식(리비전에 title 열 없음) | 결정(+SQL 가능성) | P5 |
| N4 | dry_run 실행기 / 특정 작업 선점 함수 | 결정 + SQL 또는 인프라 | P8 |
| N5 | 서버 전용 모듈 강제 방법(`server-only` 패키지 승인 또는 대안) | 결정 | P0 |
| N6 | W4 철회 버튼, 반려 사유 입력, 보관 UI | 디자인 | P6, 보관 |
| N7 | 증거 시각 입력의 시간대 처리(datetime-local → UTC 규칙) | 결정 | P7 |
| N8 | M3 연결·자격정보, live gate 해제 migration | SQL·서버 | P9 |
| N9 | M4 미디어 자산·권리·업로드 | SQL·서버 | P10, Instagram |
| N10 | 자기 승인 금지, 필수 체크리스트 키 | 정책 | P6(현재는 승인된 admin이면 누구나) |

---

## 10. 원본 키트 기반 이식 작업표 (사용자 방향 변경 반영)

Master msg_cea4fe3cd7e2: 사용자 지시 "소스가 있으니 그걸 그대로 적용 후 수정해 나가면 된다". 이에 따라 이 절은 §1~§9의 "독립 구현" 전제를 **채널 어댑터·OAuth·게시 실행 부분에 한해** 바꾼다. 원문·초안·승인·작업 상태와 DB(M1/M2/050000)는 그대로 우리 구조를 쓰고, 키트 코드는 그 아래에서 외부 플랫폼을 호출하는 부품으로 들어온다.

열람 범위: 세 키트의 코드·문서 파일. 원본에는 실제 `.env`가 없고 `.env.example`·`KIT/env.example`만 있다. API KEY·비밀번호·env 실값은 열지 않았다. 원본 파일은 수정하지 않았고, 코드 복사도 하지 않았다(다음 작업).

### 10.1 원본 확인 결과

| 키트 | 위치 | 스택 | 게시 방식 | 인증·저장 |
|---|---|---|---|---|
| Blog v1.07 (앱 v1.75) | `Blog_Posting_Kit_v1.07/ai-auto-blog/` | Next 16.4.2, React 19.2.4, @supabase/ssr, tiptap, cheerio, Tailwind. 크롬 확장 `extension/`(MV3) | **크롬 확장이 네이버 글쓰기 화면에 제목·본문·이미지·카테고리를 입력하고 "발행 직전"까지 준비한다. 마지막 [발행]은 사람이 누른다**(`extension/naver-adapter.js` 8행). 공식 API 없음 | 확장 ↔ 사이트는 Bearer 개인 토큰. **sha256 해시만 저장**(`utils/extensionAuth.ts`, `personal_access_tokens`) |
| Threads v1.02 (앱 v1.34) | `Threads_Auto_Posting_Kit_v1.02/threads/` | Next ^16.4.2, @supabase/ssr, zod 4, server-only, cheerio | 공식 Threads Graph API(`graph.threads.net`). 텍스트·이미지·캐러셀 컨테이너 → `threads_publish` → permalink(`src/lib/threads/client.ts`) | OAuth(`threads_basic`, `threads_content_publish`) → 장기 토큰. **`threads_accounts.access_token` 평문 저장**. 앱 ID·Secret은 회원별 `user_api_keys.api_key` **평문** |
| Instagram v1.11 | `Insta_Auto_Posting_Kit_v1.11/insta_auto_poster/` | Next ^16.4.2, zod 4, server-only, **sharp**(JPEG 변환), undici, jszip, 카드뉴스 폰트 | 공식 Graph API. Facebook 로그인(`graph.facebook.com/v21.0`) 또는 Instagram 로그인(`graph.instagram.com/v25.0`). 이미지 컨테이너 → FINISHED 폴링 → `media_publish` → permalink(`src/lib/instagram/publish.ts`) | Threads와 같은 패턴(state = user.id, 토큰 DB 저장) |

공통 부가 기능(이식 제외): AI 글·이미지 생성(OpenAI·Gemini·Perplexity), 글감 수집(RSS·NewsBlur·Shorts), 카드뉴스 스튜디오, cron-job.org 연동, AIMaster 전용 분기(`IS_STANDALONE`, buylife 도메인, 휴대폰 정책, `checkProgramAccess`, 구독·등급 표).

### 10.2 기술·배포 조건 (NOTICE 요약 — 사용자에게 다시 승인을 묻지 않음)
- 세 키트는 "배포판"이고, 구매자가 **자기 계정에 설치하고 이름·브랜드를 바꾸는 것**은 키트 문서가 허용한다. NOTICE는 정식 배포 키트 외의 분석·복제를 금지하고 재배포를 금지한다.
- **C1 저장소 비공개:** 키트는 "GitHub 저장소 폴더 안에 풀지 말 것"을 안내한다. 그런데 현재 `icando8988/vibe`는 **public**이다. 키트 유래 코드를 커밋하기 전에 저장소를 **private로 전환**해야 한다(사용자 GitHub 설정. 이식 작업의 선행 조건). 비공개로 바꾸기 전에는 키트 유래 파일을 커밋하지 않는다.
- **C2 출처 보존:** 옮긴 파일 상단에 원본 경로·버전 주석을 달고, 키트 `NOTICE`를 `web/src/server/distribution/providers/NOTICE`로 함께 둔다. 원본 폴더는 읽기 전용으로 남긴다.
- **C3 재배포 없음:** 확장 zip은 우리 사이트의 관리자만 받는다. 공개 페이지에서 배포하지 않는다.

### 10.3 파일 매핑 — 재사용 / 서버 추출 / 대체 수정

**Blog (우선 1순위, manual 경로)**

| 원본 | 우리 앱 위치(제안) | 구분 | 수정 내용 |
|---|---|---|---|
| `extension/*`(manifest, background, blog-core, blog-engine, naver-adapter, naver-page, sidepanel, web-bridge, styles, icons) | `web/extension/naver-blog/`(앱 번들 밖 정적 자산) | **그대로 재사용** | 사이트 주소·API 경로 상수만 우리 경로로 바꾼다. "마지막 발행은 사람이" 규칙은 유지 |
| `scripts/build-extension-archive.mjs` | `web/scripts/build-extension.mjs` | 재사용 + 수정 | `archiver` devDependency가 필요하다(패키지 승인). 대안으로 zip 없이 "압축 해제된 확장 로드" 안내만 할 수 있다 |
| `utils/extensionAuth.ts` | `web/src/server/distribution/blog/extension-auth.ts` | **서버 추출** | 해시 토큰 검증은 그대로 둔다. `checkProgramAccess`·profiles 조회를 **D1(`distribution_assert_admin_actor` 기준)**으로 바꾼다. `personal_access_tokens`는 우리 migration에 **신규 테이블**로 추가(+ 만료·철회 열) |
| `utils/extensionTask.ts`, `utils/extensionContent.ts`, `utils/markdown.ts` | `web/src/server/distribution/blog/task.ts`, `content.ts` | 서버 추출 | 입력원을 키트 `posts` 표 → **승인된 blog 리비전(`distribution_draft_revisions`)**으로 바꾼다. 제목 출처는 N3 결정 |
| `app/api/extension/{whoami,task,posts,posts/[id]/start,heartbeat,input-result}/route.ts`, `app/api/posts/[id]/extension-handoff/route.ts` | `web/src/app/api/distribution/extension/**/route.ts` | 대체 수정 | 키트 posts 상태 갱신 → **M2 작업 상태**에 매핑. handoff = `manual_ready` 작업을 확장에 넘김. input-result 성공 = 아직 게시 아님(로그만). 사람이 발행한 뒤에는 A9(`mark_manual_posted`) → A10(증거 URL, `blog.naver.com`만 DB가 허용) |
| `app/settings/extensionTokenActions.ts`, `components/settings/Extension*` | `web/src/app/admin/distribution/connections/` 하위 | 대체 수정 | 토큰 발급(원문은 1회 표시)·철회 UI. 디자인은 우리 콘솔 토큰 사용 |
| tiptap 편집기, AI 생성, 글감 수집, cleanup cron | — | 제외 | 우선 출시 범위 밖 |

**Threads (2순위)**

| 원본 | 우리 앱 위치 | 구분 | 수정 내용 |
|---|---|---|---|
| `src/lib/threads/client.ts` | `web/src/server/distribution/threads/graph.ts` | **그대로 재사용(일부 수정)** | 텍스트·단일 이미지 함수부터 쓴다(캐러셀은 후속). `fetch` 래퍼에 타임아웃을 두고 토큰을 로그에서 가린다 |
| `src/lib/threads/types.ts`, `signedRequest.ts` | 같은 폴더 | 재사용 | signedRequest(Meta 데이터 삭제 콜백 서명 검증)는 uninstall/delete 콜백을 열 때만 |
| `src/lib/posts/publish-core.ts` | `web/src/server/distribution/threads/adapter.ts`(PublishAdapter 구현) | **대체 수정** | 키트 `posts` 직접 update → M2 워커 함수(`claim_jobs` → `advance_phase(container_created, provider_container_id)` → `complete_attempt`)로 바꾼다. **컨테이너 ID를 게시 요청 전에 기록**(선커밋). `threads_publish` 응답 유실·permalink 실패는 `failed`가 아니라 **`unknown`**으로 기록 → 대사 |
| `src/lib/posts/dispatch.ts`, `memberScheduler.ts`, `cronJobOrg.ts`, `app/api/posts/dispatch-*` | `web/src/app/api/distribution/worker/route.ts` | 대체 수정 | 조건부 update 선점 → `distribution_claim_jobs` 리스. 24시간 지연 규칙은 유지(M2 hold로 표현). 호출자는 Vercel Cron + `CRON_SECRET` Bearer(N4/c). 회원별 cron-job.org와 휴대폰 정책은 제외 |
| `src/app/api/threads/callback/route.ts`, `src/lib/oauthRedirect.ts` | `web/src/app/api/distribution/oauth/threads/{start,callback}/route.ts` | **대체 수정** | ① **state = 무작위 nonce**(httpOnly·SameSite=Lax 쿠키 + 서버 대조, 10분 만료). user.id를 state로 쓰지 않는다 ② D1 재검사 ③ 앱 ID·Secret은 회원별 DB가 아니라 **서버 env**(`THREADS_APP_ID`, `THREADS_APP_SECRET`) ④ 리디렉트 주소는 고정 `SITE_URL` 하나(buylife 이중 주소 로직 제거) |
| `src/lib/threads/memberAccount.ts`, `memberIntegrations.ts` | `web/src/server/distribution/connections.ts` | 대체 수정 | 토큰을 **M3 `distribution_channel_connections`(신규)**에 **암호화 저장**(AES-256-GCM, 서버 env 키 `DISTRIBUTION_TOKEN_KEY`, 키 버전 열). service_role 전용, authenticated에는 토큰 열 GRANT 없음. 공유 테이블 이중 기록 제거 |
| `src/lib/apiKeys.ts`, `user_api_keys` | — | 제외 | 앱 자격정보는 env. DB에 평문으로 두지 않는다 |
| 데이터 삭제 페이지 `app/data-deletion`, `api/threads/{delete,uninstall}` | `web/src/app/(public)/data-deletion` 등 | 대체 수정 | Meta 앱 심사 요구 시에만. 공개 페이지라 디자인·문구 별도 |

**Instagram (3순위)**

| 원본 | 우리 앱 위치 | 구분 | 수정 내용 |
|---|---|---|---|
| `src/lib/instagram/client.ts`(OAuth·계정 조회) | `web/src/server/distribution/instagram/graph.ts` | 재사용 + 수정 | 로그인 방식을 하나로 정한다(권장: Instagram 로그인 `graph.instagram.com`. Facebook 페이지 경로는 후속). **토큰을 URL 쿼리 대신 POST 본문·헤더로** 보내도록 바꿔 로그 노출을 줄인다 |
| `src/lib/instagram/publish.ts` | `web/src/server/distribution/instagram/adapter.ts` | **대체 수정(필수)** | `postGraphWithRetry`가 **`media_publish`에도 "Timeout" 재시도**를 한다 → 실제로는 게시됐는데 다시 보내 **중복 게시**가 날 수 있다. 수정: 재시도는 컨테이너 생성까지만 하고, `media_publish`가 Timeout·응답 유실이면 **unknown + 대사**로 처리한다. FINISHED 폴링은 유지하고 `advance_phase`로 단계를 기록한다 |
| `src/lib/posts/instagramJpeg.ts` | `web/src/server/distribution/media/jpeg.ts` | 재사용 | **`sharp` 의존성**(네이티브, 패키지 승인 필요). Vercel Node 런타임에서 동작한다 |
| `src/lib/posts/publish-core.ts`, `dispatch.ts` | Threads와 같은 워커 | 대체 수정 | Threads와 같은 규칙 |
| `src/app/api/instagram/callback/{route,byok/route}.ts`, `pendingConnection.ts` | `web/src/app/api/distribution/oauth/instagram/*` | 대체 수정 | Threads와 같은 state·env·암호화 규칙. BYOK(회원 자체 앱) 분기 제거 |
| 업로드(`lib/actions/upload.ts`, Storage 공개 URL) | `web/src/server/distribution/media/storage.ts` | 대체 수정 | M4 자산·권리 테이블 + Supabase Storage 비공개 버킷 + 게시 시점 짧은 서명 URL(Meta가 가져갈 수 있는 유효시간) |
| 카드뉴스 스튜디오·AI·주간 차트 | — | 제외 | |

### 10.4 수정 대상으로 유지하는 원본 문제
| ID | 원본 위치 | 문제 | 이식 시 수정 |
|---|---|---|---|
| K1 | Threads·Instagram callback | state에 user.id를 써서 예측할 수 있다(CSRF 방어 약함) | 무작위 nonce + 쿠키 대조 + 만료 |
| K2 | `threads_accounts.access_token`, `user_api_keys.api_key` | 토큰·앱 Secret 평문 저장 | 앱 자격정보는 env, 사용자 토큰은 AES-GCM 암호화 + service_role 전용 |
| K3 | Threads `publish-core.ts` | 게시 후 permalink 실패 등 모든 예외를 `failed`로 기록 → 재시도 시 중복 | 게시 요청 이후 예외는 `unknown`, 대사 전 재시도 금지(M2 규칙) |
| K4 | Instagram `postGraphWithRetry` | `media_publish` Timeout 재시도 → 중복 게시 | 게시 요청 재시도 금지, unknown |
| K5 | Instagram·Threads graph 호출 | access_token이 GET 쿼리에 들어가 로그·프록시에 남을 수 있다 | 헤더/본문 전달, 오류 메시지에서 토큰 제거 |
| K6 | 키트 posts 직접 update 선점 | 리스·만료 회수가 없어 중단 시 `publishing`에 멈춘다 | M2 `claim_jobs` 리스 + `recover_expired_leases` |

### 10.5 가장 작은 실행 가능 이식 순서

| 단계 | 내용 | 선행 | 수락 조건 |
|---|---|---|---|
| I0 | C1 저장소 private 전환, 키트 NOTICE 배치, `web/src/server/distribution/` 뼈대(§2 P0와 같음) | 사용자 GitHub 설정 | 공개 저장소에 키트 유래 코드 0 |
| I1 **Blog** | 확장 그대로 + 서버 추출 3개 + extension API 6개 + `personal_access_tokens` migration. 흐름: 승인된 blog 리비전 → A8 manual 작업 → 확장 handoff → (사람이 발행) → A9 → A10 증거 | §7 P2~P7(DB 적용·승인 흐름), N3 | 확장이 승인본만 받는다. 미승인·다른 작업 ID는 403/404. 토큰 원문 미저장. input-result 성공만으로 published가 되지 않는다. 증거 URL이 blog.naver.com이 아니면 거부. 확장이 [발행]을 누르지 않는다 |
| I2 **Threads 텍스트** | graph.ts(텍스트), OAuth start/callback(K1·K2), M3 연결 테이블(암호화), 어댑터(K3, 선커밋), 워커 라우트 + Vercel Cron, live gate 해제 migration(Threads·텍스트 한정) | I1과 독립(DB만 공유), N4/c, N8, Meta 앱(사용자 계정), env 4개(`THREADS_APP_ID`·`THREADS_APP_SECRET`·`DISTRIBUTION_TOKEN_KEY`·`CRON_SECRET`) | state 위조·재사용 거부. DB 덤프에 토큰 평문 없음. 컨테이너 ID가 게시 요청 전에 기록된다. 게시 응답 유실 테스트(모의 fetch) → unknown, 재시도 없음. 같은 작업 두 워커 동시 실행 시 한 번만 게시 |
| I3 Threads 이미지 | 단일 이미지(공개 URL) | I2, M4 최소(이미지 자산·권리) | FINISHED 전 게시 안 함 |
| I4 **Instagram 단일 이미지** | graph.ts(Instagram 로그인), OAuth(K1·K2·K5), jpeg.ts(sharp), storage.ts, 어댑터(K4) | I2·I3, sharp 승인, M4 | media_publish Timeout 모의 → unknown, 재전송 0회. 서명 URL 만료 뒤 재사용 안 함 |
| I5 | 캐러셀·예약 UI·데이터 삭제 콜백 | I4 | 별도 명세 |

각 단계의 실제 코드 복사는 이 명세를 검토한 뒤 별도 작업으로 한다. 로컬 DB 검증은 별도 작업(ctx_6a721861de50)이 진행 중이므로 여기서는 중복하지 않는다.

### 10.6 의존성·env 추가 목록 (승인 필요 항목)
- 패키지: `sharp`(I4), `archiver`(devDependency, I1의 zip. 선택), `server-only`(N5 해결 시, 선택). zod·cheerio·tiptap은 가져오지 않는다.
- 서버 env(이름만):
  - I1: `SUPABASE_SECRET_KEY`
  - I2: `THREADS_APP_ID`, `THREADS_APP_SECRET`, `DISTRIBUTION_TOKEN_KEY`, `CRON_SECRET`
  - I4: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`
  - 값은 사용자가 Vercel에 직접 넣는다.
- Supabase: Storage 비공개 버킷(I3·I4), migration(personal_access_tokens, channel_connections, media assets, live gate 조건).

## 11. 검토 한계
- SQL은 정적으로 읽기만 했다. 시그니처, 반환 키, 오류 토큰, GRANT, RLS는 파일에 쓰인 대로 옮겼지만 실제 동작은 확인하지 않았다(B1).
- PostgREST가 FK 임베드, 열 GRANT와 함께 어떻게 동작하는지, 오류 `code`가 SQLSTATE 그대로 오는지도 실행으로 확인하지 않았다.
- 앱 코드, SQL, package, env는 바꾸지 않았다. 네트워크, DB, 게시, commit은 없다.
