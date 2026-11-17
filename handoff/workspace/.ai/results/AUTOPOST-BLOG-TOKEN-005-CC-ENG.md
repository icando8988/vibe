# AUTOPOST-BLOG-TOKEN-005 — CC-ENG 결과

담당 Claude Code(CC-ENG-01) · task_deaf6dee0110 / dispatch ctx_3320ced565e9 · 2026-11-17
상태: **ready_review — 확장 인증 기반 구현·로컬 검증 완료. 운영 가능 상태 아님.**
- 실제 Supabase에 060000을 적용하지 않았다.
- 서버 secret 키가 env에 없다.
- 확장은 `API_READY=false`를 유지한다(task·heartbeat·input-result는 다음 작업).

## 구현 파일

### SQL — `web/supabase/migrations/20261116060000_distribution_extension_tokens.sql`

**테이블 `distribution_extension_tokens`**

| 열 | 내용 |
|---|---|
| `owner_id` | 소유 admin |
| `label` | 1~60자, 공백만·제어문자 금지 |
| `token_hash` | sha256 hex, unique |
| `created_at`, `expires_at` | 만료는 최대 366일 |
| `last_used_at` | 마지막 사용 |
| `revoked_at`, `revoked_by` | 철회 시각·철회자(둘 다 있거나 둘 다 없음) |

- RLS를 켜고 정책은 두지 않았다.
- 테이블 권한은 **PUBLIC·anon·authenticated·service_role 모두 회수**했다(SELECT 포함). 따라서 token_hash는 어떤 역할도 직접 읽을 수 없다.

**함수 4개** — 모두 SECURITY DEFINER, `search_path=''`, PUBLIC·anon·authenticated EXECUTE 회수, service_role에만 부여

| 함수 | 동작 |
|---|---|
| `distribution_issue_extension_token(actor, hash, label, ttl)` | D1(`distribution_assert_admin_actor` 재사용) 확인. 해시·label·ttl(1~365일) 검증. 유효 토큰 10개 상한(`TOKEN_LIMIT`). 같은 해시는 `DUPLICATE`. 반환은 `{id, label, created_at, expires_at}`만 |
| `distribution_list_extension_tokens(actor)` | D1 확인. **actor 소유 토큰만** 반환하며 해시 열 없음. 최대 50개 |
| `distribution_revoke_extension_token(actor, token_id)` | D1 확인. 소유 토큰만 철회. 다른 소유자 토큰은 "없음"(P0002)과 같은 응답이라 존재가 드러나지 않음. 두 번 철회하면 `ALREADY_REVOKED` |
| `distribution_authenticate_extension_token(hash)` | 해시로 찾아 **매 호출** 철회·만료·소유자 D1(현재 profiles·role_assignments)을 확인. 실패 사유를 구분하지 않고 0행. 성공 시 `{user_id, token_id}`만 반환하고 last_used_at을 갱신 |

### 서버 — `web/src/server/distribution/blog/`

| 파일 | 역할 |
|---|---|
| `token.ts` | `pat_` + `crypto.randomBytes(32)` hex, sha256, Bearer 파서(`pat_[0-9a-f]{64}`만), label·기간(30/90/180일) |
| `token-service.ts` | 발급·목록·철회(아래 규칙). 목록 응답에 예상 밖 열(예: token_hash)이 섞이면 거부. 실패를 안내 코드로 변환 |
| `extension-auth.ts` | 형식 오류 → 401(조회 0회), 키 없음·DB 오류 → 503, 0행 → 401, 1행 → userId |
| `whoami.ts` | 응답 `{ok:true, connected:true}`만. `Cache-Control: private, no-store`, `Vary: Authorization`, nosniff. **CORS 헤더 없음**. 401은 `WWW-Authenticate: Bearer` |
| `service.ts` | server-only. service_role RPC 클라이언트. 키가 없으면 null |

`token-service.ts`의 규칙:
- 공통 write-runner를 쓴다: 세션 actor + D1 → 입력 검증 → 키 확인 → RPC 1회.
- **토큰은 D1·입력 통과 뒤에만 생성**하고, RPC에는 해시만 보낸다.
- 원문은 발급 성공 결과에만 담긴다.

### 라우트·화면
- `web/src/app/api/distribution/extension/whoami/route.ts`: GET, nodejs, force-dynamic.
- `web/src/app/admin/distribution/connections/blog-extension/`

| 파일 | 내용 |
|---|---|
| `page.tsx` | 서버 컴포넌트. D1 guard. 키·DB 준비 전이면 "연결 준비 전" 안내와 비활성 발급 버튼만 보이고 가짜 목록이 없다. 목록 조회 실패는 오류 안내. 정상일 때 발급 폼, 내 토큰 표(상태·만료·마지막 사용), 철회 버튼 |
| `actions.ts` | `"use server"`. 발급(`useActionState` 반환)과 철회(notice 코드로 redirect, 토큰 값 없음) |
| `token-issue-form.tsx` | 클라이언트. 발급 원문을 **컴포넌트 메모리에만** 1회 표시하고 복사 버튼을 둔다. URL·localStorage·sessionStorage·쿠키는 쓰지 않는다 |

- `connections/page.tsx`의 Blog 카드에 진입 링크를 추가했다.

### 검증·테스트
- 로컬 DB 러너(독립): `web/scripts/distribution-local-verify/token-run.mjs`
- 단위 테스트: `web/tests/distribution-server/blog-token.test.ts`

