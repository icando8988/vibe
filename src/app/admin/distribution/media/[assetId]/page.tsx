import Link from "next/link";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { isWellFormedId } from "@/components/distribution-console/readiness";
import { DisabledAction, IdLine, InvalidParam, NotConnected } from "@/components/distribution-console/states";

export const dynamic = "force-dynamic";
export const metadata = { title: "자산 상세" };

/** W6 자산 상세·권리 검토. 조회 경로 미연결. */
export default async function MediaAssetPage({ params }: { params: Promise<{ assetId: string }> }) {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const { assetId } = await params;
  const crumbs = [{ href: "/admin/distribution/media", label: "미디어·권리" }, { label: "자산 상세" }];

  if (!isWellFormedId(assetId)) {
    return (
      <ConsoleShell section="media" title="자산 상세" crumbs={crumbs}>
        <InvalidParam what="자산 ID" back={{ href: "/admin/distribution/media", label: "미디어 목록으로" }} />
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell section="media" title="자산 상세" crumbs={crumbs}>
      <IdLine label="자산 ID" value={assetId} />
      <section aria-labelledby="as-info" className="dc-block">
        <h2 id="as-info">형식 · 출처 · 사용권 · 동의</h2>
        <NotConnected what="자산 정보" />
      </section>
      <section aria-labelledby="as-refs" className="dc-block">
        <h2 id="as-refs">검토 이력 · 참조 작업</h2>
        <NotConnected what="검토 이력과 참조 작업" />
      </section>
      <div className="ds-actions">
        <DisabledAction id="as-approve" label="권리 확인 기록" reason="권리 검토 저장 경로 미연결" />
        <DisabledAction id="as-delete" label="자산 삭제" reason="참조·보존 확인 경로가 없어 삭제할 수 없습니다." />
      </div>
      <p>
        <Link className="ds-text-link" href="/admin/distribution/media">
          미디어 목록으로
        </Link>
      </p>
    </ConsoleShell>
  );
}
