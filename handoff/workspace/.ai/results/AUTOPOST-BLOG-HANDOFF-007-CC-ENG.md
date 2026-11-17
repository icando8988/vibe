# AUTOPOST-BLOG-HANDOFF-007 — CC-ENG 결과

담당 Claude Code(CC-ENG-01, 기존 세션 term_67ce2ea3 유지) · task_ab19fccdb986 / dispatch ctx_1232c1fd98f6 · 2026-11-17
상태: **ready_review — 승인본 인계 서버 기능 구현·로컬 대역 검증 완료. 운영 가능 상태 아님.**
- 실제 Supabase에 080000을 적용하지 않았다.
- secret 키가 없다.
- 확장 `API_READY=false`를 유지한다.
- 브라우저와 네이버에서 실측하지 않았다.

**최종 080000 SHA-256:** `6b750a38f4aa5e450dcc5eca45970130dee190143e254e5c416f7a1bd54cd392`
- 독립 검토 기준 해시: `d9cfcaa7…867e`. 작업 시작 때 대조해 일치했고, 이후 F-1·F-2·F-3을 고쳐 해시가 바뀌었다.

## 원본 계약 대조 (Blog_Posting_Kit_v1.07)

| 원본 | 이식 |
|---|---|
| `task`: 30분 이내 보낸 본인 글을 조건부 update로 선점, runId, 리스 3분 | `distribution_claim_extension_handoff`: 토큰 소유자가 요청한 30분 이내 인계를 `FOR UPDATE SKIP LOCKED`로 선점. 작업은 `FOR SHARE`. 작업당 인계 1건(unique job_id). run = gen_random_uuid. 리스 180초 |
| 내용 = 글 title·content(HTML→blocks) | 승인된 원문 버전 title + 승인된 리비전 body(작업에 고정된 ID)를 `buildBlogExtensionTask`로 text 블록화. `category: null`, `tags: []` |
| heartbeat: runId 일치 시 리스 연장, 아니면 409 | 같은 토큰·run만 연장. 만료·원문/승인 변경은 needs_check를 기록하고 409 |
| input-result: ALLOWED_PREVIOUS, 같은 상태는 unchanged, 오류 문장 500자 저장 | 같은 전이 규칙. 만료 검사를 unchanged보다 먼저 한다. 오류는 `[CODE]` 접두어만 저장한다. **M2 작업은 바꾸지 않는다** |
| 리스 만료 → 자동으로 대기로 되돌리지 않음 | 같음. needs_check로 두고 자동 재입력·새 run 발급·재인계가 없다 |

## 구현 파일

### `web/supabase/migrations/20261116080000_distribution_extension_handoffs.sql`
- **테이블 `distribution_extension_handoffs`**
  - 상태 7개: requested, in_progress, completed, publish_ready, failed, needs_check, rejected
  - 열: token_id, run_id, 리스·시각, last_code(대문자 코드)
  - 상태별 형식 제약
  - RLS를 켜고 모든 역할의 권한을 회수했다
- **공개 RPC(service_role 전용)**

| RPC | 동작 |
|---|---|
| `distribution_request_extension_handoff(actor, job)` | D1 확인 + 인계 가능 작업인지 확인 |
| `distribution_claim_extension_handoff(token_hash)` | 선점 |
| `distribution_heartbeat_extension_handoff(token_hash, job, run)` | 리스 연장 |
| `distribution_record_extension_input(token_hash, job, run, status, code)` | 입력 단계 기록 |
| `distribution_list_extension_handoffs(actor)` | F-3 관리자 조회(아래 참조) |

- **내부 helper(owner 전용)**

| helper | 역할 |
|---|---|
| `handoff_token_owner` | 060000 인증 재사용(철회·만료·D1을 매번 확인) |
| `handoff_expire` | 리스 만료 → needs_check |
| `handoff_problem` | blog·manual·manual_ready·보류·대사 필요·M2 `distribution_job_basis_problem`(stale·approval_revoked·archived) 확인 |
| `handoff_lock_run` | 같은 소유자·토큰·run인지 확인 |

- 모든 함수는 SECURITY DEFINER이고 `search_path=''`이며, PUBLIC 기본 EXECUTE를 회수했다.
- needs_check 기록이 필요한 거절은 예외를 던지지 않고 `{superseded:true, reason}` 결과로 돌려준다. 예외를 던지면 롤백되어 기록이 사라지기 때문이다.

