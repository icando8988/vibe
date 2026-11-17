# AUTOPOST-CONSOLE-UI-001 — CC-ENG 결과 (부분 완료, 중단)

task_e07d04363888 / dispatch ctx_e6f024e4731b / run_eaedc8d53618 / 2026-11-16. 상태: **failed(미완료)** — 사용량 한도 도달로 중단.

## 완료된 것 (web/src/components/distribution-console/)
- `access.ts`: `decideDistributionAccess(viewer)` / `getDistributionAccess()` — 기존 `decideAccess(viewer,'admin')` 위에 `approval==='approved'`를 추가 검사(D1). 공용 auth 의미 변경 없음.
- `readiness.ts`: 채널별 방식·차단 사유, `CHANNEL_MODES` 기반 모드 가용성, `unverifiedCapabilities` 기반 기능 준비도(전부 미검증), `LIVE_GATE_OPEN=false`, `DATA_SOURCE_CONNECTED=false`, ID 형식 검사.
- `console-shell.tsx`: `DistributionDenied`(메뉴·데이터 비노출 거부 화면), `ConsoleShell`(단일 main, 경로, 데스크톱/모바일 details 메뉴, aria-current, 준비 전 gate 안내).

## 남은 것
- 라우트 미작성: `web/src/app/admin/distribution/` 의 layout(noindex)·loading·error·page 및 contents(/new, /[contentId], /channels/[channel], /review, /prepare), jobs(/[jobId], /manual, /reconcile), connections, media(/[assetId]). 각 page에서 `getDistributionAccess()` 후 거부 시 `DistributionDenied`, `export const dynamic="force-dynamic"`.
- CSS 미작성: shell이 쓰는 `dc-shell`, `dc-side-nav`, `dc-mobile-nav`, `dc-content` 클래스 정의 필요(960px 이하 side nav 숨김·details 표시, 700px 한 열, disabled 사유 표시, wait 커서 금지). CSS module 또는 globals.css 결정 필요.
- 공통 UI(빈/미연결/오류 상태, 비활성 버튼+사유, 상태 사전) 및 `/admin` 진입 카드(접근 허용 시에만) 미작성.
- 주의: Next 16.4.6에서 페이지 렌더 중 `notFound()`는 JS 없이 빈 화면(stories 주석 참조) → 잘못된 channel/ID는 셸 안의 안내로 처리할 것.
- `ContentDistributionPreview`는 현재 어디서도 사용되지 않으며 콘솔에 넣지 않을 계획이었다.

## 검증
테스트·build·typecheck·lint·브라우저·DB 미실행(지시상). 작성 파일은 정적 검토만. 외부 게시·DB 쓰기·commit 없음.
