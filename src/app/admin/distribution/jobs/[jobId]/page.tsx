import Link from "next/link";
import { ActionForm } from "@/components/distribution-console/action-form";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { isWellFormedId } from "@/components/distribution-console/readiness";
import { IdLine, InvalidParam } from "@/components/distribution-console/states";
import { ReadStateNotice, WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { StatusNotice } from "@/components/status-notice";
import { isWriteConfigured, loadHandoffs, loadJobDetail } from "@/server/distribution/content-page";
import { jobActions } from "@/server/distribution/jobs-dto";
import { cancelJobAction } from "../actions";
import { JobFacts, kst } from "./job-common";

export const dynamic = "force-dynamic";
export const metadata = { title: "실행 상세" };

/**
 * W8 실행 상세(AUTOPOST-BLOG-FLOW-015). 상태에 따라 가능한 다음 행동만 보인다(jobActions — M2 전이 규칙).
 * 결과 불명·늦은/충돌 증거에서는 대사 동선만, 재게시·복제·수동 우회 CTA 없음. 취소(A14)는 확인 후 렌더된 version으로.
 */
export default async function JobDetailPage({
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
      <ConsoleShell section="jobs" title="실행 상세" crumbs={[...crumbs, { label: "실행 상세" }]}>
        <InvalidParam what="작업 ID" back={{ href: "/admin/distribution/jobs", label: "작업 목록으로" }} />
      </ConsoleShell>
    );
  }

  const [loaded, handoffs] = await Promise.all([loadJobDetail(jobId), loadHandoffs()]);
  const detail = loaded.status === "ok" ? loaded.data : null;
  const handoff = handoffs.status === "ok" ? handoffs.handoffs.find((h) => h.jobId === jobId) ?? null : null;
  const actions = detail ? jobActions(detail.job, handoff?.status ?? null) : null;
  const canWrite = isWriteConfigured();
  const base = `/admin/distribution/jobs/${jobId}`;

  return (
    <ConsoleShell section="jobs" eyebrow="실행 상세" title="실행 상세" crumbs={[...crumbs, { label: "실행 상세" }]}>
      <WriteNoticeView notice={sp.notice} />
      <IdLine label="작업 ID" value={jobId} />
      {loaded.status !== "ok" ? (
        <ReadStateNotice status={loaded.status} what="작업" />
      ) : !detail || !actions ? (
        <p className="ds-muted">이 작업을 찾지 못했습니다(없거나 볼 권한이 없음).</p>
      ) : (
        <>
          <section aria-labelledby="jd-facts" className="dc-panel">
            <h2 id="jd-facts">고정된 버전 · 방식 · 상태</h2>
            <JobFacts job={detail.job} />
            {handoff ? <p className="ds-muted">확장 인계: {handoff.status}{handoff.lastCode ? ` (${handoff.lastCode})` : ""}</p> : null}
          </section>

          {actions.warnings.map((w) => (
            <StatusNotice key={w} tone="warning" title="확인이 필요합니다">
              <p>{w}</p>
            </StatusNotice>
          ))}

          <section aria-labelledby="jd-next" className="dc-panel dc-block">
            <h2 id="jd-next">다음 행동</h2>
            <ul className="dc-action-list">
              {actions.markPosted || actions.recordEvidence || actions.abandon || actions.markUncertain || actions.requestHandoff ? (
                <li>
                  <Link className="dc-action" href={`${base}/manual`}>
                    Blog 수동 게시·증거 →
                  </Link>
                </li>
              ) : null}
              {actions.reconcile ? (
                <li>
                  <Link className="dc-action" href={`${base}/reconcile`}>
                    대사(확인 기록) →
                  </Link>
                </li>
              ) : null}
            </ul>
            {!actions.markPosted && !actions.recordEvidence && !actions.reconcile && !actions.cancel && !actions.abandon ? (
              <p className="ds-muted">이 상태에서 할 수 있는 행동이 없습니다. 재게시·복제 기능은 제공하지 않습니다.</p>
            ) : null}
            {detail.job.status === "failed" ? <p className="ds-muted">실패 작업의 재실행 승인은 아직 화면에 연결되지 않았습니다(운영자 승인 기능 준비 중).</p> : null}
          </section>

          {actions.cancel ? (
            <section aria-labelledby="jd-cancel" className="dc-panel dc-block">
              <h2 id="jd-cancel">작업 취소</h2>
              <ActionForm action={cancelJobAction} disabled={!canWrite} fieldLabels={{ confirmCancel: "취소 확인", reason: "사유" }}>
                <input type="hidden" name="jobId" value={jobId} />
                <input type="hidden" name="expectedVersion" value={String(detail.job.version)} />
                <label>
                  <input type="checkbox" name="confirmCancel" /> 이 작업을 취소합니다. 이미 외부에 게시된 글을 지우지는 않습니다.
                </label>
                <label htmlFor="jd-cancel-reason">사유(선택)</label>
                <input id="jd-cancel-reason" name="reason" type="text" maxLength={1000} />
                <button type="submit" className="ds-button ds-button--secondary">
                  작업 취소
                </button>
              </ActionForm>
            </section>
          ) : null}

          <section aria-labelledby="jd-evidence" className="dc-panel dc-block">
            <h2 id="jd-evidence">게시 증거</h2>
            {detail.evidence.length === 0 ? (
              <p className="ds-muted">기록된 증거가 없습니다.</p>
            ) : (
              <ul>
                {detail.evidence.map((e) => (
                  <li key={e.id}>
                    {e.status} · {e.source} · {e.externalUrl ?? e.externalPostId ?? "—"} · 확인 {kst(e.observedAt)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="jd-recon" className="dc-panel dc-block">
            <h2 id="jd-recon">대사 기록</h2>
            {detail.reconciliations.length === 0 ? (
              <p className="ds-muted">대사 기록이 없습니다.</p>
            ) : (
              <ul>
                {detail.reconciliations.map((r) => (
                  <li key={r.id}>
                    {r.finding} · {r.method} · {kst(r.observedAt)}
                    {r.observation ? ` · ${r.observation}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="dc-block">
            <summary>상태 변경 이력</summary>
            <ol>
              {detail.events.map((e) => (
                <li key={e.seq}>
                  {e.fromStatus ?? "—"} → {e.toStatus ?? "—"} {e.reasonCode ? `(${e.reasonCode})` : ""} · {kst(e.createdAt)}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </ConsoleShell>
  );
}
