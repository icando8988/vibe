# AUTOPOST-DESIGN-A-013 — CC-ENG 결과

담당 Claude Code(CC-ENG-01) · **기존 세션 term_67ce2ea3에서 수행**(새 세션·worker·subagent 없음) · task_08b9d370c0fb / dispatch ctx_0ced776989c7 · 2026-11-17
상태: **ready_review.**
- A안 디자인을 콘솔에 적용했고 독립 검토 러너를 최종 정리했다.
- 데이터 쓰기는 이번 범위가 아니라 활성화하지 않았다. 준비 전 상태를 유지한다.
- 승인 admin 실세션 렌더와 브라우저 실측은 하지 않았다(아래 한계).

## 1. handoff-review-run.mjs 최종 회귀 정리
이 작업은 **기존 REVIEW-009 검토의 최종 회귀 정리**이며 새 독립 검토가 아니다.

- 결함 "FINDING 재현" 집계를 없앴다. F-1·F-1b·F-2·F-3을 **수정 후 기대 동작 단언**으로 바꿨다.

| 항목 | 단언 내용 |
|---|---|
| F-1 | 만료 뒤 같은 상태 재보고 → success=false·LEASE_EXPIRED·needs_check |
| F-1b | completed 재보고도 같음 |
| F-2 | 조건 해소 후 재요청 → requested 재설정 → 정상 선점. failed(전달됨)는 HANDOFF_EXISTS |
| F-3 | 토큰 철회 뒤 관리자 조회 → needs_check(LEASE_EXPIRED) 정리. 재요청은 HANDOFF_EXISTS |

- 데이터 격리: 그룹 9의 재설정 인계를 끝까지 처리하고, 그룹 10 전에 "요청자 A의 30분 이내 대기 요청 0건"을 단언한다.
- 결과: **101/101, exit 0**. 적용 080000 hash `6b750a38f4aa5e450dcc5eca45970130dee190143e254e5c416f7a1bd54cd392`. 적용 migration 000000~080000(9개).

## 2. A안 적용 화면
기준: `docs/design-options/AUTOPOST_DESIGN_A.html`, `AUTOPOST_DESIGN_COMPARISON.md`(사용자 선택 A, msg_95d6a1009def).

| 영역 | 적용 |
|---|---|
| 공통 셸(`console-shell.tsx`, `nav.ts`) | A안 구조: 경로·상태 줄("실제 게시 gate 닫힘" 칩) → 흰색 왼쪽 메뉴(브랜드 + **작업 공간**: 통합 개요·콘텐츠 보관함·예약·작업·미디어·권리 / **연결과 운영**: 연결·준비도·Blog 확장 연결) → 페이지 머리(eyebrow·h1·설명·대표 행동) → gate 안내 → 본문. 960px 이하에서는 접이식 메뉴. 글감·AI 생성·캠페인 같은 미구현 기능은 메뉴에 넣지 않았다 |
| 통합 개요 | "이야기 하나에서, 세 채널로" 히어로 + 단계 흐름(원문 작성 → 채널 초안 → 채널별 검토·승인 → 개별 실행 준비). 콘텐츠 보관함 패널(미연결)과 "원문을 고르면 보이는 것" 패널을 2열로, 채널별 방식 카드(채널 표식), 조치 필요·최근 작업(미연결) |
| 콘텐츠 보관함(`contents`) | 제목·설명·"새 원문(저장 준비 중)" 대표 행동, 기존 검색·필터(비활성)와 미연결 상태 |
| 원문(`contents/[id]`) | A안 대표 편집: 왼쪽 공통 원문(비활성 필드, "새 버전으로 저장" 비활성), 오른쪽 채널 초안·검토 목록(채널 표식 + 초안 열기) + 실행 준비 비교. 이 원문의 작업(미연결) |
| 채널 초안·승인·준비 비교·작업·대사·연결·미디어 | 새 셸 안에서 기존 기능 그대로. 경로 표시는 "콘텐츠 보관함"으로 통일 |
| Blog 확장 연결 | 메뉴 "연결과 운영 › Blog 확장 연결"로 승격(section=extension). 토큰 발급·목록·철회, 표시 세션, 불확실 안내, 준비 단계, gateNotice 등 **TOKEN-005·UX-FIX-008 기능 전부 유지** |
| `/admin` | 콘솔 진입 카드를 A안 히어로 톤(`dc-admin-entry`)으로. D1일 때만 보임 |
| `/me` | **DQ-04:** 승인 admin(D1)에게만 "관리" 진입 링크(`showAdminEntry`) |

