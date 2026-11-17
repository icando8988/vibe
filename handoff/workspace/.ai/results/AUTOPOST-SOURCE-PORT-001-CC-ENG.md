# AUTOPOST-SOURCE-PORT-001 — CC-ENG 결과

담당 Claude Code(CC-ENG-01) · task_e15cfe9d35ee / dispatch ctx_ad926d15a609 · 2026-11-17
상태: **ready_review — 기능 이식(로컬 코드) 완료. 운영 가능 상태 아님.**
- 서버 API와 DB가 연결되지 않았다.
- 확장은 기본값에서 "연결 준비 전" 오류를 낸다.

## 구현 파일

**서버 P0 (신규, 모두 DB 없이 동작·테스트)**

순수 함수(테스트 대상):

| 파일 | 역할 |
|---|---|
| `web/src/server/distribution/errors.ts` | DB 오류 → 콘솔 코드(토큰 우선, SQLSTATE 보조). 원문 메시지 미보존 |
| `web/src/server/distribution/service-config.ts` | secret 키 판정. `sb_secret_`만 허용, https만, 없으면 null |
| `web/src/server/distribution/actor-core.ts` | `resolveDistributionActor(viewer)`. D1과 같은 판정이며, actor는 세션 userId에서만 나온다 |
| `web/src/server/distribution/validation.ts` | DB 제약과 같은 입력 검증: 원문, target_path, UTM, 체크리스트, 기대 번호·해시, Blog 수동 증거(blog.naver.com만, ID만이면 메모 필수, 시간대 필수 → UTC), 사유 |
| `web/src/server/distribution/write-runner.ts` | 공통 쓰기 절차(아래 순서) |
| `web/src/server/distribution/rpc-params.ts` | A1~A14 RPC 인자·반환 매핑. `p_actor_kind='admin'` 고정, manual 작업은 예약·재게시 없음 |
| `web/src/server/distribution/blog-task.ts` | 확장 작업 본문 생성(아래 규칙) |

`write-runner.ts`의 처리 순서:
1. actor 도출 — 거부면 RPC 0회, 클라이언트도 만들지 않음
2. 입력 검증 — 실패면 RPC 0회
3. 클라이언트 확인 — 없으면 `not_ready`
4. RPC 1회 — 응답 유실이면 `unavailable`, 재전송 없음

`blog-task.ts`의 규칙:
- **제목은 승인된 원문 버전 title**을 쓴다(신규 열 없음).
- 본문은 빈 줄 기준으로 문단 text 블록으로 나눈다.
- manual · manual_ready · 리비전과 원문 버전 승인을 모두 확인한다.

server-only 연결 파일:
- `web/src/lib/supabase/admin.ts`: `createSupabaseServiceClient()`. env `SUPABASE_SECRET_KEY`가 없으면 null이다. 세션 저장 없음.
- `web/src/server/distribution/actor.ts`: `requireDistributionActor()` = `getViewer()`(auth.getUser 검증) → actor-core.

**확장 이식 `web/extension/naver-blog/`** (원본 `Blog_Posting_Kit_v1.07/ai-auto-blog/extension/`, 원본 폴더는 수정하지 않음)
- 원본 `NOTICE`를 그대로 보존했다. `SETUP.md`(신규)에 출처, 변경 표, unpacked 설치법, 필요한 서버 API 계약을 적었다.
- `config.js`(신규):
  - `SITE_ORIGIN: ""`, `API_READY: false`.
  - API 경로는 `/api/distribution/extension/{whoami,task,jobs/{id}/heartbeat,jobs/{id}/input-result}`.
  - `requireSite()`는 주소가 비었거나 API가 준비 전이면 **요청 전에 "연결 준비 전" 오류**를 던진다.
- 원본 대비 변경:
  - `background.js`, `sidepanel.js`: 원본 운영 서버 주소 상수 제거. 모든 fetch가 `requireSite()`를 거친다. 메시지 출처 검사는 `SITE_ORIGIN` 하나로 바꿨다. 자동 연결 시 여는 화면은 `/admin/distribution/connections`.
  - `web-bridge.js`: `SITE_ORIGIN`만 허용한다.
  - `sidepanel.html`: 외부 링크와 브랜드 표시 제거, config.js 로드.
  - `manifest.json`: 이름 변경. 빌드 자리표시와 content_scripts를 제거해 기본 권한은 `https://*.naver.com/*`뿐이다.
  - `blog-engine.js`: lint 예외 주석 1줄만 추가했다. 로직은 그대로다.
  - naver-page, naver-adapter, blog-core, styles, icons는 변경 없음.
- **최종 발행 버튼은 원본대로 누르지 않는다.** `seOnePublishBtn`은 제외 조건(`!==`)에만 나오고, 테스트로 고정했다.
- localhost·운영 주소를 하드코딩하지 않았다. 설정 필요 사항은 SETUP.md에 안내했다.

