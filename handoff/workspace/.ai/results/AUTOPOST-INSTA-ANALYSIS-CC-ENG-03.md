# AUTOPOST-INSTA-ANALYSIS — Insta_Auto_Posting_Kit_v1.11 분석 결과

- 작업: AUTOPOST-INSTA-ANALYSIS · 담당 CC-ENG-03 (Claude Code) · Orca task_a473027652f5 / dispatch ctx_bd459e58c3b6 · 2026-11-16
- 상태: **ready_review** (읽기 전용 분석, 소스 수정·실행·네트워크·설치 없음)
- 표기: **[확인]** = 코드/SQL을 직접 읽어 확인 · **[문서]** = 킷 문서의 주장(코드로 미검증) · **[추론]** = 읽은 내용으로부터의 판단. 경로는 `KIT=D:/Vibe/Insta_Auto_Posting_Kit_v1.11/insta_auto_poster`, `WEB=D:/Vibe/web` 기준.

## 0. 읽은 범위·제외·한계

- 킷 전체 파일 215개 중 목록 전부 확인, 핵심 약 45개 파일 정독(아래 근거에 나열). AI 프롬프트 본문·카드뉴스 스튜디오 UI·대시보드 화면은 구조만 훑고 정독하지 않았다(프롬프트 문구는 보고서에 옮기지 않음).
- **열지 않은 파일**(존재만 확인): `KIT/.env.example`, `KIT/KIT/env.example`(모든 `.env*`/env 예시 규칙 적용), `D:/Vibe/API KEY.txt`, `D:/Vibe/SUPABASS DB 비번.txt`. 설치 마법사(`KIT/setup.ps1|sh`, `패키지설치마법사.*`, `enable-vercel-cron.*`)는 실행하지 않았고 내용도 열지 않았다(README 설명만 근거).
- `package.json`의 `scripts/`·`tests/` 경로는 킷에 없다 — `KIT/kit.json:10-15`가 배포판에서 제외 [확인]. 따라서 킷 자체 시험은 재현 불가.
- 실행·빌드·시험·Meta/Graph 호출을 하지 않았으므로 동작은 전부 정적 분석 결과다. Meta 정책·권한·제한값은 **공식 자료 미확인**(§6.5).

## 1. 앱 구조·버전·라이선스

### 1.1 구조 [확인]
- 단일 Next.js App Router 앱(`KIT/src/app`): `(auth)` 로그인/가입, `(dashboard)` 게시글·후보·설정·카드뉴스, `app/api/**` 라우트 핸들러, `lib/actions/**` 서버 액션, `lib/instagram/**` Graph API, `lib/posts/**` 게시·예약, `lib/ai/**` 생성, `proxy.ts`(옛 middleware).
- 2가지 실행 모드: `NEXT_PUBLIC_STANDALONE_MODE` 값으로 `IS_STANDALONE` 판정(`KIT/src/lib/deployment.ts:8`). 독립 모드는 등급·구독·전화번호 판정을 건너뛰고(`KIT/src/lib/access.ts:36,176`) 공용 연동 테이블(`member_platform_accounts`)을 쓰지 않는다(`KIT/src/lib/instagram/memberAccount.ts:40,85,104`).
- 카드뉴스 스튜디오(`cns_*` 테이블)는 운영 사이트 전용이며 독립 모드에서 `/dashboard`로 돌려보낸다(`KIT/src/app/(dashboard)/cardnews/layout.tsx:11`). `cns_*` 테이블은 `schema.sql`에 없다(`KIT/KIT/kit.json:19-30`의 schemaCheckIgnore). → **배포판에서 실제 사용 가능한 범위는 "피드(1장)/카드뉴스(캐러셀 2~10장) 게시글" 흐름**이다.

