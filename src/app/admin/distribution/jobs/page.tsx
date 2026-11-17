import Link from "next/link";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { StatusDictionary } from "@/components/distribution-console/states";
import { ReadStateNotice, WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { loadJobs } from "@/server/distribution/content-page";
import { jobStatusText } from "@/server/distribution/jobs-dto";

export const dynamic = "force-dynamic";
export const metadata = { title: "예약·작업" };

const kst = (iso: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + " KST";
const MODE: Record<string, string> = { manual: "수동 게시", dry_run: "모의 실행", live: "실제 게시" };

/**
 * W7 예약·작업 — 사용자 세션(RLS)으로 실제 조회(AUTOPOST-BLOG-FLOW-015).
 * 조치 필요 우선 정렬(대사 필요 → 결과 불명 → 실패 → 증거 대기 → 수동 준비 → 예약). 준비 전·DB 적용 전·조회 오류·0건 구분.
 */
export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const sp = await searchParams;
  const jobs = await loadJobs();

  return (
    <ConsoleShell
      section="jobs"
      eyebrow="작업 공간"
      title="예약·작업"
      description="조치가 필요한 작업을 먼저 봅니다. 결과 불명 작업은 대사(확인 기록) 전에는 다시 게시하지 않습니다."
      crumbs={[{ label: "예약·작업" }]}
    >
      <WriteNoticeView notice={sp.notice} />
      <section aria-labelledby="jobs-list" className="dc-panel">
        <div className="dc-panel-head">
          <h2 id="jobs-list">작업</h2>
          <span className="dc-tag">최근 100건 · 필터 준비 중</span>
        </div>
        {jobs.status !== "ok" ? (
          <ReadStateNotice status={jobs.status} what="작업 목록" />
        ) : jobs.data.length === 0 ? (
          <p className="ds-muted">아직 작업이 없습니다(조회 성공 · 0건). 원문의 &lsquo;실행 준비 비교&rsquo;에서 Blog 수동 게시 작업을 만들 수 있습니다.</p>
        ) : (
          <div className="dc-table-wrap">
            <table className="dc-table">
              <caption>작업 목록(조치 필요 우선, 시각 기준 KST)</caption>
              <thead>
                <tr>
                  <th scope="col">작업</th>
                  <th scope="col">채널·방식</th>
                  <th scope="col">상태</th>
                  <th scope="col">원문 버전</th>
                  <th scope="col">최근 변경</th>
                </tr>
              </thead>
              <tbody>
                {jobs.data.map((j) => (
                  <tr key={j.id}>
                    <th scope="row">
                      <Link href={`/admin/distribution/jobs/${j.id}`}>상세 보기</Link>
                    </th>
                    <td>
                      {j.channel} · {MODE[j.mode] ?? j.mode}
                    </td>
                    <td>
                      {jobStatusText(j)}
                      {j.reconciliationRequired ? " · 증거 검토 필요" : ""}
                      {j.hasIssues ? " · 구성 경고" : ""}
                    </td>
                    <td>v{j.contentVersionNo}</td>
                    <td>{kst(j.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="dc-block">
        <summary>작업 상태 설명 보기</summary>
        <StatusDictionary />
      </details>
    </ConsoleShell>
  );
}
