# CI-002 Node24 기준 실제 로컬 호환 검증

P2 / CC-ENG-01 / Master CX-MASTER-01. CI001 정적근거검토 수용, GitHub미실행 유지. 기준은 Node24 유지(의존성엔진·@types24), 로컬Node26 차이를 실측한다.
허용 docs/CI_VERIFICATION.md, .ai/results/CI-002-CC-ENG-01.md만. web소스/lock/워크플로/global환경 변경 금지. 읽기전용 점검과 빌드산출 .next 재생성 허용. Design components/styles 병행수정 중이면 최종snapshot시각 명시.
사용가능 Node24 실행기 발견부터 확인. 없으면 Master는 npm registry 공식 node@24 패키지를 임시캐시에 받아 격리실행하는 비용없는 로컬개발 검증을 허용한다. npm exec --package=node@24 등 지원방법을 확인해서 사용하되 package.json/lockfile이나 global PATH/Node설치 변경 금지. 다운로드 실행기 버전/출처 기록, 자격정보 읽기 금지.
실제로 child명령이 Node24를 사용함을 먼저 process.version/execPath로 확인. lint/test/build/typecheck를 Node24로 실행, 기존186tests 기준과 비교. 검증명령이 실수로 Node26이면 성공으로 기록하지 말고 수정. 추가npm ci 반복은 현재 설치변경이 없으므로 불필요. 불가환경이면 동일조건2회반복하지 말고 근거·미실행 반환.
코드결함 발견시 현재범위에서 임의수정하지 말고 재현/원인/추천을 Master에게. 비밀값/대형npm로그 출력 금지, 필요한단계와요약만 기록. 실제GitHubCI/원격인증/배포 성공과 구별. 결과worker_done, 추가위임금지.
