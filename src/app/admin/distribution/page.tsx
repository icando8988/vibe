import Link from "next/link";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { CONTENT_FLOW } from "@/components/distribution-console/nav";
import { ChannelCards } from "@/components/distribution-console/states";
import { ReadStateNotice } from "@/components/distribution-console/write-notice-view";
import { loadContentList } from "@/server/distribution/content-page";
import type { Channel } from "@/lib/distribution/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "SNS 관리" };

const connectionHref: Record<Channel, string> = {
  blog: "/admin/distribution/connections/blog-extension",
  threads: "/admin/distribution/connections/threads",
  instagram: "/admin/distribution/connections/instagram",
};

export default async function DistributionOverviewPage() {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const listed = await loadContentList();

  return (
    <ConsoleShell
      section="overview"
      isRoot
      title="SNS 관리"
      description="Threads, Instagram, 네이버 블로그의 원고와 채널별 초안을 작성하고 게시 작업을 관리합니다."
      actions={
        <div className="ds-actions">
          <Link className="ds-button ds-button--primary" href="/admin/distribution/contents/new">새 원고 작성</Link>
          <Link className="ds-button ds-button--secondary" href="/admin/distribution/contents">콘텐츠 보관함</Link>
          <Link className="ds-button ds-button--secondary" href="/admin/distribution/jobs">게시 작업 관리</Link>
        </div>
      }
    >
      <section aria-labelledby="ov-flow" className="dc-panel dc-hero">
        <span className="dc-tag dc-tag-blue">공통 원문 재사용</span>
        <h2 id="ov-flow" className="dc-block">
          무엇을 전할지 먼저 정리하세요
        </h2>
        <p className="ds-muted">한 원문을 채널마다 복제하지 않고 참조합니다. 여러 채널을 한 번에 게시하지 않습니다.</p>
        <ol className="dc-stepflow" aria-label="작업 순서">
          {CONTENT_FLOW.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <div className="dc-split dc-block">
        <section aria-labelledby="ov-library" className="dc-panel">
          <div className="dc-panel-head">
            <h2 id="ov-library">콘텐츠 보관함</h2>
            <Link className="dc-action" href="/admin/distribution/contents">
              보관함 전체 →
            </Link>
          </div>
          {listed.status !== "ok" ? (
            <ReadStateNotice status={listed.status} what="원문 목록" />
          ) : listed.data.length === 0 ? (
            <p className="ds-muted">아직 저장된 원문이 없습니다(조회 성공 · 0건).</p>
          ) : (
            <ul className="dc-action-list">
              {listed.data.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link className="dc-action" href={`/admin/distribution/contents/${c.id}`}>
                    {c.title ?? "(제목 없음)"} · v{c.versionNo}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <article aria-labelledby="ov-next" className="dc-panel">
          <h2 id="ov-next">원문을 고르면 보이는 것</h2>
          <p className="ds-muted">최신 원문과 세 채널 초안을 한곳에서 비교합니다.</p>
          <div className="dc-readyline">
            <span>원문 버전·출처</span>
            <span>먼저 검토</span>
          </div>
          <div className="dc-readyline">
            <span>채널 문안·미디어</span>
            <span>채널마다 편집</span>
          </div>
          <div className="dc-readyline">
            <span>승인·게시 증거</span>
            <span>채널마다 따로 확인</span>
          </div>
        </article>
      </div>

      <section aria-labelledby="ov-channels" className="dc-block">
        <div className="dc-panel-head">
          <h2 id="ov-channels">채널 연결 및 게시 상태</h2>
          <Link className="dc-action" href="/admin/distribution/connections">
            연결·준비도 →
          </Link>
        </div>
        <ChannelCards hrefFor={(channel) => connectionHref[channel]} />
      </section>

      <section aria-labelledby="ov-attention" className="dc-panel dc-block">
        <div className="dc-panel-head">
          <h2 id="ov-attention">조치 필요 · 최근 작업</h2>
          <Link className="dc-action" href="/admin/distribution/jobs">
            예약·작업 →
          </Link>
        </div>
        <p className="ds-muted">
          작업 목록은 예약·작업 화면에서 조치 필요 순(대사 필요 → 결과 불명 → 실패 → 증거 대기 → 수동 준비 → 예약)으로 봅니다. 이 개요에는 작업 건수·요약을 따로 집계하지 않습니다.
        </p>
      </section>
    </ConsoleShell>
  );
}
