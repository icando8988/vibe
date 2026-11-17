# MKT-002 콘텐츠 중심 홈·배포 미리보기

- 책임 Codex design / CX-DESIGN-01 · P1 · 상태 ready_review
- 상위 지시: Master msg_ca22027e667c, DEC-MARKETING-001 및 MKT-002 배정.
- 입력: MARKETING_DELIVERY_PLAN, DEC-MARKETING-001, 기존 디자인 시스템.
- 수정 범위: components/styles, DESIGN_SYSTEM, docs/qa/MKT-002, 이 결과. app/lib/package/DB 수정 없음.
- 완료 조건: 콘텐츠 중심 홈, 독립 ContentDistributionPreview named export, 로컬 미연결·샘플 상태, 가능한 lint/typecheck·브라우저 확인, Master 연동 계약 반환.
- DEV-002B 변경과 증거는 보존했으며 별도 결과 파일 참조. 실제 게시·발송·계정 연결·프로그램 실행은 없음.

## 변경과 미리보기 계약

- project-home.tsx: 주요 CTA /about + 홈 #stories, 콘텐츠 준비/미발행 안내와 기획 주제 3개. 책 안내는 보조로 하단 배치. 실제 기사·채널·구독·성과·사진을 창작하지 않음.
- site-header.tsx: 소개/참여 안내/책 준비 안내 순으로 메뉴 조정, 기존 Next Link 수정 유지.
- content-distribution-preview.tsx: props 없는 named export ContentDistributionPreview. 제목/본문 편집과 블로그/Threads/Instagram 구성, native radio와 상태 select(needs_review/scheduled/failed/disconnected), 원문 샘플 복원. 모든 상태는 시안으로 표시하고 실제 예약/실패/성공을 주장하지 않음.
- design.css: 한/두 열 편집기, 폼 라벨/조작 높이/미리보기 줄바꿈. 기존 토큰·포커스·모션 규칙 재사용.
- DESIGN_SYSTEM 및 docs/qa/MKT-002에 연동/실행 증거. 추가 의존성 없음. client state만 사용하고 네트워크·저장·게시·계정 입력 없음.

## 실행 검증

1. web에서 npm.cmd run lint 및 npm.cmd run typecheck: 둘 다 exit 0 (최종 코드에서 재확인).
2. 홈의 실제 dev 화면: h1/main 각 1개, 주 CTA /about, 관리자 미리보기 0개. 홈/독립 시안 각각 320/390/768/1440px에서 넘침 없음(widths.json).
3. 설치된 TypeScript·React·ReactDOM을 이용한 메모리 번들 harness로 독립 컴포넌트를 실제 Chromium에서 실행. app에 임시 라우트 만들지 않음. 실제 Next 관리자 라우트 통합과 동일한 검증이라고 주장하지 않음.
4. 제목·본문 입력→Threads 변형 반영, 실제 ArrowRight→Instagram 선택 및 구성 변화 확인. 검토/예약/실패 시안 메시지, 초기 미연결 메시지 확인. 원문 reset 안내와 reload 후 모든 로컬 변경 소실 확인. localStorage/sessionStorage는 모두 0.
5. harness console entries 빈 목록(비잘림). network는 로컬 문서/preview.js GET 200만(비잘림). 스크린샷 3개 직접 확인.
6. React skill 점검: 명시적 union type·useId 라벨·안정 key·derived preview·effect 없음, 사용자 문자열은 텍스트로 렌더. native radio/select로 키보드 제공. 오류/미연결은 텍스트로 구별.

## 검증 중 도구 문제와 남은 항목

- 첫 harness 동작 명령에서 PowerShell이 인용하지 않은 @e6 등을 splatting으로 해석해 CLI invalid_argument. ref를 인용해 수정 후 실제 상태 변경을 확인하고 증거 JSON을 교체했다. 앱 결함이 아님.
- esbuild 설치 여부 확인은 MODULE_NOT_FOUND여서 새 의존성 없이 설치된 TypeScript와 메모리 harness로 검증했다.
- DEV-002B에서 보고한 app 본문 링크 24px는 이 작업에서도 app 수정 금지로 보존. 실제 200% 브라우저 확대/가시 포커스는 Orca background/input 제한으로 미검증, 화면낭독기/실기기도 미검증.
- 관리자 Next 라우트 연결, 인증/권한, 실제 프로그램 수령·capability/라이선스·미디어 지원·인증 방식 분석, 저장/검토/예약/게시/대사/통계는 후속. 실제 플랫폼 API 제약을 임의 확정하지 않았다.

## Master 후속

ContentDistributionPreview를 향후 서버 권한 검증이 있는 관리 경로의 main 안에 연결한다. h2를 포함하므로 호스트가 h1을 제공하고, 독립 ds-container가 PageMain 컨테이너와 중복되지 않게 배치한다. 공개 홈에 연결하지 않는다. props/API 계약은 Claude의 실제 배포 모델 확인 후 별도 합의해야 하며 현 시안에는 입력/상태 저장 콜백이 없다.

프로그램 수령 후 UI는 채널 capability, 버전별 초안과 검토 승인, 실제 예약/시간대, 미디어 권리/대체텍스트, 실패·unknown 대사, 외부 게시 식별자/URL·부분 성공을 반영해야 한다. 실제 근거 전 published 표시 금지.

DEV-002B 보고도 함께 반환하며 QA 증거와 기존 링크 수정은 보존했다. 직접 시작한 3312/3313 검증 서버는 종료 후 반환한다.
