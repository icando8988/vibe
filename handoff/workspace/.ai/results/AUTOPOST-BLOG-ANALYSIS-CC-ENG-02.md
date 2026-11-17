# AUTOPOST-BLOG-ANALYSIS — Blog_Posting_Kit_v1.07 기술 분석

- 책임: CC-ENG-02 (Claude Code) / Orca task_1a083f595784, dispatch ctx_658640173422 / 2026-11-16
- 상태: **ready_review** (읽기 전용 분석. 소스 수정·복사·실행·설치·네트워크 호출 없음)
- 표기: **[확인]** = 내가 파일에서 직접 읽은 코드/설정, **[문서]** = 킷 문서의 주장(실행 검증 아님), **[추론]** = 코드에서 끌어낸 판단(실행 미검증)
- 경로 약어: `K/` = `D:/Vibe/Blog_Posting_Kit_v1.07/ai-auto-blog/`, `W/` = `D:/Vibe/web/`

---

## 0. 요약 (Master용)

1. 킷은 **Next.js 16 + Supabase 단독 웹앱(멀티 회원) + 압축해제형 크롬 MV3 확장**이다. 네이버 블로그는 공식 API가 아니라 **확장이 `chrome.debugger`(CDP)로 글쓰기 화면에 사람처럼 입력**하는 방식이고, **마지막 [발행]은 사람이 누른다**. 그 밖의 블로그(티스토리 등)는 **클립보드 복사 → 수동 붙여넣기**뿐이다. 예약 게시 기능은 없다.
2. **라이선스가 가장 큰 차단 요소다.** NOTICE는 "All rights reserved"이며 사전 서면 허락 없는 복제·변형·배포를 금지한다(`K/NOTICE:1-11`). → **코드·프롬프트를 복사해 이식하지 말고**, 이 보고서의 기능 명세만으로 클린룸 재구현하는 것을 권고한다. 코드를 재사용하려면 권리자 서면 허락이 필요하다(사용자 결정).
3. 네이버 자동 입력은 코드 주석에 **"봇 탐지 회피 규칙"**이 명시돼 있다(`K/extension/naver-adapter.js:6`). 플랫폼 약관·계정 제재 위험은 공식 자료 확인 전까지 **미판정**이며, 1차 이식 범위에서 제외(P3)를 권고한다.
4. 현재 `web` 배포 계약(MKT-003)과 개념은 잘 맞는다: 확장의 **실행번호(runId)+임대(lease)+heartbeat+이전상태 허용표**는 우리 `attempts`/`STALE_RESULT`/`unknown` 대사 규칙과 같은 문제를 푼다. 단 확장은 **외부 게시 URL/식별자를 돌려주지 않으므로** `published`로 갈 근거가 없다 → "수동 발행 대기 + 운영자 URL 입력" 단계가 계약에 필요하다(Master 결정).
5. 그대로 들여오면 안 되는 것: AIMaster 권한·쿠키·리다이렉트 잔재, **30일 후 글·이미지 자동 삭제**, 회원별 평문 API 키·NewsBlur 평문 비밀번호, 무제한 자체 회원가입, 공개 이미지 버킷, SSRF 무방비 URL 수집, 비정제 HTML 렌더링.

---

## 1. 수령·읽은 범위

| 항목 | 값 | 근거 |
|---|---|---|
| 위치 | `D:/Vibe/Blog_Posting_Kit_v1.07/` (+ `ai-auto-blog/`) | [확인] 디렉터리 목록, 파일 163개 |
| 버전 | 키트 v1.07 / 앱 v1.87(kit.json) / `APP_VERSION="v1.07"` / package.json `1.75.0` / 확장 manifest `1.87.0` — **버전 표기가 서로 다름** | [확인] `K/KIT/kit.json:45-46`, `K/utils/version.ts:3`, `K/package.json:3`, `K/extension/manifest.json:4-5` |
| 배포 성격 | "수강생 배포 키트", 각자 Supabase·Vercel에 독립 설치 | [문서] `K/KIT/README.md:3-5`, `00_START_HERE.md:3-5,13` |
| 라이선스 | 독점(BUYLIFE, All rights reserved). 오픈소스 아님 | [확인] `K/NOTICE:1-11`, `K/extension/NOTICE` 동일 |
| 폰트 | Geist(OFL) 별도 라이선스 파일 존재 | [확인] `K/app/fonts/OFL.txt` 존재(내용 미정독) |
| 전체 정독 | 문서(00_START_HERE, README, KIT/README, PLATFORMS, kit.json), package.json, schema.sql, upgrade sql, manifest, vercel.json, next.config, proxy, tsconfig, 확장 background/web-bridge, 확장 API 6개 라우트, extension-handoff, extensionAuth/Task/Bridge, 토큰 액션, access/checkProgramAccess/deployment, supabase 클라이언트·미들웨어·쿠키도메인, apiKeys, settings/actions, auth actions/confirm, imageStorage/Retention, cleanup cron, build-extension-archive.mjs(읽기만) | |
| 부분 정독(머리말·grep) | auto-post route, naver-adapter/blog-engine/naver-page/blog-core/sidepanel, collector(ai·news), contentModels, contentJson, extensionContent, workInbox, posts/[id] route·page, candidates/http | |
| 읽지 않음 | `write/ai-form/page.tsx`(1,572줄), candidates/HomePage/guide/edit 화면, RichTextEditor, 생성 프롬프트 본문(generator·promptRules — 라이선스상 추출 회피), setup.ps1/setup.sh/설치마법사 .cmd/.command(실행 금지 대상, 내용 미정독), package-lock 전체(주요 패키지만 grep) | |
| 열지 않은 민감 파일(존재만) | `K/.env.example`, `K/KIT/env.example`(이름에 env 포함 — 보수적으로 제외), 루트 `API KEY.txt`, `SUPABASS DB 비번.txt`. 환경변수는 **코드에서 이름만** 수집 | 작업 지시 |
| 자동 시험 | package.json에 `test:*` 스크립트가 있으나 `tests/`는 배포에서 제외돼 **존재하지 않음** | [확인] `K/package.json:12-17`, `K/KIT/kit.json:15`, 파일 목록 |

