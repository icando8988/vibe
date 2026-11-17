# BE-CHANNEL-RELEASE-035 — 세 채널 배포 서버 검토 (결과)

담당: CC-BACKEND-01 Claude(Backend) / term_0dacb0de-23ca-43f4-a7d2-7bf514a82ae8
지시: 사용자 → CX-MASTER-01. 착수 보고: msg_2bc9bd1d72dc. 상태: **ready_review**. 결과 반환 뒤 코드 동결.
방법: 소스 읽기(라우트·서버 모듈 import 관계·설정 로더·실패 처리)만. **코드 수정 없음.** env 값·비밀 파일 미열람, 실DB·Storage·외부 호출·배포·commit 없음. 전체 test/build는 지시대로 Master 최종 snapshot에 맡기고 반복하지 않았다(직전 근거는 BE-UPLOAD-RECOVERY-030: npm test 657통과/skip0, build·typecheck 성공. 지금 작업 트리에는 다른 담당의 미커밋 변경이 섞여 있다).

## 1. 결론
- **재현된 배포 차단 결함: 없음.** 모든 채널 라우트는 설정·클라이언트가 없으면 `not_ready`/503으로 막히고(fail closed) 예외를 던지지 않는다. build는 직전 성공했다.
- 다만 **배포만으로 실제 게시가 되는 채널은 없다.** Threads·Instagram live 게시는 서버에 연결돼 있지 않고 DB live gate가 닫혀 있다. Blog는 사람이 직접 게시하는 수동 흐름과, 확장 프로그램이 발행 직전까지 입력하는 흐름까지만 있다.

## 2. route → service / DB / 외부 HTTP 연결 지도
| 채널 | 진입점(route/page·action) | 서버 모듈 | DB(RPC, service_role) | 외부 HTTP | 상태 |
|---|---|---|---|---|---|
| 공통 | `/admin/distribution/contents/**` actions | `content-service`·`approval-service`·`jobs-service` → `write-runner` | content/approval/job RPC(030000~050000·110000) | 없음 | 연결됨 |
| **Blog** 수동 | `/admin/distribution/jobs/[jobId]/manual`·`reconcile` | `jobs-service` | M2 manual·증거·대사 RPC(040000·070000) | 없음(사람이 네이버에 직접 게시 후 URL·증거 기록) | 연결됨 |
| **Blog** 확장 토큰 | `/admin/distribution/connections/blog-extension` | `blog/token-service`·`blog/service` | 060000 토큰 RPC | 없음 | 연결됨 |
| **Blog** 확장 API | `GET /api/distribution/extension/whoami`, `POST …/task`, `POST …/jobs/[jobId]/heartbeat`, `POST …/jobs/[jobId]/input-result` | `blog/whoami`·`blog/handoff`·`blog/extension-auth` | 060000·080000 인계 RPC | 서버는 없음. 확장이 사이트 API와 `blog.naver.com`을 호출 | 서버 연결됨 / **확장 미설정**(§3) |
| **Threads** 연결 | `POST /api/distribution/oauth/threads/start`, `GET …/callback`, `/admin/distribution/connections/threads` | `threads/oauth/{flow,provider,endpoints,state,config,session}`·`connections/{service,crypto}` | 090000 연결·100000 state RPC | `threads.com/oauth/authorize`(리다이렉트), 토큰 교환·장기 토큰(서버 fetch, 시간 제한, `redirect:"error"`) | 연결됨, **실환경 미검증** |
| **Threads** 모의 실행 | `/admin/distribution/jobs/[jobId]` + `jobs/actions.ts` | `dry-run/executor`(외부 fetch import 금지를 시험이 고정) | 110000 claim + M2 advance/complete | 없음 | 연결됨(dry_run만) |
| **Threads** live 게시 | **없음** | `threads/client.ts` — **어떤 라우트·서버 모듈도 import하지 않음** | live gate `distribution_live_gate()` 항상 false | (클라이언트만 있고 미사용) | **미구현** |
| **Instagram** | **라우트 없음** | `instagram/client.ts` — **import 0** | live gate false | (클라이언트만 있고 미사용) | **미구현**(연결 OAuth도 없음) |
| 미디어(Instagram 전제) | `/admin/distribution/media/**`, `POST /api/distribution/media/upload/{grant,complete,cancel}` | `media/{session,service,upload,upload-http,storage-supabase,process}` | 120000·130000 (140000 복구는 `media/recovery.ts`, 호출 주체 없음) | Supabase Storage(서명 업로드·다운로드·업로드) | 서버 연결됨, **Storage 실환경 미검증**, UI는 Front 소관 |

## 3. 실제 동작에 필요한 미설정 / 미검증 항목
**환경변수(이름만, 값 미확인)**
| 이름 | 쓰는 곳 | 없을 때 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 세션·조회 | 로그인·조회 불가 |
| `SUPABASE_SECRET_KEY`(서버 전용) | 모든 쓰기 RPC·Storage | `not_ready` |
| `NEXT_PUBLIC_SITE_URL`(https origin) | Threads redirect_uri·Origin 검사 | Threads `not_ready` |
| `THREADS_APP_ID`, `THREADS_APP_SECRET` | Threads OAuth | Threads `not_ready` |
| `DISTRIBUTION_TOKEN_KEY` | 연결 토큰 암호화(M3) | Threads 연결 저장 `not_ready` |

