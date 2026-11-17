# AUTOPOST-CONTENT-CONNECT-014 — CC-ENG 결과

담당 Claude Code(CC-ENG-01) · **기존 세션 term_67ce2ea3 유지**(새 세션·worker·subagent 없음) · task_68b798b15f56 / dispatch ctx_49ff02fd46fb · 2026-11-17
상태: **ready_review.**
- A안 콘솔의 원문 조회·저장 → 채널 초안 → 승인·반려·철회를 실제 서버 모듈과 서버 액션으로 연결했다.
- PGlite 대역에서 서비스 → RPC 왕복을 검증했다.
- 실 Supabase·실사용자 세션 렌더는 데이터 준비 전이라 **검증 불가**다.
- 실행·게시·작업 생성은 활성화하지 않았다.

## 구현

### 서버 모듈(`web/src/server/distribution/`)

| 파일 | 역할 |
|---|---|
| `dto.ts` | 아래 참조 |
| `read.ts` | 아래 참조 |
| `read-session.ts` | server-only. 사용자 세션 Supabase 클라이언트 → ReadSource |
| `content-service.ts` | A1 원문 생성, A2 새 버전, A3 초안 생성, A4 리비전. write-runner 사용(세션 actor + D1 → 입력 → 키 확인 → RPC 1회) |
| `approval-service.ts` | A5/A6 승인·반려, A7 철회 |
| `write-notice.ts` | 결과 → 허용 목록 안내 코드. 성공은 RPC 응답 파싱 뒤에만. 응답 유실·형식 오류·식별 못 한 DB 오류는 `uncertain` |
| `content-page.ts` | server-only 로더 + `isWriteConfigured()`(service 키 유무만) |

`dto.ts`:
- `effectiveApproval()`: SQL `distribution_effective_approval_id`와 같다.
  - approved·rejected 결정을 created_at desc, id desc로 정렬해 최근 1건만 본다.
  - 그 건이 approved이면서 철회되지 않았을 때만 유효 승인이다. 최근 승인이 철회됐으면 더 이전 승인이 있어도 유효 승인이 없다.
  - 상태: approved / rejected / revoked / none
- 행 → DTO 변환: 버전, 리비전, 승인
- 대상별 고정 체크리스트 키

`read.ts`:
- 최소 `ReadSource` 인터페이스 위에서 동작한다.
  - 보관함 목록
  - 원문 상세: 현재 버전, 버전 이력, 3채널 초안·현재 리비전, `basedOnLatest`, 원문·리비전 유효 승인
- 030000 GRANT의 **명시 열만** 요청한다. `select *` 없음, `created_xact_id`·`owner_id` 제외.
- 상태를 분리한다:

| 상태 | 뜻 |
|---|---|
| `not_configured` | 로그인·Supabase 미설정 |
| `schema_missing` | 42P01·42703·PGRST20x(DB 적용 전) |
| `error` | 그 밖의 조회 실패(0건으로 바꾸지 않음) |
| `ok` | 성공. 0건이면 `[]`, 없거나 RLS로 안 보이면 `null` |

### 화면·액션(`web/src/app/admin/distribution/`)

`contents/actions.ts`("use server") — 서버 액션 6개:
- 모두 검증된 세션 actor(`requireDistributionActor`)를 쓰고, 폼의 actor 값은 무시한다.
- 결과는 허용 목록 notice 코드로만 redirect한다. 입력·오류 원문은 URL에 싣지 않는다.
- redirect 경로 조각은 uuid·채널 형식을 확인한 뒤에만 쓴다.

화면별 연결:

| 화면 | 연결 내용 |
|---|---|
| `contents/page.tsx` 보관함 | 실제 목록. 준비 전·DB 적용 전·조회 오류·성공 0건을 서로 다른 문구로 표시 |
| `contents/new/page.tsx` A1 | 조회 ok이고 키가 있을 때만 폼이 열린다. 아니면 비활성 + 이유 |
| `contents/[contentId]/page.tsx` | 원문 본문은 React 텍스트·pre-wrap으로 렌더(HTML 해석 없음). 버전 이력. A2 새 버전(hidden `expectedVersionNo` = 렌더 시점 번호). A5 원문 승인·반려(hidden `expectedSubjectHash` = 렌더된 content_hash, 체크리스트, 반려 사유). A7 철회(사유 필수). 3채널 초안 상태(없음 / rN·승인 상태 / 원문 변경됨) |
| `channels/[channel]/page.tsx` | A3 초안 만들기. A4 리비전(hidden `expectedRevisionNo`·`expectedContentVersionId` = 렌더 값). Blog 제목은 **원문 버전 title 그대로** 쓴다고 표시. 원문이 바뀌면 경고 |
| `channels/[channel]/review/page.tsx` | A6 리비전 승인·반려(렌더된 revision_hash), A7 철회. 원문 변경(basedOnLatest=false)이면 승인 폼 대신 다시 작성을 안내. 원문 미승인도 안내 |
| 개요(`page.tsx`) | 콘텐츠 보관함 패널이 실제 조회 결과를 표시(최근 5건 또는 상태 안내) |

**액션은 기대값을 최신값으로 덮어쓰지 않는다.** 충돌은 conflict_version·conflict_revision·stale_content·not_latest·subject_changed 안내로 보여 주고 자동으로 재전송하지 않는다. 보관·권한 철회·무결성 오류도 각자의 안내로 분기한다.