## 실행 명령과 종료코드
| 명령 | 결과 |
|---|---|
| `node web/scripts/distribution-local-verify/token-run.mjs --pglite-project %TEMP%\autopost-local-db-verify-002` | **0 — 71/71**. 그룹별 결과는 아래 표 |
| 같은 대역으로 기존 `run.mjs` | 0 — 204/204. 앞 6개 순서 확인 후 060000도 적용(M2-VERIFY-003에서 이미 추가분을 허용하도록 바뀜) |
| 같은 대역으로 기존 `m2-run.mjs` | 0 — 304/304. 060000이 M2 시나리오에 영향 없음. 출력의 `DEFECT-REPRODUCED D-2`는 m2-run이 원래 재현하는 M2 결함 기록이며 070000 작업 범위 |
| `npx vitest run tests/distribution-server` | 0 — 4 files / 109 |
| `npm.cmd test`(전체) | **0 — 15 files / 335 tests** |
| `npm.cmd run lint` | 0 — 오류 0, 경고 2(원본 확장 코드의 미사용 변수, 기존과 같음) |
| `npm.cmd run typecheck` / `npm.cmd run build` | 0 / 0(`/admin/distribution/connections/blog-extension`, `/api/distribution/extension/whoami` 생성) |
| `.next/static`에서 `SUPABASE_SECRET_KEY`·`sb_secret_`·인증 RPC 이름 검색 | 0건 |

token-run.mjs 그룹별 결과(71/71):

| 그룹 | 확인 내용 |
|---|---|
| 0 적용 | migration 7개 순서대로 적용, owner = supa_owner |
| 1 ACL | 3개 역할의 테이블 권한과 token_hash 열 권한 없음, RLS 켜짐. 함수 4개는 service_role만 EXECUTE, PUBLIC 없음, DEFINER, `search_path=""`. service_role·authenticated(admin JWT)·anon의 직접 접근과 함수 호출 모두 42501 |
| 2 발급 | 응답에 해시·원문 없음, DB에는 해시만, 만료 = 발급 + 90일. pending·suspended·역할 없는 회원·없는 사용자·null actor는 42501이고 행 0. 입력 오류 8종은 22023. 같은 해시는 DUPLICATE, 11번째는 TOKEN_LIMIT |
| 3 목록 | 자기 토큰만, 해시 열 없음, 비승인 actor는 42501 |
| 4 인증 | 사용자·토큰 ID만 반환, last_used_at 갱신. 모르는 해시·원문 토큰·null은 0행. 소유자 정지 즉시 0행 → 재승인 시 복구. admin 역할 회수 → 0행. 만료 → 0행 |
| 5 철회 | 다른 소유자 토큰은 P0002이고 상대 토큰은 그대로 유효. 비승인 actor는 42501. 철회 후 인증 0행, 두 번째 철회는 ALREADY_REVOKED. service_role이 철회를 직접 해제하려 하면 42501 |

**적용한 migration 목록(전체 적용 검증 시점):** 000000, 010000, 020000, 030000, 040000, 050000, 060000(7개). 검증 시점에 070000은 없었다. 070000은 별도 작업(ctx_1d0f2344dec6)이 맡고 있으며 결과는 Master가 조정한다(msg_f55597b95e67).

## 원본 대비 변경 (Blog_Posting_Kit_v1.07 utils/extensionAuth.ts·settings 토큰 흐름)
| 원본 | 이식본 |
|---|---|
| `personal_access_tokens`(program_slug 공용 테이블), 클라이언트·RLS로 본인 행 조회 | 전용 테이블. **모든 역할 직접 접근 불가**, service_role 전용 RPC 4개만 |
| sha256 해시 저장 | 같음(앱에서 해시). 토큰 형식 `pat_` + hex 64자 유지(확장 sidepanel 정규식과 호환) |
| `checkProgramAccess`·구독·is_admin 프로필 | D1(admin 역할 AND approved)을 발급·목록·철회·**매 인증마다** DB에서 확인 |
| 만료 없음(원본 스키마 기준) | 만료 필수(30/90/180일, DB 상한 366일), 철회자 기록, 소유자당 유효 10개 상한 |
| whoami가 email·name·isAdmin·버전 반환 | `{ok, connected}`만(최소 상태). 확장 sidepanel은 "연결됨: undefined"처럼 email 칸이 비어 보일 수 있다 — 다음 작업에서 확장 표시 문구 조정 필요 |
| 원본 코드 | 복사하지 않고 이 프로젝트 패턴으로 다시 작성 |

## 남은 작업
1. 실제 Supabase 적용(060000)과 서버 secret 키 등록(사용자). 그 전까지 화면은 "준비 전"이다.
2. 다음 작업: `task`(manual_ready blog 작업 선점 → `buildBlogExtensionTask`; 선점·runId용 SQL 필요), `jobs/[id]/heartbeat`, `jobs/[id]/input-result`(published로 바꾸지 않음). 그 뒤 확장 `config.js`의 API_READY와 사이트 주소 설정.
3. 확장 sidepanel의 whoami 표시(email 대신 "연결됨")를 조정한다(확장 범위).
4. whoami·인증 요청 속도 제한(무차별 대입 완화)은 미구현이다. 토큰 엔트로피가 256비트라 실질 위험은 낮지만 운영 전 검토가 필요하다.
5. 브라우저 실측(발급 1회 표시, 철회 흐름)은 미실행이다.

## 범위 준수
- 기존 M0~050000 SQL, run/m2-run/lib, 도메인 코드, 확장, 070000은 수정하지 않았다.
- 키·env 파일을 열람하지 않았다.
- 실DB, 플랫폼, 네트워크, 외부 게시, commit, push는 없다.
