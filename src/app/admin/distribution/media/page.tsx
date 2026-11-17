import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { MediaAssetList } from "@/components/distribution-console/media-asset-list";
import { MediaUploadPanel } from "@/components/distribution-console/media-forms";
import { requestNow } from "@/components/distribution-console/media-labels";
import { WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { loadMediaList } from "./load";

export const dynamic = "force-dynamic";
export const metadata = { title: "미디어·권리" };

/**
 * W6 미디어·권리 목록(FE-MEDIA-024). 실제 listAssets 결과만 목록·0건으로 표시한다(준비 전·오류는 0건이 아님).
 * 업로드는 원본 전용 업로드 계약(Master A안)이 구현·확정될 때까지 비활성. 외부 이미지 URL 입력란·미리보기 없음.
 */
export default async function MediaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const sp = await searchParams;
  const { view } = await loadMediaList();
  const selected = typeof sp.selected === "string" ? sp.selected : null;

  return (
    <ConsoleShell
      section="media"
      eyebrow="미디어"
      title="미디어·권리"
      description="게시에 쓰는 이미지는 처리 완료와 권리 승인이 모두 필요합니다. 두 상태를 따로 봅니다."
      crumbs={[{ label: "미디어·권리" }]}
    >
      <WriteNoticeView notice={sp.notice} />
      <MediaUploadPanel reason="원본 업로드 경로(원본 전용 비공개 저장소·서명 업로드)가 아직 구현·확정되지 않았습니다." />
      <section aria-labelledby="md-list" className="dc-panel dc-block">
        <h2 id="md-list">내 자산</h2>
        <MediaAssetList view={view} now={requestNow()} selectedId={selected} />
      </section>
      <p className="ds-muted">
        자산은 지우지 않고 보관만 합니다. 채널 초안이 쓰는 자산은 보관할 수 없습니다. 권리 미승인 자산은 초안에 붙일 수는 있어도 게시 때 막힙니다.
      </p>
    </ConsoleShell>
  );
}