준비 신호는 전역 `DATA_SOURCE_CONNECTED`를 쓰지 않는다. 연결한 화면은 조회 결과와 키 유무에서 도출한다. 이 상수는 아직 연결하지 않은 화면 전용으로 남아 있다.

### 컴포넌트·검증 파일
- `web/src/components/distribution-console/write-notice-view.tsx`
  - `WriteNoticeView`: 허용 목록 코드만 렌더
  - `ReadStateNotice`: 준비 전 / DB 적용 전 / 조회 오류
- `web/scripts/distribution-local-verify/content-connect-run.mjs`(독립 러너): vitest로 아래 PGlite 시험을 실행한다.
- `web/tests/distribution-server/content-connect.pglite.test.ts`: `PGLITE_PROJECT`가 있을 때만 실행한다. 평소 `npm test`에서는 skipped로, 통과로 세지 않는다.

## 검증

| 명령 | 결과 |
|---|---|
| `node web/scripts/distribution-local-verify/content-connect-run.mjs --pglite-project %TEMP%\autopost-local-db-verify-002` | **exit 0 — 2/2.** 적용 migration 000000~080000(9개). 확인 내용은 아래 |
| `npx vitest run tests/distribution-server/content-connect.test.ts` | 32/32. 확인 내용은 아래 |
| `npm.cmd test` | 0 — 18 files 통과 + 1 skipped(PGlite 전용) / **408 passed**, 2 skipped |
| `npm.cmd run lint` | 0(오류 0, 기존 경고 3) |
| `npm.cmd run typecheck` / `npm.cmd run build` | 0 / 0 |
| `next start` 미인증 HTTP | 콘텐츠 경로 5개 모두 거부 화면. `?notice=saved`를 붙여도 성공 문구 없음, 폼·기대값 hidden 없음. `.next/static`에서 secret·RPC 이름 검색 0건 |

PGlite 왕복(앱 서비스·조회 함수를 그대로 쓰고 DB만 service_role RPC 어댑터·authenticated RLS 조회 어댑터로 바꿈)에서 확인한 흐름:

| 단계 | 확인 |
|---|---|
| 시작 | 조회 성공 0건 |
| A1 | 생성 성공. 일반 회원·비승인 admin 조회는 0건·null(RLS). 비승인 admin actor의 쓰기는 denied(DB D1). 본문 `<b>`가 텍스트 그대로 |
| A3 | 초안 생성, 중복 생성은 duplicate |
| A4 | 리비전 저장(expected 0). 같은 기대값 재전송은 conflict_revision |
| A5 | 잘못된 해시는 subject_changed. 렌더 해시로 승인. 재승인은 already_decided |
| A6 | 반려 → rejected 표시 → 승인 → approved |
| A7 | 철회 → revoked. 두 번 철회는 already_revoked. **앱 DTO 판정이 SQL `distribution_effective_approval_id`(null)와 일치** |
| A2 | 새 버전 저장. 같은 기대값 재전송은 conflict_version. 버전 [2,1], basedOnLatest=false, 원문 승인 none |
| 옛 기준 | 옛 리비전 승인은 stale·not_latest, 옛 원문 기준 리비전은 stale_content |
| 보관 | 보관 후 쓰기는 archived |

단위 테스트(32)가 확인하는 내용:
- 유효 승인 판정 7가지: 최근 반려, 최근 승인 철회, 철회 뒤 재승인, 같은 시각 id 정렬, 다른 대상 무시 등
- 조회 상태 분리, 명시 열, 상세 조립
- D1 거부 시 RPC 0회, 키 없음은 not_ready
- 렌더된 기대 버전·해시를 그대로 전달하고 폼 actor는 무시
- 체크리스트(고정 키만, 승인은 전부 true), 반려·철회 사유 필수
- 충돌·stale·subject_changed·archived·denied·uncertain 매핑, 응답 유실 시 RPC 1회만

## 한계
- **실제 세션 렌더는 검증 불가**다. 실 Supabase에 M1/M2/050000을 적용하지 않았고, secret 키가 없으며, 승인 admin 계정을 쓰지 않았다. 미인증 거부만 HTTP로 확인했다.
- PGlite는 단일 연결이라 동시 저장 경합은 순차 재요청으로만 확인했다.
- 충돌 시 입력 유지가 안 된다. 서버 액션이 redirect하므로 입력이 보존되지 않고, 안내 문구가 다시 불러오기를 요청한다(명세 §4 권장).
- 검색·필터는 미구현이다(최근 50건).
- 미디어·대상 계정·UTM 입력은 이번 범위가 아니며 빈 값으로 보낸다.

## 다음 작업 제안 — Blog manual 작업·증거·handoff 화면 연결
1. 실행 준비 비교(`prepare`)
   - 원문 승인 + Blog 리비전 승인이 모두 유효하면 A8 `distribution_create_job(manual)` 서버 액션을 활성화한다(rpc-params 준비됨).
   - 작업 목록·상세는 jobs·events·evidence 명시 열 조회로 연결한다.
2. 작업 상세 `manual` 화면
   - A9 게시 표시, A10 증거(blog.naver.com URL, 시간대 필수), A11 중단(확인 체크), A12 불명. 모두 `expected_version` = 렌더된 job.version.
3. Blog 확장 인계
   - manual_ready 작업에 "확장으로 보내기"(`handoff-request.ts`)를 붙인다.
   - 인계 상태·needs_check를 표시한다(`handoff-status.ts`, F-3 조회 RPC).
   - 확장 입력 결과는 게시가 아님을 유지한다.
4. 대사(A13), 취소(A14), 작업 목록의 조치 필요 정렬.