**의존성:** `server-only@0.0.1`(dependencies, 정확 버전). package.json과 lockfile만 바뀌었다. 운영 의존성 audit 0건. 개발 의존성의 moderate 7건(eslint 계열 minimatch)은 원래 있던 것이다.

**테스트(신규):**
- `web/tests/distribution-server/write-runner.test.ts`
- `web/tests/distribution-server/rules.test.ts`
- `web/tests/distribution-server/extension-port.test.ts`

## 실행 명령과 종료코드 (D:/Vibe/web)
| 명령 | 결과 |
|---|---|
| `npm.cmd install --save-exact server-only@0.0.1` | 0 |
| `npx vitest run tests/distribution-server tests/auth tests/content` | 0 — 6 files / 144 tests |
| `npm.cmd run lint` | 0 — 오류 0, 경고 2(원본 확장 코드의 미사용 변수: background.js `stored`, sidepanel.js `api`. 원본 그대로 둠) |
| `npm.cmd run typecheck` | 0 |
| `npm.cmd run build` | 0 |
| `npm.cmd test`(전체) | 1 — 267개 중 41 실패. 모두 `tests/distribution/{qa-decisions,adapters-utm,jobs,qa-boundaries}`이며 **다른 세션의 미커밋 distribution 도메인 변경** 때문이다(이전 작업 때와 같은 41건). 이번 신규 테스트 82개는 전부 통과 |
| `.next/static`에서 `SUPABASE_SECRET_KEY`·`sb_secret_` 검색 | 0건(클라이언트 번들에 secret 참조 없음) |

수정 과정에서 고친 것:
- 타입 오류 2건: `noUncheckedIndexedAccess` 대응.
- lint 오류 1건: 원본 확장의 `require`.
- 테스트 기대치 2건: 안내 문구 속 localhost 표기, `seOnePublishBtn` 제외 조건이 2곳임.

## 검증된 보장 (테스트)
- D1 거부(비승인 admin, 일반 회원, 비로그인) 시 RPC 0회, service 클라이언트 생성 0회.
- 폼에 다른 actor(`actorId`, `p_actor_id`)를 넣어도 무시된다. `p_actor_id`는 세션 userId다.
- 키가 없으면 `not_ready`.
- 응답을 못 받으면 `unavailable`이고 RPC는 1회만 호출된다.
- 확장: 기본 설정에서 요청이 차단된다. 주소만 있고 API가 미준비여도 차단된다. 다른 출처는 거부한다. 원본·외부 도메인과 하드코딩 주소가 0건이다. manifest 권한은 네이버만이다.

## 미연결 한계 (운영 불가 사유)
- 사이트에 `/api/distribution/extension/*` 라우트가 **없다.** 확장은 설치해도 "연결 준비 전" 상태다.
- 서버 액션·라우트에서 runner를 실제로 호출하는 곳이 아직 없다. 콘솔 UI 버튼은 여전히 비활성이다.
- DB(M1/M2/050000)는 미적용·미검증 상태다(별도 작업에서 진행 중). service 키는 env에 없다.
- `personal_access_tokens` 테이블과 발급·철회 UI가 없다.
- 이미지 블록은 M4 전이라 없다(텍스트만). 확장의 이미지 다운로드에는 이미지 호스트 권한이 필요하다(SETUP.md).
- **공개 저장소 주의:** `web/extension/naver-blog/`는 untracked 상태다. 저장소가 private로 바뀌기 전에는 커밋하지 않는다(commit·push 없음).

## 다음 작업: Blog 토큰·작업 API 범위
1. migration: `personal_access_tokens`(user_id, token_hash sha256 unique, label, created_at, last_used_at, expires_at, revoked_at)와 service_role 전용 발급·검증·철회 RPC. 토큰 원문은 발급 응답에서 1회만 보여 준다.
2. `web/src/server/distribution/blog/extension-auth.ts`: Bearer `pat_[0-9a-f]{64}` → 해시 조회 → 사용자 D1 재검사(`distribution_assert_admin_actor`와 같은 조건) → actor.
3. 라우트 `web/src/app/api/distribution/extension/`:
   - `whoami`(GET)
   - `task`(POST): `manual_ready` blog 작업 1건 선점 → `buildBlogExtensionTask`. 선점·runId 기록용 신규 SQL이 필요하다. M2에는 확장 선점 함수가 없다.
   - `jobs/[id]/heartbeat`(POST)
   - `jobs/[id]/input-result`(POST): 입력 결과는 로그만 남기고 상태를 published로 바꾸지 않는다.
   - 모두 no-store이고, CORS는 확장 origin을 허용하지 않는다(확장은 host_permissions로 호출).
4. 콘솔 연결 화면에 토큰 발급·철회 UI를 둔다(Design 범위 협의).
5. 그다음 A9(게시 표시) → A10(증거) 서버 액션을 runner로 연결한다.
