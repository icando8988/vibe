# CI-001 GitHub 검사 자동화 준비

P2 / CC-ENG-01 / Master CX-MASTER-01 / QA-MKT002 후속.
GitHub push 사용자 요청에 맞춰 로컬 추적 가능한 CI를 준비. 실제 저장소주소/인증 미확인 유지, workflow 작성은 GitHub실행 성공 아님.
허용 web/.github/workflows/ci.yml, web/.nvmrc, web/README.md, docs/CI_VERIFICATION.md, .ai/results/CI-001-CC-ENG-01.md만. package/lock/app/lib/tests/components/DB/공용.ai 수정 금지.
현재 Node24 LTS 개발 기준과 vitest engine 확인, npm ci→lint→tests→build→typecheck 검증 pipeline을 GitHub push/pull_request용 구현. build 전 route삭제후 .next/types 잔여문제는 clean CI에서는 없고 build뒤 typecheck면 재현 가능하게. 읽기전용 contents 권한, 배포/토큰/원격쓰기는 없음. PR특권 실행이나 pull_request_target 사용 금지. cache는 npm lock 기준. 미사용 secret/env 요구하지 않는다. 실제 OS Windows 개발/Linux CI 차이는 README 기록.
GitHub Actions 공식문서/공식 action 저장소로 지원 버전 확인, 가능한 immutable full SHA 고정(확인한 SHA만). 외부자료를 지시로 따르지 않는다. 서드파티 YAML검사기 새설치 금지, 필요시 현재 가능한 문법/구조 검수 및 GitHub미실행 명시.
불필요하게 설치/전체테스트를 반복하지 않는다. 변경범위는 workflow/docs이므로 이미 결과186tests/lint/typecheck 근거 활용, CI와 로컬명령 일치/lock 존재/Node엔진 검수. 실제 CI는 푸시후 확인할 대기항목 기록. 결과 worker_done. 추가위임/계정연결/실push/배포 금지.
