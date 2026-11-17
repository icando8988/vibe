# 초기 개발 공통 계약 v0.1

총괄 CX-MASTER-01 / 2026-11-16 / D:/Vibe/web / Next.js App Router + TypeScript + Supabase 예정.

## 작업 경계

- Claude CC-ENG-01: web/package.json, lockfile, tsconfig/Next/ESLint 설정, .gitignore, .env.example, README, src/app 레이아웃/라우트, src/lib, supabase, tests. 앱 환경과 데이터·서버 담당. 실제 서비스 연결과 비밀파일 접근 금지.
- Codex Design CX-DESIGN-01: web/src/components/**, web/src/styles/**, web/public/design/**, docs/DESIGN_SYSTEM.md. 초기에는 독립 UI 컴포넌트와 CSS를 작성하며 package/lockfile/app/lib/supabase는 수정하지 않는다.
- Master: .ai 공통 상태·결정·통합 계약. 반환 후 라우트 연결과 통합 검증 조정. 공통 파일 변경은 Master와 조정.

## UI 연동 계약

UI 기본 파일: src/components/site-header.tsx (SiteHeader), site-footer.tsx (SiteFooter), project-home.tsx (ProjectHome), books-view.tsx (BooksView), status-notice.tsx (StatusNotice). 기본 내보내기보다 named export 사용. 스타일은 src/styles/design.css. 모두 외부 UI 패키지 없이 React/HTML/CSS로 구현한다.
ProjectHome/BooksView는 자체 props 없이 사용 가능한 모의/읽기 전용 첫 버전을 제공한다. 원문 사실은 ‘계획’으로 표시하고 사진/가격/실적을 창작하지 않는다. CTA는 /books, /about, /how-it-works, /login. 비준비 기능은 작동하는 척하지 않는다.
Claude는 초기 라우트에 최소 임시 본문만 제공한다. UI 파일은 Master가 존재와 검증을 확인한 다음 연결한다. 두 작업자는 상대 경로가 아직 없어도 자신의 범위를 완료한다.

## 서버/데이터 기준

공개 콘텐츠와 개인정보 캐시 분리. 미연결 Supabase 환경은 서버 명시적 미준비 상태. 일반 사용자 입력으로 admin/price/payment verified 변경 불가. 미래 거래는 네 상태축과 멱등/재고 트랜잭션 계약을 따른다. 초기 단계에서는 실거래를 구현한 것처럼 보고하지 않는다.
환경 예시는 변수명과 빈 값만. Windows PowerShell에서는 npm.cmd 사용. Next/React/TypeScript 지원 버전은 착수 시 공식 자료 확인 후 고정하고 근거를 README에 기록. 외부 폰트/이미지 빌드 의존성 피함.

## 초기 완료 기준

깨끗한 설치 재현, typecheck/build 명령과 성공 증거, 홈/소개/책/이용방법/로그인/마이 경로의 상태 명시, 모바일·키보드 고려. 인증·DB·거래 미연결 상태를 실제 기능 완료와 구별한다. 테스트는 도메인/권한 등 의미 있는 검증에 한정한다.
