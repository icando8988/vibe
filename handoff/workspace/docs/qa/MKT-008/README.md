# MKT-008 로컬 검토 HTML 검증

2026-11-16 · Windows · Orca 내장 Chromium. 실기기 아님.

재현:

1. D:/Vibe에서 `node docs/marketing/render-content-review.cjs`.
2. `docs/marketing/content-review.html`을 브라우저에서 로컬 파일로 연다. HTTP 서버·앱·외부 연결 불필요.
3. 주제 select와 채널 radio를 선택해 원문/변형을 비교한다. 출처·확인사항은 각 패널의 details로 확인한다.
4. 본문 복사 버튼을 누른다. 클립보드가 거절되면 본문이 선택되고 Ctrl+C/기기 복사 메뉴 안내가 나온다.

check-review.cjs는 생성 결과 결정성·12항목 원본 일치·미승인 표시·escape 및 3주제×3채널×320/390/1440 총27조합을 검사한다. Orca page/ref는 이 세션 기준이므로 새 검증 시 갱신한다. 결과와 원문 SHA-256은 browser-results.json.

copy-native.json은 실제 클립보드 쓰기 성공 안내를 확인한 기록이며 기존 클립보드는 읽지 않았다. copy-fallback.json은 로컬 페이지의 writeText를 일시적으로 거절시키는 QA shim 적용 후 버튼을 눌러 시도/선택 본문이 원본과 같음을 확인한 기록이다. 검사 뒤 reload하여 shim을 제거했다.

키보드: select focus→Tab으로 checked radio, ArrowLeft로 Instagram→Threads, Shift+Tab→select 후 ArrowUp으로 3주제→2주제, summary focus→Enter로 출처 details 펼침. keyboard-*.json 참조. 기본 native 컨트롤을 사용하며 사용자 선택 변경 시 비교 안내는 role=status로 갱신한다.

escape-review.html은 별도 합성 검증 입력이다. 원본 자료와 무관한 `</script>`, img/onerror, 따옴표, U+2028/U+2029를 제목·본문·메타에 넣어도 텍스트로만 남는다. escape-browser.json은 injected=false, script 1개, image 0개를 확인한 기록. 테스트 입력은 원본이나 실제 결과 HTML에 합치지 않았다.

review-1440/320/390.png는 본문 비교 영역, overview-1440/320.png는 안내·선택 영역 캡처. console/network에 기록된 오류 없음, 네트워크는 단일 로컬 file 문서만(비잘림). CSP가 connect/img/font/object를 차단하고 외부 리소스를 쓰지 않는다.

미실행: 다른 브라우저/실기기, 화면낭독기, 브라우저 실제 200% 확대, 인쇄 출력, 모바일 OS 복사 메뉴. 외부 게시·저장·승인·예약 기능은 구현하지 않았다. 원본 JSON/MD는 SHA-256 변경 없음.
