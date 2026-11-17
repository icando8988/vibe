# AUTOPOST-THREADS-OAUTH-019 — CC-ENG 결과

- 작업자: Claude Code(CC-ENG-01), handle term_67ce2ea3-ec00-4b76-985a-fad63d177b0a
- task_3d3f6256bea1 / dispatch ctx_51527d96a112 / 2026-11-17
- 금지 준수: 기존 SQL·키트 원본·확장·package 미수정, 실DB·실계정·키/env 열람·실제 Threads/Meta 호출·게시·commit/push 없음. 공식 문서 조회만(아래).
- **운영 상태: 코드·로컬 검증만. 실제 Supabase에 030000~100000 미적용, THREADS_APP_ID/THREADS_APP_SECRET/DISTRIBUTION_TOKEN_KEY/SUPABASE_SECRET_KEY 미등록, Meta 앱 미설정 → 실제 연결 불가(화면은 "연결 준비 전"). 연결 성공도 게시 가능이 아님(부여 권한 확인·capability 검증·실행기 미구현, live gate 닫힘).**

## 0. 선행 정리 — connections-run.mjs
- 대상 테스트·connections 모듈·090000 SQL이 없으면 `NOT RUN` + 준비 안내 + **exit 3**(없는 검증을 통과로 세지 않음).
- 검증: `git archive HEAD`(공개 release 3a20194 트리)에 수정 러너를 덮어 실행 → 빠진 파일 3개 나열, exit 3. 전체 작업 트리 → 5/5 통과.
- 공개 release 재commit/push는 하지 않았다(작업 트리 정리 변경으로만 남김: `M scripts/distribution-local-verify/connections-run.mjs`).

## 1. 근거 확인(공식 문서, 2026-11-17 조회)
- https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions
  - 인증 창 `https://threads.com/oauth/authorize` — client_id, redirect_uri, scope(쉼표 또는 URL 인코딩 공백 구분), response_type=code, state(선택, CSRF)
  - 코드 교환 `POST https://graph.threads.com/oauth/access_token` — client_id, client_secret, code, grant_type=authorization_code, redirect_uri → access_token, token_type, user_id
  - "Authorization codes are valid for 1 hour and can only be used once." redirect_uri는 등록값과 정확히 일치. 콜백 code 뒤 `#_`는 code 아님. threads_basic 필수.
- https://developers.facebook.com/docs/threads/get-started/long-lived-tokens
  - `GET https://graph.threads.com/access_token` — grant_type=th_exchange_token, client_secret, access_token → access_token, token_type, expires_in. 장기 60일, 단기 1시간.
- Postman(meta/threads) 페이지는 본문을 읽지 못함(빈 응답).
- 원본 키트와 차이: 키트는 threads.net / graph.threads.net 호스트 → 공식 현재 값 threads.com / graph.threads.com 채택.
- **미검증(fail closed / 호출 안 함)**: 코드 교환 본문 형식(문서 예시는 multipart, 원본과 같은 urlencoded 사용 — 실제 호출 미검증), `/me` 프로필(문서에 없어 호출 안 함 → 계정 ID는 교환 응답 user_id, 라벨 없음), 실제 부여 권한(응답에 scope 없음 → "요청한 권한"으로만 저장·표시), Bearer 헤더 대안(문서 없음 → 장기 토큰 교환은 문서대로 GET 쿼리, URL은 요청 함수 밖으로 안 나감).
- vercel-connect skill(코덱스 플러그인 경로)을 읽었다: `@vercel/connect` 패키지·Vercel CLI 인증·Vercel 보관 토큰 방식이라 이번 범위(package 수정 금지, M3 자체 암호화 저장)와 맞지 않아 채택하지 않음.