**runtime 사전조건**
1. **실 DB migration**: 000000~130000이 실제 프로젝트에 적용돼야 한다(적용 이력은 Master 확인 대상, 나는 확인하지 않음). 140000은 새로 만든 것이라 미적용이며, 앱 화면 경로는 140000 없이도 동작한다.
2. **Storage bucket**: `distribution-media-intake`·`distribution-media`(private, 정책 0) 미생성 가정. 없으면 미디어 업로드가 실패한다(`storage_error`/`signing_failed`). 다른 채널에는 영향 없음.
3. **Threads 앱 설정**: Meta 앱에 redirect URI `<NEXT_PUBLIC_SITE_URL>/api/distribution/oauth/threads/callback`를 등록하고 scope·심사 상태를 확인해야 한다. 실제 토큰 교환은 미검증.
4. **Blog 확장 배포 설정**(`extension/naver-blog`, 내 수정 범위 밖): `config.js`가 `SITE_ORIGIN: ""`, `API_READY: false`이고 `manifest.json` `host_permissions`에는 `https://*.naver.com/*`만 있다. 그래서 사이트를 배포해도 확장은 서버 요청을 보내지 않는다. 운영 주소로 세 곳을 맞춘 확장 빌드와 배포가 따로 필요하다(SETUP.md 참조). 확장 파일은 Master가 담당을 지정해야 한다.
5. **완료 라우트 `maxDuration=60`** 이 실제로 강제되는지(미디어 복구 자동 호출의 전제). 지금은 호출 주체가 없어 영향 없음.
6. 미검증 유지: Storage 서명 업로드 전제 6건(RESUME-026), 실DB 다중 연결 동시성, Threads/Meta 실제 응답.

## 4. 배포만으로 가능한 것 / 불가한 것
**가능**(env와 DB migration이 갖춰졌을 때)
- 콘텐츠 작성 → 채널 초안 → 승인 → 작업 생성. 작업 목록·상세·보류·재검사.
- **Blog**: 사람이 네이버에 직접 게시한 뒤 수동 기록·증거·대사. 확장 토큰 발급·폐기, 확장 API 응답(확장 쪽 설정 후 실제 사용 가능).
- **Threads**: 계정 연결 OAuth(Meta 앱 설정이 맞을 때)와 dry_run 모의 실행(외부 게시 없음).
- 미디어 metadata 목록·권리 결정·보관. 업로드는 bucket 생성과 Storage 검증 뒤에 가능.

**불가**(배포로 해결되지 않음)
- Threads·Instagram **실제 게시**: live 실행기·worker 미구현, live gate가 항상 false(fail closed).
- Instagram 계정 연결: OAuth 라우트 없음.
- 예약 실행·자동 재시도·리스 회수·미디어 만료/복구 정리: Cron/worker 호출 주체 없음.
- Blog 완전 자동 게시: 설계상 마지막 발행은 사람이 누른다.
- Storage 고아 파일 정리.

## 5. 차단 결함 판단 근거
- 각 라우트가 클라이언트·설정이 없을 때 `not_ready`/503으로 응답하는 것을 확인했다.
  - Blog 확장: `blog/handoff.ts:49-50`, `blog/whoami.ts:23`
  - Threads OAuth: `threads/oauth/flow.ts:83-85`, `:189-191`
  - 미디어 업로드: `media/upload.ts` `begin`
  - 라우트 예외는 각 route의 catch가 `unexpected`/`uncertain`으로 처리한다.
- live 경로는 DB 함수 `distribution_live_gate`가 false라 작업 생성과 claim 모두에서 거부된다(`20261116040000_distribution_jobs.sql:896`, `:1626`). 미사용 클라이언트(`threads/client.ts`, `instagram/client.ts`)는 진입점이 없어 런타임에 호출되지 않는다.
- build·typecheck는 직전 작업(030)에서 성공했다. 이번에는 소스를 바꾸지 않았다.
- 독립 근거: Claude(Tester) 세션(vibe-2e)이 같은 작업 트리에서 Node 24.22.3과 PGlite로 기준선을 다시 실행했다. test 39파일 667통과·skip 0·실패 0, typecheck 통과, lint 오류 0(기존 경고 3), build 통과였다(Tester 보고 기준이며 내가 다시 돌리지는 않았다).
- 검토 범위 밖: 공통 인증과 proxy(Master 단일 담당), Front 페이지 렌더링, 확장 내부 동작.

## 6. 함께 알릴 사항
- `src/server/distribution/threads/NOTICE`, `instagram/NOTICE`, `extension/naver-blog/NOTICE`에 원 키트 제작사의 **저작권·이용 제한 고지**가 들어 있다. 공개 배포 전에 이식본의 사용 권리와 고지 의무를 사용자 또는 Master가 확인해야 한다. 이 검토는 연결과 차단 여부만 봤고, 원 키트의 로직을 새로 분석하거나 추출하지 않았다.
- Front는 라우트 동작만 소비하며 공개 계약 변경은 없다.

## 7. 수정·hash
- 코드 수정 없음. 이 결과 문서 1개만 새로 만들었다.