### 1.2 런타임·직접 의존성(잠금파일 `lockfileVersion 3`) [확인]
| 패키지 | package.json | lock 실제 | 현재 사이트(WEB/package.json) |
|---|---|---|---|
| next | ^16.4.2 | 16.4.2 | 16.4.6 |
| react / react-dom | 19.2.4 | 19.2.4 | 19.3.1 |
| @supabase/supabase-js | ^2.110.8 | 2.112.3 | 2.119.0 |
| @supabase/ssr | ^0.12.3 | 0.12.4 | 0.12.7 |
| sharp | ^0.35.5 | 0.35.5 | 없음(네이티브 모듈) |
| zod / undici / cheerio | ^4.4.3 / 7.30.0 / ^1.2.0 | 4.4.3 / 7.30.0 / 1.2.0 | 미확인 |
| typescript / tailwindcss | ^5 / ^4 | 5.9.3 / 4.3.3 | — |
근거: `KIT/package.json:15-43`, `KIT/package-lock.json`(next 6137, react 6669, supabase-js 1950, ssr 1925, sharp 6985, zod 7922, undici 7664, cheerio 3401, ts 7607, tailwind 7370행), `WEB/package.json:18-21`.
- Node 22 LTS 권장 [문서] `00_START_HERE.md:17`. 외부 AI: OpenAI chat completions(`gpt-4o-mini`), Gemini 이미지, Perplexity, NewsBlur(`KIT/src/lib/ai/generator.ts:80-87`, `geminiImage.ts:17`, `collector.ts:193-284`) [확인].
- [추론] 버전 차이는 작다(동일 메이저). 단 `sharp`는 현재 사이트에 없는 네이티브 의존성이며 추가 시 lockfile 변경이 필요하다.

### 1.3 라이선스·NOTICE 한계 [확인] — **이식 최대 제약**
- `KIT/NOTICE:1-28`: BUYLIFE 전 권리 보유. 사전 서면 허락 없는 소스·로직·프롬프트의 **추출·복제·변형·배포**, 자동화 도구/AI에 의한 분석을 금지한다고 명시. 오픈소스 라이선스 파일 없음. `00_START_HERE.md:4-5`는 "내 계정에 설치해 쓰는" 배포판으로 설명.
- [추론] 이 킷의 허용 범위는 "본인 계정에 독립 설치해 사용"으로 읽힌다. **코드·프롬프트·스키마를 현재 사이트로 복사·변형해 통합하는 것은 NOTICE와 충돌**할 가능성이 높다. 본 보고서는 통합 판단을 위한 구조 분석만 하며 코드·프롬프트를 옮기지 않았다.
- 권고: (a) BUYLIFE로부터 1-site 통합·변형 허락을 **서면으로** 받거나, (b) 킷 코드는 참조 금지로 두고 **Meta 공식 문서만으로 독립 재구현**(clean-room: 구현자는 킷 코드를 보지 않고 이 보고서의 요구사항 수준만 사용), (c) 킷을 별도 사이트로 그대로 설치해 운영하고 현재 사이트와는 수동/링크로만 연결. 결정은 사용자(법적·사업 판단) → Master가 DEC로 취합. **법률 자문 아님.**

## 2. Instagram(Meta) 연결·게시

### 2.1 연결 방식 2종 [확인]
| | instagram_login (킷 권장) | facebook_login (대안) |
|---|---|---|
| 인가 URL | instagram.com/oauth/authorize | facebook.com/v21.0/dialog/oauth |
| scope | instagram_business_basic, instagram_business_content_publish | instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement, business_management |
| 토큰 | code→단기→장기(ig_exchange_token), graph.instagram.com/v25.0 | code→단기→장기(fb_exchange_token), graph.facebook.com/v21.0, 페이지별 IG 계정 탐색 후 사용자 선택 |
| 콜백 | `/api/instagram/callback/byok` | `/api/instagram/callback` → `/accounts/select` |
근거: `KIT/src/lib/instagram/client.ts:35-48,50-127,132-218`, `app/api/instagram/callback/byok/route.ts:18-117`, `app/api/instagram/callback/route.ts:20-111`, `lib/actions/accounts.ts:21-106`.
- **앱 소유 경계**: 운영자 공용 앱 없음. 회원마다 **본인 Meta 앱** App ID/Secret을 `user_api_keys`(provider `meta_app_id`/`meta_app_secret`, `facebook_app_id`/`facebook_app_secret`)에 저장해 사용(`client.ts:8-16`, `accounts.ts:26-31`, `callback/route.ts:61-70`) [확인].
- **계정 유형**: 비즈니스/크리에이터(프로페셔널) 계정 필수, 개인 계정 불가, 개발 모드에서는 Instagram 테스터 본인 계정만, 타인 계정은 앱 검수 필요 — 전부 **[문서]** `KIT/KIT/README.md:32,39`, `KIT/KIT/PLATFORMS.md:16-36`. 공식 자료 미확인.
- 연결 시 `checkProgramAccessApi()`로 이용 권한 확인 후에만 토큰 저장(`callback/route.ts:53-58`, `byok/route.ts:57-60`) [확인].

