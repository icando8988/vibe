# MKT-005 UI 브라우저 검증

2026-11-16 · Windows/Orca 내장 Chromium · 로컬 샘플만 사용.

1. D:/Vibe에서 `node docs/qa/MKT-005/preview-harness.cjs`, 127.0.0.1:3315. 설치된 TypeScript/React로 원본 컴포넌트와 실제 distribution 모듈을 메모리 번들한다. 별도 앱 라우트·새 패키지·외부 CDN 없음.
2. Orca tab을 열고 snapshot으로 ref를 얻는다. check-browser.cjs의 page/ref는 이 세션 기준이므로 재현 때 갱신한다. `node docs/qa/MKT-005/check-browser.cjs`는 UI의 실제 fill/click/viewport 명령을 실행한다. 저장소의 공통 로직 테스트를 복제한 단위시험이 아니다.
3. browser-results.json: 미검토 차단→검토 확인→편집 무효→재확인 전 차단→모의 완료→재클릭 DUPLICATE→공백 본문/제목 거절→초기화 무효→채널별 모의 실행 등 11사례. 320/390(mobile),768/1440에서 문서/요소 폭도 확인.
4. details summary를 DOM focus 후 실제 Enter로 열고, select에서 unknown/partial 설명을 고른다. unknown-example.json/partial-example.json에서 실제 dry_run_succeeded 결과가 그대로이며 설명 예시만 바뀜을 확인.
5. 앱 web dev(3316)에서 헤더/홈에 /stories 링크 존재, 실제 홈 링크 클릭→/stories 빈 상태를 확인. home-widths.json/stories-widths.json/stories-link.json 참조.

result-320.png/result-1440.png는 실제 모의 결과·설명 예시 캡처. console/network는 최종 정상 렌더 후 상태를 저장한다. 기록된 네트워크는 로컬 문서와 JS뿐이며 외부 게시/저장 요청은 없다.

미검증: Next 보호 관리자 라우트, 실제 인증/승인 저장/외부 프로그램/게시/예약/통계, 화면낭독기·실기기·실제 브라우저 200% 확대. 순수 로컬 시안이므로 인증을 우회한 운영 화면이라고 간주하지 않는다. dev/harness는 본 작업이 시작한 것만 종료한다.

harness 수정 이력: 최초 PowerShell 기본 디코딩으로 HTML 표기가 깨져 UTF-8 Node 복사로 바로잡았고, .ts 제네릭을 TSX로 해석하는 문제는 transpileModule(fileName)으로 수정했다. 앱이나 공통 모듈의 결함으로 분류하지 않는다.
