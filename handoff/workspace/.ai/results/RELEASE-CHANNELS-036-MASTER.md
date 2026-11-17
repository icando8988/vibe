# RELEASE-CHANNELS-036 — Blog·Threads·Instagram 사이트 통합

책임 CX-MASTER-01. 주인님 직접 지시: 세 채널을 기존 사이트에 병합 후 배포하고 결과를 제시한다. 기존 공개 저장소/원본 보존·NOTICE 유지 승인은 PROJECT_HANDOFF를 따른다.

## 통합 범위

- 기존 공통 원문→채널 초안→검토→개별 실행준비/작업, Blog 수동·확장 API, Threads OAuth·수동 모의 실행, Instagram 초안·미디어 기반을 하나의 기존 Next.js 사이트에 보존한다.
- FE034 최종 코드9개 해시를 전부 대조했다. 공통 안내·채널 카드·관리 진입·연결/미디어 링크·Threads 모의 실행 동선을 실제 구현과 일치시켰다. 정적 계정 미연결 단정과 과거 전체 비동작 안내를 제거했다. 준비/카드의 모의 실행 안내 사실오류도 정정했다.
- Backend035는 코드 변경 없는 서버 연결 검토로 회수했다. 재현된 배포 차단 결함 없음, 실환경 준비/미구현 사항은 그대로 남긴다.
- 이전 인수된 미디어 UI·오류/필드 안내·업로드 불확실 상태 처리·소비 후 고착 복구(140000)도 포함한다. 실제 bucket 생성·DB migration 적용·복구 호출·외부 게시는 이번 실행에서 하지 않는다.

## Master 최종 검증

2026-11-17, Node24.22.3·PGlite0.5.16(`PGLITE_PROJECT`를 기존 임시 도구 프로젝트로 지정):

| 검사 | 결과 |
|---|---|
| npm test | 39파일668통과, 실패/skip0, exit0 |
| npm run lint | 오류0/기존경고3, exit0 |
| npm run build | 성공, exit0 |
| 빌드 후 npm run typecheck | 성공, exit0 |
| git diff --check | exit0 |
| 최종 staged 비밀패턴 점검 | 66개 파일, 고정밀 패턴/금지이름 발견0 |
| FE034 최종 동결 해시 | 9개 전부 일치 |

React best-practices에 따라 서버/클라이언트 경계·기존 ActionForm 기본동작·세션 재검사·링크/라벨·불필요 상태추가 없음과 요청별 데이터 격리를 검토했다. 로컬 대역 시험은 실제 Supabase/Storage/OAuth/게시 왕복 검증이 아니다.

## 배포 및 검증 상태

배포 대상은 기존 `icando8988/vibe` main, 기존 사이트 `https://vibe-ten-nu.vercel.app`이다. 기준 HEAD8f0691c의 GitHub Vercel 상태 success와 대상 대시보드 링크를 확인했다. Git origin 조회와 push dry-run 성공. 최종 commit/push/배포 ID·상태는 후속 결과 문서에 기록한다.

Vercel MCP 프로젝트 조회는 team 접근403이다. 기존 연결의 팀 접근 승인 링크를 주인님께 제시했고 인증값은 읽거나 기록하지 않았다. Git 연결 자동 배포 결과는 GitHub 상태/운영 HTTP와 대조한다. 실제 배포 전 기준선 HTTP는 홈·로그인·관리콘솔200이었다(관리 페이지는 비로그인 권한거부 화면이며 관리자 기능 성공을 뜻하지 않음).

브라우저는 주인님 지시로 Chrome이다. Orca 제어용 PowerShell이 Defender에서 격리됐고 새 창 실행 명령도 별도 정책에서 거절돼 브라우저 실측은 미완료다. 상세 CHROME-CONTROL-DIAGNOSTIC-20261117-MASTER.md. 보안 우회/설정 변경 없음.

## 배포로 해결되지 않는 항목

- Threads·Instagram live 실행기/자동 예약, Instagram OAuth·이미지 첨부 UI는 미구현이다. 실제 게시 gate는 닫혀 있다.
- 원문/초안/권리/작업 저장은 실제 DB migration·서버 설정·승인 admin 세션이 필요하다. 이번 코드 배포를 실DB 적용 증거로 보지 않는다.
- Threads 연결에는 Meta 앱·callback/권한·암호화 키 및 실제 계정 시험이 필요하다.
- Blog 확장 배포 설정은 기본 비활성이다. 사이트 주소/API_READY/권한 설정·Chrome 확장 설치/실측은 별도이며 마지막 발행은 사람이 한다.
- 미디어 private bucket·서명 전송·정리/sweep·실동시성·복구 운영 호출자는 미검증/미구현 상태를 유지한다.
- 별도 Tester 결과 QA-TESTER-001도 보존했다. 0바이트/크기초과 intake의 반복 storage_error, 다운로드 후 크기검사, 프록시 Origin 실측 및 일부 route 직접시험 공백은 미해결이다. 이번에 업로드 UI를 활성화하지 않으며 이 결과를 운영 업로드 수락으로 쓰지 않는다.
