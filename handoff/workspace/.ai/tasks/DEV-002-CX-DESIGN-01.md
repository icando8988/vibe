# DEV-002 디자인 시스템과 공개 UI

P2 / 상위 DEVELOPMENT-001 / 단일 책임 CX-DESIGN-01 / 상태 prepared.
사용자의 개발 시작 지시를 적용한다. 기존 DESIGN-ROLE-001 역할을 유지한다. AI_TEAM_RULES, PROJECT, CODEX_SUB_UI 역할, docs/MASTER_DEVELOPMENT_PLAN.md, docs/DEVELOPMENT_CONTRACT.md와 DEC-DEV-START-001을 읽고 구현한다.
수정은 web/src/components/**, web/src/styles/**, web/public/design/**, docs/DESIGN_SYSTEM.md, .ai/results/DEV-002-CX-DESIGN-01.md만. package/lockfile/app/lib/supabase 및 공용 .ai는 수정 금지. Claude가 scaffolding 중이므로 해당 파일의 존재를 기다리지 않고 독립 UI부터 작성한다.
공통 계약의 named exports 5개 및 CSS를 구현. 밝고 읽기 쉬운 파랑/주황/흰색, 본문18px, 반응형·키보드·포커스·상태 안내. 핵심 고령 사용자를 고려. 홈은 도전 소개→책/참여→진행 과정→문의/정책 경로. 책 목록은 미확보/빈 상태를 정직하게 표시. 실제 가격/후원자/사진/실적 창작 금지. 기존 앱/외부 자산 없으므로 필수 비트맵 생성 불필요.
1차 카드/채팅/앱/리뷰/다국어/AI 추천 제외. 회원/거래는 미연결 상태로 표시하며 가짜 성공/입금 완료 제공 금지. 추가 의존성·외부 폰트·계정 연결·배포·자격정보 읽기 금지.
완료 조건: React TSX/CSS 구현, 디자인 토큰·연동 설명, 상태·접근성 체크, 실제 가능한 검증과 미실행 범위, 발견 버그의 재현/영향/수정 여부를 결과 파일로 보고. 다수 TSX 수정 시 react-best-practices 스킬 적용. 런타임 연결/브라우저 검증은 scaffold 준비 여부에 따라 Master에게 필요한 작업 명시. worker_done으로 결과 반환, 추가 위임 금지.
