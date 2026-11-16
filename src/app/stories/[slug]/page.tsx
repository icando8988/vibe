import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { buildStoryMetadata, formatKoreanDate, getStoryRepository, isValidSlug, siteBaseUrlFromEnv } from "@/lib/content";
import { PageMain } from "../../_components/page-main";

/*
 * 없는·비공개 slug는 라우팅 단계에서 404로 처리한다(dynamicParams=false).
 * 이유(MKT-006): Next 16.4.6에서 페이지 렌더 중 notFound()가 나면 오류 복구 셸
 * (server/app-render getErrorRSCPayload → <html id="__next_error__"> 빈 body)만 보내고
 * not-found UI는 클라이언트에서 그린다 → JS 없이 빈 화면. 라우팅 404는 미리 렌더된
 * /_not-found HTML을 그대로 보낸다(상태 404, noindex 유지).
 * 영향: 공개 글 목록은 빌드 시점에 확정된다. 예약 게시·공개 변경은 재빌드(재배포)해야 반영된다.
 * 아래 notFound()는 방어용으로 남긴다.
 */
export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const stories = await getStoryRepository().listPublished(new Date());
  return stories.map((s) => ({ slug: s.slug }));
}

// generateMetadata와 페이지가 같은 조회를 한 번만 하도록 메모이즈.
const loadStory = cache(async (slug: string) => {
  if (!isValidSlug(slug)) return null;
  return getStoryRepository().getPublishedBySlug(slug, new Date());
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const story = await loadStory(slug);
  if (!story) notFound();
  return buildStoryMetadata(story, siteBaseUrlFromEnv());
}

export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const story = await loadStory(slug);
  if (!story) notFound();

  return (
    <PageMain eyebrow="이야기" title={story.title}>
      <p className="ds-muted">
        <time dateTime={story.publishedAt}>{formatKoreanDate(story.publishedAt)}</time> · {story.authorLabel}
      </p>
      {story.summary ? <p className="ds-lead">{story.summary}</p> : null}
      {story.paragraphs.map((p, i) => (
        // 단락은 순서가 고정된 정적 본문이라 인덱스 key가 안정적이다.
        <p key={i}>{p}</p>
      ))}
      {story.sourceLabels.length > 0 ? (
        <section aria-labelledby="story-sources">
          <h2 id="story-sources">출처</h2>
          <ul>
            {story.sourceLabels.map((label, i) => (
              <li key={`${i}-${label}`}>{label}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="ds-actions">
        <Link className="ds-text-link" href="/stories">
          <span aria-hidden="true">←</span> 이야기 목록
        </Link>
      </div>
    </PageMain>
  );
}