### 2.2 토큰 처리 위치 [확인]
- 저장: `public.insta_accounts.access_token`(평문 text), `token_expires_at`, `auth_method`, 회원당 1행(`unique(user_id)`) — `KIT/KIT/schema.sql:118-131`. facebook_login은 선택 전 최대 600초 httpOnly 쿠키에 장기 토큰·후보를 JSON으로 보관(`callback/route.ts:88-101`, `pendingConnection.ts`).
- 브라우저 비노출은 "서버 모듈에서만 Graph 호출"로 의도(`client.ts:1-5`, `publish.ts:1-6`). **그러나** RLS가 본인 `select`를 허용하므로(`schema.sql:196-197`) 로그인 사용자는 anon 키 + 세션으로 자기 토큰을 PostgREST에서 직접 읽을 수 있다. `user_api_keys.api_key`(Meta App Secret, AI 키, cron-job.org 키)도 동일(`schema.sql:79-97`). `newsblur_accounts.password`도 평문(`schema.sql:186-193`). [추론] 1-site 통합 시 그대로 가져오면 안 되는 설계.
- **갱신 없음**: 장기 토큰 갱신(refresh) 호출이 코드 어디에도 없다(`refresh_access_token`/`ig_refresh_token` 검색 0건). 만료 시각은 설정 화면 표시만(`app/(dashboard)/settings/page.tsx:317-319`). 만료 후 게시는 Graph 오류 → `failed`. **철회/해제**: 로컬 행 삭제만, Meta 측 권한 철회 API 호출 없음(`accounts.ts:108-117`). Meta 철회 콜백(deauthorize/data deletion) 라우트 없음 [확인].
- **CSRF state = user.id**(`accounts.ts:40-44`, 콜백 비교 `byok/route.ts:52-55`): 예측 가능한 값이며 일회용 nonce가 아니다. 로그인 세션 일치 검사가 있어 계정 탈취 위험은 제한적이나, [추론] 로그인 CSRF(공격자 code를 피해자 세션에 연결) 방지가 약하다.
- 오류 메시지를 리다이렉트 쿼리 `reason`으로 노출(`byok/route.ts:44,115`) — 토큰은 포함되지 않도록 의도(`callback/route.ts:104-106`). 토큰 교환 실패 시 응답 본문 텍스트 전체를 Error에 넣는 경로가 있음(`client.ts:182,199,213`) [확인] → [추론] 로그·URL에 Meta 오류 본문이 남을 수 있음(토큰 포함 가능성은 낮으나 마스킹 없음).

### 2.3 업로드·게시·상태 [확인]
- 공개 JPEG URL만 사용(`publish.ts:6` 주석, `instagramJpeg.ts:3-8`에서 sharp로 PNG/WEBP→JPEG 92). 이미지는 공개 버킷 `insta-post-images`에 `{user_id}/{uuid}.jpg`(`lib/actions/ai.ts:96-108`, `schema.sql:249-258`).
- 피드: 컨테이너 생성 → `status_code` FINISHED 폴링(2초 간격, 60초 한도) → `media_publish` → permalink 조회(`KIT/src/lib/instagram/publish.ts`: 재시도 32-46, 폴링 57-70, 피드 98-104, 캐러셀 137-149행). 캐러셀: 자식 컨테이너(각 폴링) → CAROUSEL 부모(폴링) → publish → permalink. 1장=피드, 2장 이상=캐러셀 자동 분기(`lib/posts/publish-core.ts:29-62`).
- 재시도: POST(컨테이너 생성, **media_publish 포함**)에 오류 메시지가 "timeout"이면 최대 2회 재시도(`publish.ts` postGraphWithRetry). [추론] media_publish가 Meta 측에서 성공했는데 응답만 timeout이면 **중복 게시 위험** — 멱등키 없음.
- 상태 기록: `draft→publishing→published|failed`, `ig_media_id`, `ig_permalink`, `published_at`(`publish-core.ts:37-95`). **`unknown` 상태 없음**: media_publish 성공 후 permalink 조회 실패도 `failed`로 기록(`publish-core.ts:59-62,82-94`) [확인]. 그러면 재게시 버튼 경로(`publishNowAction`은 failed 재실행 허용, `lib/actions/posts.ts:304-324`)로 **중복 게시 가능** [추론].
- 대사(reconcile): 게시 후 Instagram 미디어 목록 조회로 확인하는 로직 없음(일반 게시글 흐름). 수정·삭제 API 미사용 [확인].

