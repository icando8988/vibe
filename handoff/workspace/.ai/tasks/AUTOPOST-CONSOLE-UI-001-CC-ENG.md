# AUTOPOST-CONSOLE-UI-001 — 통합 배포 콘솔 UI 구현

Run: `run_eaedc8d53618`. 작업자: CC-ENG Claude Code. 상위: `AUTOPOST-CONSOLE-DESIGN-001` (`task_a2d43c1165b8`) 완료 후 시작. Master: CX-MASTER-01.

## 목표

현재 사이트 관리자 안에 Blog·Threads·Instagram 3채널 통합 배포 콘솔을 구현한다. 화면 구조와 사용자 흐름은 선행 Codex Design 산출물 `docs/AUTOPOST_CONSOLE_UI_PLAN.md`, `docs/AUTOPOST_CONSOLE_WIREFRAME.html`을 따른다. 실제 UI 코드는 Claude Code가 담당하고 Master가 통합·리뷰한다.

## 현재 사실과 제한

- distribution M1/M2 migration은 정적 검토만 됐고 DB 미적용이다. M1 쓰기 RPC는 별도 작업 중이다.
- M3 연결·credential storage, M4 media assets/rights, 실제 Instagram/Threads adapter와 scheduler는 아직 구현되지 않았다.
- `distribution_live_gate()`는 false이고 live adapter는 `UnconnectedAdapter`다. Blog는 `manual`/`dry_run`만 지원한다.
- 실제 콘텐츠·계정 연결·통계·예약 기록을 임의로 만들지 않는다. 연결이 준비되지 않은 기능은 안내·비활성 상태로 표시한다.
- 외부 게시, OAuth, DB 쓰기, migration, 배포, commit/push를 하지 않는다.

## 보안·접근

- 공개 `SiteHeader`에는 배포 메뉴를 노출하지 않는다. 관리자 하위 라우트에만 넣는다.
- 기존 `decideAccess(viewer, 'admin')`는 admin 역할만 검사한다. 배포 기능의 D1 정책은 `role=admin AND profiles.approval_status=approved`이므로 새 route에서 서버 측으로 둘 다 검사한다.
- RLS/auth 전역 판정이나 공용 profile/admin 함수 의미를 바꾸지 않는다. 비관리자는 계정·작업·통계 정보를 볼 수 없어야 한다.

## 범위

선행 설계의 admin navigation, 통합 개요, 공통 콘텐츠와 채널 탭(Blog/Threads/Instagram), readiness, 상태별 작업/빈 상태, 승인·검토 메시지, 미디어 권리 안내, 실행 상세·대사/오류 화면을 디자인 결과에 맞게 구현한다. 기존 `ContentDistributionPreview`를 쓰면 샘플/모의 전용임을 명시하고 실데이터처럼 보이지 않게 한다. 미완성 API 호출이나 placeholder 성공을 만들지 않는다.

## 수정 허용

- `web/src/app/admin/page.tsx`
- `web/src/app/admin/distribution/**`
- `web/src/components/distribution-console/**` (신규)
- `web/src/app/globals.css` (정말 필요한 경우만)
- `.ai/results/AUTOPOST-CONSOLE-UI-001-CC-ENG.md`

다른 담당 파일·migration·auth·API/DB·public routes·tests·package/lockfile은 수정하지 않는다. 테스트/build/typecheck/lint/browser/DB 실행 금지. 기존 디자인 토큰과 접근성(키보드, focus, 라벨, 반응형)을 유지한다.

## 완료 조건

선행 설계 기준으로 관리자 콘솔 UI 구현, 채널별 모드·readiness 차이와 loading/empty/error/not-connected 상태를 사실대로 표시, D1 접근 차단, 수정 범위 제한을 완료한다. 실제 연동에 필요한 후속 API/DB 의존성과 미검증 사항을 보고서에 기록하고 `worker_done`으로 보고한다. UI 데이터 연결은 별도 후속 작업이며 이번에 실제 게시/영속화로 가장하지 않는다.
