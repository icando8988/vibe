# DEV-002B UI 통합 수정·브라우저 검증

P1 / 책임 CX-DESIGN-01 / 상위 DEVELOPMENT-001 / 상태 prepared.
기존 DEV-002를 이어 즉시 작업한다. 사용자 최신 지시: Design 담당이 대기하지 않도록 계속 작업 배정. Master CX-MASTER-01.
입력: 기존 공통 규칙/역할, docs/DEVELOPMENT_CONTRACT.md, docs/DESIGN_SYSTEM.md, .ai/results/DEV-001-CC-ENG-01.md.
수정 허용: web/src/components/**, web/src/styles/**, docs/DESIGN_SYSTEM.md, docs/qa/DEV-002B/**, 본인 .ai/results/DEV-002B-CX-DESIGN-01.md. app/lib/DB/package/lockfile/공용 .ai 수정 금지.

1. books-view.tsx:7, site-header.tsx:13의 내부 홈 링크 lint 오류를 Next Link로 수정. 다른 내부 경로도 적절히 Link로 통일하되 #main-content/#contact는 앵커 유지. lint 규칙 비활성화 금지.
2. 설치된 의존성을 이용해 lint/typecheck 실행. Claude가 다음 작업에서 설정/의존성 파일을 수정하지 않도록 Master가 분리 배정한다. 이 단계에서 새 의존성 추가 금지.
3. 사용자 흐름 전체(/,/books,/about,/how-it-works,/login,/me,/admin,404)를 실제 브라우저로 확인한다. dev server 실행 시 verification 스킬, 브라우저는 ego-browser/Orca 지침, 다수 TSX는 react-best-practices 적용. 서버는 자신이 시작한 것만 종료.
4. 320/390/768/1440 폭, 200% 확대, Tab/Shift+Tab/Enter, 본문 바로가기·문의 앵커, 중복 main/h1, 가로 넘침·잘림·초점·터치 조작을 검증한다. 대표 스크린샷과 기기/폭/실행 절차를 docs/qa/DEV-002B에 기록. 화면낭독기 등 미실행 항목은 명시.
5. 허용 범위 UI 결함은 직접 수정·재검증. app 소유 파일 결함은 재현/기대/실제/영향/추천 패치로 Master에게 반환. 새 사진/가짜 실적·가격/실거래·공개 배포 금지.
6. 검증이 끝나면 즉시 결과를 worker_done으로 반환. 실제 발견 결함과 미검증을 구분하고 막힌 작업만 기다리지 말고 독립 화면을 계속 검증한다. 추가 위임 금지.