## 3. 콘텐츠 생성·미디어 흐름 [확인, 일부 구조만]

- 후보 수집: URL/RSS/Perplexity/NewsBlur → OpenAI로 후보 구조화 → `insta_candidates`(`lib/ai/collector.ts`, `lib/actions/candidates.ts`, `schema.sql:169-184`).
- 캡션·해시태그·카드뉴스 문구·이미지 프롬프트: OpenAI `gpt-4o-mini`(`generator.ts:59-430`). 이미지: Gemini(나노바나나 계열, `generator.ts:477-`, `geminiImage.ts:195-243`, 타임아웃 시 과금 가능성 안내 `geminiImage.ts:231`).
- **키 정책**: 회원 본인 키만, 관리자 공용 키 폴백 없음(`lib/apiKeys.ts:22-35`). 이미지 생성 액션은 입력으로 받은 `apiKey`를 우선 사용(`ai.ts:85`).
- 직접 첨부: AI 없이 업로드 이미지로 저장·예약·게시 가능 [문서] `KIT/KIT/README.md:111`; 업로드는 브라우저에서 Supabase Storage로 직접(`lib/uploadImageClient.ts:75-82`).
- 사용량 기록 `usage_logs`(서버, `logProgramUsage`) — 이미지 프롬프트를 metadata로 저장(`ai.ts:110-114`).
- **SSRF**: 후보 수집용 `fetchHtml`은 사설 IP/로컬호스트 차단이 없다(`lib/ai/collector.ts:25-44`, `fetchUrlText` 84-). 카드뉴스 쪽에는 별도 `safeFetch.ts`가 DNS 확인 후 사설 IP 차단(`lib/cardnews/safeFetch.ts:11-71`) [확인]. [추론] 통합 시 공통 안전 fetch 필수.
- **미디어 정리**: 슬라이드 교체·작성 중 삭제는 Storage 파일 제거(`lib/actions/slides.ts:204`, `lib/actions/upload.ts:11-23` — 경로가 `{user.id}/`로 시작할 때만). **게시글 삭제는 DB만 지우고 Storage 파일은 남는다**(`lib/actions/posts.ts:273-282`, FK cascade로 slides 행만 삭제) → 고아 파일 [확인]. 공개 버킷이므로 URL을 아는 누구나 영구 열람 가능 [확인 `schema.sql:250-252`].
- 권리·동의 검토 단계 없음: 생성 즉시 게시 가능(검토 상태 컬럼 없음, `insta_posts.status`는 draft/scheduled/publishing/published/failed뿐 `schema.sql:149`) [확인].

## 4. 예약·동시성·권한

### 4.1 실행 경로 3종 [확인]
1. **운영자 Vercel cron** `/api/posts/dispatch-scheduled`(GET/POST, `Authorization: Bearer CRON_SECRET`, service role로 전체 회원) — cronjob 모드·일시정지 회원 제외. 독립 모드에서 `INSTA_PLATFORM_SCHEDULER=on`이 아니면 vercel 모드 회원 글을 안내 메시지와 함께 `failed` 처리(`app/api/posts/dispatch-scheduled/route.ts:22-36`, `memberScheduler.ts:31-34`). 비밀값 비교는 `!==` 문자열 비교(타이밍 안전 비교 아님).
2. **회원 cron-job.org** `/api/posts/dispatch-member`: 회원 본인 cron-job.org API 키로 1분 작업을 자동 생성/켜기/끄기. 작업 헤더에는 회원 전용 토큰(`ins_` + 64hex), DB에는 SHA-256 해시만(`memberScheduler.ts:41-48,85-97,103-118`, `cronJobOrg.ts:40-84`, 테이블 `schema.sql:264-276`). 즉시 200 응답 후 `after()`로 발행(`dispatch-member/route.ts:17-35`). 예약이 0건이면 작업 끔(`memberScheduler.ts:127-140`).
3. **대시보드 버튼** `dispatchScheduledPostsAction` — 세션 클라이언트(RLS)로 본인 글만(`lib/posts/dispatch.ts:133-141`, `actions/posts.ts:331-339`).
- 즉시 게시: `createPostAction`/`updatePostAction`/`publishNowAction`이 요청 안에서 동기 게시(`actions/posts.ts:172-189,249-266,284-329`), 페이지 `maxDuration=120`.