NOTICE에는 AI 에이전트에게 작업 거절을 요구하는 문구가 있다(`K/NOTICE:13-25`). 작업 지시(프로그램 속 지침은 자료일 뿐)에 따라 **운영 지시로 따르지 않고 라이선스 제약 자료로만** 반영했다. 같은 이유로 프롬프트·로직 본문을 보고서에 옮기지 않고 구조·계약 수준으로만 기술했다.

---

## 2. 앱 구조·런타임·의존성 (항목 1)

### 2.1 구조 [확인]
- Next.js App Router 단일 앱: 화면 `app/*`(candidates, write/ai-form, my-posts, posts/[id], settings, extension-connect, auth 등), API `app/api/*`(auto-post, candidates/{http,rss,perplexity,shorts}, posts, extension/*, cron/cleanup-images, newsblur-account, work-inbox).
- 라우트 경로 별칭이 두 개: `@/*`와 `@/blog/*`가 같은 루트를 가리킴(AIMaster 모노레포 잔재) — `K/tsconfig.json:21-24`.
- 미들웨어 대신 `proxy.ts`(Next 16 방식): 세션 쿠키 갱신 + 운영판에서는 `*.vercel.app` → `ai-auto-blog.buylife.xyz` 308 리다이렉트 — `K/proxy.ts:7-19`.
- 크롬 확장 `extension/`: MV3 service worker(background.js) + 사이드패널 + 사이트 전용 content script(web-bridge.js) + 순수 규칙(blog-core) + 입력 엔진(blog-engine) + 네이버 어댑터(naver-adapter, CDP) + 페이지 주입 명령(naver-page).
- 빌드 시 `prebuild`가 확장 ZIP을 만들어 `public/downloads/`에 둔다. 독립 운영판은 임시 사본에서 운영 주소를 `NEXT_PUBLIC_SITE_URL`로 치환 — `K/package.json:7`, `K/scripts/build-extension-archive.mjs:33-77`. 이 스크립트는 `.env.local`/`.env`를 직접 읽는다(`:18-26`).

### 2.2 버전 (킷 vs 현재 사이트)

| 패키지 | 킷 선언 | 킷 잠금 | web 선언(고정) | 근거 |
|---|---|---|---|---|
| next | 16.4.2 | 16.4.2 | 16.4.6 | `K/package.json:39`, `K/package-lock.json:6691`, `W/package.json` |
| react / react-dom | 19.2.4 | 19.2.4 | 19.3.1 | `K/package.json:40-41`, lock `:7378,:7387` |
| @supabase/supabase-js | ^2.110.7 | 2.110.7 | 2.119.0 | lock `:1510` |
| @supabase/ssr | ^0.12.3 | 0.12.3 | 0.12.7 | lock `:1485` |
| typescript | ^5 | 5.9.3 | 6.0.3 | lock `:8500` |
| 킷 전용 | @tiptap/* ^3.31.3, cheerio ^1.2.0, lucide-react, tailwindcss 4, archiver 7.0.1 | tiptap core 3.31.3, cheerio 1.2.0, archiver 7.0.1 | 없음 | `K/package.json:22-38,44-51` |
| Node | 문서상 Node 22 LTS | lock 루트 engines 없음 | `>=20.9.0` | [문서] `00_START_HERE.md:17` |

[추론] web은 이미 더 새 버전(next 16.4.6/react 19.3.1/TS 6)으로 고정돼 있어 버전 충돌은 작다. 이식 시 새 의존성(tiptap·cheerio·tailwind·lucide)은 **필요한 기능에 한해** 별도 승인으로 추가해야 한다(web은 현재 런타임 의존성 5개만 사용).

### 2.3 실행 환경 [확인/문서]
- Vercel 서버리스, 생성 API `maxDuration = 300` — `K/app/api/auto-post/route.ts:24`. 이미지 최대 5장 생성까지 한 요청에서 처리.
- Cron: 매일 `0 18 * * *`(UTC, KST 03:00) 정리 작업 1개뿐 — `K/vercel.json:3-5`.
- 확장: Chrome 120+, 권한 `sidePanel, storage, scripting, tabs, debugger, alarms, notifications`, 호스트 `*.naver.com`, 사이트, Supabase — `K/extension/manifest.json:7-21`. 압축해제 로드(개발자 모드) 방식 배포 — [문서] `K/KIT/README.md:88-99`.
- 비용 안내: Vercel Hobby는 "개인·비상업 기준" — [문서] `K/KIT/README.md:168`. [추론] 사업 사이트 통합 시 이 전제는 적용되지 않음(공식 확인 항목).

---

## 3. 기능 흐름 (항목 2)

### 3.1 글감 수집 [확인]
- 방식 4종: HTTP URL(단일 기사 또는 목록 페이지에서 무작위 5건) `K/app/api/candidates/http/route.ts:48-60`, RSS/NewsBlur, Perplexity 트렌드(`K/utils/ai/collector.ts:277-282`), YouTube 쇼츠 분석(`K/utils/ai/youtubeData.ts:17`).
- 결과는 `blog_candidates`(title, summary, keywords, source_type/input) 저장 — `K/KIT/schema.sql:103-117`. 배치 내 순서를 위해 created_at을 1ms씩 다르게 넣음 — `candidates/http/route.ts:29-44`.
- **보안 [확인+추론]**: 서버가 사용자 입력 URL을 그대로 `fetch`하며 호스트/사설IP 차단·타임아웃·크기 제한이 없다 — `K/utils/ai/collector.ts:24-43`. → 1-site 통합 시 SSRF 방어 필수.
- NewsBlur는 아이디·비밀번호를 **평문 열**로 저장 — `K/KIT/schema.sql:184-191`.

### 3.2 생성·편집·이미지 [확인]
- `POST /api/auto-post`: (a) `saveOnly`/`mode=save` 편집본 저장, (b) `previewOnly`/`mode=generate` 미리보기, (c) 생성 즉시 저장 — `route.ts:169-226`, 생성부 `:290-` 부근.
- 생성 전 Google News RSS로 최근 24시간 기사 수집 → 점수는 "내부 추정값"이라고 명시 — `K/utils/news/collector.ts:10-22,174-197`.
- 본문 공급자 OpenAI/Anthropic/Gemini 선택, 이미지 Gemini 필수. **회원 본인 키만** 사용(운영자 키 폴백 없음) — `route.ts:232-260`, `K/utils/apiKeys.ts:26-35`. 독립판 기본 공급자는 gemini — `K/utils/ai/contentModels.ts:66`.
- 모델 목록에 다수의 모델 ID가 하드코딩 — `contentModels.ts:34-56`. [미확인] 실제 존재·가용성은 공식 문서로 확인 필요.
- Gemini 호출은 API 키를 URL 쿼리에 넣음 — `K/utils/ai/contentJson.ts:43`. [추론] 프록시·로그에 키가 남을 위험.
- 이미지는 Supabase Storage `post-images`(공개 버킷) `<userId>/ai-auto-blog/<uuid>.<ext>`에 업로드하고 공개 URL을 본문 HTML에 삽입 — `K/utils/imageStorage.ts:10-29`, 버킷 정책 `schema.sql:151-159`.
- 편집기는 TipTap 기반(`K/components/RichTextEditor.tsx`, 미정독), 상세 편집 저장은 `PUT /api/posts/[id]` — `K/app/api/posts/[id]/route.ts:97-193`.

### 3.3 저장·검토 UX [확인/문서]
- 글은 `blog_posts`(HTML `content`, excerpt, reading_minutes, 카테고리 다대다) — `schema.sql:73-98`. **검토/승인 상태가 없다**(생성=저장=개인 보관함). 사람 검토는 "글 보기/수정" 화면에서 회원이 임의로 함.
- 글 상세는 `post.content`를 `dangerouslySetInnerHTML`로 렌더(이미지 프롬프트 구역만 제거) — `K/app/posts/[id]/page.tsx:576`. `saveOnly` 경로는 클라이언트가 보낸 `contentHtml`을 정제 없이 저장 — `route.ts:178-187`. [추론] 본인 데이터만 보이는 구조라 자기 XSS 수준이지만, 관리자 다수가 보는 1-site에서는 저장형 XSS가 된다.
- **30일 보관 후 자동 삭제**: 글·이미지·글감 모두 — `K/utils/imageRetention.ts:37-66`, `K/app/api/cron/cleanup-images/route.ts:12-22,51-121`. [문서] 이미지가 사라지므로 블로그에 직접 다시 올리라고 안내 — `K/KIT/README.md:119`.

### 3.4 네이버 확장 — 수동/자동 경계 [확인]
| 단계 | 자동/수동 | 근거 |
|---|---|---|
| 확장 설치(압축해제 로드), 사이드패널에서 네이버 블로그 ID 저장 | 수동 | [문서] `K/KIT/README.md:90-97` |
| 네이버 로그인 | **수동**(확장은 ID/비번을 입력하지 않음) | [문서] `README.md:97`, [확인] 로그인 대기 최대 5분 `naver-adapter.js:15,149-202` |
| 웹에서 "네이버 입력기로 보내기"(카테고리 선택 포함) | 수동 트리거 | `K/app/api/posts/[id]/extension-handoff/route.ts:13-63`, `posts/[id]/page.tsx:505` |
| 확장이 대기 글을 가져가 새 글쓰기 탭에서 제목·본문·이미지·링크·카테고리·태그 입력 | **자동**(CDP `Input.insertText` 한 글자씩 70~170ms, 4% 확률 250~700ms 쉼) | `naver-adapter.js:6,10-14,97-117,231` |
| 매 단계 문서를 다시 읽어 원고와 정확 비교, 불일치 시 재입력하지 않고 중지 | 자동 | `blog-engine.js:6-10`, `blog-core.js:4-5` |
| 발행 설정창 열기·카테고리·태그(최대 30) | 자동 | `naver-adapter.js:324-378` |
| **최종 [발행] 버튼** | **수동**(코드상 누르지 않음) | `naver-adapter.js:8`, `blog-engine.js:10,200-201`, `background.js:6` |
| 결과 | 크롬 알림 "발행 직전 준비 완료" → 사람이 확인 후 발행 | `background.js` notifyOutcome(파일 내 113-127행) |

※ `background.js` 줄번호: 파일 단독 기준.  pump 207-221, runTask 130-194, heartbeat 139-146, 결과 보고 61-87, 재시작 복구 197-205, connect 검증 263-273, 알람/주기 297-303.

[확인] 시작 전 편집기가 비어 있지 않으면 중지(기존 내용 덮어쓰기 금지), 계정 불일치·안내창·탭 이동/닫힘을 감지해 중지 — `naver-adapter.js:25,126,174-190`.
[확인] **확장은 발행 후 게시 URL/글 번호를 서버에 보고하지 않는다.** 서버 상태는 `in_progress/completed/publish_ready/failed`까지만 존재 — `K/utils/extensionTask.ts:30`.

### 3.5 기타 블로그 — 복사·붙여넣기 [확인]
- "📋 본문 복사하기": 이미지 프롬프트 구역·figcaption·onclick 제거 → base64 이미지는 canvas로 압축 → `ClipboardItem`에 text/html + text/plain 동시 기록, 실패 시 텍스트만 — `K/app/posts/[id]/page.tsx:410-498`.
- 붙여넣은 이미지 URL은 30일 후 삭제될 공개 버킷 주소 → 직접 재업로드 안내, 티스토리 검토 문구 안내 — [문서] `K/KIT/README.md:116-120`.

---

## 4. 인증·권한·데이터·확장 연동·정리 (항목 3)

### 4.1 인증·사용자 권한 [확인]
- Supabase Auth 이메일/비밀번호. 독립판은 **누구나 자체 가입**, 이메일 확인을 끄도록 안내 — `K/app/auth/actions.ts:48-71`, [문서] `README.md:68`.
- 권한: 운영판은 AIMaster `profiles/programs/subscriptions/user_program_access` 기반 판정, **독립판은 로그인만 하면 전부 허용** — `K/utils/access.ts:37-38,80`, `K/lib/access/checkProgramAccess.ts:88-138`. 독립판 스키마에는 이 표들이 없음 — `K/KIT/kit.json:28-35`.
- 관리자 개념 없음("가입한 사람은 각자 자기 글만") — [문서] `README.md:82`. 확장의 `isAdmin`은 화면 표시용이라고 명시 — `K/utils/extensionAuth.ts:12`.
- 로그인 후 redirect는 내부 경로만 허용(`safeRedirectPath`) — `auth/actions.ts:39-43`. 반면 `/auth/confirm`의 `next`는 검증 없이 `${origin}${next}`로 이동 — `K/app/auth/confirm/route.ts:7,16-21`. [추론] `next`가 `@`나 `//`로 시작하면 외부 이동 가능성이 있어 재구현 시 같은 검증을 적용해야 한다.
- AIMaster 잔재: 쿠키 도메인 `.buylife.xyz`(`K/utils/supabase/cookieDomain.ts:3-8`), 권한 없을 때 buylife.xyz 리다이렉트(`K/app/extension-connect/page.tsx:15`), Work Inbox 전송 버튼(운영판만, `posts/[id]/page.tsx:523`, `K/lib/workInbox.ts`).

### 4.2 프로그램(서버) 권한·비밀 [확인]
- 서버 라우트 대부분이 **service role 클라이언트**로 DB를 다루고 `user_id` 조건으로 소유권을 직접 검사(RLS 우회) — `K/utils/supabase/admin.ts:3-15`, 예: `extension/task/route.ts:26-50`.
- 환경변수 이름(값 미열람): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`(또는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`), `SUPABASE_SECRET_KEY`(또는 `SUPABASE_SERVICE_ROLE_KEY`), `CRON_SECRET`, `NEXT_PUBLIC_STANDALONE_MODE`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_MAIN_SITE_URL` — `admin.ts:4-5`, `server.ts:11-12`, `cleanup-images/route.ts:26`, `K/lib/deployment.ts:9,18,21,24`.
- AI·YouTube·Perplexity 키는 `user_api_keys.api_key` **평문**, RLS로 본인만 — `schema.sql:21-41`. 화면에는 마스킹 — `K/utils/apiKeyLabels.ts:14-17`.

### 4.3 데이터·RLS·스토리지 [확인]
| 표/버킷 | 용도 | 정책 | 근거 |
|---|---|---|---|
| user_api_keys | 회원 AI 키 | 본인 CRUD | `schema.sql:21-41` |
| blog_authors / blog_categories / blog_posts / blog_post_categories | 작성자·카테고리·글 | 본인 all, anon 전부 revoke | `:46-98,122-145` |
| blog_posts의 naver_* / extension_* 열 | 확장 작업 상태·임대 | 위와 같음 | `:84-90` |
| blog_candidates | 글감 | 본인 all | `:103-117,136` |
| personal_access_tokens | 확장 토큰(sha256 해시) | 본인 select만, 쓰기는 서버 | `:164-178` |
| newsblur_accounts | NewsBlur 계정(평문 비밀번호) | 본인 all | `:184-194` |
| storage `post-images` | 이미지 | **public 읽기**, 본인 폴더만 쓰기/삭제 | `:151-159` |

[추론] `blog_posts` 작업 상태를 본문 표에 섞어 둬서 시도 이력·감사 기록이 남지 않는다(마지막 상태만 덮어씀).

### 4.4 크롬 확장 연결·작업 임대·heartbeat·응답·중복 [확인]
- **연결**: 사이드패널 "자동 연결" → `/extension-connect?from=extension` 로그인 → 서버 액션이 `pat_` + 32바이트 랜덤 토큰 발급, DB엔 sha256만 — `K/app/settings/extensionTokenActions.ts:28-44`. 사이트 화면의 web-bridge가 허용 출처에서만 토큰을 확장에 전달하고, 확장은 형식(`^pat_[0-9a-f]{64}$`)과 `/api/extension/whoami` 확인 후 `chrome.storage.local`에 저장 — `K/extension/web-bridge.js:7-24`, `background.js:263-273`. 미사용·30일 미사용 자동 토큰은 정리 — `extensionTokenActions.ts:58-74`. [추론] 토큰 만료 시각은 없고 폐기만 가능.
- **허용 출처는 빌드 시 치환되는 하드코딩 문자열** — `web-bridge.js:7`, `background.js:9`, `sidepanel.js:8`, 치환 `build-extension-archive.mjs:39,52-58`.
- **작업 가져가기(claim)**: 확장이 10초 주기(+30초 알람)로 `POST /api/extension/task` → 서버가 본인 글 중 `naver_input_status IS NULL` 이고 보낸 지 30분 이내인 가장 오래된 1건을 **조건부 UPDATE**로 `in_progress`+새 `naver_run_id`+임대 만료로 바꿈. 조건이 안 맞으면 `task:null`(다른 확장이 먼저 가져감) — `K/app/api/extension/task/route.ts:11-66`, `extensionTask.ts:9`.
- **임대/heartbeat**: 임대 3분, 확장은 45초마다 heartbeat. runId가 다르거나 상태가 끝났으면 409 `superseded` → 확장 중지 — `extensionTask.ts:13-18`, `heartbeat/route.ts:9-33`, `background.js:139-146`.
- **직접 시작**: `POST .../start`는 살아 있는 실행이 있으면 409, 읽은 상태·runId와 같을 때만 갱신(낙관적 잠금) — `start/route.ts:9-43`. (v1.56 이후 확장 UI에는 직접 시작이 없다는 주석 — `extensionTask.ts:8`)
- **결과 보고**: `POST .../input-result` — runId 불일치 409, 같은 상태 재보고는 변경 없이 성공(응답 유실 대비 멱등), 허용 이전상태표 밖이면 409, 쓰기도 이전 상태 조건부 — `input-result/route.ts:9-68`, 허용표 `extensionTask.ts:33-39`. 확장은 `success·persisted·status`가 일치할 때까지 결과를 로컬 보관·재보고, 400/404/409면 보관 종료 — `background.js:61-87`.
- **재전송**: 웹에서 다시 보내면 상태·runId·임대를 비우고 대기열 맨 위로. 단 살아 있는 실행은 409 — `extension-handoff/route.ts:39-63`. 임대가 끝난 실행을 **자동으로 대기로 되돌리지 않음**(이미 입력·발행됐을 수 있음) — `extensionTask.ts:15`.
- **확장 재시작 중 작업**: 자동 재입력하지 않고 `failed [EXTENSION_INTERRUPTED]` 보고 — `background.js:197-205`.

### 4.5 예약·cron [확인/문서]
- 예약 게시 없음 — [문서] `K/KIT/README.md:124-126`, [확인] 스케줄 관련 열·라우트 없음.
- cron은 정리 1개(`CRON_SECRET` Bearer 확인, `?dry=1` 모의 실행 지원) — `cleanup-images/route.ts:25-35`.

### 4.6 오류·재시도·정리 정책 [확인]
- 서버: DB 오류 503, 소유 아님 404/403, 상태 충돌 409, 응답은 `Cache-Control: private, no-store` — `K/utils/privateResponse.ts:3-6`.
- 입력 엔진: 단계 불일치·이미지 미반영 시 **같은 단계를 재시도하지 않고 중지**(중복 입력 방지) — `blog-engine.js:8-9`, `naver-adapter.js:305`.
- 이미지 다운로드 실패는 건너뛰고 경고 — `background.js:156-162`.
- 정리: 30일 지난 글 삭제(+본문 속 이미지), 30일 지난 이미지 파일, 30일 지난 글감 삭제. 100개 단위 배치, 중간 실패 시 즉시 중단(부분 삭제 상태 가능) — `cleanup-images/route.ts:51-121`.
- 생성 시간 초과 시 "이미 요금이 나갔을 수 있다"고 안내(자동 재시도 없음) — [문서] `README.md:150`.

---

## 5. 현재 `web` 계약과의 비교 (항목 4)

### 5.1 web 현황 [확인]
- 배포 계약: `Channel = blog|threads|instagram`, `JobStatus`에 `published`(외부 식별자 필수)·`dry_run_succeeded`·`unknown` 구분 — `W/src/lib/distribution/types.ts:8,51-60,89-94`. 기능 선언은 전부 `unverified`, live는 `UnconnectedAdapter`로 거절 — `adapters.ts:16-44,72-74`. 멱등키 `pub:{id}:v{ver}:{channel}:{mode}`, 중복·미종료 이전 버전·재게시 확인 — `idempotency.ts:10-65`. 재시도는 retryable+횟수 한도, unknown은 대사 필수 — `jobs.ts:12,212-218,232-246`. 늦은 근거 보존 — `late-evidence.ts:55-94`.
- 공개 콘텐츠: `StoryRecord` 본문은 **일반 텍스트(HTML 해석 안 함)**, 검토·출처 검증·운영자 공개 승인 게이트 — `W/src/lib/content/types.ts:5,26-43`, `visibility.ts:154-169`. 저장소는 빈 메모리 저장소 — `repository.ts:121`.
- 권한: `role_assignments`(admin/seller) + `profiles.approval_status`, 서버 조회 역할만 신뢰 — `W/supabase/migrations/20261116000000_initial_foundation.sql:56-74`, `W/src/lib/auth/viewer.ts:44-71`. `W/src`에는 service role 사용 코드가 없음(검색 결과 0).
- 미리보기 UI `content-distribution-preview.tsx`는 DryRunAdapter만 사용 — `:4,109,118`. [확인] `src/app`에서 이 컴포넌트를 쓰는 곳은 검색되지 않음(미장착).

### 5.2 재사용(개념)·충돌·제거 후보

| 킷 요소 | 판정 | 이유 / web 대응 |
|---|---|---|
| runId+lease+heartbeat+이전상태표+조건부 UPDATE claim | **개념 재사용(재구현)** | web의 `attempts`·`STALE_RESULT`·`startDispatch`와 같은 목적. 확장 실행기용 "임대" 필드는 publish_jobs 저장 설계에 추가 필요 |
| 결과 보고 로컬 보관·재보고, 같은 상태 재보고 멱등 | 개념 재사용 | `applyResult`+`late-evidence`와 결합 |
| 30분 자동 시작 창, 임대 만료 시 자동 복귀 금지 | 개념 재사용 | `unknown`→대사 원칙과 일치 |
| HTML→입력 블록 변환(text/image/link + 해시태그→태그) | 개념 재사용 | ChannelDraft(blog) 생성 규칙으로 재정의. web 원문이 일반 텍스트라 변환은 더 단순 |
| 클립보드 HTML+텍스트 복사 | 개념 재사용(1순위) | 외부 자동화 없이 블로그 채널 지원 가능 |
| 확장 토큰(해시 저장·폐기·출처 검증) | 개념 재사용 | admin 전용 토큰으로 축소 |
| AI 생성 파이프라인(뉴스 수집→LLM→이미지) | **보류(결정 필요)** | 비용·사실성 정책. web은 "실제 성과로 포장 금지"·출처 검증 게이트가 있어 자동 생성 글은 `needs_review` 초안으로만 허용해야 함 |
| 회원별 `user_api_keys` 평문 저장 | **충돌·제거** | 1-site는 운영자 키를 서버 비밀(환경변수/비밀 저장소)로. DB 평문 저장 금지 |
| 자체 회원가입·로그인=전권 | **충돌·제거** | web은 승인·역할 모델. 자동포스팅 기능은 admin 전용 |
| AIMaster 권한/쿠키/리다이렉트/Work Inbox/usage_logs | **제거** | 무관 잔재 |
| `blog_posts`(HTML, 개인 보관함, 검토 상태 없음) | **충돌** | web은 ContentItem/StoryRecord(검토·승인)→ChannelDraft. 별도 글 저장소를 두지 말고 초안 표로 흡수 |
| 30일 자동 삭제 cron | **충돌·제거** | 사이트 원문·배포 이력·감사 기록은 영구 보존이 원칙(late-evidence 영구 저장 계약 `late-evidence.ts:7-10`). 정리 대상은 임시 생성물로 한정하고 별도 결정 |
| 공개 `post-images` 버킷 | **충돌** | 권리·공개 동의 검토 전 미디어 공개 금지(`types.ts:19-20` 자산대장). 비공개 버킷+서명 URL 또는 승인 후 공개 |
| NewsBlur(평문 비밀번호), YouTube 쇼츠, Perplexity | 제거(선택 복귀) | 사업 필요성 미확인, 비밀 관리 위험 |
| 설치마법사·kit.json·standalone 분기·확장 ZIP 빌드 치환 | **제거** | 1-site에는 설치 과정이 없다. 확장 빌드는 별도 저장소/스크립트로 |
| tiptap 편집기 | 보류 | web 원문이 일반 텍스트. 리치 편집 필요 여부 결정 후 |

### 5.3 독립 설치 vs 1-site 통합 차이 [문서+추론]
| 축 | 킷(독립) | 1-site 통합 |
|---|---|---|
| 테넌시 | 수강생마다 Supabase·Vercel 1세트, 그 안에서 회원별 RLS | 하나의 사이트·DB, 운영자(admin)만 사용 |
| 계정 | 자체 가입·이메일 확인 끔 | 기존 web 로그인·승인·역할 |
| 비밀 | 회원이 화면에서 AI 키 저장(DB 평문) | 서버 환경변수·비밀 저장소, 화면에 키 입력 없음 |
| 확장 배포 | 사이트에서 ZIP 다운로드, 사이트 주소 빌드 시 주입 | 운영자 PC 1~2대에 별도 배포(빌드 파이프라인 분리), 허용 출처는 확정 공개 도메인 |
| 데이터 수명 | 30일 삭제 | 원문·이력 영구, 임시물만 만료 |
| 상태 모델 | 글 행에 마지막 상태만 | publish_jobs + 시도 이력 + audit_events |
| 설치 | 마법사가 SQL 복사·Vercel 배포 | web 마이그레이션·CI 절차(DB 적용은 별도 승인) |

---

## 6. 이식 방식 제안 (항목 5)

### 6.1 권고 아키텍처 [추론]
**하이브리드(분석 양식의 A+B 혼합)**: 상태·계약은 web 서버 모듈, 네이버 입력은 (승인 시) 별도 실행기(확장), 그 외 블로그는 복사-붙여넣기 내보내기.

| 영역 | 둘 곳 | 내용 |
|---|---|---|
| 배포 작업 저장·상태 전이 | **web 서버 모듈** (`src/lib/distribution/**` 확장 + 저장 계층) | publish_jobs/attempts/late_evidence 표, 임대 필드(runId, lease_expires_at), admin 전용 RLS, audit_events 기록 |
| 블로그 초안 생성 | web 서버 모듈 | 승인된 ContentItem → ChannelDraft(blog): 제목/본문 블록/태그. 원문 버전 고정 |
| 내보내기(복사) | **관리자 UX** | 미리보기 + "HTML/텍스트 복사" + "수동 게시 완료 → 게시 URL 입력" |
| 확장 API | web 서버 라우트(admin 토큰) | claim / heartbeat / result 3개. 기존 계약 함수로 상태 전이 |
| 네이버 자동 입력 | **브라우저 확장(별도 실행기, 운영자 PC)** | 발행 버튼 미클릭 유지. 약관 확인·사용자 승인 전 착수 금지 |
| AI 글 생성·글감 수집 | web 서버 모듈(선택) | 운영자 키, 비용 상한, SSRF 방어, 결과는 `needs_review` 초안만 |
| 예약 | web cron(선택) | 블로그는 사람의 최종 발행이 필요하므로 "예약"은 "입력 준비 시각"까지만 의미 |

### 6.2 계약 변경 필요 사항 (Master 결정)
1. **수동 발행 채널 표현**: 확장/복사는 외부 식별자를 돌려주지 않는다. 선택지 — (a) 새 상태 `awaiting_manual_publish`(권고: 의미가 분명, 재시도 금지 규칙 명시), (b) 기존 `unknown` + `reconcileUnknown(found_published, url)` 재사용(계약 무변경이나 "불명"과 "사람 대기"가 섞임). 어느 쪽이든 운영자가 게시 URL을 입력해야 `published`.
2. capability 선언(근거: 이 분석): blog/네이버-확장 = `publishText/Image/Link: supported(입력만)`, `schedule/edit/delete/lookupByIdempotencyKey/metrics: unsupported`. 복사 내보내기 = 전부 `unsupported`이되 수동 근거 입력 허용. 실제 `supported` 지정은 dry-run/실계정 검증 후.
3. 실행기 임대 필드와 `attempts`의 관계(임대 만료=시도 종료로 볼지) 정의.

### 6.3 우선순위·선행 의존성·수용 조건

| 순위 | 작업 | 선행 | 수용 조건 |
|---|---|---|---|
| P0(결정) | 라이선스 처리 방침(클린룸 재구현 vs 서면 허락), 네이버 자동입력 채택 여부 | 사용자 | 결정 기록(DEC-ID). 미결 시 P3 착수 금지 |
| P1 | publish_jobs/시도/늦은 근거 저장 설계 + admin RLS (DB 적용은 별도 승인) | DEV-003 DB 실행기 부재 해소 | 마이그레이션 초안·RLS 행렬 시험(비관리자 거부), 판매 표와 분리 |
| P1 | 블로그 ChannelDraft 생성 + 복사 내보내기 관리자 화면 | 승인된 원문 존재, 6.2-1 결정 | 외부 호출 0, 원문 버전 변경 시 STALE_DRAFT, 복사 결과에 내부 메모·프롬프트 없음, 수동 URL 입력 전 `published` 불가 |
| P2 | 수동 게시 근거 입력(https·계정정보 없는 URL 검증 재사용 `jobs.ts` isValidEvidenceUrl) | P1 | 중복 URL·다른 버전 충돌 시 late-evidence 기록 |
| P2 | (선택) AI 초안 생성·글감 수집 | 비용 상한·키 보관 결정 | SSRF 차단(사설IP/리다이렉트/크기/타임아웃), 키 URL 노출 금지, 산출물 `needs_review`, 사실 단정·성과 포장 금지 검사 |
| P3 | 확장 API(claim/heartbeat/result) + 별도 확장 | P0 승인, 공식 약관 확인, 공개 도메인 확정 | 2개 확장 동시 claim 시 1건만, runId 불일치 409, 같은 결과 재보고 멱등, 재시작 시 자동 재입력 없음, 발행 버튼 미클릭, 토큰 해시·폐기·만료 |
| P3 | 정리 정책 | 보관 정책 결정 | 원문·이력·근거 삭제 금지, 임시 생성물만 |

### 6.4 데이터/권한 경계 [추론]
- 자동포스팅 관련 모든 표: anon 접근 없음, authenticated는 `is_admin()`만, 확장 API는 토큰→admin user 확인 후 서버에서만 쓰기.
- 확장에는 Supabase 키를 주지 않는다(킷도 사이트 API만 호출 — `background.js:37-47`). 이미지는 서명 URL로 단기 제공.
- 판매(orders/payment_records) 도메인과 표·오류코드 분리 유지(`W/src/lib/distribution/result.ts:1`).

### 6.5 미확인 / 공식 자료 확인 필요
1. 네이버 블로그 이용약관·운영정책상 확장/CDP 자동 입력 허용 여부, 계정 제재 위험(코드에 "봇 탐지 회피" 명시). 네이버 블로그 공식 글쓰기 API 제공 여부.
2. 네이버 스마트에디터 DOM 변경 시 셀렉터 취약성(코드 빌드 표기 `naver-page.js:9` "20261021.1") — 유지보수 비용.
3. Chrome `debugger` 권한 경고·압축해제 확장 배포의 기업 정책 적합성, Web Store 등록 가능성.
4. Vercel 플랜의 상업 이용 조건(킷 문서는 Hobby=비상업 전제), 300초 함수 한도 가용성.
5. 하드코딩 모델 ID들의 실제 존재·가격(`contentModels.ts:34-56`).
6. 티스토리 등 기타 블로그는 공식 API 사용 가능 여부(킷은 복사만).
7. 킷 권리자(BUYLIFE)의 코드 재사용 허락 범위.
8. 이 분석은 실행·시험을 하지 않았다. 동시 claim 원자성, 정리 cron 부분 실패 동작 등은 코드 판독에 의한 추론이다.

---

## 7. 보안 관찰 목록 (이식 시 반복 금지)

| # | 관찰 | 근거 | 구분 |
|---|---|---|---|
| S1 | URL 수집 SSRF 방어·타임아웃·크기 제한 없음 | `K/utils/ai/collector.ts:24-43` | 확인 |
| S2 | 비정제 HTML 저장·렌더 | `auto-post/route.ts:178-187`, `posts/[id]/page.tsx:576` | 확인(영향은 추론) |
| S3 | `/auth/confirm` `next` 미검증 | `K/app/auth/confirm/route.ts:7,16-21` | 추론 |
| S4 | AI 키·NewsBlur 비밀번호 DB 평문 | `schema.sql:21-30,184-191` | 확인 |
| S5 | Gemini 키를 URL 쿼리에 포함 | `K/utils/ai/contentJson.ts:43` | 확인 |
| S6 | 이미지 공개 버킷 | `schema.sql:151-153` | 확인 |
| S7 | 확장 토큰 만료 없음(폐기만), `chrome.storage.local` 보관 | `schema.sql:164-173`, `background.js:270` | 확인 |
| S8 | 정리 cron 중간 실패 시 부분 삭제 | `cleanup-images/route.ts:102-121` | 추론 |

---

## 8. 협조·Master 할 일

- 변경 파일: 이 결과 파일 1개만 작성. 킷·web·공용 .ai 파일 미변경.
- 검증: 실행 검증 없음(지시상 금지). 모든 주장은 파일·줄번호 판독 근거.
- Master 할 일: (1) 사용자에게 P0 두 결정(라이선스 방침, 네이버 자동입력 채택) 취합, (2) 6.2 계약 변경안 선택, (3) `docs/AUTOPOST_IMPORT_ANALYSIS.md` 블로그 칸을 이 보고서로 채울 담당 지정(이 작업 범위 밖이라 수정하지 않음), (4) Insta/Threads 분석(CC-ENG-03/04) 결과와 공통 저장 설계 합의.
