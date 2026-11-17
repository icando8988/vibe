# MKT-011 — 콘텐츠 발행 준비 확인 양식

- 책임: CX-DESIGN-01 (명시 배정 작업자), Master: CX-MASTER-01.
- 작업 ID: MKT-011 / Orca task_18602456e097 / dispatch ctx_d49d50ea855d / P1.
- 상태: ready_review. 양식 작성 완료이며 실제 발행 준비 완료나 공개 승인 완료가 아니다.
- 목적: Q1~Q6·원문3/변형9 개별 의견·이미지/권리·미수령 프로그램 정보를 한 번에 답할 수 있는 오프라인 양식.
- 수정 범위/산출물: docs/marketing/publication-readiness.html, docs/qa/MKT-011/README.md, 이 결과 파일만 신규 작성.
- 완료 조건: 12개 개별 답변, Q1~Q6 원문과 사유 및 프로그램 정보 포함, 전부 보류 기본값, 로컬 JSON 다운로드 외 외부 효과 없음, 테스트·위임·배포 없음.

## 읽은 범위·근거

AI_TEAM_RULES.md, .ai/PROJECT.md, .ai/TEAM.md, .ai/TRANSPORT.md, .ai/roles/CODEX_SUB_UI.md를 읽었다. EDITORIAL_REVIEW.md(특히 질문 5절 및 위험·보류 사유), reader-content-pack.json/.md, MARKETING_DELIVERY_PLAN.md, MKT-009/MKT-010 결과를 사용했다. 대량 결합 출력 일부가 도구에서 잘려 편집 검토 마지막 절과 v2 Markdown 전체를 별도로 읽었고, JSON 전체는 생성 과정에서 구조 데이터로 읽어 3주제의 원문과 변형을 모두 포함했다. 루트는 프로젝트 문서상 Git 저장소가 아니며 Git 초기화·앱 작업을 하지 않았다. 자격정보 파일·.env·쿠키/토큰/비밀번호 파일은 읽지 않았다.

## 구성과 경계

- Q1~Q6 원문 질문은 EDITORIAL_REVIEW.md 표에서 가져오고 질문별 대기 사유를 따로 적었다. Q1 이름 표기/성명 사용 동의/소개 공개 동의, Q2 수치 유효성/공개 사용 허가를 각각 분리했다. Q3 실제 자료/주제2 처리, Q4 텀블벅, Q5 운영 약속, Q6 사진 의미·연도 역시 별개다. 모든 선택에 모르겠음/보류가 있다.
- T1/T2/T3 각각 original/blog/threads/instagram으로 12개를 식별한다. v2 제목·본문·출처·공개 전 확인사항·이미지 필요 설명·편집 보류 사유를 HTML 문자 이스케이프하여 정적으로 포함했다. 각 항목에 보류/수정 필요/이 항목은 승인 가능, 메모, 이미지 원본 상태, 사용권, 공개 동의, 근거 메모가 있다.
- 12개 의견 기본값은 hold이며 실제 원본의 draft/publicApproval=false/runtimeImportAllowed=false/externallyPosted=false를 변경하지 않는다. 항목별 공개 승인과 사이트 실명 공개 동의·저장소 실명 유지 승인이 별개라는 안내를 상단과 매 항목에 반복했다.
- 프로그램 소스 ZIP 파일명/전달 위치 또는 저장소 링크, 버전, 라이선스, OS/런타임, 블로그/Threads/Instagram 지원 서비스·계정 유형과 알려진 지원 범위를 받는다. 자격정보 입력칸·파일 첨부·소스 접근 기능이 없다. 공유 코드·ZIP과 자유 입력에서 비밀정보를 제외하도록 명시했다.
- 네트워크 호출·외부 리소스·storage·계정 연결·자동 저장·자동 발행·원본 승인 반영이 없다. CSP로 외부 리소스와 연결, 폼 전송을 차단하고 submit도 막았다. 다운로드는 사용자의 버튼 클릭 시 메모리의 답변만 Blob으로 로컬 파일화한다.
- 비밀정보 자동 탐지/제거는 하지 않는다. 작성자가 모든 메모·링크를 확인했다는 체크 후에만 다운로드할 수 있고 답변 수정 시 재확인을 요구한다. 다운로드 실패 시 화면에 오류 안내를 남긴다.

## 응답 JSON 규격

파일명: `MKT-011-publication-readiness-answers.json` (UTF-8, application/json).

최상위는 평면 객체이며 모든 값은 문자열이다. `new FormData(form)`의 이름 있는 select/textarea 필드만 직렬화한다. 원고 본문·원본 상태·출처 데이터·시각·확인 체크박스는 포함하지 않는다. 미응답 선택은 `hold`, 빈 텍스트는 `""`다.

- 질문 키: Q1_nameStyle, Q1_nameConsent, Q1_introConsent, Q1_note; Q2_validity, Q2_permission, Q2_note; Q3_materials, Q3_topic2, Q3_note; Q4_mention, Q4_note; Q5_promise, Q5_note; Q6_meaning, Q6_note.
- 항목 접두사: T1-original, T1-blog, T1-threads, T1-instagram, T2-original, T2-blog, T2-threads, T2-instagram, T3-original, T3-blog, T3-threads, T3-instagram. 각 접두사에 _decision, _note, _image, _rights, _consent, _evidence가 붙는다. _decision은 hold/needs_revision/can_approve이며 can_approve도 자동 승인 명령이 아니다.
- 프로그램 키: program_source, program_version, program_license, program_environment, program_blog, program_threads, program_instagram, program_integration.
- 다른 select 값은 화면의 한국어 선택지 문자열 또는 hold다. 자유 입력 값에는 사용자 답변만 들어간다. 자유 입력에 비밀정보를 잘못 쓰면 그대로 포함되므로 사용자 직접 제거가 필수다.

## 검증과 한계

작성 과정의 원본 자료 읽기와 코드 자체 검토만 수행했다. 사용자 금지에 따라 브라우저 자동화·테스트·테스트 스크립트 추가/실행·실기기·키보드/화면낭독기 실행 검증을 하지 않았다. 실제 JSON 다운로드 실행도 하지 않았으므로 브라우저별 저장 동작은 미검증이다. 수동 사용·재현 설명은 QA README에 남겼다. 공용 .ai·web·기존 원고/팩/렌더러·DB·계정·배포 설정을 수정하지 않았으며 추가 위임·배포·외부 게시를 하지 않았다.

## 미확인 사실과 답변 대기

미확인 사실: 이름·소개 동의의 실제 확보 여부, 현재 거리/구간의 유효성, 실제 준비 자료, 텀블벅 확정 내용, 가능한 게시 주기, E48 의미·연도, 이미지 원본/권리/공개 동의, 프로그램 실제 버전/라이선스/실행환경/채널 기능과 계정 유형. 일정·성과·사진·출판 상태를 창작하거나 확정하지 않았다.

사용자 답변 대기: Q1~Q6 세부 답변, 12개 각각의 검토 의견·메모, 항목별 이미지/권리/동의 근거, 비밀정보를 제외한 프로그램 전달 정보. 기존 편집 보류는 T2 4항목과 Instagram 3항목의 중복을 제외한 6항목이며 양식 선택으로 해제하지 않는다. 나머지 6항목도 미승인이다.

Master 후속: 양식 검토 후 사용자에게 파일을 제공하고 답변을 회수하여 사실 확인·권리 검토·채널 규격/프로그램 분석 및 게시물별 승인을 별도로 판단한다. 앱 반영·실제 게시·배포는 이번 결과에 포함되지 않는다.
