# AUTOPOST-BLOG-FLOW-015 — CC-ENG 결과

- 작업자: Claude Code(CC-ENG-01), handle term_67ce2ea3-ec00-4b76-985a-fad63d177b0a
- task_a3585d33b301 / dispatch ctx_693eed88457d / 2026-11-17
- 범위: A안 prepare → Blog 수동 작업 생성(A8) → jobs 목록/상세 → 수동 A9~A12 → 확장 인계/상태 → 대사(A13)/취소(A14). 기존 서버 모듈·RPC만 사용.
- 금지 준수: SQL·migration·기존 러너(run/m2-run/lib/fix006/handoff*/token-run)·확장·package 미수정. 실DB·실계정·키·env 열람·네이버·네트워크·외부게시·commit/push 없음.

## 1. 변경 파일 (web/)

서버
- `src/server/distribution/jobs-dto.ts` (신규): JobDto/Evidence/Reconciliation/Event, `jobActions(job, handoffStatus)` — M2 전이 규칙 그대로. 모르는 상태(예: recovery_failed:*)는 `unrecognized` + 행동 0.
- `src/server/distribution/jobs-read.ts` (신규): 세션 RLS·명시 컬럼 조회 `listJobs`, `getJobDetail`(승인본 제목·본문 포함), 조치 필요 우선 정렬.
- `src/server/distribution/jobs-service.ts` (신규): A8 createBlogManualJob, A9 markManualPosted(확인 체크), A10 recordManualEvidence(blog.naver.com, KST→zoned ISO), A11 abandon(사유+외부잔존 확인), A12 markManualUncertain(사유), A13 recordReconciliation(actor_kind admin·method operator_manual 서버 고정, found_published는 URL/ID 필수, confirmed_absent는 확인 계정·기간·근거 필수), A14 cancelJob(확인 필수). 모두 write-runner(actor+D1 → 검증 → RPC 1회), expected_version은 렌더 값 그대로, 자동 재전송 없음.
- `rpc-params.ts`: appendDraftRevisionParams에 target/media(선택), recordReconciliationParams에 external_post_id/url(선택).
- `read.ts`/`dto.ts`: 리비전 utm·target 컬럼 + `distribution_draft_revision_media` 조회, rows/run export.
- `content-service.ts`: A4가 편집하지 않는 UTM·대상 계정·미디어를 hidden 렌더값으로 **보존**(`parsePreserved`). 형식 오류·JSON 파싱 실패는 빈 값으로 덮지 않고 거절.
- `write-notice.ts`: 코드 추가(invalid_transition·evidence_conflict·not_approved·republish_confirmation·live_gate_closed), `FormState`/`failureState`(안내 코드+필드 이름만, 입력 원문 없음).
- `content-page.ts`: loadJobs·loadJobDetail·loadHandoffs.

UI
- `components/distribution-console/action-form.tsx` (신규, client): useActionState + onSubmit에서 FormData 직접 전송 → **실패해도 입력 유지**(CONTENT-014 입력 유실 보완), 처리 중 fieldset 잠금(중복 제출 방지), 필드 오류 표시, uncertain 시 "최신 상태 다시 불러오기"(router.refresh, 재전송 아님). 입력을 URL·storage에 싣지 않음.
- `contents/actions.ts`: 6개 액션을 `(prev, formData) => FormState`로 전환(성공은 redirect), A8 액션 추가. `jobs/actions.ts` (신규): A9~A14 + 확장 인계 요청.
- 콘텐츠 화면(new·상세·채널·검토) 폼 → ActionForm. 채널 리비전 폼에 보존 hidden 4개.
- prepare: Blog는 원문 승인+최신 원문 기준 리비전 승인+진행 중 작업 없음일 때만 "수동 게시 작업 만들기", 아니면 막힌 이유 목록. Threads/Instagram 비활성 유지.
- jobs 목록(조회 오류·준비 전·0건 구분), 상세(사실·경고·다음 행동·A14·증거/대사/이력), manual(승인본·인계 상태/요청·A9~A12), reconcile(A13·DQ-05 경고 유지). gateNotice: "자동 게시 없음 · 저장은 서버 준비 시 실제 동작".
- 핸드오프 규칙: 인계 요청은 manual_ready에서 인계 없음/requested/rejected일 때만. needs_check·in_progress·completed·publish_ready·failed는 재인계 없음 + 사람 확인/입력완료≠게시 안내. reconciliation_required면 게시 표시·증거·인계 차단.

