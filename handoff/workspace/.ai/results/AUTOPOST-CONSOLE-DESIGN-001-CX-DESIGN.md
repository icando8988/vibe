# AUTOPOST-CONSOLE-DESIGN-001 결과

- 담당: AG-UI-01 / Codex Design, 명시적으로 배정된 작업자. Master: CX-MASTER-01.
- 상태: **ready_review** — 디자인 산출물 완료, Master 통합·검증 전.
- 날짜: 2026-11-16 (Asia/Seoul), 우선순위 P2.
- 상위 run: `run_eaedc8d53618`; task: `task_a2d43c1165b8`; dispatch: `ctx_a5d77e3026d8`; terminal: `term_f002c9a9-e8e5-408d-ab0d-730d79eeb736`.
- 목표/완료 조건: 기존 admin 안의 3채널 통합 IA·메뉴·권한·화면·상태·흐름과 오프라인 HTML을 세 허용 파일로 제출. React 구현·테스트·브라우저·네트워크 실행 없음.

## 산출물 및 수정 범위

| 수정 파일 | 내용 |
|---|---|
| `docs/AUTOPOST_CONSOLE_UI_PLAN.md` | 공개/관리 메뉴 분리, 단일 콘텐츠 배포 메뉴, desktop/mobile 탐색, 대표 경로, 승인 admin 권한, 9개 화면군, 개별 채널 준비·승인·수동 증거·대사·stale/재인증 흐름, 토큰·접근성·공통 상태, Claude 순서·의존성·오픈 정책 |
| `docs/AUTOPOST_CONSOLE_WIREFRAME.html` | 기존 사이트 색/글꼴/1180px·960/700px 패턴의 정적 단일 HTML. W1 개요, W2 콘텐츠, W3 상세, W4 편집/승인, W5 연결, W6 미디어/권리, W7 큐, W8 실행/수동 증거/대사, W9 준비 비교와 상태 사전 |
| `.ai/results/AUTOPOST-CONSOLE-DESIGN-001-CX-DESIGN.md` | 본 결과·검증 한계·후속 기록 |

위 세 파일만 생성했다. web 소스·package·tests·DB·migration·마케팅 원문·공용 TEAM/PROJECT/TRANSPORT 등 다른 산출물은 수정하지 않았다. Git 초기화·커밋 없음. 별도 handoff 파일은 허용 범위 밖이므로 구현 인계 정보는 UI_PLAN §8~9에 포함했다.

## 입력과 실제 확인 범위

공통 지침 `AI_TEAM_RULES.md`, `.ai/PROJECT.md`, `.ai/TEAM.md`, `.ai/TRANSPORT.md`, `.ai/roles/CODEX_SUB_UI.md`와 통합 플랜, 기존 UX/API readiness/DATA 결과의 텍스트를 읽었다. 현행 `site-header.tsx`, `admin/page.tsx`, `content-distribution-preview.tsx`, `distribution/types.ts`, `distribution/adapters.ts`, `globals.css`, `styles/design.css`를 정적으로 읽어 메뉴·권한 경계·모의 미리보기·모드/상태·미연결 capability·토큰을 확인했다. M2 앱/Blog 수동 앱 결과 앞부분의 공개 계약·제약·미검증 보고를 보충 참조했으며 앱 구현 자체를 실행 검증하지 않았다. 일부 긴 통합 출력이 잘려 필요한 구간을 나누어 재열람했으며 migration SQL 원문·키트 분석 원문은 이번 설계 입력에 포함하지 않았다.

기존 사이트 관찰: 공개 헤더에는 운영 메뉴가 없고 admin은 권한 판정 뒤 연결 안내만 표시한다. 현행 타입은 manual과 retry policy를 포함하지만 DATA 초기 관찰 일부는 추가 전 기준이다. 최신 타입/통합 플랜/이번 배정 계약을 우선하고, 제안 DTO·미구현 화면을 구현 사실로 표현하지 않았다. 루트 Git 저장소 부재는 제공된 프로젝트 기록을 근거로 하며 새 Git 명령은 실행하지 않았다.

