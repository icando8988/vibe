# DEV-002B UI 통합 수정·브라우저 검증

- 책임: Codex design / CX-DESIGN-01 · 상위 DEVELOPMENT-001 · P1
- 상태: ready_review (QA 증거 보존 후 Master 지시 msg_ca22027e667c에 따라 MKT-002로 전환) · 2026-11-16
- 범위: components/styles, DESIGN_SYSTEM, docs/qa/DEV-002B, 이 결과. app/lib/DB/package/lockfile/공용 .ai 수정 없음.
- 완료 조건: 홈 링크 lint 수정, lint/typecheck, 지정 8경로·4폭·키보드·확대 검증 및 결함 보고.
- 입력: DEV-002B 배정, DEVELOPMENT_CONTRACT, DESIGN_SYSTEM, DEV-001 결과, 기존 역할/공통 규칙.

## 수정

SiteHeader, SiteFooter, ProjectHome, BooksView의 내부 페이지 링크를 next/link로 통일했다. #main-content/#contact는 기본 앵커로 유지했다. lint 규칙을 완화하지 않았다. React best practices 점검: 서버 컴포넌트 유지, 불필요한 state/effect/client boundary 없음, 안정 key·명시적 props·직접 import 유지.

## 명령 검증

- D:/Vibe/web에서 npm.cmd run lint: exit 0.
- D:/Vibe/web에서 npm.cmd run typecheck: exit 0.
- 최초 lint 호출은 D:/Vibe에서 실행해 package.json ENOENT. 작업 폴더를 web으로 바로잡고 위 두 검사를 성공시켰다.
- 직접 시작한 서버: npm.cmd run dev -- --hostname 127.0.0.1 --port 3312, Next 16.4.6, Ready in 457ms.

## 브라우저 증거

Orca 내장 Chromium, page 643560bd-4cf8-4d75-a2c5-5462c512a1c1. 실기기 아님. 각 폭과 경로에서 viewport를 다시 설정하며 문서 폭/요소 경계/랜드마크/안내 문구/조작 높이를 측정한다. 재현 스크립트와 JSON 및 대표 PNG는 docs/qa/DEV-002B에 저장한다.

- /, /books, /about, /how-it-works, /login, /me, /admin, /missing-page-dev-002b × 320/390/768/1440px: 총 32조합에서 main/h1/main-content/contact 각각 1개, 본문 18px, 가로 넘침 요소 없음. 책/인증/관리 미연결 상태를 실제 DOM에서 확인.
- 실제 Tab→본문 바로가기, Enter→main, Shift+Tab→회원 링크, Tab→책 CTA, Enter→/books 이동 확인. 문의 링크를 DOM focus 후 실제 Enter→#contact 및 DIV#contact 초점 이동 확인. 이것은 전체 Tab 순회·시각적 초점 적합 판정과 다르다.
- CSS zoom=2 보조 검사: 768px의 8경로 모두 가로 넘침 없음. 실제 브라우저 200% 확대 대체 증명은 아니다.
- console/network 최근 50항목에 error/실패 요청 없음(잘린 기록이므로 전체 세션 무오류라고 판정하지 않음). 직접 시작한 서버 로그에서 경로 200/의도한 404 확인. 데이터 흐름은 정적 안내/서버 미연결 상태 반환까지 확인, 인증·DB·게시·거래는 미연결이며 시도하지 않음.
- 대표 viewport 캡처 home-390.png, home-1440.png, books-320.png를 직접 확인. full-screenshot에 반복 이어붙임이 보여 desktop 증거는 일반 screenshot으로 교체했다. DOM 중복은 없으므로 앱 중복 렌더 결함으로 보고하지 않는다.

## Master 수정/후속 항목

| ID | 재현·실제 | 기대·영향·추천 | 처리 |
|---|---|---|---|
| UI-002B-01 | 기존 홈 앵커 2건 lint 실패 | next/link로 내부 경로 연결 | 허용 components 4파일 수정, lint/typecheck 통과 |
| APP-002B-01 P2 | /me·404 본문 링크, /login 단일 행 링크의 bounding height 24px (상세 JSON) | 조작 높이 44px 권고 미충족. app 소유 페이지에서 독립 링크에 ds-text-link 또는 ds-button을 적용하고 주변 문구 재배치 권장 | app 수정 금지라 보고만 함. 문장 중 inline link는 문장 내 예외 검토 가능 |
| QA-002B-01 | 배경 탭 document.hasFocus=false, activeElement는 이동하지만 :focus/:focus-visible false | 가시적 outline/skip link 노출을 실제 활성 브라우저에서 재검증해야 함 | 스타일은 구현되어 있으나 실측 합격 아님 |
| QA-002B-02 | Control+plus 입력에 CDP Input.dispatchKeyEvent routing 오류. innerWidth1440/dpr1/visualViewport.scale1 | 실제 브라우저 200% 확대 및 재배치 검증 필요 | CSS zoom=2 보조 검사만 수행 |

화면낭독기, 실기기 터치, 실제 브라우저 확대와 가시 포커스, 전체 Tab 순회는 미검증. 추가 의존성/계정 연결 없음. build는 이번 링크 변경에 대해 별도 재실행하지 않았다.

## 우선순위 전환

Master 메시지 msg_ca22027e667c를 수신해 MKT-002를 즉시 진행한다. 본 보고서와 QA 증거는 전환 전 홈에 대한 기록이며 새 홈 검증은 MKT-002에 분리한다. 기존 lint 수정은 유지한다. 직접 시작한 3312 서버는 후속 UI 검증에 재사용 후 종료한다.