### 서버
- `web/src/server/distribution/blog/handoff.ts`: task·heartbeat·input-result 처리
  - Bearer 형식이 틀리면 401이고 RPC를 0회 호출한다. 키가 없으면 503이다.
  - DB 오류는 401·409·404·400·503으로 매핑하고 원문 메시지는 버린다.
  - 응답은 원본 확장 형식을 따른다.
  - 4KB 이하 JSON만 받는다. no-store, CORS 헤더 없음.
- `blog/handoff-request.ts`: 관리자의 "확장으로 보내기" 요청(runner 기반).
- `blog/handoff-status.ts`: F-3 관리자 조회 모듈. 예상 밖 열이나 모르는 상태가 오면 거부한다.

### 라우트
- `web/src/app/api/distribution/extension/task/route.ts`
- `web/src/app/api/distribution/extension/jobs/[jobId]/heartbeat/route.ts`
- `web/src/app/api/distribution/extension/jobs/[jobId]/input-result/route.ts`

### 확장 `web/extension/naver-blog/`
- `sidepanel.js`: whoami 최소 응답(`connected`)에 맞춰 "연결됨(토큰 인증 확인)"으로 표시. 이메일 표시를 제거했다.
- `background.js`: connect 처리에서 `connected:true`를 확인한 **뒤에만** 토큰을 저장한다.
- `SETUP.md`: 실제 API 계약으로 갱신(UX-FIX-008 BC-08).
- 그대로인 것: `API_READY=false`, 사이트 주소 하드코딩 없음, 최종 발행 미클릭 코드는 변경 없음.

### 검증·테스트
- `web/scripts/distribution-local-verify/handoff-run.mjs`(신규 독립 러너)
- `web/tests/distribution-server/blog-handoff.test.ts`
- `token-run.mjs`의 마지막 migration 단언 수정(Master msg_3c25ba9e3fc7): 000000~060000 필수 prefix 순서를 확인하고, 이후 forward migration은 허용하며, 적용 목록을 출력한다.

## REVIEW-009 지적 수정 (msg_2ffd937edfa7)

| ID | 수정 | 검증(handoff-run 그룹 6 — 재현이 아니라 수정 후 기대 동작 단언) |
|---|---|---|
| F-1/F-1b | record_input에서 in_progress·completed의 만료 검사를 unchanged 분기 **앞으로** 옮겼다 | 만료 뒤 in_progress 재보고 → `superseded LEASE_EXPIRED` + needs_check 기록. completed 재보고도 superseded |
| F-2 | `status='rejected' AND run_id IS NULL AND claimed_at IS NULL`(내용 미전달이 증명됨)일 때만, 방금 다시 한 D1·작업 근거 확인 뒤 requested로 재설정. needs_check·failed·in_progress·completed·publish_ready는 계속 HANDOFF_EXISTS | 실제 M2 흐름(늦은 증거 → 대사 필요 → 반려)으로 일시 거절 → 조건이 남아 있으면 NOT_HANDOFFABLE → 해소 후 재요청이 requested → 정상 선점. needs_check·completed는 거절. 비승인 actor는 42501 |
| F-3 | `distribution_list_extension_handoffs(actor)` 신설. D1 확인 후 본인 인계 중 리스 만료(LEASE_EXPIRED)와 토큰 철회·만료(TOKEN_REVOKED/TOKEN_EXPIRED)인 진행 건을 needs_check로 정리. 코드·시각만 반환(본문·토큰·해시·run 없음). 자동 재요청 없음 | 토큰 철회 직후 in_progress → 조회 시 needs_check(TOKEN_REVOKED). 본인 것만 반환. 비승인 actor는 42501. 조회 뒤 재요청은 HANDOFF_EXISTS. ACL·DEFINER·search_path 확인. M2 작업 불변 |

**F-3 화면은 미구현이다.** 모듈과 RPC까지만 했고, 관리자 화면 연결은 다음 작업이다.

## 실행 명령과 종료코드 (PGlite 대역 `%TEMP%\autopost-local-db-verify-002`)
**적용 migration(모든 러너 공통): 000000, 010000, 020000, 030000, 040000, 050000, 060000, 070000, 080000(9개).**

