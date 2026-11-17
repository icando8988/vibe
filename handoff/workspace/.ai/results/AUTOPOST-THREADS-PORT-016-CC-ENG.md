# AUTOPOST-THREADS-PORT-016 — CC-ENG 결과

- 작업자: Claude Code(CC-ENG-01), handle term_67ce2ea3-ec00-4b76-985a-fad63d177b0a
- task_197e5e533097 / dispatch ctx_6861cec44a2c / 2026-11-17
- 금지 준수: SQL·migration·기존 러너·확장·package·env·키트 원본 미수정. 실DB·실계정·키·env 열람, 실제 Threads 호출, 외부 게시, commit/push 없음.

## 0. 한 줄 요약 — 무엇이 되고 무엇이 아직 아닌가
- **됨(코드·모의)**: Threads 텍스트 게시 부품 이식(4단계 분리, mock fetch 검증) + prepare에서 Threads **모의 실행 작업 생성·조회·취소**(PGlite 왕복 검증).
- **아직 아님(운영)**: live adapter 미등록(실제 fetch 미주입), OAuth·토큰 DB(M3 암호화)·실행기(워커·스케줄러) 없음, live gate=false 유지. 만든 dry_run 작업은 실행되지 않고 `scheduled`(모의 실행 대기)로 남는다. **실제 Threads 게시는 불가능한 상태다.**

## 1. 이식(출처·고지 보존)
- `web/src/server/distribution/threads/NOTICE` — 키트 `threads/NOTICE` 원문 그대로 복사(cmp 동일). 배포판 키트(v1.02, 사용자 본인 설치용)라 NOTICE의 "정식 배포 키트" 예외에 해당한다고 판단, Blog 확장 이식과 같은 방식으로 고지 보존.
  - 주의: 키트 파생 코드이므로 공개 저장소(icando8988/vibe)에는 private 전환 전까지 commit/push하지 말 것(기존 지시와 동일, `extension/naver-blog`와 같은 취급).
- `threads/types.ts` — 원본 응답 타입(Container/Status/Publish/ApiError) 이름 유지 + 결과 계약.
- `threads/client.ts` — 원본에서 텍스트 경로만:
  1. `createTextContainer`(POST /{user}/threads, media_type=TEXT) — 게시 아님. timeout·5xx면 `definite:false`(컨테이너가 남았을 수 있음).
  2. `getContainerStatus`(GET 1회. 반복·대기는 호출자 몫. error_message 원문 미전달)
  3. `publishContainer`(POST /{user}/threads_publish, 1회) → `published` / `rejected`(4xx 명시 거절·auth·rate limit·입력 오류) / **`unknown`**(timeout·응답 유실·5xx·2xx인데 ID 없음) — 재시도 없음.
  4. `getPermalink`(GET, threads.net/threads.com https만 신뢰)
  5. `combinePublishOutcome` — 네트워크 없이 합성: permalink 실패면 **게시 확인 + URL 미확인**(`urlConfirmed:false`), 실패로 바꾸지 않음.
  - 원본의 일괄 `publishThreadsPost`(create→wait→publish→permalink)는 **이식하지 않음**. create와 publish를 이어 부르는 helper 없음(테스트로 export 목록 고정) → 워커가 컨테이너 ID를 DB에 선기록한 뒤 publish하는 경계 유지.
  - fetch는 의존성 주입만(기본 fetch 없음), 요청별 AbortController timeout(기본 15초), `redirect:"error"`, `cache:"no-store"`. 결과·오류는 정제 코드(`timeout|network|http_5xx|rate_limited|auth|rejected|bad_response|invalid_input`)와 HTTP/공급자 숫자 코드만 — 공급자 메시지·URL·토큰 미포함, 로그 출력 없음.
  - 토큰: POST는 원본처럼 form body(URL 아님). **GET은 원본 규격(access_token 쿼리)을 유지**했다 — Authorization 헤더 지원 여부를 공식 문서로 확인하려 했으나 이번 세션에서 문서 조회가 권한상 거절돼 추측으로 바꾸지 않았다. URL 조립은 내부 함수 하나에 가두고 밖으로 내보내지 않는다. (후속: 공식 문서 확인 뒤 헤더 방식 전환 검토)
  - 텍스트 사전검사: 비어 있지 않음·제어문자 없음·500자 이하(`THREADS_TEXT_MAX`, 알려진 공급자 상한이나 이번 세션 문서 재확인 못함).
  - 이미지·영상·캐러셀·OAuth·토큰 교환·프로필·AI/수집은 미이식(다음 단계).

