# 콘텐츠 작업 흐름

MKT-004 · CC-ENG-01 · 2026-11-16. 관련 코드: `web/src/lib/content`(공개 읽기), `web/src/lib/distribution`(채널 배포, MKT-003).

## 흐름

```
원문 작성(StoryRecord: draft)
  → 사실 확인·출처 대조(sourceRefs[].verified) → 검토 기록(review.reviewedAt) → status: reviewed
  → 운영자 공개 허용(publicationApproved) + 게시 시각(publishedAt) → status: published
  → 사이트 /stories/[slug] 공개 (decideVisibility 통과 시에만)
  → 배포 원문(distribution ContentItem) 생성: id를 StoryRecord.distributionContentId에 기록
  → 채널 초안(ChannelDraft: blog/threads/instagram) → 검토 승인 → PublishJob(예약·멱등키)
  → 어댑터 게시 → 결과(published는 외부 식별자 필수, unknown은 대사 후 처리)
  → 게시물 링크 = /stories/[slug] + UTM (공개 사이트 주소 확정 후에만 생성)
  → 방문·유효 행동 확인(MKT 7단계)
```

## 공개 조건 (하나라도 빠지면 목록·상세 모두 제외, 상세는 404)

| 조건 | 필드 |
|---|---|
| 형식에 맞는 slug(소문자·숫자·하이픈, 80자 이하) | `slug` |
| 게시 상태 | `status === "published"` (draft·reviewed는 비공개) |
| 운영자 공개 허용 | `publicationApproved` |
| 검토 기록 | `review.reviewedAt` |
| 출처 1개 이상, 전부 확인됨 | `sourceRefs`, `verified` |
| 게시 시각이 지금 이전 | `publishedAt` (미래면 예약으로 숨김) |
| 제목·본문 존재 | `title`, `body` |

공개 응답에는 검토자·공개 허용 플래그·출처 확인 상태 같은 내부 정보를 넣지 않는다(`PublicStory` 투영).

## 본문 규칙

- 일반 텍스트. 빈 줄로 단락을 나눈다. HTML·마크다운을 해석하지 않으며 React 텍스트로 렌더해 자동 이스케이프한다(`dangerouslySetInnerHTML` 미사용).
- 제어문자·양방향 제어문자는 제거한다.
- 계획은 계획으로 쓴다. 실제 완료한 여행·인증·사진·성과처럼 쓰지 않는다. 사진·이력은 권리·공개 동의 확인 뒤에만.

## 배포 원문과의 관계

- `StoryRecord`(사이트 공개 원문)와 `ContentItem`(배포 원문)은 별개 타입이다. 이번 작업에서 배포 타입은 바꾸지 않았다.
- 연결은 `StoryRecord.distributionContentId → ContentItem.id` 단방향 참조. `ContentItem.targetPath`는 `/stories/{slug}`를 쓴다.
- 이야기 본문이 바뀌면 `ContentItem.version`을 올려야 하며, 옛 버전으로 만든 채널 초안은 배포 단계에서 `STALE_DRAFT`로 거절된다.

## metadata·색인

- 사이트 전체 noindex는 공개 승인(RELEASE) 전까지 유지. 이야기 상세도 `robots: noindex, nofollow`.
- canonical·OG `url`은 `NEXT_PUBLIC_SITE_URL`에 https 주소가 들어온 경우에만 만든다. 지금은 비어 있어 만들지 않는다.
- 외부 분석·추적 스크립트 없음.

## 현재 상태

- 저장소는 **명시적 빈 저장소**(`APPROVED_STORIES = []`). 실제 승인된 원문이 없어 `/stories`는 빈 상태 안내를 보여준다. 시험용 fixture는 `tests/content`에만 있다.
- **상세 페이지는 빌드 시점에 확정된다**(MKT-006). `/stories/[slug]`는 `dynamicParams = false` + `generateStaticParams`로, 빌드할 때 공개 판정을 통과한 글만 경로가 생기고 나머지는 라우팅 404다. 따라서:
  - 글 추가·수정·비공개 전환은 재빌드(재배포)해야 반영된다.
  - `publishedAt`을 미래로 둔 예약 글은 그 시각이 지나도 **자동으로 열리지 않는다.** 시각이 지난 뒤 재빌드해야 한다.
  - 목록(`/stories`)은 요청마다 판정하므로, 재빌드 전에 목록에는 보이지만 상세는 404인 상태가 생길 수 있다. 현재 저장소가 코드에 들어 있어(배포해야 내용이 바뀜) 실제로는 생기지 않지만, 저장소를 외부로 옮기면 생긴다.
  - 이유: 페이지 렌더 중 `notFound()`는 Next 16.4.6에서 JS 없이 빈 화면(오류 셸)이 된다. 근거·재현은 `docs/qa/MKT-006/README.md`.
- 원문 저장 위치(파일/DB/CMS)는 미정. 결정되면 `StoryRepository` 구현을 바꾸고, **그때 위 빌드 고정 방식(ISR revalidate, 배포 훅 등)과 예약 게시 연동을 다시 정한다.**

## 필요한 입력

1. **실제 승인된 원문**: 제목·요약·본문, 출처 목록(무엇을 근거로 썼는지), 검토자, 공개 허용 여부, 게시 시각. 첫 주제 가설: 도전의 목적·출발 전 준비·여정 계획·기록을 책으로 나누는 이유.
2. 공개 사이트 주소(canonical·UTM용).
3. 원문 저장 방식 결정(Master).

## 자동포스팅 프로그램 수령 시 확인할 것

- 저장: 프로그램이 원문·초안·게시 결과를 어디에 저장하는지, 이 흐름의 StoryRecord/ContentItem/PublishJob과 어떻게 대응하는지.
- 인증: 계정별 토큰/세션 저장 방식과 위치(값은 보지 않음), 갱신, 최소 권한.
- 게시 검증: 게시 결과로 외부 식별자/URL을 받을 수 있는지(`published` 근거), 응답 유실 시 게시 여부 조회 가능 여부, 중복 방지·재시도·예약 방식.
- 세부 양식은 `docs/AUTOPOST_IMPORT_ANALYSIS.md`.
