/**
 * 공개 콘텐츠 읽기 기반 시험. 아래 레코드는 시험 전용 fixture이며 앱 저장소에 넣지 않는다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  absoluteStoryUrl,
  buildStoryMetadata,
  createInMemoryStoryRepository,
  decideVisibility,
  getStoryRepository,
  isValidSlug,
  toParagraphs,
  type StoryRecord,
} from "@/lib/content";

const NOW = new Date("2026-11-16T03:00:00Z");

function record(over: Partial<StoryRecord> = {}): StoryRecord {
  return {
    slug: "test-fixture-story",
    title: "시험용 제목",
    summary: "시험용 요약",
    body: "첫 단락\n\n둘째 단락",
    sourceRefs: [{ label: "시험 출처", kind: "document", verified: true }],
    status: "published",
    publicationApproved: true,
    review: { reviewerLabel: "internal-reviewer", reviewedAt: "2026-11-15T00:00:00Z" },
    publishedAt: "2026-11-15T01:00:00Z",
    authorLabel: "시험 작성자",
    distributionContentId: null,
    updatedAt: "2026-11-15T01:00:00Z",
    ...over,
  };
}

describe("공개 허용 판정", () => {
  it("모든 조건 충족 시에만 공개", () => {
    expect(decideVisibility(record(), NOW)).toEqual({ visible: true });
  });

  it.each([
    ["draft", { status: "draft" as const }, "not_published"],
    ["reviewed(미게시)", { status: "reviewed" as const }, "not_published"],
    ["공개 미허용", { publicationApproved: false }, "not_approved"],
    ["검토 기록 없음", { review: { reviewerLabel: null, reviewedAt: null } }, "not_reviewed"],
    ["출처 없음", { sourceRefs: [] }, "no_sources"],
    ["출처 미확인", { sourceRefs: [{ label: "x", kind: "other" as const, verified: false }] }, "unverified_source"],
    ["게시 시각 없음", { publishedAt: null }, "no_published_at"],
    ["예약(미래) 게시", { publishedAt: "2026-11-17T00:00:00Z" }, "scheduled_future"],
    ["잘못된 slug", { slug: "Bad Slug" }, "invalid_slug"],
    ["빈 본문", { body: "   " }, "empty_content"],
  ])("%s → 비공개", (_label, over, reason) => {
    expect(decideVisibility(record(over), NOW)).toEqual({ visible: false, reason });
  });
});

describe("저장소", () => {
  it("앱 기본 저장소는 비어 있다(fixture를 공개 글처럼 넣지 않음)", async () => {
    const repo = getStoryRepository();
    expect(await repo.listPublished(NOW)).toEqual([]);
    expect(await repo.getPublishedBySlug("test-fixture-story", NOW)).toBeNull();
  });

  it("목록은 공개 글만, 최신순, 내부 검토 정보 제외", async () => {
    const repo = createInMemoryStoryRepository([
      record({ slug: "older", publishedAt: "2026-11-10T00:00:00Z" }),
      record({ slug: "newer", publishedAt: "2026-11-14T00:00:00Z" }),
      record({ slug: "hidden-draft", status: "draft" }),
      record({ slug: "unverified", sourceRefs: [{ label: "x", kind: "other", verified: false }] }),
    ]);
    const list = await repo.listPublished(NOW);
    expect(list.map((s) => s.slug)).toEqual(["newer", "older"]);
    const json = JSON.stringify(list);
    expect(json).not.toContain("internal-reviewer");
    expect(json).not.toContain("publicationApproved");
    expect(json).not.toContain("verified");
  });

  it("상세: 미게시·없는 slug·잘못된 slug는 null", async () => {
    const repo = createInMemoryStoryRepository([record(), record({ slug: "draft-one", status: "draft" })]);
    expect(await repo.getPublishedBySlug("test-fixture-story", NOW)).not.toBeNull();
    expect(await repo.getPublishedBySlug("draft-one", NOW)).toBeNull();
    expect(await repo.getPublishedBySlug("missing", NOW)).toBeNull();
    expect(await repo.getPublishedBySlug("../etc/passwd", NOW)).toBeNull();
  });

  it("slug 중복 레코드는 거절", () => {
    expect(() => createInMemoryStoryRepository([record(), record()])).toThrow();
  });

  it("slug 형식", () => {
    expect(isValidSlug("why-we-ride-2029")).toBe(true);
    for (const bad of ["", "UPPER", "a--b", "-a", "a_b", "한글", "a/b", "x".repeat(81)]) expect(isValidSlug(bad)).toBe(false);
  });
});

describe("본문 안전 렌더", () => {
  it("빈 줄로 단락 분리, CRLF·여분 공백 정리", () => {
    expect(toParagraphs("a\r\n\r\n\r\nb  \nc\n\n  ")).toEqual(["a", "b\nc"]);
  });

  it("제어문자·양방향 제어문자 제거", () => {
    expect(toParagraphs("a\u0000b‮c⁦d")).toEqual(["abcd"]);
  });

  it("악성 HTML은 텍스트로 이스케이프되어 렌더된다", async () => {
    const repo = createInMemoryStoryRepository([
      record({ body: '<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">' }),
    ]);
    const story = await repo.getPublishedBySlug("test-fixture-story", NOW);
    expect(story).not.toBeNull();
    const html = renderToStaticMarkup(
      createElement("div", null, ...(story?.paragraphs ?? []).map((p, i) => createElement("p", { key: i }, p))),
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("metadata", () => {
  it("사이트 주소 미확정이면 canonical·OG url 없음, noindex 유지", async () => {
    const story = await createInMemoryStoryRepository([record()]).getPublishedBySlug("test-fixture-story", NOW);
    if (!story) throw new Error("fixture");
    const meta = buildStoryMetadata(story, null);
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
    expect(meta.openGraph.url).toBeUndefined();
    expect(meta.description).toBe("시험용 요약");
  });

  it("확정된 https 주소가 있을 때만 절대 주소", async () => {
    expect(absoluteStoryUrl("https://example.invalid", "a-b")).toBe("https://example.invalid/stories/a-b");
    expect(absoluteStoryUrl("http://example.invalid", "a")).toBeNull();
    expect(absoluteStoryUrl("https://u:p@example.invalid", "a")).toBeNull();
    expect(absoluteStoryUrl("not a url", "a")).toBeNull();
    const story = await createInMemoryStoryRepository([record()]).getPublishedBySlug("test-fixture-story", NOW);
    if (!story) throw new Error("fixture");
    const meta = buildStoryMetadata(story, "https://example.invalid");
    expect(meta.alternates?.canonical).toBe("https://example.invalid/stories/test-fixture-story");
    expect(meta.robots.index).toBe(false);
  });
});
