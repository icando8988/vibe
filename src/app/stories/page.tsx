import type { Metadata } from "next";
import Link from "next/link";
import { StatusNotice } from "../../components/status-notice";
import { formatKoreanDate, getStoryRepository } from "@/lib/content";
import { PageMain } from "../_components/page-main";

export const metadata: Metadata = {
  title: "이야기",
  description: "도전의 목적과 준비 과정을 기록하는 이야기 목록",
};

// 승인 원문이 연결되면 게시 시각 판단을 요청 시점에 하도록 동적 렌더.
export const dynamic = "force-dynamic";

export default async function StoriesPage() {
  const stories = await getStoryRepository().listPublished(new Date());

  return (
    <PageMain eyebrow="이야기" title="이야기">
      {stories.length === 0 ? (
        <section aria-label="공개된 이야기 없음">
          <StatusNotice title="아직 공개된 이야기가 없습니다">
            <p>
              도전의 목적과 출발 전 준비를 담은 글은 사실 확인과 공개 동의를 마친 뒤 이곳에 올립니다. 지금 보이는 글이 없는 것은
              아직 공개 승인된 글이 없기 때문입니다.
            </p>
          </StatusNotice>
          <div className="ds-actions">
            <Link className="ds-button ds-button--secondary" href="/about">
              도전 이야기 소개 읽기
            </Link>
            <Link className="ds-text-link" href="/how-it-works">
              참여 안내 <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      ) : (
        <ol>
          {stories.map((s) => (
            <li key={s.slug}>
              <article aria-labelledby={`story-${s.slug}`}>
                <h2 id={`story-${s.slug}`}>
                  <Link className="ds-text-link" href={`/stories/${s.slug}`}>
                    {s.title}
                  </Link>
                </h2>
                <p>{s.summary}</p>
                <p className="ds-muted">
                  <time dateTime={s.publishedAt}>{formatKoreanDate(s.publishedAt)}</time> · {s.authorLabel}
                </p>
              </article>
            </li>
          ))}
        </ol>
      )}
    </PageMain>
  );
}