### 4.2 멱등성·중복 방지 [확인]
- 예약 발행은 `scheduled→publishing` **조건부 update**로 선점한 실행만 게시(`dispatch.ts:72-81`). 세 경로가 겹쳐도 같은 글을 두 번 집지 않음 — 좋은 설계.
- 24시간 넘게 밀린 예약은 게시하지 않고 `failed`(`dispatch.ts:38-40,83-89`).
- **즉시 게시는 선점 없음**: `publishNowAction`은 상태를 읽고 판단한 뒤 `publishPost`가 무조건 `publishing`으로 바꾼다(`posts.ts:304-307`, `publish-core.ts:37-41`). 동시 두 요청이 모두 draft를 읽으면 둘 다 게시 [추론, 경쟁 조건].
- `publishing` 정체 판정 150초(`publishStatus.ts:7-12`) 이후 수동 재게시 허용. dispatch는 `publishing`을 다시 집지 않으므로, 함수가 중간에 죽으면 글은 수동 개입 전까지 정체 [확인]. 300초 예산 안에서 여러 건을 **순차** 처리하므로(`dispatch.ts:71-115`, `maxDuration=300`) 캐러셀 다수가 쌓이면 시간 초과 가능 [추론].
- 재시도 정책: Graph timeout 메시지에만 2회 짧은 재시도. 작업 단위 재시도 횟수·백오프·retryable 구분 없음 [확인].

### 4.3 관리자·사용자 액세스 [확인]
- 모든 회원 테이블은 `auth.uid() = user_id` RLS(select/insert/update/delete) — `schema.sql:195-239`. `insta_member_scheduler`는 본인 select만, 쓰기는 service role(`schema.sql:274-276`, `actions/scheduler.ts:10`).
- 관리자 = `profiles.is_admin`(`schema.sql:25`). v1.11에서 회원이 is_admin 등을 직접 바꾸지 못하게 열 권한 축소(`schema.sql:36-40`, `upgrade-20261116-profiles-guard.sql:4-6`). v1.10 이하 설치본은 회원이 스스로 관리자 승격 가능했음 [문서+확인 `KIT/KIT/README.md:177`].
- 독립 모드에서는 로그인만 하면 바로 사용(`access.ts:36`), 가입은 자체 이메일 가입(이메일 확인 끄기 안내 [문서] `README.md:67`). [추론] 1-site에선 회원 누구나 Meta 연결·게시 가능해지는 것이므로 관리자 전용으로 좁혀야 함.
- service role 사용처: dispatch(전체), 예약 설정, 공용 계정 조회(`lib/supabase/admin.ts` 호출부들).

## 5. 현재 사이트와 비교

### 5.1 현재 사이트 상태 [확인]
- `WEB/src/lib/distribution/**`: 순수 함수 계약만. `ContentItem(version)` → `ChannelDraft(contentVersion, reviewStatus)` → `PublishJob(idempotencyKey pub:{id}:v{n}:{channel}:{mode}, attempts/maxAttempts, externalId/Url, lastError.retryable)` → `PublishResult(published|dry_run_ok|rejected|failed|unknown)`(`types.ts:12-94`, `idempotency.ts:10-65`, `jobs.ts:95-261`). unknown은 대사 전 재시도 금지(`jobs.ts:212-251`), 늦은 근거 보존(`late-evidence.ts:55-95`). 어댑터는 Unconnected/DryRun뿐, capability 전부 unverified(`adapters.ts:16-74`). DB 저장 계층 없음(MKT-003 결과 `.ai/results/MKT-003-CC-ENG-01.md:39,46`).
- `WEB/src/lib/content/**`: 공개 이야기 `StoryRecord`(검토·공개 승인·출처), 빈 메모리 저장소(`types.ts:27-43`, `repository.ts:117-128`). `content-distribution-preview.tsx`는 DryRunAdapter로 화면 시안만(`:1-40`).
- Supabase: `profiles(display_name, approval_status)` + `role_assignments(admin|seller)` + `private.is_admin()`(security definer, 비노출 스키마) — `WEB/supabase/migrations/20261116000000_initial_foundation.sql:38-89,430-445`, `20261116010000_private_role_functions.sql:12-29`. 가입 트리거 `on_auth_user_created` → `private.handle_new_user`(`20261116020000_profile_on_signup.sql:13-30`).

