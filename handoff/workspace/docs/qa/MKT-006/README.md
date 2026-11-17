# MKT-006 404 서버 렌더 점검

2026-11-16 · CC-ENG-01 · Next.js 16.4.6 (Turbopack), production `next build` + `next start`.

## 재현 (수정 전, MKT-004 시점)

`/stories/{missing-one | Bad_Slug | %3Cscript%3E}` → 상태 404, `<meta name="robots" content="noindex">` 있음. 그러나 원시 HTML은 `<html id="__next_error__"><head>…</head><body></body>` + 스크립트뿐(`<main>`·h1·푸터 없음). JS를 켠 브라우저에서만 not-found UI가 그려짐.
최소 재현: `notFound()`만 호출하는 정적/동적 확인용 라우트도 똑같이 빈 셸 → 해당 라우트 코드와 무관(확인 후 삭제). 반면 매칭되지 않는 경로 `/nope`는 미리 렌더된 `/_not-found` HTML이 정상으로 나갔다.

## 원인 (설치본 소스로 확인한 범위)

- `node_modules/next/dist/server/app-render/app-render.js` renderToStream의 errorRecovery 분기: SSR 셸 렌더 중 HTTP access fallback(notFound) 오류가 올라오면 상태를 404로 바꾸고 `getErrorRSCPayload`로 응답을 다시 만든다.
- `getErrorRSCPayload`(같은 파일 1286행 부근)는 루트 렌더 결과로 `createElement('html', { id: '__next_error__' }, head, body)`인 **빈 오류 셸**을 넣는다. 화면은 클라이언트 AppRouter가 RSC 데이터로 not-found 경계를 그려서 채운다.
- 확인한 것: 위 코드 경로와, 페이지 렌더 중 notFound()가 이 분기로 간다는 재현 결과. **추정:** 서버 렌더(Fizz)에서 클라이언트 오류 경계(HTTPAccessFallbackBoundary)가 오류를 잡지 못해 셸 오류가 되는 것. React/Next 내부 설계 의도까지는 확정하지 않았다.

## 수정 (최소)

`web/src/app/stories/[slug]/page.tsx`: `force-dynamic` 제거, `export const dynamicParams = false` + 공개 판정을 통과한 글로 `generateStaticParams`.
근거: 설치본 문서 `docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/dynamicParams.md` — "`false`: Dynamic route segments not included in `generateStaticParams` will return a 404." 라우팅 단계 404는 `/nope`와 같은 미리 렌더된 not-found HTML을 쓴다. Cache Components는 켜져 있지 않으므로 사용 가능.

영향: 공개 글 목록이 빌드 시점에 확정된다. 예약 게시·공개 변경은 재빌드(재배포)해야 반영된다. 지금 저장소는 코드에 들어 있는 빈 배열이라 어차피 배포가 필요하다. 저장소를 DB/CMS로 바꿀 때 ISR(revalidate) 또는 다른 방식 재검토가 필요하다. 페이지 안의 `notFound()`와 `stories/not-found.tsx`는 방어용으로 남겼다(라우팅 404에서는 루트 not-found가 쓰인다).

## 수정 후 결과

- `after-attempt1.json`: `node check-raw-html.mjs http://localhost:3316` 결과. 없는 slug 3종·`/nope`: 404, 오류 셸 없음, `<main>` 1, h1 "페이지를 찾을 수 없습니다", main 안 링크 2(홈으로·이야기 목록), `#contact`, robots `noindex`, `Cache-Control: private, no-cache, no-store`. `/`·`/stories`·`/me`·`/admin`·`/login` 정상 SSR, 개인 경로 `private, no-store` 유지.
- `js-off-story-404.png`: Ego Lite에서 `Emulation.setScriptExecutionDisabled`로 JS를 끈 상태의 `/stories/missing-one`. 접근성 스냅샷에서 404 제목·홈으로·이야기 목록·문의와 정책 확인. JS를 다시 켠 상태도 main 1·h1 정상.

## 재실행

```powershell
cd D:\Vibe\web; npm.cmd run build; npm.cmd run start -- -p 3316
node D:\Vibe\docs\qa\MKT-006\check-raw-html.mjs http://localhost:3316
```
