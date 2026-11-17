# MKT-008 콘텐츠 초안 검토 HTML

책임 Codex design / CX-DESIGN-01 · P1 · 상태 ready_review · 2026-11-16.
범위: docs/marketing/render-content-review.cjs, content-review.html, docs/qa/MKT-008/**, 이 결과만.
입력: first-content-pack JSON/Markdown 읽기 전용, 기존 디자인/계획. 원문 수정 없음.
완료 조건: 단일 HTML 비교·선택·접힌 근거·복사 fallback, 12항목 일치/미승인/escape 검증과 브라우저 320/390/1440·키보드 확인.

## 변경과 사용법

- docs/marketing/render-content-review.cjs: Node fs/path/TextDecoder만 사용하는 재현 renderer. JSON/Markdown은 읽기 전용. 항목 미승인·채널 구성 및 원문/Markdown 일치 확인 뒤 HTML 출력.
- docs/marketing/content-review.html: 독립 단일 파일. 로컬 파일로 열면 주제 select + 채널 radio로 원문/변형 비교, 본문 복사, 출처/주장 근거/확인사항/CTA/이미지 권리/채널 기능 접기 제공. 모든 12항목에 draft·공개승인 false·외부 미게시 표시. 18px·파랑/주황/흰색, 모바일 한 열/큰 화면 두 열, native 키보드 컨트롤·포커스·상태 안내.
- docs/qa/MKT-008/**: 재현 스크립트/원본 SHA-256/27조합 검사/복사·키보드·escape 기록과 대표 캡처.
- 이 결과 파일. web/원본 JSON/MD/공용 .ai 수정 없음. 게시·예약·승인 버튼, 외부 요청, storage, 분석 태그, 의존성 추가 없음. CTA는 미승인 내부 경로 텍스트로만 표시하고 이동·자동 게시에 연결하지 않음.

생성 명령: `node docs/marketing/render-content-review.cjs`. 별도 HTTP 서버 없이 content-review.html을 file로 열 수 있다. 앱 관리자 화면·인증·실게시 프로그램과 분리된 편집 검토 자료다.

## 실행 검증

- Node assert 최종 exit 0: strict UTF-8, 결정적 HTML 재생성 일치, 원문3+변형9의 실제 DOM 제목·본문 12쌍 원본 JSON과 완전 일치, 미승인 배지12, 허용 버튼은 복사뿐, 원본 JSON/Markdown SHA-256 변경 없음.
- 실제 Orca Chromium file 페이지: 320/390 mobile,1440 desktop ×3주제×3채널 총27조합 PASS. 선택 주제1개·원문/선택변형2패널, 안내 갱신, 가로 넘침 요소 없음.
- 실제 본문 복사 버튼으로 clipboard write 성공 안내 확인. 기존 사용자 클립보드를 읽지 않았음. 실패 QA shim에서 같은 버튼 클릭→시도 payload와 수동 선택 본문 모두 원본 Instagram 본문과 일치, 본문 초점 및 Ctrl+C 안내 확인. reload로 shim 제거.
- 실제 Tab/Shift+Tab, ArrowLeft/ArrowUp, Enter로 radio/주제 변경 및 details 펼침 확인. 읽기 전용 body isContentEditable=false.
- 악성 태그형 합성 제목·본문·메타를 별도 QA HTML에 렌더링: 닫는 script·img/onerror·따옴표·U+2028/2029를 포함해도 브라우저 injected=false, script1, image0, 제목/본문 텍스트 동일. 원본 자료에는 합성 입력을 넣지 않음.
- inline JSON을 사용하지 않는다. 원본 값은 HTML text/attribute에서 전부 escape하고 실행 script는 고정 문자열뿐. script 닫힘은 정상1개로 유지, CSP default/connect/img/font/object 차단. 최종 script 구문 검사 및 request/storage API 부재 확인.
- console 오류 entries 없음, network는 단일 로컬 file 문서만, 모두 비잘림. 비교/안내 영역 스크린샷 저장 후 시각 확인. 서버를 시작하지 않았음.

## 발견·한계·Master 후속

이번 범위에서 새 결함은 확인하지 못했다. 클립보드는 브라우저/권한/기기에 따라 실패할 수 있어 수동 선택 복구 경로를 구현·실제로 확인했다. 다른 브라우저/실기기·화면낭독기·실제 200% 확대·인쇄·모바일 OS 복사 메뉴는 미실행이다. 320px에서 원문과 변형은 세로 배치되어 스크롤하며 비교한다.

Master는 이 HTML을 사용자 검토 자료로 안내할 수 있다. 모든 항목은 계속 공개승인 false이며 사실 확인·당사자 동의·브랜드/원본 이미지 권리·채널 프로그램 분석·별도 공개 승인 필요. 운영 저장소/자동배포 입력/공개 사이트로 변환하지 않았다. 최종 통합/done 판정은 Master 담당.
