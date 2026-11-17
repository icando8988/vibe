# DEV-002B 브라우저 검증 증거

2026-11-16 · Windows · Orca 내장 Chromium · 로컬 dev 127.0.0.1:3312. 실제 기기 아님.

1. web에서 `npm.cmd run dev -- --hostname 127.0.0.1 --port 3312`.
2. Orca tab을 열고 스크립트의 page ID를 교체.
3. D:/Vibe에서 `node docs/qa/DEV-002B/check-browser.cjs 320`을 390/768/1440에도 실행. 각 8경로 방문과 viewport 재설정 후 DOM 폭·랜드마크·조작 높이 JSON 저장.
4. `node docs/qa/DEV-002B/check-interaction.cjs`로 키보드 이동 및 CSS zoom=2 보조 검사. 실제 브라우저 확대와 구별.

routes-*.json은 32조합 실측, interaction.json은 실제 키 입력 뒤 focus/URL 기록. home-390.png와 home-1440.png, books-320.png는 viewport 캡처다. 스크린샷에서 잘린 아래 내용은 스크롤하여 볼 수 있으며 문서 내용 잘림이 아니다.

제한: background browser의 document.hasFocus=false로 가시 포커스 미확정. Control+plus는 CDP 입력 오류라 200% 브라우저 확대 미검증. console/network는 최근 50항목으로 잘림. 앱 본문 링크 24px는 Master 보고 대상이며 결과 파일에 재현/추천 기록. 자세한 결과: .ai/results/DEV-002B-CX-DESIGN-01.md.