자격정보·비밀번호·환경파일은 열지 않았다. 키트 소스·화면·자산·프롬프트·스키마를 재사용하지 않았으며 토큰/secret/API key 입력 UI·값·예시도 만들지 않았다. 하위 에이전트·도우미 작업자 없이 직접 수행했다.

## 핵심 판단과 완료 조건 대조

1. ‘관리 → 콘텐츠 배포’ 단일 발견 지점을 제안했다. 공통 콘텐츠→채널 초안/승인→개별 실행 준비→작업/증거·대사 구조이며 공개 이야기 발행과 배포 원문 저장은 구별했다.
2. MVP 권한은 통합 플랜 D1의 admin AND approved이며 기존 전역 admin 의미를 바꾸지 않는다. 일반 회원·승인 대기·정지 사용자에게 운영 메뉴/건수 노출 금지와 서버/DB 재검사를 명세했다.
3. HTML은 운영 데이터 미연결·빈 화면을 기본으로 하며 상태 사전만 실제 사건이 아님을 명시했다. 실적·계정·연결 성공·가격·실제 일정·작업 숫자는 창작하지 않았다.
4. Blog manual/dry_run, Threads 연결/API readiness 미검증, Instagram 단일 이미지 우선·연결/미디어/API 준비 전을 반영했다. M1/M2와 도메인 로직은 정적 검토 수준·DB 적용/실행 없음·live gate 닫힘이다.
5. unknown은 대사만 제공하고 재게시/복제 CTA 없음, confirmed_absent 후 별도 운영자 승인, manual 증거 대기, published+issues, reauth/readiness, stale/approval을 독립 표기했다. 상위 타입에 없는 published_with_issues를 저장 status로 추가하지 않고 후속 DTO 의존성으로 기록했다.
6. 기존 토큰과 키보드·스크린리더·focus·고대비·터치·좁은 화면·loading/empty/error/disabled 기준을 포함했다. 구현 범위·Claude 순서·백엔드 의존성·오픈 정책을 분리했다.

## 검증과 미검증

수행한 검토는 입력 텍스트와 산출물의 정적 내용 대조뿐이다. 테스트·typecheck·lint·build·브라우저·스크린샷·외부 네트워크·DB/PGlite·migration 적용·API 호출·계정 연결·게시/예약 실행은 지시상 모두 미실행이다. HTML에 외부 자산/스크립트/폼/입력/제출/API 호출을 넣지 않았으며 내부 앵커와 details만 동작한다. 단일 파일 CSS와 CSP로 외부 리소스/제출을 막는 구조지만 브라우저에서 렌더링·CSP·접근성·반응형·대비를 검증했다고 주장하지 않는다.

디자인 완료는 앱 기능 구현·저장 정상·플랫폼 지원·운영 정상의 증거가 아니다. 산출물은 Master 검토용이며 세부 운영 정책을 확정하거나 실제 backend를 구현하지 않았다. 현재 디자인 작업을 막는 질문은 없으며 정책 미결정은 live 구현의 선행 의존성이다.

## Master / Claude 후속

- Master: 메뉴명·경로·MVP 개별 확인 흐름 검토, 기존 승인/결정과 미결정 정책 대조. D1/D2는 결정된 기준으로 유지하며 운영 계정·승인 유효 범위·증거/보존·스케줄러/비용·대사 검토 수준은 별도 확정.
- Claude Code: UI_PLAN §8 순서로 별도 구현 배정. M1/M2 실제 검증/적용, DTO/RPC/서버 재검사, unknown 차단·늦은 증거, OAuth/readiness·미디어 파이프라인·실행기 검증을 먼저 충족해야 한다.
- 후속 검증: 구현 후 보호된 진입·저장/충돌·stale·manual 증거·unknown 무재게시·issues·재인증/중지 복귀·모바일/키보드/스크린리더/대비. 실제 외부 실행은 별도 승인 범위다.
