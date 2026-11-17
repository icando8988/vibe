# MKT-003 배포 공통 계약·이식 준비

P1 / CC-ENG-01 / Master CX-MASTER-01. 사용자 지시로 콘텐츠 배포·마케팅 우선. 블로그/Threads/Instagram 자동포스팅 프로그램을 나중에 제공할 예정. 현재 프로그램 미제공.
DEV-003 현재 변경·시험·차단 기록을 보존하고 거래/DB 확장은 중단, 진행 중 명령은 안전하게 정리한다. 최종 DEV-003 상태도 보고. 새 외부 실행/설치 금지.
입력 docs/MARKETING_DELIVERY_PLAN.md 및 DEC-MARKETING-001.
수정 범위 web/src/lib/distribution/**, web/tests/distribution/**, docs/AUTOPOST_IMPORT_ANALYSIS.md, .ai/results/MKT-003-CC-ENG-01.md. app/components/styles/DB/package/lockfile/공용 .ai 변경 금지.
기존 의존성만 사용해 ContentItem/ChannelDraft/PublishJob/PublishResult/AdapterCapabilities 타입과 검증 가능한 순수 상태 전이·멱등키·UTM 생성 유틸을 작성. 실제 공급자 어댑터는 미연결로 거절. mock/dry-run이 실제 published 상태를 만들지 않게 구별. 응답유실 unknown에서 무조건 재시도 방지, 콘텐츠+채널+버전 중복 요청·부분성공·예약시각을 테스트. 기능 미확인 채널에는 capability를 임의 true로 두지 않는다.
자동포스팅 프로그램 분석 보고 양식에 입력 파일/버전/라이선스/실행환경/인증/API또는브라우저자동화/예약/중복/재시도/배포호환성/테스트/보안·이식판정을 포함하고 모두 미수령·미확인 상태로 작성. 프로그램 분석했다고 주장 금지. 실제 통합을 구현할 때 공식 플랫폼 자료 확인, 지금은 API/SDK를 임의 구현하지 않는다.
완료는 코드/의미있는 테스트/검증 결과/남은 입력을 worker_done으로 반환. 자격정보/원격계정/실게시/추가 위임 금지.