**DQ 반영**

| ID | 내용 |
|---|---|
| DQ-01 | 콘솔 CSS 전체를 `.dc-console`(콘솔 main) 아래로 모아 특정성 (0,2,x)로 공통 `.ds-main h1/h2/h3/p`(0,1,1)를 의도적으로 이긴다. !important 없음. 공개 페이지에는 영향 없음 |
| DQ-02 | 필터와 편집 필드가 같은 font·padding·border·색 규칙을 공유한다 |
| DQ-03 | 700px 이하에서 채널 링크가 한 열, 폭 100%, 44px. 현재 채널은 aria-current와 스타일로 구분한다 |
| DQ-04 | /me 관리 진입(위 표) |
| DQ-05 | 대사 화면 상단에 결과 불명 경고를 둔다: 외부 게시가 됐을 수 있음, 확인 전 재게시 안 함, 조회 실패 ≠ 부재, 연결 복구 ≠ 대사 해소, 부재 뒤 재실행은 별도 승인. 미연결 상태의 안내임을 명시 |
| DQ-06 | 개발 의존성 목록을 접이식 "운영 진단"으로 내렸다. 비활성 사유에서 RPC·DB·M2·M4 같은 용어를 빼고 "준비 중" 문장으로 바꿨다 |
| DQ-07 | 상태 사전에 보조 축 표를 추가했다(게시 확인 + 구성 경고, 검토·최신성, 연결·기능 준비, 보류). "실제 작업 아님" 표시를 유지한다 |
| DQ-08 | 실행 상세의 주요 다음 행동을 44px `dc-action` 목록으로 바꾸고 "결과 불명이면 수동 게시로 우회하지 않음"을 표시했다 |

**유지한 원칙**
- 모든 콘솔 page는 D1 guard를 먼저 실행하고 force-dynamic이다(테스트로 고정).
- 거부 화면에는 메뉴·데이터가 없다.
- 서버 미연결 폼은 fieldset disabled + 사유. 가짜 데이터·건수·성과·캠페인이 없다.
- unknown 재게시·복제 CTA가 없다.
- 실제 토큰 관리(서버 준비 시 실제 결과)와 준비 전 게시 기능을 gateNotice로 구분한다.

## 3. 변경 파일
- **수정:** `web/src/components/distribution-console/console-shell.tsx`, `states.tsx`(Dependencies → 진단 details, ChannelMark, 보조 축 사전), `access.ts`(`showAdminEntry`)
- **신규:** `web/src/components/distribution-console/nav.ts`, `web/tests/distribution-server/console-design-a.test.ts`
- **수정:** `web/src/app/globals.css`(콘솔 블록을 A안 범위 CSS로 교체)
- **수정(`web/src/app/admin/distribution/`):**
  - `page.tsx`
  - `contents/page.tsx`, `contents/new/page.tsx`
  - `contents/[contentId]/page.tsx`, `contents/[contentId]/channels/[channel]/page.tsx`, `contents/[contentId]/channels/[channel]/review/page.tsx`, `contents/[contentId]/prepare/page.tsx`
  - `jobs/[jobId]/page.tsx`, `jobs/[jobId]/reconcile/page.tsx`, `jobs/[jobId]/manual/page.tsx`
  - `media/page.tsx`
  - `connections/blog-extension/page.tsx`
- **수정:** `web/src/app/admin/page.tsx`, `web/src/app/me/page.tsx`
- **수정:** `web/scripts/distribution-local-verify/handoff-review-run.mjs`
- **수정하지 않음:** SQL, 다른 러너, 도메인·확장·package