## 2. 구현
**migration `20261116100000_distribution_oauth_states.sql`**(새 SQL만): `distribution_oauth_states`(actor·channel=threads·state_hash sha256·고정 https redirect·만료 ≤15분·재연결 대상 id+row_version·consumed_at). RLS·정책 없음·모든 공개 역할 직접 권한 회수. RPC 2개(service_role 전용 DEFINER, search_path=''):
- `distribution_create_oauth_state`: D1, ttl 60~900초, 재연결 대상은 actor 소유·미철회·row_version 일치, actor별 열린 state 5개 상한.
- `distribution_consume_oauth_state`: D1, FOR UPDATE로 1회 소비(동시 재사용 → `OAUTH_STATE_USED`), 다른 actor·없는 state·channel/redirect 불일치는 `OAUTH_STATE_INVALID`(소비 안 함), 만료 `OAUTH_STATE_EXPIRED`. 재연결 대상 계정 ID 반환.

**`src/server/distribution/threads/oauth/`**(키트 파생, 출처 주석 + ../NOTICE)
- `endpoints.ts`(공식 근거·미검증 기록), `config.ts`(THREADS_APP_ID·THREADS_APP_SECRET·DISTRIBUTION_TOKEN_KEY·NEXT_PUBLIC_SITE_URL, 없거나 형식 오류면 not_ready·이름만, secret은 SecretToken, redirect는 `SITE_URL + 고정 경로` 하나), `state.ts`(256bit base64url, sha256, 상수 시간 비교, `__Host-` HttpOnly·Secure·SameSite=Lax·Max-Age 600), `provider.ts`(인증 URL·코드 교환·장기 토큰, DI fetch·timeout·redirect 거부·no-store·재시도 없음·정제 결과, user_id는 원문에서 문자열 추출 — 17자리 정밀도 보존), `flow.ts`(start/callback), `http.ts`(응답 조립·Origin 검사), `session.ts`(server-only, env는 여기서만).
- start(POST만): 세션 actor+D1 → 설정 → 같은 사이트 Origin → state 해시 등록 → 고정 인증 URL로 303 + 쿠키.
- callback(GET): 세션 actor+D1 → 설정 → 쿠키 state = 쿼리 state → DB 1회 소비 → provider error/취소면 저장 없이 종료 → code 1회 교환(4xx exchange_failed / 유실 exchange_unknown, 재요청 없음) → 장기 토큰 → 재연결이면 대상 계정과 user_id 비교(다르면 account_mismatch, 저장 없음) → `reconnectSameAccount`(같은 id, 렌더 version) / 새 연결이면 `saveNewConnection`(같은 계정 활성 연결 있으면 already_connected, 저장 없음). 저장 응답 유실은 save_unknown. 결과는 허용 목록 코드만 고정 내부 경로로 303, 쿠키 항상 삭제. state·code·token·공급자 메시지는 URL·로그·사용자 오류에 반사하지 않음.
- 저장 토큰은 장기 토큰만, M3 AES-256-GCM 봉투로만. 앱 secret은 DB 저장 없음. UI에는 계정 ID·요청 권한·만료·상태만.

**화면·라우트**: `app/api/distribution/oauth/threads/{start,callback}/route.ts`, `app/admin/distribution/connections/threads/{page.tsx,actions.ts}`(준비 상태·빠진 설정 이름·등록할 redirect, 새 계정 연결, 같은 계정 재연결, 연결 해제(확인 필수, M3 철회), 결과 안내, "연결됨 ≠ 게시 가능"), `connections/page.tsx`에 Threads 링크.

**connections 최소 변경**: 코드 변경 없음(테스트 1줄: migration 마지막 파일 단언 → 포함 단언).

## 3. 검증
| 항목 | 결과 |
|---|---|
| oauth-run.mjs (PGlite, 000000~100000 11개) | 6/6 |
| connections-run 5/5 · threads-connect 3/3 · blog-flow 5/5 · content-connect 2/2 | 통과 |
| run 208/208 · m2-run 334/334 · token-run 76/76 · handoff-run 91/91 · handoff-review-run 103/103 | 통과 |
| vitest 전체(작업 트리) | 22 files · 487 passed · 21 skipped(PGlite 전용) |
| tsc / lint / build | 0 / 0 error(기존 경고 3) / 성공(새 라우트 3개) |
| 로컬 비인증 HTTP | GET start 405, POST start(본문 없음·타 origin) → `?result=invalid_request`, callback(세션 없음) → `?result=denied` + 쿠키 삭제, URL에 state/code 반사 없음 |

