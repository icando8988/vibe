# DEV-001 앱 기반과 서버·DB 착수

P1 / 상위 DEVELOPMENT-001 / 단일 책임 CC-ENG-01 / 상태 prepared.
사용자가 개발 착수와 Master 총괄을 승인했다. AI_TEAM_RULES, PROJECT, 역할 CLAUDE_CODE, docs/MASTER_DEVELOPMENT_PLAN.md, docs/DEVELOPMENT_CONTRACT.md, DEC-DEV-START-001을 읽고 바로 구현한다.
수정 범위는 공통 계약의 Claude 범위 및 본인 .ai/results/DEV-001-CC-ENG-01.md. docs/DEVELOPMENT_CONTRACT 및 다른 담당 범위/공용 .ai 변경 금지.
D:/Vibe/web에 Next.js+TS 앱을 만들고 의존성을 설치한다. 필요시 해당 디렉터리 안에서만 git init, 커밋/push는 하지 않는다. 최신 지원 버전은 공식 문서로 확인하고 고정한다. 루트 자격정보/API KEY/비밀번호 파일 읽기·복사·env 저장 금지. Supabase 실제 연결·외부 발송·배포·유료 작업 금지.
공개 라우트 /, /about, /books, /how-it-works와 /login, /me, /admin에 적절한 미연결/권한 상태를 만든다. 인증 없는 admin·me에는 개인/운영 데이터 제공 금지. 실거래 쓰기는 비활성.
Supabase 초기 migration은 사용자/역할/프로젝트/책/캠페인/주문 네 상태축의 공통 기반과 RLS 방향을 작성하되 미확정 정책을 확정하지 않는다. 실행하지 않은 SQL 검증은 미실행 명시. 도메인 계약 중 순수 함수가 있으면 의미 있는 테스트를 추가한다. UI 담당의 src/components, src/styles, public/design은 수정 금지. 임시 페이지로 독립 빌드 가능하게 만든다.
완료 조건: 실제 구현, npm.cmd install/build/typecheck 결과, 변경 목록, 공식 버전 근거, 미연결 기능/미결 정책, 통합 주의와 후속 DEV-003~005 분해를 결과 파일로 반환. worker_done으로 Master에게 보고. 비제로 build/typecheck는 미완료이며 원인 수정 후 재검증. 추가 위임 금지.
