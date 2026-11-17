# MKT-002 로컬 UI 검증

2026-11-16 · Windows · Orca 내장 Chromium. 외부 연결·실제 게시 없음.

- 홈: web dev 서버 127.0.0.1:3312. public home에 배포 운영 UI가 없는지 확인.
- 독립 시안: D:/Vibe에서 `node docs/qa/MKT-002/preview-harness.cjs`, 127.0.0.1:3313. 설치된 TypeScript/React/ReactDOM만 이용해 원본 TSX를 메모리 번들로 렌더링한다. src/app 변경·추가 패키지·외부 CDN 없음. 운영 제공 서버가 아닌 샘플 검증 전용이다.
- 각 페이지를 Orca로 열고 320/390/768/1440×900 viewport에서 DOM 폭·main/h1·범위 밖 요소를 확인. widths.json은 desktop viewport 모드이며 별도로 320/390 mobile 모드 캡처도 확인.
- snapshot에서 얻은 ref로 제목·본문 fill, Threads radio click, 상태 select(failed/scheduled/needs_review), reset button click. PowerShell에서는 `'@e6'`처럼 ref를 인용한다.
- Threads에 focus 후 실제 ArrowRight로 Instagram을 선택하고 본문 순서 변화 확인. reload 후 blog/disconnected/초기 원문 복원과 local/session storage 0 확인.
- console.json/network.json: 시안 페이지의 오류 없음, 로컬 문서와 JS GET 200만 확인(비잘림). 실제 플랫폼 네트워크 요청 없음.

파일: edited-threads-failed.json, keyboard-instagram.json, scheduled-sample.json, review-sample.json, reset-sample.json, reload-reset.json. home-390.png/preview-1440.png/preview-320.png는 실제 viewport 캡처다.

제한: 관리자 Next 라우트에는 아직 연결하지 않음. 실제 프로그램, 인증/권한, 플랫폼별 기능, 저장/예약/게시, 실제 브라우저 200% 확대·가시 포커스·화면낭독기·실기기 터치는 미검증. 로컬 서버는 검사 후 종료한다. DEV-002B 결과는 이전 홈에 대한 별도 기록으로 보존했다.
