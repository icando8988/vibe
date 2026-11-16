/**
 * 공개 조회 허용 판정. 하나라도 빠지면 공개 목록·상세에서 제외한다.
 */
import type { StoryRecord } from "./types";

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 80;

export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === "string" && slug.length <= MAX_SLUG && SLUG_PATTERN.test(slug);
}

export type HiddenReason =
  | "invalid_slug"
  | "not_published"
  | "not_approved"
  | "not_reviewed"
  | "no_sources"
  | "unverified_source"
  | "no_published_at"
  | "scheduled_future"
  | "empty_content";

export type VisibilityDecision = { visible: true } | { visible: false; reason: HiddenReason };

export function decideVisibility(story: StoryRecord, now: Date): VisibilityDecision {
  if (!isValidSlug(story.slug)) return { visible: false, reason: "invalid_slug" };
  if (story.status !== "published") return { visible: false, reason: "not_published" };
  if (!story.publicationApproved) return { visible: false, reason: "not_approved" };
  if (!story.review.reviewedAt || Number.isNaN(Date.parse(story.review.reviewedAt))) {
    return { visible: false, reason: "not_reviewed" };
  }
  if (story.sourceRefs.length === 0) return { visible: false, reason: "no_sources" };
  if (story.sourceRefs.some((s) => !s.verified)) return { visible: false, reason: "unverified_source" };
  if (!story.publishedAt) return { visible: false, reason: "no_published_at" };
  const published = Date.parse(story.publishedAt);
  if (Number.isNaN(published)) return { visible: false, reason: "no_published_at" };
  if (published > now.getTime()) return { visible: false, reason: "scheduled_future" };
  if (story.title.trim() === "" || story.body.trim() === "") return { visible: false, reason: "empty_content" };
  return { visible: true };
}