### 5.2 매핑·충돌
| 킷 | 현재 사이트 | 판정 |
|---|---|---|
| `insta_posts`(caption+hashtags, status 5종) | ChannelDraft + PublishJob | 개념 대응. 킷은 원문 버전·검토 승인·멱등키·attempts·unknown 없음 → **킷 모델을 버리고 사이트 계약 사용** |
| `insta_post_slides.image_url` | `mediaRefs` | 공유 미디어 자산 테이블 필요(현재 없음) |
| `ig_media_id`/`ig_permalink` | `externalId`/`externalUrl` | 그대로 대응. permalink 실패 시 → `unknown`이 아니라 media id만으로 `published`(externalUrl=null 허용, `jobs.ts:77-86`) |
| status `failed`(무조건) | failed(retryable) / unknown | 킷 오류 분류를 재설계해야 함(§6.3) |
| `profiles.is_admin` + `on_auth_user_created` | `role_assignments` + 같은 트리거 이름 | **직접 충돌**: 킷 `schema.sql:20-52`를 현재 DB에 실행하면 `profiles` 정의 불일치(if not exists로 건너뛰어 컬럼 없음) + **가입 트리거를 킷 함수로 교체**(`drop trigger if exists on_auth_user_created`, `schema.sql:51-52`) → 현재 가입 흐름 파손 [추론, 높은 확신]. **킷 SQL 실행 금지.** |
| `user_api_keys`(회원별 평문, 45개 provider) | 없음 | 1-site에서는 회원별 BYOK 불필요. 관리자 1개 Meta 앱 → 서버 비밀(환경변수/Vault) |
| `insta_accounts`(회원당 1, RLS 본인 select) | 없음 | 관리자 소유 채널 연결 테이블로 재설계, 토큰은 클라이언트 비노출 |
| cron-job.org 회원별 작업 | 없음(`isDue`만) | 1-site는 사이트 단일 스케줄러 1개로 충분 |
| `programs/subscriptions/user_program_access/member_grades` | 없음 | AIMaster 호환용 빈 테이블 — 불필요 |

### 5.3 독립 설치 vs 1-site 통합 차이 [추론]
- 독립 설치: 별도 Supabase·Vercel·도메인, 자체 회원가입, 회원별 Meta 앱/AI 키/cron-job.org. 현재 사이트 DB·인증과 **완전히 분리**되며 NOTICE 상 가장 덜 충돌하는 경로. 단 콘텐츠 원문·검토·UTM·결과 대사 계약과 연결되지 않는다.
- 1-site 통합: 단일 Supabase Auth, 관리자만 운영, 사이트 소유 Instagram 계정 1~소수, 원문→채널 초안 검토 후 게시. 킷의 회원 BYOK·구독·등급·SSO 리다이렉트(`oauthRedirect.ts`, `proxy.ts:11-18`, buylife.xyz 하드코딩) 대부분이 불필요.

## 6. 단계별 이식 제안

### 6.0 전제 결정(사용자→Master)
1. **라이선스 경로**(§1.3 a/b/c). 서면 허락이 없으면 b(공식 문서 기반 독립 구현) 또는 c(별도 설치) 권장. 이 보고서 이후 구현 작업자는 킷 코드를 복사하지 않는다.
2. Instagram 계정 조건: 사이트 운영 계정이 비즈니스/크리에이터인지, Facebook 페이지 연결 여부 → instagram_login만 지원할지 결정(권장: instagram_login 하나로 시작, 페이지 탐색·선택 화면 불필요).
3. 실제 게시 시험용 테스트 계정·Meta 앱 생성 승인(외부 계정 연결은 별도 승인 항목).

