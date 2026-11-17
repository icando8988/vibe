# MKT-004 — 공개 콘텐츠 읽기 기반

- 책임 CC-ENG-01 / Orca task_369fc5e8b710, dispatch ctx_fd4105109f1e / 2026-11-16
- 상태: **ready_review**
- 입력: .ai/tasks/MKT-004-CC-ENG-01.md, docs/MARKETING_DELIVERY_PLAN.md, MKT-003 모델, DEV-002B 보고(APP-002B-01)
- DEV-003: Master 지시대로 DB 실행기 미도입·미실행 상태 유지.

## 변경 (허용 범위만)

- `web/src/lib/content/` — `types.ts`(StoryRecord 내부 / PublicStorySummary·PublicStory 공개 투영, source refs, draft/reviewed/published), `visibility.ts`(공개 판정 9가지 사유, slug 형식), `render.ts`(텍스트→단락, 제어·양방향 문자 제거, 설명 요약), `repository.ts`(StoryRepository 인터페이스, 메모리 구현, **앱 기본 저장소는 빈 배열**), `metadata.ts`(noindex 유지, https 사이트 주소가 있을 때만 canonical/OG url, `siteBaseUrlFromEnv`, Asia/Seoul 날짜), `index.ts`
- `web/src/app/stories/page.tsx` — 목록. 지금은 정직한 빈 상태 + 소개/참여 안내 링크
- `web/src/app/stories/[slug]/page.tsx` — 상세. `cache()`로 metadata·본문 조회 1회, 형식 오류·미게시·없음 → `notFound()`, 단락 텍스트 렌더, 출처 라벨
- `web/src/app/stories/not-found.tsx` — 이야기 전용 404(비공개 글 존재 여부를 구별하지 않음)
- APP-002B-01 수정: `login/page.tsx`(문장 속 링크 → 별도 줄 `ds-text-link`), `me/page.tsx`(→ `ds-button ds-button--secondary`), `not-found.tsx`(→ `ds-actions` 안 버튼 + 텍스트 링크, /books 대신 /stories)
- `web/tests/content/content.test.ts` — 21개 시험
- `docs/CONTENT_WORKFLOW.md`
- components/styles/package/lockfile/DB/배포 공통 로직(lib/distribution) 미변경. 새 CSS 클래스 없이 기존 ds-* 클래스만 사용.

## 검증 (D:/Vibe/web)

| 명령 | 결과 |
|---|---|
| `npm.cmd run typecheck` | exit 0 |
| `npm.cmd test` | exit 0, 7 files / **107 tests** (기존 86 + 콘텐츠 21) |
| `npm.cmd run lint` | **exit 0** (DEV-002B 링크 수정 반영 후 전체 통과) |
| `npm.cmd run build` | exit 0. `/stories`, `/stories/[slug]` 동적 |
| `next start` + curl | `/stories` 200·main 1·h1 1·noindex·canonical/og:url 없음·빈 상태 문구. `/stories/{없음 \| Bad_Slug \| %3Cscript%3E}` 404·noindex |
| Ego Lite 브라우저 실측 | `/stories/missing-one`: main 1, h1 "이야기를 찾을 수 없습니다", #contact 있음, robots "noindex, nofollow". 링크 높이: /stories 62·44px, /me 62px, /login 44px, /nope 62·44px(이전 24px) |

시험 범위: 공개/초안/reviewed/공개 미허용/검토 없음/출처 없음/출처 미확인/미래 게시/잘못된 slug/빈 본문, 기본 저장소 빈 상태, 목록 정렬·내부 정보 제외, slug 경로 조작(`../etc/passwd`) 거절, 중복 slug 거절, `<script>`·`onerror` 본문 이스케이프(renderToStaticMarkup), metadata noindex·canonical 조건.

## 발견 사항

| ID | 내용 | 처리 |
|---|---|---|
| MKT-004-01 · P3 (프레임워크 동작) | 이 앱에서 `notFound()`를 부르는 모든 라우트(최소 확인용 정적·동적 라우트 포함)가 서버 HTML로 `__next_error__` 셸을 보내고 not-found UI는 클라이언트에서 그린다. 상태 404·noindex는 정상. 브라우저(JS)에서는 정상 표시 확인. JS 없는 클라이언트에는 빈 화면 | 제 라우트 코드와 무관함을 확인용 라우트로 재현(검증 후 삭제). Next 16.4.6 동작 추정 — 원인 확정은 안 함. 공개 전 Master가 수용/조사 판단 |
| MKT-004-02 · 참고 | 라우트를 지운 뒤 `npm run build` 전에 typecheck를 돌리면 `.next/types/validator.ts`에 남은 옛 경로로 실패. build 후 재실행 exit 0 | 통합 검증 순서: build → typecheck 권장 |

## 남은 입력 / 후속

1. 실제 승인된 원문(제목·요약·본문·출처·검토자·공개 허용·게시 시각). 그 전까지 `/stories`는 빈 상태.
2. 원문 저장 방식(파일/DB/CMS) 결정 → `StoryRepository` 구현 교체.
3. 공개 사이트 주소(`NEXT_PUBLIC_SITE_URL`) 확정 시 canonical/OG 자동 생성.
4. 헤더·홈에서 /stories로 가는 진입 링크는 UI(Design) 범위. 현재 홈의 "이야기" 버튼은 `#stories` 앵커.