| 명령 | 결과 |
|---|---|
| `node …/run.mjs` | 0 — 206/206 |
| `node …/m2-run.mjs` | 0 — 334/334 |
| `node …/token-run.mjs` | 0 — 74/74 |
| `node …/handoff-run.mjs` | 0 — **91/91**. 그룹별 결과는 아래 표 |
| `node …/handoff-review-run.mjs`(다른 작업자 파일, 참고 실행·미수정) | 1 — F-2가 `FINDING-NOT-REPRODUCED`(수정 확인). 그룹 10 준비 단계에서 `SUPERSEDED`로 중단됨(원인은 아래) |
| `npm.cmd test` | 0 — 16 files / **360 tests** |
| `npm.cmd run lint` | 0 — 오류 0. 경고 3(확장 원본 `api` 미사용, 다른 작업자 `m2-run.mjs`의 `defect` 미사용 등) |
| `npm.cmd run typecheck` / `npm.cmd run build` | 0 / 0. task·heartbeat·input-result 라우트 생성 |
| `.next/static`에서 secret·인계·인증 RPC 이름 검색 | 0건 |

handoff-run 그룹별 결과(91/91):

| 그룹 | 확인 내용 |
|---|---|
| ACL | 3개 역할의 테이블 권한 없음, RLS. 공개 RPC 4개는 service_role만, helper 4개는 owner만, DEFINER, `search_path=""`. service_role 직접 SELECT·helper 호출, authenticated·anon 호출 모두 42501 |
| 요청 | pending·suspended·역할 없는 회원은 42501. dry_run·threads는 NOT_HANDOFFABLE. 재요청은 창만 갱신. 다른 admin은 HANDOFF_EXISTS |
| 선점 | 모르는 토큰·원문 토큰은 UNAUTHENTICATED. 남의 요청은 null. 내용은 승인 title·body만이고 토큰·해시 없음. 두 번째 선점은 null. M2 작업 불변. 중복 행 23505. stale·승인 철회·보관은 rejected(코드만). 30분 지난 요청은 시작 안 함 |
| heartbeat | 다른 run·같은 소유자의 다른 토큰은 SUPERSEDED. 남의 토큰은 P0002. 연장 성공. 만료 → needs_check(run 유지), 이후 heartbeat·결과·재선점·재요청 모두 거부. 입력 중 승인 철회 → needs_check |
| 결과 | published 상태 입력은 22023. completed → unchanged → publish_ready 순서 정상. 늦은 failed는 SUPERSEDED. **M2 작업 manual_ready·증거 0 유지**. 소문자 코드는 저장 안 함. 토큰 철회·소유자 정지 시 UNAUTHENTICATED, 재승인 후 같은 run으로 계속 |
| F-1~F-3 | 위 REVIEW-009 표 참조 |

**handoff-review-run 중단 원인:** F-2 수정으로 그룹 9의 작업이 "requested"로 재설정되었다. 요청 시각이 더 이른 그 건을 그룹 10의 `claim`이 먼저 가져가서, 그룹 10이 만든 작업의 run과 맞지 않는다. 검토 러너가 옛 동작(재요청 영구 거절)을 전제로 데이터를 쌓았기 때문이다. 080000 결함이 아니며, 검토 러너 쪽 데이터 격리(그룹 9 인계 정리 또는 별도 토큰 소유자)가 필요하다. 다른 작업자 파일이라 수정하지 않았다.

## 남은 의존성·한계
- 실제 Supabase 적용(060000·080000)과 secret 키 등록. 그 전까지 API는 503(준비 전)이다.
- 관리자 화면: "확장으로 보내기" 버튼(요청 RPC), 인계 상태·needs_check 표시(F-3). 다음 작업이다.
- 확장 `API_READY=true` 전환은 실DB·브라우저 실측 뒤에 한다. 네이버 화면 실측(입력·발행 직전 상태)은 미실행이다.
- 다중 연결 동시성(SKIP LOCKED 실제 경합)은 PGlite 단일 연결이라 검증하지 못했다. unique(job_id)와 선점 1회는 확인했다.
- 070000 recover의 `recovery_failed:<SQLSTATE>` 반환값은 정상 JobStatus가 아니므로 워커 호출부에서 경보로 구분해야 한다(Master msg_3c25ba9e3fc7). 지금은 워커 호출부가 없어 **남은 의존성**으로 기록한다.
- 확장은 needs_check 상태에서 받은 409를 "입력 중지"로 처리한다(원본 동작). 사람 확인 흐름은 화면 작업과 함께 한다.

## 지시 수신 기록
- 사용자 확정(msg_95d6a1009def): **A안으로 진행. 새 세션을 만들지 말고 기존 Claude 담당 세션이 계속 수행.** 이번 작업에서는 디자인 파일을 섞지 않았다. A안 적용은 범위가 확정되는 대로 다음 지시에 따라 이 세션에서 진행한다.
- 범위 준수: 070000, 다른 작업자의 handoff-review-run·m2-run·lib, 기존 M0~070000은 수정하지 않았다. 키·env 열람, 실DB, 네이버·외부 호출, commit, push 없음.