### 6.1 우선순위·최소 통합 경로(권장: b안 기준)
| 단계 | 내용 | 완료 조건 |
|---|---|---|
| P1-1 DB 계약 | 신규 마이그레이션(킷 SQL 미사용): `distribution_jobs`(PublishJob 그대로, idempotency_key unique, attempts, external_id/url, last_error jsonb), `distribution_job_events`(감사·late evidence), `channel_connections`(channel, external_account_id, username, scopes, token_expires_at, status, **토큰 컬럼은 클라이언트 role에 select 권한 없음** 또는 Supabase Vault/서버 전용 스키마), `media_assets`(storage_path, 권리·동의 상태, 소유 content). RLS: 관리자(`private.is_admin()`)만 읽기, 쓰기는 서버(service role)만 | 마이그레이션 검토, 기존 `on_auth_user_created`/`profiles` 무변경, 로컬 DB 적용은 별도 승인 |
| P1-2 Instagram 어댑터(dry-run 우선) | `PublishAdapter` 구현: 피드/캐러셀, 컨테이너 생성→상태 폴링→publish→permalink. capability는 공식 문서 확인 항목만 supported. 결과 매핑: 컨테이너 단계 실패=failed(retryable=true, 아직 게시 안 됨), **media_publish 호출 후 응답 유실/timeout=unknown**(자동 재시도 금지), permalink만 실패=published(externalUrl null) | 모의 fetch 시험으로 전 분기 고정, live 호출 0 |
| P1-3 서버 실행기 | 관리자 서버 액션/라우트: `createJob`→원자 선점(`update ... where status='scheduled' and attempts=?` 또는 RPC)→`startDispatch`→어댑터→`applyResult(attempt)`. 예약은 사이트 단일 cron(CRON_SECRET, `timingSafeEqual`) 1개, 1회 실행 건수 제한·건별 예산, `dispatching` 정체는 자동 재시도하지 않고 unknown 전환 후 대사 대기 | 동시 2회 호출 시험에서 1건만 게시, 시간초과 시 unknown |
| P2-1 Meta 연결(관리자 전용) | 관리자 설정 화면: OAuth 시작(state=서버 저장 일회용 nonce + 만료 + 관리자 세션 바인딩), 콜백에서 장기 토큰 교환·서버 저장, 만료 전 **갱신 작업**, 연결 해제 시 로컬 폐기(+공식 철회 방법 확인), Meta 앱 Secret은 환경변수 이름만 코드에 | 콜백 CSRF 시험, 토큰이 클라이언트 응답·로그·URL에 없음 |
| P2-2 공유 미디어 | 비공개 버킷 저장 → 게시 직전 단기 서명 URL 또는 게시용 공개 경로를 제한적으로 발급(Meta가 공개 URL을 가져가야 함 — 서명 URL 허용 여부 공식 확인), JPEG 변환은 서버 이미지 처리(sharp 도입 여부 결정), 게시 후·삭제 시 정리 작업 | 고아 파일 없음, 권리 미승인 미디어 게시 거절 |
| P2-3 대사 UI | unknown 작업: 관리자가 Instagram 최근 미디어 조회(또는 수동 확인)로 `reconcileUnknown` found_published/confirmed_absent | unknown은 재시도 버튼 비활성 |
| P3 | AI 캡션/이미지 생성(사이트 소유 키·비용 상한·검토 필수), 후보 수집(SSRF 안전 fetch), 성과 지표(insights 권한 별도) | 별도 비용·권한 승인 후 |

### 6.2 분리 원칙
- **서버**: Graph 호출·토큰·Secret은 `server-only` 모듈. 클라이언트 컴포넌트는 job id/상태만.
- **관리자 UI**: 기존 `content-distribution-preview.tsx` 계약(ContentItem/ChannelDraft) 위에 연결, 회원 화면 없음.
- **Meta 연결**은 채널 연결 레코드로 격리 — 게시 실행기는 연결 id만 참조. 회원별 BYOK·cron-job.org·구독/등급 로직은 이식하지 않음.