## 4. 실행 명령과 종료코드
| 명령 | 결과 |
|---|---|
| `node …/handoff-review-run.mjs --pglite-project %TEMP%\autopost-local-db-verify-002` | 0 — 101/101 |
| `npm.cmd test` | 0 — 17 files / **376 tests**(신규 `console-design-a.test.ts` 16개 포함) |
| `npm.cmd run lint` | 0 — 오류 0, 경고 3(확장 원본 `api`, 다른 작업자 `m2-run.mjs`의 `defect` 등) |
| `npm.cmd run typecheck` / `npm.cmd run build` | 0 / 0 |
| `next start -p 3012` 미인증 HTTP 확인 | 결과는 아래 참조. 확인 뒤 서버 종료 |

`console-design-a.test.ts`가 고정하는 내용:
- 메뉴 두 묶음과 순서. 모든 메뉴 경로에 실제 page.tsx가 존재. 미구현 기능은 메뉴에 없음.
- `showAdminEntry`는 승인 admin만 true.
- CSS 규칙이 전부 `.dc-console` 아래이고 !important 없음. DQ-02·DQ-03 규칙 존재.
- 모든 콘솔 page가 D1 guard를 먼저 실행하고 force-dynamic. 재게시·복제 버튼 문구 없음.

미인증 HTTP 확인 결과:
- `/admin`, `/admin/distribution`, `/contents`, `/contents/abc`, `/connections/blog-extension`: 200 + "관리자 확인이 필요합니다". 콘솔 메뉴 노출 0. `private, no-store`.
- `/me`: 로그인 필요.
- `GET /api/distribution/extension/whoami`, `POST …/task`, 잘못된 Bearer의 heartbeat: 401 + `WWW-Authenticate`. CORS 헤더 없음.

## 5. 한계(미검증)
- **승인 admin 실세션 렌더는 검증하지 못했다.** 계정·토큰을 쓰지 않는다는 조건 때문이다. 미인증 거부 화면만 HTTP로 확인했다. A안 셸과 화면의 실제 시각(1440·960·700·320px), 키보드 순회, 스크린리더, 대비, forced-colors는 브라우저로 실측하지 않았다.
- CSS 특정성은 선택자와 테스트로 확인했다. computed style 실측은 하지 않았다.
- 데이터 쓰기·조회는 이번 범위 밖이다. 모든 목록·원문·작업은 "운영 데이터 미연결" 상태다.

## 6. 다음 최소 작업 — 원문 저장 → 채널 초안 → 승인 연결
1. 실 Supabase에 M1·M2·050000 적용과 secret 키 등록(사용자 승인·조치).
2. 조회: `read.ts`
   - 보관함: contents + 현재 버전 title(명시 열, 사용자 세션 RLS)
   - 원문 상세: 현재 버전·이력·3채널 초안
   - 페이지별 `DATA_SOURCE_CONNECTED`를 실제 조회 결과(미연결·0건·오류 구분)로 교체
3. 서버 액션(이미 있는 write-runner·rpc-params 사용):
   - 원문 화면: A1 원문 생성, A2 새 버전(`expected_version_no` hidden)
   - 채널 화면: A3 초안 생성, A4 리비전(`expected_revision_no` + `expected_content_version_id`)
   - 검토 화면: A5·A6 승인(`expected_subject_hash` = 화면에 보인 해시), A7 철회(디자인 N6 철회 버튼 필요)
   - 성공하면 `revalidatePath` + notice. 충돌·stale·subject_changed는 §5 매핑 문구로 안내
4. 비활성 fieldset을 실제 폼으로 바꾸는 것은 해당 서버 액션과 조회가 연결된 화면부터 하나씩 한다. 승인 전에는 실행 준비 버튼을 계속 비활성으로 둔다.
5. 검증: 대역 DB에서 액션 → RPC 왕복, 승인 admin 세션으로 렌더 확인(허용되는 범위에서).

이 세션은 다음 지시를 위해 유지한다.
