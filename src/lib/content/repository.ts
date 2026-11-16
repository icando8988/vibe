/**
 * 공개 콘텐츠 저장소. 공개 조회 경로는 decideVisibility를 통과한 글만, 내부 열을 뺀 투영으로 돌려준다.
 * 현재는 실제 승인된 글이 없어 명시적 빈 저장소를 쓴다(외부 네트워크·DB 연결 없음).
 */
import { toParagraphs } from "./render";
import type { PublicStory, PublicStorySummary, StoryRecord } from "./types";
import { decideVisibility, isValidSlug } from "./visibility";

export interface StoryRepository {
  /** 공개 글 목록. 최신 publishedAt 순 */
  listPublished(now: Date): Promise<PublicStorySummary[]>;
  /** 공개 글 상세. 없거나 비공개·형식 오류면 null */
  getPublishedBySlug(slug: string, now: Date): Promise<PublicStory | null>;
}

function toSummary(s: StoryRecord): PublicStorySummary {
  return {
    slug: s.slug,
    title: s.title,
    summary: s.summary,
    publishedAt: s.publishedAt as string,
    authorLabel: s.authorLabel,
  };
}

function toPublic(s: StoryRecord): PublicStory {
  return {
    ...toSummary(s),
    paragraphs: toParagraphs(s.body),
    sourceLabels: s.sourceRefs.map((r) => r.label),
    updatedAt: s.updatedAt,
  };
}

/** 메모리 저장소. 시험·향후 승인 원문 연결 전 단계에서 사용 */
export function createInMemoryStoryRepository(records: readonly StoryRecord[]): StoryRepository {
  const bySlug = new Map<string, StoryRecord>();
  for (const r of records) {
    if (bySlug.has(r.slug)) throw new Error(`duplicate story slug: ${r.slug}`);
    bySlug.set(r.slug, r);
  }
  return {
    async listPublished(now) {
      return [...bySlug.values()]
        .filter((r) => decideVisibility(r, now).visible)
        .sort((a, b) => Date.parse(b.publishedAt as string) - Date.parse(a.publishedAt as string))
        .map(toSummary);
    },
    async getPublishedBySlug(slug, now) {
      if (!isValidSlug(slug)) return null;
      const r = bySlug.get(slug);
      if (!r || !decideVisibility(r, now).visible) return null;
      return toPublic(r);
    },
  };
}

/**
 * 앱이 쓰는 저장소. 실제 승인된 원문이 생기기 전까지 비어 있다.
 * 시험용 fixture를 여기에 넣지 않는다.
 */
const APPROVED_STORIES: readonly StoryRecord[] = [];

let current: StoryRepository | null = null;

export function getStoryRepository(): StoryRepository {
  current ??= createInMemoryStoryRepository(APPROVED_STORIES);
  return current;
}