## 2. 작업 연결
- `rpc-params.ts`: `CREATABLE_JOB_MODES = ["manual","dry_run"]`, `createJobParams`(live는 앱에서 만들지 않음 — throw). 기존 `createBlogManualJobParams` 유지.
- `jobs-service.ts`: `createThreadsDryRunJob` — 세션 actor + D1 → channel=threads·uuid 검증 → `distribution_create_job(mode=dry_run, 예약 없음, 재게시 false)`. 승인·최신성·중복 최종 판단은 SQL.
- `jobs-dto.ts`: dry_run+scheduled 경고("실행기 없음, 생성은 모의 실행 성공 아님, 외부 게시 없음"), `jobStatusText` → "모의 실행 대기(실행기 없음)". 행동은 취소만.
- `contents/actions.ts`: `createThreadsDryRunJobAction`(성공 시 실행 상세로).
- prepare: Threads 카드 — 원문 승인 + 최신 원문 기준 Threads 리비전 승인 + 같은 버전 진행 중 작업 없음일 때만 "모의 실행 작업 만들기", 아니면 막힌 이유. 실행기·OAuth·토큰·live gate 미준비 안내. Instagram은 비활성 유지.
- jobs 목록·상세: 상태 표시를 `jobStatusText`로(dry_run 대기 정직 표시). 취소는 기존 A14.

## 3. 검증
| 항목 | 결과 |
|---|---|
| threads-connect-run.mjs (PGlite, 000000~080000) | 3/3 |
| blog-flow-run.mjs 회귀 | 5/5 |
| content-connect-run.mjs 회귀 | 2/2 |
| vitest 전체 | 20 files · 454 passed · 10 skipped(PGlite 전용) |
| tsc | 0 오류 |
| lint | 0 오류 · 경고 3(범위 밖 기존) |
| next build | 성공 |

- mock fetch(17): export에 일괄 helper 없음, 컨테이너 생성은 POST 1회·토큰 body만·publish 미호출, 입력 오류 시 요청 0회, 컨테이너 timeout→definite:false, publish 1회, publish timeout/응답 유실/5xx/2xx 무ID→unknown·재시도 없음, 4xx→rejected(메시지 폐기, 코드만), 190→auth, 결과에 토큰 문자열 없음(오류 메시지에 토큰이 섞여도), permalink 실패→게시 확인+URL 미확인, 다른 호스트 permalink 거절, redirect 거부·no-store·abort 신호. dry_run 서비스: RPC 인자, D1·채널 불일치 RPC 0회, NOT_APPROVED/DUPLICATE 안내, live 생성 불가, 대기 표시.
- PGlite: 비승인 admin denied, 생성→`scheduled`/dry_run·증거 0·행동은 취소만, 목록 조회, 같은 버전 중복 duplicate, Threads 리비전 manual 생성은 SQL 거절, 취소 version 충돌→성공→cancelled, 취소 후 재생성 가능(SQL 키가 cancelled 제외), 미승인 not_approved, 승인 철회 후 not_approved, admin 역할 회수 후 denied, 같은 원문 Blog manual과 Threads dry_run 독립.

## 4. 측정 못한 것
- 실제 Threads API 동작(규격·응답·글자 수 상한·permalink 호스트) — 외부 호출 금지, 문서 조회도 이번 세션 거절.
- 실제 세션 브라우저 렌더·클릭, 실제 Supabase/PostgREST.
- dry_run 작업 실행(dry_run_succeeded 전이) — 실행기 없음.

## 5. 다음 단계 제안
1. **M3 최소(암호화 연결 저장)**: Threads 연결 테이블(계정 ID·암호화 토큰·만료·철회) + service_role 전용 RPC, 토큰은 서버 키로 암호화(평문 DB·로그 금지), 화면엔 연결 상태만. SQL 작업 허용 필요.
2. **OAuth 최소**: 키트 OAuth 부품(authorize URL·코드 교환·장기 토큰) 이식 — state 검증·redirect 고정·토큰은 1번 저장소로만. 실제 Meta 앱 등록은 사용자 작업.
3. 그 뒤: 공식 문서로 GET 토큰 전달 방식 확인, 워커(claim → 컨테이너 선기록 → publish → unknown/permalink 처리) + dry_run 실행기, live gate 조건.

## 6. 실제 Supabase 준비사항
- migration 000000~080000 적용, `SUPABASE_SECRET_KEY` 서버 등록, 승인 admin 1명.
- (다음 단계) Meta 개발자 앱 + Threads 테스터 계정, redirect URI 확정, 토큰 암호화 키 env, M3 migration.
