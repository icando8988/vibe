import Link from "next/link";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { ReadStateNotice, WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { isWriteConfigured, loadContentList } from "@/server/distribution/content-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "콘텐츠 보관함" };

const fmt = (iso: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + " KST";

/**
 * W2 콘텐츠 보관함 — 사용자 세션(RLS)으로 실제 조회(AUTOPOST-CONTENT-CONNECT-014).
 * 준비 전 / 데이터 구조 준비 전 / 조회 오류 / 조회 성공 0건을 서로 다른 문구로 보인다.
 * 검색·필터는 아직 구현하지 않았다(최근 수정 50건만 표시).
 */
export default async function ContentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const params = await searchParams;
  const listed = await loadContentList();
  const canWrite = listed.status === "ok" && isWriteConfigured();

  return (
    <ConsoleShell
      section="contents"
      eyebrow="작업 공간"
      title="콘텐츠 보관함"
      description="모든 배포는 원문 하나에서 시작합니다. 원문을 고르면 세 채널 초안과 검토 상태를 함께 봅니다."
      crumbs={[{ label: "콘텐츠 보관함" }]}
      actions={
        <Link className="ds-button ds-button--primary" href="/admin/distribution/contents/new">
          {canWrite ? "새 원문" : "새 원문 (저장 준비 전)"}
        </Link>
      }
    >
      <WriteNoticeView notice={params.notice} />
      <section aria-labelledby="lib-list" className="dc-panel">
        <div className="dc-panel-head">
          <h2 id="lib-list">원문</h2>
          <span className="dc-tag">최근 수정 50건 · 검색 준비 중</span>
        </div>
        {listed.status !== "ok" ? (
          <ReadStateNotice status={listed.status} what="원문 목록" />
        ) : listed.data.length === 0 ? (
          <p className="ds-muted">아직 저장된 원문이 없습니다(조회 성공 · 0건).</p>
        ) : (
          <div className="dc-table-wrap">
            <table className="dc-table">
              <caption>원문 목록(시각 기준 KST)</caption>
              <thead>
                <tr>
                  <th scope="col">제목</th>
                  <th scope="col">버전</th>
                  <th scope="col">상태</th>
                  <th scope="col">최근 수정</th>
                </tr>
              </thead>
              <tbody>
                {listed.data.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">
                      <Link href={`/admin/distribution/contents/${c.id}`}>{c.title ?? "(제목 없음)"}</Link>
                    </th>
                    <td>v{c.versionNo}</td>
                    <td>{c.archived ? "보관됨" : "사용 중"}</td>
                    <td>{fmt(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </ConsoleShell>
  );
}
