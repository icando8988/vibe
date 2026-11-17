# MKT-010 독자용 v2 검증

2026-11-16 · Windows · Orca Chromium · 로컬 file만 사용. 외부 요청/실게시 없음.

생성: `node docs/marketing/render-reader-review.cjs`. v1/v2 JSON을 읽고 v2 Markdown과 비교 HTML을 만든다. v1 pack·renderer·HTML은 읽기 전용이다. `reader-review.html`을 브라우저에서 직접 열면 주제와 원문/채널 항목을 선택해 두 버전을 비교할 수 있다.

check-reader.cjs는 v2 12항목 상태·CTA·내부 말투·T2 출처 정정·보류6개·Q1~Q6, 실제 DOM 24패널(12쌍) 제목/본문 일치, HTML escape·script 구문, 원본4파일 SHA-256 보존을 검사한다. 실제 Orca select/viewport로 3주제×4항목×320/390(mobile)/1440 총36조합을 검사한다. 새 세션에서 재현 시 스크립트 page/ref를 갱신한다. 결과는 browser-results.json.

copy-native.json은 실제 v2 본문 복사 성공 안내이며 기존 클립보드를 읽지 않았다. copy-fallback.json은 페이지의 clipboard.writeText를 일시적 거절 shim으로 바꾼 뒤 실제 버튼을 눌러 수동 선택된 본문이 원본 v2와 같은지 확인한 결과다. reload 후 shim 제거. keyboard.json은 주제 select focus→Tab→비교항목 select→ArrowDown으로 blog 선택 기록이다.

compare-1440.png는 비교 개요, hold-topic2-390.png와 hold-instagram-320.png는 v2 보류 사유가 접힘 영역 밖에 표시되는 화면이다. 실제 본문은 아래로 스크롤해 읽는다. console/network는 정상 file 문서만 확인했다. 화면은 앱 운영 UI가 아니다.

미검증: 다른 브라우저·실기기·화면낭독기·실제 200% 확대·모바일 OS 복사 메뉴. 실제 발행 적합성·이미지 권리·채널 규격·성과는 판정하지 않는다. 보류 아닌6개도 공개 미승인이다.
