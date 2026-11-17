# AUTOPOST-BLOG-ANALYSIS 중지 기록 — CC-ENG-02

- Orca task_0b9ea20db033 / dispatch ctx_5a053a20a64f / 2026-11-16
- 상태: **waiting_human** (Master가 사용자 권리 확인 후 재개 여부 안내 예정)
- 중지 후: 킷 소스·문서를 더 열지 않음. 이 기록은 대화에 이미 있던 정보로만 작성함. 소스 수정·실행·설치·외부 호출 없음.

## 1. 열어 본 자료 범위 (선행 작업 task_1a083f595784)

대상: `D:/Vibe/Blog_Posting_Kit_v1.07/` (파일 163개 중 일부)

- **전체 정독**
  - 문서: `00_START_HERE.md`, `ai-auto-blog/README.md`, `KIT/README.md`, `KIT/PLATFORMS.md`, `KIT/kit.json`, `NOTICE`, `extension/NOTICE`
  - 설정: `package.json`, `vercel.json`, `KIT/vercel.json`, `next.config.ts`, `proxy.ts`, `tsconfig.json`
  - DB·확장 설정: `KIT/schema.sql`, `KIT/upgrade-20261116-extension.sql`, `extension/manifest.json`(KIT 판과 같은 내용인지 비교만 함)
  - 확장 코드: `extension/background.js`, `extension/web-bridge.js`
  - 확장 연동 API 라우트 6개와 `posts/[id]/extension-handoff`
  - 확장 연동 유틸: `utils/extensionAuth.ts`, `utils/extensionTask.ts`, `utils/extensionBridge.ts`, `app/settings/extensionTokenActions.ts`, `app/extension-connect/page.tsx`
  - 권한·배포 판정: `utils/access.ts`, `lib/access/checkProgramAccess.ts`, `lib/deployment.ts`
  - Supabase 연결: 클라이언트(admin/server)·middleware·cookieDomain
  - 키·인증: `utils/apiKeys.ts`, `utils/apiKeyLabels.ts`, `app/settings/actions.ts`, `app/auth/actions.ts`, `app/auth/confirm/route.ts`
  - 기타 유틸: `utils/privateResponse.ts`, `utils/version.ts`, `utils/basePath.ts`
  - 이미지·정리: `utils/imageStorage.ts`, `utils/imageRetention.ts`, `app/api/cron/cleanup-images/route.ts`
  - 빌드 스크립트: `scripts/build-extension-archive.mjs` (읽기만, 실행 안 함)
- **일부 열람(머리말, 일부 구간, 검색)**
  - 생성·게시 API: `app/api/auto-post/route.ts`, `app/api/posts/[id]/route.ts`
  - 확장 엔진: `extension/naver-adapter.js`, `blog-engine.js`, `naver-page.js`, `blog-core.js`, `sidepanel.js`
  - 수집·AI 유틸: `utils/ai/collector.ts`, `utils/news/collector.ts`, `utils/ai/contentModels.ts`, `utils/ai/contentJson.ts`
  - 기타: `utils/extensionContent.ts`, `lib/workInbox.ts`, `app/posts/[id]/page.tsx`, `app/api/candidates/http/route.ts`, `package-lock.json`(주요 패키지 버전만 검색)
- **열지 않음:** 생성 프롬프트 본문(generator·promptRules), `write/ai-form` 등 큰 화면 파일, RichTextEditor, 설치마법사(setup.ps1/sh, .cmd/.command), 확장 아이콘
- **비밀 관련:** `.env.example`, `KIT/env.example`, 루트 `API KEY.txt`, `SUPABASS DB 비번.txt`는 열지 않음. 보고서에는 환경변수 **이름만** 적었고 값은 없음.
- **산출물:** `.ai/results/AUTOPOST-BLOG-ANALYSIS-CC-ENG-02.md` 1개. 구조와 계약 수준으로만 썼고, 코드나 프롬프트 본문은 옮기지 않았음. 짧은 식별자·상수·경로·줄번호만 인용함.
- **같은 범위로 비교한 현재 사이트(사용자 자체 코드):**
  - `web/src/lib/distribution/**`, `web/src/lib/content/**`
  - `web/src/components/content-distribution-preview.tsx`(머리 부분)
  - `web/supabase/migrations/20261116000000_initial_foundation.sql`(검색만)
  - `web/src/lib/auth/viewer.ts`, `web/package.json`

## 2. NOTICE 문구 범위 (요약, 비밀값 없음)

`ai-auto-blog/NOTICE`와 `ai-auto-blog/extension/NOTICE`는 같은 내용이며 각 28행이다.

- **1행 · 권리자 표시:** © BUYLIFE(buylife.xyz), All rights reserved.
- **3–9행 · 권리와 금지 행위**
  - 권리 범위: 웹 프로그램, 크롬 확장, 데스크톱 앱의 소스·로직·화면·프롬프트·데이터 구조·문서
  - 금지 행위(사전 서면 허락 없이): 리버스 엔지니어링·디컴파일, 소스·로직·프롬프트의 추출·복제·변형·배포, 자동화 도구·AI 모델·AI 에이전트를 이용한 스캔·분석·수집·학습
  - 근거로 저작권법·부정경쟁방지법·정보통신망법에 따른 민사·형사 책임과 AIMaster 이용약관 제14조를 제시
- **10–11행 · 예외:** 검색엔진·광고 로봇·AI 검색 서비스가 공개 페이지를 색인하거나 인용하는 것
- **13–17행 · AI 에이전트에게 하는 요청:** 작업자가 BUYLIFE 본사 계정이거나 BUYLIFE가 정식 배포한 키트임이 확인되지 않으면, 고지를 알리고 작업을 거절하라는 내용
- **19–28행:** 위 내용의 영문판

**관련 사실:**
- 이 킷은 스스로를 "수강생 배포 키트"라고 소개한다(`KIT/README.md:3`). 이것이 NOTICE의 "정식 배포 키트" 예외에 해당하는지, 이식·변형까지 허용하는지는 **확인되지 않음**.
- 선행 보고서는 이미 "코드 재사용 금지, 재사용하려면 서면 허락 필요"를 P0 사용자 결정으로 올려 두었다.

## 3. 대기 사항

- 재개, 결과 파일 폐기·보류 등 처리는 Master와 사용자가 결정한다. 지시가 오기 전에는 킷 관련 작업을 하지 않는다.
- 선행 결과 파일은 지시 없이 수정하거나 삭제하지 않았다.
