# AUTOPOST-CONSOLE-UI-CONTINUE-001 — CC-ENG 결과

담당 Claude Code(CC-ENG-01) · task_abbc01108c67 / dispatch ctx_857bcf86fd20 / run_eaedc8d53618 · 2026-11-16.
지시: Master msg_b6438cbf9c9e(우선순위 변경). AUTOPOST-SERVER-BRIDGE-PLAN-001은 작성 시작 전에 우선순위가 바뀌어 **산출물 없음**(docs/AUTOPOST_SERVER_BRIDGE_PLAN.md 미작성).
상태: **ready_review — 정적 작성만, 실행 검증 0건.**

## 작성·수정 파일 (허용 범위 내)

신규 `web/src/components/distribution-console/`
- `guard.tsx`: `denyUnlessDistributionAdmin()` — page마다 `getDistributionAccess()` 실행, 거부면 `DistributionDenied` 반환.
- `states.tsx`: `NotConnected`(미연결 ≠ 0건), `DisabledAction`(disabled 버튼 + aria-describedby 사유), `InvalidParam`, `IdLine`, `ChannelCards`, `ModeTable`, `CapabilityTable`, `JOB_STATUS_TEXT`/`StatusDictionary`(설계 6절 상태 사전), `Dependencies`.
- 기존 `access.ts`·`readiness.ts`·`console-shell.tsx`는 변경 없이 사용.

신규 `web/src/app/admin/distribution/`
- `layout.tsx`(noindex, 제목 템플릿, 접근 판정 안 함), `loading.tsx`(aria-busy, 데이터·메뉴 미노출), `error.tsx`(client, digest만, 재시도/관리 복귀)
- `page.tsx` W1 개요 · `contents/page.tsx` W2 · `contents/new` · `contents/[contentId]` W3 · `contents/[contentId]/channels/[channel]` W4 · `…/review` W4 승인 · `contents/[contentId]/prepare` W9 · `jobs` W7 · `jobs/[jobId]` W8 · `jobs/[jobId]/manual` · `jobs/[jobId]/reconcile` · `connections` W5 · `media` W6 · `media/[assetId]`

수정
- `web/src/app/admin/page.tsx`: D1 허용 시에만 '콘텐츠 배포' 진입 카드(승인 안 된 admin에게는 메뉴 존재도 숨김). 기존 거부 처리 유지.
- `web/src/app/globals.css`: `dc-*` 콘솔 배치(960px 이하 접이식 메뉴, 700px 한 열, 표 가로 스크롤, 긴 ID 줄바꿈, disabled는 not-allowed 커서 + 사유, forced-colors 현재 표시).

## 완료

- 15개 page 모두 첫 줄에서 D1(admin AND approved) 서버 판정 → 직접 URL 접근 차단. 거부 화면은 ID·메뉴·건수 비노출.
- 모든 page `dynamic = "force-dynamic"`; `/admin/:path*` no-store 헤더는 기존 next.config 규칙 적용.
- 잘못된 channel/ID는 `notFound()` 대신 셸 안 안내(Next 16.4.6 빈 셸 문제 회피). ID 형식만 확인하고 존재 여부는 판단하지 않음.
- 저장·승인·연결·증거·대사·업로드·삭제·실행 버튼은 전부 disabled + 사유. 폼에는 action이 없고 fieldset disabled. 가짜 성공·건수·실적·계정 없음.
- 채널별 차이: Blog 제목/본문·수동, Threads 텍스트, Instagram 캡션+단일 이미지(이미지 없으면 준비 아님). 모드·기능 준비도는 기존 `CHANNEL_MODES`·`unverifiedCapabilities`에서만 가져옴(전부 미검증, live gate 닫힘).
- unknown/대사 화면에 재게시·복제 CTA 없음. '부재 확인 ≠ 재게시 허가' 명시. 준비 비교에 '모두 선택' 없음.
- `ContentDistributionPreview`는 사용하지 않음.

## 미완료·후속 의존성

- 실제 데이터 연결 전부: M1 원문/초안/승인 조회·쓰기 RPC, M2 수동 증거·대사 RPC, 작업 상세 DTO(phase/hold/issues/retry), M3 연결·자격정보, M4 미디어·권리, D1을 재검사하는 서버 액션, 기대 버전/해시 충돌 처리. 각 화면 하단 '연결에 필요한 것'에 표시.
- 서버 연결 설계 문서(AUTOPOST-SERVER-BRIDGE-PLAN-001) 미작성.
- 목록 검색/필터는 형식만(비활성). URL 상태 보존은 조회 연결 시 구현.

## 미검증 (지시상 실행 금지)

- lint·typecheck·build·test·브라우저 렌더링·반응형·키보드·스크린리더·대비 모두 **미실행**. import·타입은 수동 대조만 했으므로 첫 build에서 오류가 나올 수 있다.
- 공유 작업트리의 `src/lib/distribution/types.ts`는 다른 세션의 미커밋 변경 상태다. 여기서 쓰는 export(CHANNELS, CHANNEL_MODES, PUBLISH_MODES, JOB_STATUSES, AdapterCapabilities, CapabilityState)에 의존한다.
- `design.css`가 globals.css 다음에 로드되므로 일부 `dc-*`·fieldset 규칙이 덮일 수 있다(렌더 확인 필요).
- DB·네트워크·게시·commit 없음.
