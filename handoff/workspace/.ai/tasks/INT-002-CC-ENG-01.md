# INT-002 GitHub 푸시 전 준비 검토

P1 / 책임 CC-ENG-01 / Master CX-MASTER-01.
사용자 요청 GitHub push가 대기 중이다. D:/Vibe/web에 Master가 git init -b main 완료. 원격 주소/실행환경 GitHub 인증 미확인, user.name/email도 미설정. 임의 GitHub 저장소·작성자·인증정보를 만들지 않는다.
MKT-006 근거 수용: 404 routing SSR 수정, 빌드 시점 콘텐츠 고정 제한은 문서화하고 공개 콘텐츠 저장/예약 연동 전 재검토. 관련 문서 README/CONTENT_WORKFLOW에 현재 제한이 일치하도록 보완.
범위: 읽기 전용 web Git 상태/추적 후보 점검, web/.gitignore, web/README.md, docs/PUSH_READINESS.md, .ai/results/INT-002-CC-ENG-01.md만. app/components/styles/lib/tests/package/DB 수정 금지. stage/commit/push/remote설정/계정변경은 Master가 담당하므로 실행 금지.
1 .gitignore를 검토해 node_modules/.next/.env*/로컬 실행기/인증·쿠키·브라우저 프로필/로그·키·덤프 등 제외. .env.example은 변수명 빈값만인지 확인. 루트 비밀번호/API KEY 파일 접근 금지. 비밀 파일 후보는 내용 읽지 말고 경로로 제외·보고. 안전한 소스만 비밀값 패턴 스캔하고 출력은 경로·유형만(일치한 값 출력 금지).
2 git ls-files --others --exclude-standard 등으로 push 후보를 목록화하고 루트 자료 미포함 검증. 외부 임시 harness/테스트 서버/빌드 산출물 잔존 확인. 코드에서 실제 외부 게시·트래킹·계정 연결이 비활성인지 상태 설명.
3 README에 실행/검증/기능 미연결/사이트 noindex/글 변경 재빌드/프로그램 미제공/DB 실제 미검증을 현황에 맞게 정리. 이미 증거 있는 빌드/110tests를 불필요 반복하지 말고 새 변경 위험에 맞는 정적 확인. 최신 UI 결과가 다른 작업자로 수정 중이면 snapshot 시점 명시.
4 PUSH_READINESS에 현재 대상 web, 제외 목록, 커밋 전 검수 결과, 남은 입력(원격 저장소·인증·작성자 확인), 공개/비공개·원격 기존 이력 보존 방침을 간결히 기록.
완료 worker_done. 새 패키지/설치/외부 게시/추가 위임/실계정·비밀파일 접근 금지.
