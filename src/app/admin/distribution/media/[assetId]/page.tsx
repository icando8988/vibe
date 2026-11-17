import Link from "next/link";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { MediaAssetList } from "@/components/distribution-console/media-asset-list";
import { MediaAssetFacts } from "@/components/distribution-console/media-asset-detail";
import { MediaArchiveForm, MediaRightsForm } from "@/components/distribution-console/media-forms";
import { requestNow } from "@/components/distribution-console/media-labels";
import { isWellFormedId } from "@/components/distribution-console/readiness";
import { IdLine, InvalidParam } from "@/components/distribution-console/states";
import { WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { archiveMediaAssetAction, decideMediaRightsAction } from "../actions";
import { loadMediaList } from "../load";

export const dynamic = "force-dynamic";
export const metadata = { title: "자산 상세" };

/**
 * W6 자산 상세·권리 결정·보관(FE-MEDIA-024).
 * listAssets(소유 actor 것, 최신 100건) 결과에서 이 자산을 찾는다. 실제 조회 성공일 때만 사실·폼을 보이고 폼을 켠다.
 * 쓰기는 media/actions.ts → service(세션 actor·D1·expected version은 서버 몫). 미리보기 없음.
 */
export default async function MediaAssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const { assetId } = await params;
  const sp = await searchParams;
  const crumbs = [{ href: "/admin/distribution/media", label: "미디어·권리" }, { label: "자산 상세" }];

  if (!isWellFormedId(assetId)) {
    return (
      <ConsoleShell section="media" title="자산 상세" crumbs={crumbs}>
        <InvalidParam what="자산 ID" back={{ href: "/admin/distribution/media", label: "미디어 목록으로" }} />
      </ConsoleShell>
    );
  }

  const now = requestNow();
  const { view, assets } = await loadMediaList();
  const asset = assets?.find((a) => a.id === assetId) ?? null;

  return (
    <ConsoleShell section="media" eyebrow="미디어" title="자산 상세" crumbs={crumbs}>
      <WriteNoticeView notice={sp.notice} />
      <IdLine label="자산 ID" value={assetId} />
      {view.state !== "ok" ? (
        <MediaAssetList view={view} now={now} />
      ) : !asset ? (
        <p className="ds-muted">이 자산을 찾지 못했습니다(없거나, 다른 관리자의 자산이거나, 최근 100건 밖일 수 있습니다).</p>
      ) : (
        <>
          <section aria-labelledby="as-info" className="dc-panel">
            <h2 id="as-info">처리 · 권리 · 규격</h2>
            <MediaAssetFacts asset={asset} now={now} />
          </section>
          <section aria-labelledby="as-rights" className="dc-panel dc-block">
            <h2 id="as-rights">권리 결정</h2>
            <MediaRightsForm asset={asset} action={decideMediaRightsAction} disabledReason={null} />
          </section>
          <section aria-labelledby="as-archive" className="dc-panel dc-block">
            <h2 id="as-archive">보관</h2>
            <MediaArchiveForm asset={asset} action={archiveMediaAssetAction} disabledReason={null} />
          </section>
        </>
      )}
      <p>
        <Link className="ds-text-link" href={`/admin/distribution/media?selected=${assetId}`}>
          미디어 목록으로
        </Link>
      </p>
    </ConsoleShell>
  );
}
