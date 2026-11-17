# MKT-006 — 404 서버 렌더 결함 조사·복구

- 책임 CC-ENG-01 / Orca task_24ea77618645, dispatch ctx_8285def2b1d5 / 2026-11-16
- 상태: **ready_review** (시도 1회로 해결)

## 결과

- 재현: production에서 없는 story slug가 404·noindex는 맞지만, 원시 HTML이 `__next_error__` 빈 셸이라 JS 없이 빈 화면. `notFound()`만 부르는 최소 확인용 라우트에서도 재현됐고, 매칭되지 않는 경로(`/nope`)는 정상이었다.
- 원인(설치본 소스): `next/dist/server/app-render/app-render.js` errorRecovery → `getErrorRSCPayload`가 빈 `<html id="__next_error__">` 셸을 만들고 not-found UI는 클라이언트가 그린다. 코드 경로와 재현은 확인했고, 서버 렌더에서 클라이언트 오류 경계가 잡지 못하는 이유는 추정이다.
- 수정: `web/src/app/stories/[slug]/page.tsx`만 변경. `force-dynamic` 제거, `dynamicParams = false` + `generateStaticParams`(공개 판정 통과 글만, 현재 0개). 근거는 설치본 dynamicParams 문서. 상태 404·noindex·비공개 글 비노출 유지, 가짜 200·JS 강제 없음. 의존성·Next 버전 변경 없음.
- 트레이드오프: 공개 글 목록이 빌드 시점에 확정되므로 예약 게시·공개 변경은 재빌드해야 한다. 저장소를 DB/CMS로 바꿀 때 재검토 필요.

## 검증

| 항목 | 결과 |
|---|---|
| `npm.cmd run build` | exit 0, `/stories/[slug]` ● SSG(0 경로) |
| `npm.cmd run typecheck` (build 후) | exit 0 |
| `npm.cmd test` | exit 0, 8 files / **110 tests** (+3 라우트 설정 회귀) |
| `npm.cmd run lint` | exit 0 |
| 원시 HTML (`docs/qa/MKT-006/check-raw-html.mjs`, `<script>` 제거 후 계산) | 없는 slug 3종·/nope: 404, 오류 셸 없음, main 1, h1, 복구 링크 2, #contact, noindex, private no-store. 정상 경로 SSR·개인 경로 캐시 헤더 유지 → `after-attempt1.json` |
| JS 끈 실제 브라우저(Ego Lite, CDP로 스크립트 비활성) | 404 제목·홈으로·이야기 목록·문의와 정책 표시 → `js-off-story-404.png`. JS를 켠 상태도 정상 |

## 변경 파일

- `web/src/app/stories/[slug]/page.tsx`
- `web/tests/content/story-route-config.test.ts`
- `docs/qa/MKT-006/README.md`, `check-raw-html.mjs`, `after-attempt1.json`, `js-off-story-404.png`
- 확인용 라우트는 만들지 않았다(MKT-004 때 만든 것은 이미 삭제). components/styles/lib/distribution/package/lockfile/DB 미변경. 저장소는 빈 상태 유지.

## 남은 점

1. 다른 라우트에서 렌더 중 `notFound()`를 쓰면 같은 빈 셸이 나온다. 앞으로 동적 라우트는 라우팅 단계 404(`dynamicParams=false`)나 존재 확인을 먼저 하는 구조를 쓰는 것을 권장한다.
2. `stories/not-found.tsx`는 지금 라우팅 404에서 쓰이지 않는다(루트 not-found 사용). 방어용으로 남겼고, 지울지는 Master가 판단.
3. 근본 동작이 Next 버그인지 의도된 설계인지는 확정하지 않았다. 필요하면 Next 이슈 확인이나 버전 업그레이드 검토(Master 결정).