테스트·검증
- `tests/distribution-server/blog-flow.test.ts` (29): jobActions 전 상태, 서비스 D1·검증·RPC 인자·오류 매핑, 보존, 폼 상태.
- `tests/distribution-server/pglite-harness.ts` (신규 공용 어댑터; ISO 시각은 timestamptz 캐스트 — PostgREST의 이름 기반 형 해석 대역).
- `tests/distribution-server/blog-flow.pglite.test.ts` + `scripts/distribution-local-verify/blog-flow-run.mjs` (신규).

## 2. 검증 결과

| 항목 | 결과 |
|---|---|
| blog-flow-run.mjs (PGlite, 000000~080000 9개 적용) | 5/5 통과 |
| content-connect-run.mjs 회귀 | 2/2 통과 |
| vitest 전체 | 19 files 통과 · 437 passed · 7 skipped(PGlite 전용) |
| tsc --noEmit | 0 오류 |
| lint | 0 오류 · 경고 3(범위 밖 기존: extension 2, m2-run 1) |
| next build | 성공(jobs·prepare 등 dynamic) |

PGlite 왕복에서 확인한 것: 미승인 → not_approved, 비승인 admin → denied, 중복 생성 → duplicate, 인계 요청→claim→`completed` 후에도 job `manual_ready`·증거 0·재인계 불가, A9 낡은 version → conflict_version, 같은 version 재전송 거절, 허용 외 호스트 → RPC 전 거절, A10 수락 시에만 `published`, 다른 작업과 같은 URL → evidence_conflict(published 아님), A12 → unknown(대사만), found_published 근거 없음 거절, still_unknown 기록, confirmed_absent(계정·기간·근거) → `failed`/`operator_only`이며 재게시·인계·증거 동선 없음 + 같은 키 재생성 duplicate, A11 확인 없음 거절→abandoned 후 키 점유, A14 충돌→cancelled, UTM 보존.

발견·수정한 결함: 처음 A13이 checked_scope를 `{note}`만 보내 confirmed_absent가 DB 불변조건 6(account·period·observation)에 걸림 → 입력 추가·검증으로 수정.

## 3. 측정하지 못한 것
- 실제 로그인 세션으로 화면 렌더·클릭(브라우저) — 이번에는 미실행. ActionForm의 입력 유지·잠금은 코드·타입 수준 확인뿐.
- 실제 Supabase/PostgREST 형 해석(대역은 어댑터 캐스트), RLS의 실제 JWT 경로.
- 미디어 보존의 DB 왕복(자산 행 fixture 없음 → UTM만 왕복, 미디어는 단위 테스트).
- 확장 lease 만료·토큰 철회 → needs_check 화면 표시(서버 로직은 기존 handoff 러너가 검증, 화면은 미측정).

## 4. 실제 Supabase에 필요한 것
- migration 000000~080000 적용(특히 040000 M2, 050000, 060000, 070000, 080000).
- 서버 env에 `SUPABASE_SECRET_KEY` 등록(없으면 화면은 "저장 준비 전"으로 쓰기 비활성).
- 승인된 admin 계정 1개 + 실제 세션으로 prepare→manual→증거 1회 수동 확인.

## 5. 의존성·남은 것
- 미래 worker `recovery_failed`: 호출자 없음 → 정상 상태로 매핑하지 않고 `unrecognized`(행동 0)로만 표시. 워커 구현 시 별도 정의 필요.
- failed(confirmed_absent 후) 재실행 운영자 승인(4.14) UI 미연결 — 화면에 "준비 중" 표기.
- 다음 최소 Threads 작업 제안: **THREADS-DRYRUN-016** — Threads 채널 초안·승인까지 재사용하고 prepare에서 `dry_run` 작업 생성(A8 mode=dry_run)만 연결, live gate 닫힌 상태 유지·외부 호출 0, PGlite 왕복(생성·취소·중복)으로 검증.
