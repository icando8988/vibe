import Link from "next/link";
import { ActionForm } from "@/components/distribution-console/action-form";
import { StatusNotice } from "@/components/status-notice";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { isWellFormedId } from "@/components/distribution-console/readiness";
import { IdLine, InvalidParam } from "@/components/distribution-console/states";
import { ReadStateNotice, WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { isWriteConfigured, loadJobDetail } from "@/server/distribution/content-page";
import { recordReconciliationAction } from "../../actions";
import { JobFacts, kst } from "../job-common";

export const dynamic = "force-dynamic";
export const metadata = { title: "대사·오류 검토" };

/**
 * W8 대사(A13, AUTOPOST-BLOG-FLOW-015). 결과 불명(unknown) 작업에만 관리자 수동 확인(operator_manual)을 기록한다.
 * 결과: 게시 확인(증거 필요, blog.naver.com) / 부재 확인 / 여전히 불명. 부재 확인은 재게시 허가가 아니다.
 * 늦은·충돌 증거가 남아 있으면 부재 확인은 서버가 거절한다. 재게시·자동 재시도·복제 버튼은 없다.
 */
export default async function ReconcilePage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const { jobId } = await params;
  const sp = await searchParams;
  const crumbs = [{ href: "/admin/distribution/jobs", label: "예약·작업" }];

  if (!isWellFormedId(jobId)) {
    return (
      <ConsoleShell section="jobs" title="대사·오류 검토" crumbs={[...crumbs, { label: "대사·오류 검토" }]}>
        <InvalidParam what="작업 ID" back={{ href: "/admin/distribution/jobs", label: "작업 목록으로" }} />
      </ConsoleShell>
    );
  }

  const base = `/admin/distribution/jobs/${jobId}`;
  const loaded = await loadJobDetail(jobId);
  const detail = loaded.status === "ok" ? loaded.data : null;
  const canWrite = isWriteConfigured();

  return (
    <ConsoleShell
      section="jobs"
      eyebrow="대사"
      title="대사·오류 검토"
      crumbs={[...crumbs, { href: base, label: "실행 상세" }, { label: "대사·오류 검토" }]}
    >
      <WriteNoticeView notice={sp.notice} />
      <IdLine label="작업 ID" value={jobId} />
      <StatusNotice tone="warning" title="결과 불명일 때의 안내 — 외부 게시가 이미 됐을 수 있습니다">
        <p>
          확인하기 전에는 다시 게시하지 않습니다. 조회 실패나 검색 결과 없음은 &lsquo;게시되지 않음&rsquo;이 아니고, 계정 연결이 복구돼도 대사가 끝난 것이
          아닙니다. 부재 확인 뒤 재실행은 별도 운영자 승인과 서버 재검사로만 가능합니다(이 화면에는 재실행 버튼이 없습니다).
        </p>
      </StatusNotice>

      {loaded.status !== "ok" ? (
        <ReadStateNotice status={loaded.status} what="작업" />
      ) : !detail ? (
        <p className="ds-muted">이 작업을 찾지 못했습니다(없거나 볼 권한이 없음).</p>
      ) : (
        <>
          <section aria-labelledby="rc-facts" className="dc-panel dc-block">
            <h2 id="rc-facts">작업</h2>
            <JobFacts job={detail.job} />
          </section>
          {detail.job.status !== "unknown" ? (
            <p className="ds-muted dc-block">결과 불명 작업이 아니어서 대사를 기록할 수 없습니다.</p>
          ) : (
            <section aria-labelledby="rc-record" className="dc-panel dc-block">
              <h2 id="rc-record">확인 결과 기록</h2>
              <p className="ds-muted">검증된 조회 기능이 없으므로 사람이 네이버에서 직접 확인합니다.</p>
              <ActionForm
                action={recordReconciliationAction}
                disabled={!canWrite}
                fieldLabels={{ finding: "확인 결과", observedAt: "확인한 시각", checkedScope: "확인 범위", observation: "근거 메모", externalUrl: "게시 URL", checkedAccount: "확인한 블로그 계정", checkedPeriod: "확인한 기간" }}
              >
                <input type="hidden" name="jobId" value={jobId} />
                <input type="hidden" name="expectedVersion" value={String(detail.job.version)} />
                <label htmlFor="rc-finding">확인 결과</label>
                <select id="rc-finding" name="finding" defaultValue="still_unknown">
                  <option value="found_published">게시 확인(게시 URL 또는 ID 필요)</option>
                  <option value="confirmed_absent">부재 확인(재게시 허가 아님)</option>
                  <option value="still_unknown">여전히 불명</option>
                </select>
                <label htmlFor="rc-scope">확인 범위(어디를 어떻게 봤는지, 필수)</label>
                <textarea id="rc-scope" name="checkedScope" rows={3} required maxLength={1000} />
                <label htmlFor="rc-account">확인한 블로그 계정(부재 확인이면 필수)</label>
                <input id="rc-account" name="checkedAccount" type="text" maxLength={200} />
                <label htmlFor="rc-period">확인한 기간(부재 확인이면 필수, 예: 11/17 09:00~10:30 KST)</label>
                <input id="rc-period" name="checkedPeriod" type="text" maxLength={200} />
                <label htmlFor="rc-observed">확인한 시각(KST)</label>
                <input id="rc-observed" name="observedAt" type="datetime-local" required />
                <label htmlFor="rc-url">게시 URL(게시 확인일 때, blog.naver.com)</label>
                <input id="rc-url" name="externalUrl" type="url" maxLength={2048} />
                <label htmlFor="rc-pid">또는 외부 글 ID</label>
                <input id="rc-pid" name="externalPostId" type="text" maxLength={200} />
                <label htmlFor="rc-obs">근거 메모(부재 확인이면 필수)</label>
                <input id="rc-obs" name="observation" type="text" maxLength={1000} />
                <button type="submit" className="ds-button ds-button--primary">
                  확인 결과 기록
                </button>
              </ActionForm>
            </section>
          )}
          <section aria-labelledby="rc-history" className="dc-panel dc-block">
            <h2 id="rc-history">기존 대사 기록</h2>
            {detail.reconciliations.length === 0 ? (
              <p className="ds-muted">대사 기록이 없습니다.</p>
            ) : (
              <ul>
                {detail.reconciliations.map((r) => (
                  <li key={r.id}>
                    {r.finding} · {kst(r.observedAt)}
                    {r.observation ? ` · ${r.observation}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <p>
        <Link className="ds-text-link" href={base}>
          실행 상세로 돌아가기
        </Link>
      </p>
    </ConsoleShell>
  );
}
