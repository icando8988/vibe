# UI-MKT-001 상태·오류 안내 검증

2026-11-16 · Windows · Orca Chromium · 로컬 샘플만 사용.

1. D:/Vibe에서 `node docs/qa/UI-MKT-001/preview-harness.cjs` → 127.0.0.1:3317.
2. snapshot으로 page/ref를 얻고 check-browser.cjs 값을 갱신해 실행한다. 기존 설치의 TypeScript·React만 사용하며 앱 라우트/공통 lib는 수정하지 않는다.
3. 일반 흐름 8건: 미검토 차단, 공백 본문, 검토 확인, 편집 무효, 재검토 전 차단, 모의 완료, 자연 발생 중복, 초기화 후 모의 완료.
4. 알려진 오류 13개+알 수 없는 코드 1개는 harness의 일시적 createJob 응답 fixture로 확인한다. 오류 원문에는 노출 금지 표식을 넣고 일반 화면에 코드·표식이 보이지 않는지 검사한다. 실제 공급자 장애를 재현한 것이 아니다. lib 파일을 수정하지 않으며 fixture는 검사 후 복원한다.
5. harness가 applyResult options.attempt를 읽어 모의 완료마다 1을 받았는지 확인한다. 이는 실제 재시도·외부 게시 검증이 아니다.

browser-results.json에 22개 화면 상태·3개 폭 및 콘텐츠 v2 4파일 SHA-256이 있다. DOM에는 한글 결과·오류 안내만, 상태값/코드/공급자 원문은 출력되지 않는다. 원문 입력 자체에 사용자가 코드를 적는 상황은 검사 대상이 아니다.

keyboard.json: radio focus→ArrowRight로 Threads→Tab/Enter 샘플 검토→Tab/Enter 모의 실행. summary focus→Enter로 설명 예시를 연 뒤 unknown/partial을 골라도 실제 모의 결과는 그대로임을 별도 JSON에서 확인했다.

320/390(mobile)/1440 폭에서 가로 넘침 없음. result-*.png는 한글 결과와 실제 사건이 아닌 설명 영역을 보여준다. console/network에는 로컬 문서·JS만 기록되었으며 외부 게시·저장·계정 요청은 없다.

미검증: Next 보호 관리자 경로, 실계정·실예약·실게시·실제 공급자 오류, 화면낭독기·실기기·브라우저 200% 확대. QA 전용 window 함수는 harness에만 존재하며 제품 컴포넌트에는 없다. 직접 시작한 harness만 종료하고 반환한다.
