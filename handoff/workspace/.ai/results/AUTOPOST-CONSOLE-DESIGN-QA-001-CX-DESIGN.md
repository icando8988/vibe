# AUTOPOST-CONSOLE-DESIGN-QA-001 결과

- 담당 AG-UI-01 / Codex Design(배정 작업자), Master CX-MASTER-01.
- task `task_bc4fd57dd6a1`, dispatch `ctx_a9d49e2d1d24`, terminal `term_27d47b2ae8bd60ddd33fc7b30d13c5c9`.
- 날짜 2026-11-16, 상태 **ready_review**. 추가 위임 없이 직접 검토했다.
- 목적: 설계/HTML·기존 검증 보고와 현행 콘솔 UI를 정적 비교하고 결함·실측 필요·원문~Blog 수동 준비 연결 보완을 제출.
- 완료 조건: 파일/위치·영향·권고·우선순위·수락 조건을 갖춘 QA와 결과 파일 2개. 앱 수정 없음.

## 산출물/변경

1. `docs/AUTOPOST_CONSOLE_DESIGN_QA.md` 생성 — 현재 P2 개선 8건, 원본 기반 이식 명세 갭 3건, 14개 page와 공통 셸/상태/CSS 점검, 원문 작성→초안→승인→Blog 수동 준비 수락 기준, 실측 목록.
2. `.ai/results/AUTOPOST-CONSOLE-DESIGN-QA-001-CX-DESIGN.md` 생성 — 본 결과.

수정은 위 2개 문서뿐이다. 앱·스타일·기존 계획/HTML·검증 결과·package/tests·DB/migration·공용 상태 문서는 바꾸지 않았다. Git/commit, 브라우저·네트워크·실DB·키/env 열람, 앱/원본 프로그램 실행 없음.

## 핵심 결과

- 현재 관리자 진입 카드·D1 판정, 공통 콘텐츠→3채널 초안 구조, Blog 제목/본문·Threads 글/링크·Instagram 캡션/이미지 설명, 준비 전/disabled 사유, 단일 main/h1(영구 페이지), unknown 재게시/복제 CTA 부재를 정적으로 확인했다.
- **DQ-01:** globals의 콘솔 h1/h2 규칙이 나중 design.css의 같은 특정성 규칙에 덮인다. 카드 제목/사유 문단 간격도 공통 규칙에 덮인다. 이는 소스 근거가 있는 cascade 문제이며 실제 화면 손상 정도는 미실측이다.
- **DQ-02~08:** 필터 필드 스타일 계승 누락, 700px 채널 세로 전환 누락, 기본 회원 영역→관리 링크 부재, 대사 상단 무재전송 경고 미흡, 기본 사용자 흐름에 개발 의존성 노출, 보조축 상태 사전 누락, 실행 상세 주요 링크의 최소 터치 영역 규칙 미적용. 모두 현 비활성 골격의 P2 개선으로 기록했다.
- 실제 저장·승인·외부 실행은 여전히 미연결이다. 후속 연결에서 미리보기/미디어·원문 버전/리비전/승인 대상·저장 실패/충돌·상태별 행위·manual 증거/시간대를 완성할 수락 기준을 별도 기록했다. 현재 골격의 미구현을 실행 장애로 꾸미지 않았다.

## 조정자 후속 지시 반영

Orca 알림에 따라 `orca orchestration check`를 실행해 `msg_13c43bdac617`을 읽었다. 최신 방향은 **제공된 원본 소스 기반 이식 후 수정**이며 Claude가 소스→사이트 매핑 중이라는 지시다. 기존 분석의 clean-room 권고를 현재 작업 중단/재승인 사유로 사용하지 않았다.

지시대로 Blog/Threads/Instagram 기존 분석 보고서의 기능 목록을 추가 읽고 QA §5에 대조했다. 원본 소스 자체는 열지 않았으며 당시 보고서의 기능 관찰을 이번 실행 검증으로 표현하지 않았다. 핵심 누락/축소는 (IGAP-01) 공통 글감 수집→후보→생성→검토, (IGAP-02) Blog 서식/이미지/태그·카테고리/내보내기·확장 인계 단계, (IGAP-03) Threads 이미지·Instagram 슬라이드/생성·예약 운영이다. 세 항목마다 현재 위치·사용자 영향·권고·우선순위·수락 조건을 적고 원본 전체 이식 완료와 수동/단일 이미지 MVP를 구별했다. 이식 방향만으로 live/API 준비도나 미지원 영상/독립 스튜디오를 사용 가능으로 승격하지 않았다.

## 읽은 범위·검증 한계

공통 AI_TEAM_RULES/PROJECT/TEAM/TRANSPORT/CODEX_SUB_UI 지침, UI_PLAN과 HTML, AUTOPOST-CONSOLE-VERIFY-001 보고를 읽었다. 현행 `admin/distribution/**` 14 page·layout/loading/error, `components/distribution-console/**`, globals/design CSS를 정적으로 읽었다. 단일 main/탐색/발견성 확인용 root layout·PageMain·admin/me·site-header·StatusNotice를 추가 열람했으며 로그인/콜백 기본 returnTo는 지정 파일 문자열 검색으로만 확인했다. 기존 키트 분석은 Blog §3, Threads §3~4, Instagram §2.3~4.2 기능 목록 중심의 부분 열람이다. 긴 출력 일부는 잘려 필요한 구간을 나누어 읽었다.

이번 검증은 텍스트·선택자·분기·DOM 선언 비교뿐이다. CC-ENG 보고의 type/lint/build/역할 테스트 통과는 **기존 보고 근거**로 인용했으며 재실행하지 않았다. 브라우저 렌더링·960/700/320px 실측·스크린리더·focus·대비·200%/forced-colors·실세션·응답 헤더·DB/API 동작은 미검증이다. 테스트/빌드/서버 실행·네트워크는 하지 않았다. 정적 범위에서 P0/P1 실행 결함을 입증하지 않았다는 것은 출시/접근성 통과 판정이 아니다.

## 후속 담당

- Master: QA 수락·Claude 수정 배정, 최신 원본 모듈 매핑과 IGAP-01~03을 대조해 이식 범위/후속 단계 정합화. 회원→관리 진입은 공용 파일 별도 범위로 조정.
- Claude: DQ-01~08 수정, 원문~Blog 준비 연결 명세/서버 계약 확정, 실제 state/mode에 따른 액션 제한과 D1/승인 해시/unknown 차단 유지. 앱 변경은 본 작업자가 하지 않았다.
- 별도 QA: 960/700px 경계·320px/확대·키보드/스크린리더·CSS computed style/대비. 실DB·계정·게시 검증은 별도 범위이며 live gate는 계속 닫힘.