### 6.3 실패·unknown 대사 규칙(킷 대비 보완점)
1. media_publish 이후의 모든 불확실성은 unknown(킷은 failed → 중복 위험, `publish-core.ts:82-94`).
2. media_publish에 대한 자동 재시도 금지(킷 `postGraphWithRetry`는 timeout 시 재시도).
3. 즉시 게시도 예약과 같은 원자 선점 사용(킷 `publishNowAction`은 선점 없음).
4. `dispatching` 정체 시간 경과 → 자동 재게시가 아니라 unknown.
5. 토큰 만료·권한 부족 = rejected/failed(retryable=false) + 재연결 안내.

### 6.4 DB/권한 계약 요약
- 배포 테이블은 판매 도메인(`orders` 등)과 분리, 관리자 읽기·서버 쓰기, 토큰은 일반 role 접근 불가, 모든 상태 전이는 `distribution_job_events`에 기록, idempotency_key unique 제약으로 DB 수준 중복 차단.

### 6.5 공식 자료로 확인할 항목(미확인)
- Instagram API with Instagram Login의 현재 Graph 버전, 필요한 권한명(`instagram_business_basic`, `instagram_business_content_publish`)과 앱 검수 요구, 개발 모드 테스터 제한.
- 장기 토큰 수명·갱신 엔드포인트·갱신 조건, 철회(deauthorize)·데이터 삭제 콜백 요구.
- 이미지 형식(JPEG 한정 여부)·크기·비율, 캐러셀 장수(킷 주석 2~10), 캡션 길이·해시태그 수, 24시간 게시 한도(content_publishing_limit), 컨테이너 상태값·만료.
- media_publish 응답 유실 시 게시 여부 조회 방법(최근 미디어 목록/컨테이너 상태로 대사 가능 여부) → `lookupByIdempotencyKey` capability 판정 근거.
- Meta가 서명 URL(쿼리 포함, 만료형)을 image_url로 허용하는지.

### 6.6 구현 완료 조건(첫 채널)
- 킷 코드·SQL·프롬프트 미복사(또는 서면 허락 기록), 신규 마이그레이션 검토 통과, 기존 가입 트리거·profiles 무변경.
- 어댑터·실행기 단위시험: 성공/컨테이너 실패/publish timeout→unknown/permalink 실패→published(url null)/토큰 만료/동시 실행 1건/24h 지연 거절.
- 토큰·Secret이 클라이언트 번들·응답·로그·리다이렉트 URL에 없음(검색·시험).
- dry-run 전 구간 통과 후, 사용자 승인된 테스트 계정으로 live 1건 게시·externalId 기록·대사 확인(별도 승인 작업).

## 7. 요약 판정
- **재사용 가치**: 게시 절차의 단계 구조(컨테이너→폴링→publish→permalink), 예약 선점(`scheduled→publishing` 조건부 update), 24h 지연 차단, JPEG 정규화 필요성 — **개념만** 참고. 코드는 라이선스상 재사용 불가 가정.
- **이식 비권장**: 회원 BYOK·cron-job.org 회원 스케줄러·구독/등급·SSO 리다이렉트·킷 `schema.sql` 전체.
- **보완 필수**: 토큰 클라이언트 노출 가능 RLS, 토큰 갱신 부재, state nonce, publish 후 failed 기록·자동 재시도로 인한 중복 위험, 즉시 게시 경쟁 조건, 고아 미디어, 수집기 SSRF.
- 권고 경로: §6.0 라이선스 결정 → P1(DB 계약·dry-run 어댑터·서버 실행기) → P2(관리자 Meta 연결·미디어·대사) → P3.

## 8. Master 할 일·미해결
1. 라이선스 경로(§1.3) 사용자 결정 취합 — DEC 기록 필요. 결정 전 구현 착수 금지 권고.
2. 운영 Instagram 계정 유형·Meta 앱 생성·테스트 계정 승인 여부 확인.
3. 배포 DB 테이블 설계 작업(P1-1) 배정 — 기존 마이그레이션과 같은 파일 수정 금지, 신규 파일로.
4. 이 분석은 정적 분석이며 킷 시험(`tests/` 부재)·빌드·실 게시를 하지 않았다.

변경 파일: 이 문서 1개(`.ai/results/AUTOPOST-INSTA-ANALYSIS-CC-ENG-03.md`)만 작성. 소스·킷·DB·패키지·공용 .ai 문서 미변경.