- 단위(20, mock HTTP·RPC): 설정 판정·secret 가림, SITE_URL https origin만, state 형식·무작위·해시·상수 시간 비교, 인증 URL 파라미터, `#_` 제거, 코드 교환 POST 본문(URL에 secret·code 없음)·user_id 문자열·토큰 가림, 4xx rejected/timeout·network·5xx·형식오류 unknown·재시도 0, 장기 토큰 GET·expires_in 범위, start D1/준비전 RPC 0회·해시만 등록·공급자 미호출, 재연결 대상 묶음, callback 정상(장기 토큰만 저장, 복호화로 확인), 쿠키 불일치 소비·교환 0회, 재사용·만료·D1·준비전 교환 0회, 취소·공급자 오류는 소비만, 교환 실패 저장 없음, 같은/다른 계정 재연결, 저장 결과 매핑(already_connected·save_unknown·connection_revoked·version_conflict), 라우트 응답 헤더·쿠키 속성·고정 인증 URL만·Origin 검사.
- PGlite(6): ACL(테이블 42501, RPC service_role만), 비승인 denied, DB에 state 원문 없음, 연결 성공 → worker 복호화로 장기 토큰 확인, 재사용 state_used(교환 0회), DB 덤프에 토큰·앱 secret 없음, 같은 계정 새 연결 already_connected, **동시 callback 2개 → connected 1 + state_used 1, 연결 1개**, 다른 actor state_invalid·원 state 미소비, 만료 state_expired, start 후 권한 회수 denied, 재연결 다른 계정 account_mismatch(행 불변)·같은 계정 reconnected(같은 id·version+1·새 토큰)·낡은 version conflict·철회 연결 시작 거부·타인 연결 not_found, 취소 후 state_used, 열린 state 상한.

## 4. 알려진 한계·후속
- `next.config.ts` 전역 헤더가 라우트의 `Referrer-Policy: no-referrer`를 `strict-origin-when-cross-origin`으로 덮는다(범위 밖이라 미수정). 결과 이동 URL에는 비밀이 없어 직접 노출은 없음 — 경로별 no-referrer는 next.config 작업에서.
- 실제 부여 권한 확인, 토큰 갱신(`refresh_access_token`, 문서 확인됨)·만료 전 재연결 안내, Meta 데이터 삭제/권한 해제 콜백, 연결 소유자·상태를 반영한 live gate는 미구현.
- **공개 release 제외 유지 필요**(키트 파생 또는 그 의존): `src/server/distribution/threads/**`(oauth 포함), `src/server/distribution/connections/**`, `src/app/api/distribution/oauth/**`, `src/app/admin/distribution/connections/threads/**`, `tests/distribution-server/threads-oauth*.ts`·connections·threads-client·extension-port 테스트, `scripts/distribution-local-verify/oauth-run.mjs`(대상 없으면 NOT RUN). `connections/page.tsx`(공개 추적 파일)의 Threads 링크는 위 페이지 없이 공개되면 404가 되므로 함께 묶어 다룰 것. migration 100000은 자체 SQL(키트 문구 없음).

## 5. 실제 Meta 앱·서버에 설정할 것(이름만, 값은 요청하지 않음)
- Meta(Threads) 앱 → 유효한 OAuth redirect URI: `<NEXT_PUBLIC_SITE_URL>/api/distribution/oauth/threads/callback` (예: production이면 `https://vibe-ten-nu.vercel.app/api/distribution/oauth/threads/callback`) — 이 하나만. 권한: threads_basic, threads_content_publish. 개발 모드면 연결할 계정을 테스터로 등록.
- 서버 env: `THREADS_APP_ID`, `THREADS_APP_SECRET`, `DISTRIBUTION_TOKEN_KEY`(`v1:<base64 32바이트>`), `NEXT_PUBLIC_SITE_URL`(https origin), `SUPABASE_SECRET_KEY`.
- Supabase: migration 000000~100000 적용.
- 다음 작업은 Master 지시 대기.
