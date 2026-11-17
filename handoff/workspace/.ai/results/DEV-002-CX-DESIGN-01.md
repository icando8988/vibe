# DEV-002 — 공개 UI와 디자인 시스템

- 상위: DEVELOPMENT-001 / P2 / 책임: CX-DESIGN-01
- 상태: ready_review / 2026-11-16 (Master 통합 대기)
- 입력: 공통 규칙, PROJECT, CODEX_SUB_UI, MASTER_DEVELOPMENT_PLAN, DEVELOPMENT_CONTRACT v0.1, DEC-DEV-START-001
- 수정 범위: web/src/components/**, web/src/styles/**, docs/DESIGN_SYSTEM.md, 이 결과 파일. public/design 자산은 필요하지 않음.
- 완료 조건: 계약의 named export 5개와 CSS, 연동·상태·접근성 문서, 가능한 검증 및 버그 보고.
- 의존성: Claude scaffold 및 Master 라우트 연결. 외부 연결·거래·배포는 제외.

## 결과와 변경 파일

계약의 named export 5개를 구현했다. ProjectHome과 BooksView는 props 없이 사용하며, 추가 의존성·외부 폰트·비트맵·서버 호출이 없다.

- web/src/components/site-header.tsx — SiteHeader, 본문 바로가기와 줄바꿈 메뉴
- web/src/components/site-footer.tsx — SiteFooter, 문의·정책 미준비 상태와 #contact
- web/src/components/project-home.tsx — ProjectHome, 도전 소개→책/참여→과정→문의/정책 경로
- web/src/components/books-view.tsx — BooksView, 자료 미확보 빈 상태와 거래 미연결 안내
- web/src/components/status-notice.tsx — StatusNotice, info/warning/error 및 선택적 동적 상태 알림
- web/src/styles/design.css — 색·타입·간격·반응형·포커스·강제 색상·동작 감소
- docs/DESIGN_SYSTEM.md — 토큰, props, 연결 방법, 상태·접근성 인수 기준
- 이 결과 문서

모든 변경은 지정 범위 안에서 신규 파일로 작성했다. package/lockfile/app/lib/supabase/공용 .ai는 수정하지 않았다. 기존 자격정보는 읽지 않았다. 추가 위임·서비스 연결·배포·실거래는 수행하지 않았다.

## 읽은 범위와 적용

AI_TEAM_RULES, PROJECT, TEAM, TRANSPORT, CODEX_SUB_UI, MASTER_DEVELOPMENT_PLAN 0~24절, DEVELOPMENT_CONTRACT, DEC-DEV-START-001을 확인했다. 계획 출력 중 잘린 9~17절은 별도로 읽었다. orchestration 버전 가이드와 react-best-practices 스킬을 적용했다. 역할은 CX-DESIGN-01이며 Master를 자칭하지 않는다.

## 실행 검증

Node.js v26.13.0에서 일회성 읽기 전용 정적 검사 실행, 최종 exit 0:

- 파일별 named export 5개와 정적 className의 CSS 선택자 존재 확인
- 외부 URL/네트워크 호출/가짜 click 동작/unsafe HTML 삽입 없음 확인
- sRGB 상대휘도 계산: #2563eb/흰색 5.17:1, #1e40af/흰색 8.72:1, #526178/#f7f9fc 5.96:1, #172b4d/#eff6ff 12.96:1, #9a3412/#fff7ed 6.88:1
- React 검토: 순수 컴포넌트, 명시적 props 타입, 안정 key, 직접 import, 불필요한 effect/state/memo 및 client boundary 없음
- 수동 소스 점검: 유일 main과 h1, nav 이름, 순서 목록, 장식 aria-hidden, 키보드 가능한 실제 링크, 최소 조작 높이, 시각적 포커스, 색 외 텍스트 상태, 본문 18px

루트 git status는 저장소 아님을 반환했다. Git 초기화·커밋은 하지 않았다.

## 미실행 검증과 제한

착수 시 web/src/components와 styles는 없었고, 반환 전 package.json/tsconfig는 scaffold 담당이 생성했다. 최종 확인 시 로컬 web/node_modules/typescript/bin/tsc와 전역 tsc가 없어 typecheck/build/lint를 실행하지 않았다. 임의 설치 또는 package 변경 없이 반환한다. 라우트에 UI가 연결되지 않아 런타임/브라우저/화면낭독기/200% 확대/320~1440px 실측은 미실행이다. 계산상 대비와 CSS 설계를 브라우저 접근성 적합 판정으로 간주하지 않는다.

## 발견 사항과 수정 여부

| ID·영향 | 재현/근거 | 처리 |
|---|---|---|
| UI-DEV-002-01 · P3 | 최초 정적 클래스 검사에서 footer의 ds-contact 선택자가 없어 exit 1 | 해당 선택자에 scroll-margin-top 추가, 같은 검사 exit 0. 화면 동작 장애가 확인된 것은 아님 |
| INT-DEV-002-01 · 통합 미완료 | 헤더의 본문 바로가기→#main-content, 본문의 문의 링크→#contact는 공통 레이아웃·본문을 함께 렌더링해야 작동 | 컴포넌트 자체 대상은 구현 완료. 모든 라우트의 연결과 중복 main 방지는 Master 담당 |
| CONTENT-DEV-002-01 · 공개 차단 | 푸터에서 실제 문의 연락처·정책 자료가 없음을 표시 | 가짜 연락처/정책 링크를 만들지 않음. 실제 자료 확보와 공개 전 교체 필요 |

별도의 기존 앱 버그는 확인하지 못했다. 기존 실행 앱이 없는 상태에서 작성했으므로 정상 동작한다고 추정하지 않는다.

## Master에게 필요한 후속

1. 루트 layout에서 기존 globals 뒤 design.css import, SiteHeader/페이지/SiteFooter 연결. 홈과 /books는 컴포넌트가 main을 포함하므로 중복 main 금지.
2. /about, /how-it-works, /login과 나머지 라우트의 main-content 대상 및 미연결 상태 안내 확인. CSS의 body/루트 폰트와 scaffold 기본 CSS 우선순위 확인.
3. scaffold 의존성 준비 후 npm.cmd run typecheck/build/lint 실행. 브라우저 320/360/390/768/1024/1440px·200%·Tab/Shift+Tab/Enter·본문/푸터 앵커 검증.
4. 실제 콘텐츠·연락처·정책 승인 전 비공개 검토 상태 유지. 인증/거래/DB 정상 동작으로 보고하지 않음.

전달: 이 보고서는 worker_done의 report-path로 반환한다. 최종 integrated/done 판단은 CX-MASTER-01 담당이다.
