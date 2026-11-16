/**
 * 이야기 metadata 구성. Next Metadata 타입에 의존하지 않는 순수 객체를 돌려주고 라우트에서 그대로 쓴다.
 * - 사이트 전체 noindex(공개 승인 전)를 해제하지 않는다.
 * - 공개 사이트 주소가 정해지지 않으면 canonical·OG url을 만들지 않는다.
 */
import { toPlainDescription } from "./render";
import type { PublicStory } from "./types";

export interface StoryMetadata {
  title: string;
  description: string;
  robots: { index: false; follow: false };
  alternates?: { canonical: string };
  openGraph: {
    type: "article";
    title: string;
    description: string;
    publishedTime: string;
    modifiedTime: string;
    url?: string;
  };
}

export function buildStoryMetadata(story: PublicStory, siteBaseUrl: string | null): StoryMetadata {
  const description = toPlainDescription(story.summary || story.paragraphs[0] || "");
  const meta: StoryMetadata = {
    title: story.title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: "article",
      title: story.title,
      description,
      publishedTime: story.publishedAt,
      modifiedTime: story.updatedAt,
    },
  };
  const absolute = absoluteStoryUrl(siteBaseUrl, story.slug);
  if (absolute) {
    meta.alternates = { canonical: absolute };
    meta.openGraph.url = absolute;
  }
  return meta;
}

/** 확정된 https 기준 URL이 있을 때만 절대 주소. 아니면 null */
export function absoluteStoryUrl(siteBaseUrl: string | null, slug: string): string | null {
  if (!siteBaseUrl) return null;
  try {
    const base = new URL(siteBaseUrl);
    if (base.protocol !== "https:" || base.username || base.password) return null;
    return new URL(`/stories/${encodeURIComponent(slug)}`, base.origin).toString();
  } catch {
    return null;
  }
}

/**
 * 공개 사이트 기준 URL. 운영 주소가 확정돼 NEXT_PUBLIC_SITE_URL에 https 값이 들어오기 전에는 null.
 * (값을 지어내지 않는다)
 */
export function siteBaseUrlFromEnv(): string | null {
  const v = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u.origin : null;
  } catch {
    return null;
  }
}

/** 날짜 표시(Asia/Seoul) */
export function formatKoreanDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }).format(d);
}
