# AUTOPOST-CONSOLE-VERIFY-001 — CC-ENG 결과

담당 Claude Code(CC-ENG-01) · task_764491d1cceb / dispatch ctx_7d4211d631e3 · 2026-11-16. 상태: **ready_review**.
네트워크·외부 API·실제 DB·게시·commit/push 없음. env·키 파일 내용은 열람·출력하지 않음(Next build가 통상 방식으로 env를 읽는 것만 있었음).

## 실행 명령과 종료코드 (D:/Vibe/web)

| 순서 | 명령 | 종료코드 |
|---|---|---|
| 1 | `npm.cmd run typecheck` | 0 |
| 2 | `npm.cmd run lint` | 0 |
| 3 | `npm.cmd run build` | 0 — 콘솔 라우트 14개 모두 ƒ(동적) |
| 4 | `npm.cmd run typecheck` (build로 .next 타입 갱신 뒤 재실행) | 0 |
| 5 | `npx vitest run --config <scratchpad>/vitest.verify.config.mts` (역할 판정 임시 테스트) | 0 — 1 file / 8 tests 통과 |
| 6 | 수정 후 `npm.cmd run lint` / `npm.cmd run typecheck` | 0 / 0 |

5번 테스트 파일은 저장소 밖 scratchpad에 두어 tests/는 바꾸지 않았다. 확인한 케이스:
- 승인된 admin → 허용
- 비승인 admin(pending·rejected·suspended) → `not_approved`
- 승인된 일반 회원 → `forbidden`
- 승인 대기 일반 회원 → 거부
- 비로그인 → `unauthenticated`
- 인증 미설정 → `auth_not_configured`

## 수정

- `web/src/app/admin/distribution/contents/[contentId]/prepare/page.tsx`: 채널 카드의 h3가 h1 바로 아래에 와서 제목 단계가 건너뛰었다. `<section>` + h2 "채널별 다음 단계"로 감쌌다(접근성).
- 이전 보고서(AUTOPOST-CONSOLE-UI-CONTINUE-001)의 "page 15개"는 잘못 센 수다. 실제 page.tsx는 14개다(build 출력과 일치). 이전 보고서는 보존하고 여기서 정정한다.
- 그 외 새 UI에서 build·lint·type 결함은 나오지 않았다. 범위 밖 기존 오류도 이번 명령들에서는 없었다.

## 정적 대조

| 항목 | 결과 |
|---|---|
| guard 호출 | 실제 page 14개 모두 `await denyUnlessDistributionAdmin()`를 params 읽기·렌더보다 먼저 호출. layout은 판정하지 않고 children만 전달 |
| 허용 시에만 메뉴 | 콘솔 메뉴는 `ConsoleShell` 안에만 있고, 셸은 guard 통과 뒤에만 렌더. `/admin` 진입 카드는 `decideDistributionAccess(viewer).allowed`일 때만. 거부 화면(`DistributionDenied`)에는 메뉴·ID·건수 없음 |
| dynamic / no-store | 14개 모두 `dynamic = "force-dynamic"`, build 결과도 ƒ. `next.config.ts`의 `/admin`, `/admin/:path*` → `private, no-store`. layout에 noindex |
| 미연결 상태 | 목록·상세는 `NotConnected`("운영 데이터 미연결 · 실제로 없다는 뜻 아님"). 숫자·계정·성공 표시 없음. 폼은 action 없이 `fieldset disabled` |
| unknown 재게시 CTA | 없음. '재게시'라는 단어는 reconcile의 disabled '부재 확인' 사유 문장에만 있음. 재시도·복제 버튼 없음 |
| main 하나 | 화면마다 `DistributionDenied`(PageMain) 또는 `ConsoleShell` 중 하나만 main을 렌더. loading/error도 각자 main 하나. 루트·콘솔 layout에는 main 없음 |
| 서버/클라이언트 경계 | `"use client"`는 `error.tsx` 하나뿐(Next 규약상 필수, Link·버튼만 있음). 나머지 page·셸·states는 서버 컴포넌트이고 훅·이벤트 핸들러 없음 → 불필요한 클라이언트 번들 없음. guard·access는 서버에서만 import |
| label / aria-describedby | 입력·선택마다 `htmlFor`로 label 연결. 정적 `aria-describedby` 대상 id는 같은 파일에 모두 있음(누락 0). `DisabledAction`은 `${id}-reason`을 생성해 연결, 페이지 안 id 중복 없음 |
| 키보드 구조 | 이동은 Link, 행위는 button. ARIA tab 없음. 모바일 메뉴는 details/summary. disabled 버튼은 포커스를 받지 않지만 사유 문장이 바로 옆 본문에 있어 읽힘. aria-current로 현재 위치 표시. 데스크톱·모바일 메뉴 중 하나는 CSS `display:none`이라 보조기기에도 하나만 노출 |

## 미검증 한계

- **브라우저 실측은 이번 범위 밖.** 실제 렌더링, 960/700px 반응형, 포커스 링, 스크린리더 낭독, 대비, 200% 확대, forced-colors는 확인하지 않았다.
- `design.css`가 globals.css 뒤에 로드되므로 `dc-*`·fieldset 규칙이 덮이는지는 렌더 확인이 필요하다.
- 실제 Supabase 세션으로 역할별 직접 URL 차단을 확인하지 않았다(순수 함수 테스트와 정적 대조만).
- `next.config` 헤더가 실제 응답에 붙는지는 이번에 HTTP로 확인하지 않았다.
- 공유 작업트리의 `src/lib/distribution/*`는 다른 세션의 미커밋 변경 상태 그대로 build했다. 그 파일들은 열람만 하고 수정하지 않았다.
- 서버 연결 명세 작성은 다음 별도 작업이다.
