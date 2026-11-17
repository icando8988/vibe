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
import { abandonManualJobAction, markManualPostedAction, markManualUncertainAction, recordManualEvidenceAction, requestHandoffAction } from "../../actions";
import { JobFacts } from "../job-common";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blog 수동 게시·증거" };

const TEXT_STYLE = { whiteSpace: "pre-wrap" as const };
const HANDOFF_LABEL: Record<string, string> = {
  requested: "확장으로 보냄(아직 가져가지 않음)",
  in_progress: "확장이 입력 중",
  completed: "본문 입력 완료(게시 아님)",
  publish_ready: "발행 직전까지 준비 완료(게시 아님)",
  failed: "확장 입력 실패",
  needs_check: "사람 확인 필요",
  rejected: "인계 거절(내용 미전달)",
};

/**
 * W8 Blog 수동 게시·증거(AUTOPOST-BLOG-FLOW-015).
 * 순서: 승인본 확인·(선택) 확장으로 보내기 → 사람이 네이버에서 직접 [발행] → A9 "게시를 마쳤습니다" → A10 증거 → (DB 수락 시) 게시 확인됨.
 * 확장 입력 완료·발행 준비 완료는 게시가 아니다. 증거 입력만으로 확인됐다고 표시하지 않는다(DB 수락 뒤 redirect로만 성공 안내).
 * 모든 쓰기는 렌더된 job.version을 그대로 보낸다.
 */
export default async function ManualEvidencePage({
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
      <ConsoleShell section="jobs" title="Blog 수동 게시·증거" crumbs={[...crumbs, { label: "수동 게시·증거" }]}>
        <InvalidParam what="작업 ID" back={{ href: "/admin/distribution/jobs", label: "작업 목록으로" }} />
      </ConsoleShell>
    );
  }

  const base = `/admin/distribution/jobs/${jobId}`;
  const [loaded, handoffs] = await Promise.all([loadJobDetail(jobId), loadHandoffs()]);
  const detail = loaded.status === "ok" ? loaded.data : null;
  const handoff = handoffs.status === "ok" ? handoffs.handoffs.find((h) => h.jobId === jobId) ?? null : null;
  const actions = detail ? jobActions(detail.job, handoff?.status ?? null) : null;
  const canWrite = isWriteConfigured();
  const version = detail ? String(detail.job.version) : "";

  return (
    <ConsoleShell
      section="jobs"
      eyebrow="Blog 수동 게시"
      title="Blog 수동 게시·증거"
      description="승인본을 사람이 네이버에서 직접 발행하고, 게시 증거를 서버가 수락해야 '게시 확인됨'이 됩니다."
      crumbs={[...crumbs, { href: base, label: "실행 상세" }, { label: "수동 게시·증거" }]}
      gateNotice={
        <StatusNotice tone="warning" title="자동 게시 없음 · 저장은 서버 준비 시 실제 동작">
          <p>이 화면의 게시 표시·증거·중단 기록은 서버 저장이 준비되면 실제로 저장됩니다. 네이버 발행은 언제나 사람이 직접 합니다(확장도 마지막 [발행]은 누르지 않음).</p>
        </StatusNotice>
      }
    >
      <WriteNoticeView notice={sp.notice} />
      <IdLine label="작업 ID" value={jobId} />
      {loaded.status !== "ok" ? (
        <ReadStateNotice status={loaded.status} what="작업" />
      ) : !detail || !actions ? (
        <p className="ds-muted">이 작업을 찾지 못했습니다(없거나 볼 권한이 없음).</p>
      ) : detail.job.mode !== "manual" ? (
        <p className="ds-muted">수동 게시 작업이 아닙니다.</p>
      ) : (
        <>
          <section aria-labelledby="mn-facts" className="dc-panel">
            <h2 id="mn-facts">작업</h2>
            <JobFacts job={detail.job} />
          </section>
          {actions.warnings.map((w) => (
            <StatusNotice key={w} tone="warning" title="확인이 필요합니다">
              <p>{w}</p>
            </StatusNotice>
          ))}

          <section aria-labelledby="mn-copy" className="dc-panel dc-block">
            <h2 id="mn-copy">승인본(이 작업에 고정)</h2>
            {detail.approvedText ? (
              <>
                <p>
                  <strong>{detail.approvedText.title}</strong> <span className="ds-muted">(원문 제목)</span>
                </p>
                <p style={TEXT_STYLE}>{detail.approvedText.body}</p>
              </>
            ) : (
              <p className="ds-muted">승인본을 불러오지 못했습니다.</p>
            )}
          </section>

          <section aria-labelledby="mn-handoff" className="dc-panel dc-block">
            <h2 id="mn-handoff">네이버 블로그 입력기(확장)</h2>
            <p className="ds-muted">
              인계 상태: {handoffs.status === "ok" ? (handoff ? HANDOFF_LABEL[handoff.status] ?? handoff.status : "보내지 않음") : handoffs.status === "not_ready" ? "확인 불가(서버 연결 준비 전)" : "확인 불가"}
              {handoff?.lastCode ? ` · ${handoff.lastCode}` : ""}
            </p>
            {actions.requestHandoff ? (
              <ActionForm action={requestHandoffAction} disabled={!canWrite} className="">
                <input type="hidden" name="jobId" value={jobId} />
                <button type="submit" className="ds-button ds-button--secondary">
                  {handoff?.status === "requested" ? "확장 요청 다시 열기(30분)" : "확장으로 보내기"}
                </button>
              </ActionForm>
            ) : null}
            <p className="ds-muted dc-reason">
              확장은 30분 안에 가져가 발행 직전까지 입력합니다. 입력 완료는 게시가 아니며, 가져간 뒤에는 자동으로 다시 보내지 않습니다.
              <Link className="ds-text-link" href="/admin/distribution/connections/blog-extension">
                확장 연결 토큰 관리
              </Link>
            </p>
          </section>

          {actions.markPosted ? (
            <section aria-labelledby="mn-posted" className="dc-panel dc-block">
              <h2 id="mn-posted">외부 발행을 마쳤나요?</h2>
              <ActionForm action={markManualPostedAction} disabled={!canWrite} fieldLabels={{ confirmPosted: "발행 확인" }}>
                <input type="hidden" name="jobId" value={jobId} />
                <input type="hidden" name="expectedVersion" value={version} />
                <label>
                  <input type="checkbox" name="confirmPosted" /> 네이버에서 직접 [발행]을 눌러 게시했습니다
                </label>
                <button type="submit" className="ds-button ds-button--primary">
                  외부에서 게시를 마쳤습니다
                </button>
              </ActionForm>
              <p className="ds-muted dc-reason">표시 후 상태는 &lsquo;게시 증거 대기&rsquo;입니다. 아직 게시 확인이 아닙니다.</p>
            </section>
          ) : null}

          {actions.recordEvidence ? (
            <section aria-labelledby="mn-evidence" className="dc-panel dc-block">
              <h2 id="mn-evidence">게시 증거 기록</h2>
              <ActionForm
                action={recordManualEvidenceAction}
                disabled={!canWrite}
                fieldLabels={{ externalUrl: "게시 URL", externalPostId: "외부 글 ID", externalAccountId: "블로그 계정", observedAt: "확인한 시각", methodNote: "확인 방법" }}
              >
                <input type="hidden" name="jobId" value={jobId} />
                <input type="hidden" name="expectedVersion" value={version} />
                <label htmlFor="mn-url">게시 URL(blog.naver.com)</label>
                <input id="mn-url" name="externalUrl" type="url" maxLength={2048} />
                <label htmlFor="mn-pid">또는 외부 글 ID(ID만 쓰면 확인 방법 필수)</label>
                <input id="mn-pid" name="externalPostId" type="text" maxLength={200} />
                <label htmlFor="mn-acct">블로그 계정(선택)</label>
                <input id="mn-acct" name="externalAccountId" type="text" maxLength={200} />
                <label htmlFor="mn-observed">확인한 시각(KST)</label>
                <input id="mn-observed" name="observedAt" type="datetime-local" required />
                <label htmlFor="mn-note">확인 방법·메모</label>
                <textarea id="mn-note" name="methodNote" rows={3} maxLength={1000} />
                <button type="submit" className="ds-button ds-button--primary">
                  증거 저장
                </button>
              </ActionForm>
              <p className="ds-muted dc-reason">URL은 자동으로 방문·확인하지 않습니다. 서버가 증거를 수락해야 &lsquo;게시 확인됨&rsquo;이 됩니다.</p>
            </section>
          ) : null}

          {actions.markUncertain ? (
            <section aria-labelledby="mn-uncertain" className="dc-panel dc-block">
              <h2 id="mn-uncertain">게시 여부를 모르겠나요?</h2>
              <ActionForm action={markManualUncertainAction} disabled={!canWrite} fieldLabels={{ reason: "사유" }}>
                <input type="hidden" name="jobId" value={jobId} />
                <input type="hidden" name="expectedVersion" value={version} />
                <label htmlFor="mn-unc-reason">사유(필수)</label>
                <input id="mn-unc-reason" name="reason" type="text" required maxLength={500} />
                <button type="submit" className="ds-button ds-button--secondary">
                  결과 불명으로 표시
                </button>
              </ActionForm>
              <p className="ds-muted dc-reason">결과 불명이 되면 대사(확인 기록)만 할 수 있고 다시 게시하지 않습니다.</p>
            </section>
          ) : null}

          {actions.abandon ? (
            <section aria-labelledby="mn-abandon" className="dc-panel dc-block">
              <h2 id="mn-abandon">수동 작업 중단</h2>
              <ActionForm action={abandonManualJobAction} disabled={!canWrite} fieldLabels={{ reason: "사유", acknowledged: "외부에 남을 수 있음 확인" }}>
                <input type="hidden" name="jobId" value={jobId} />
                <input type="hidden" name="expectedVersion" value={version} />
                <label htmlFor="mn-ab-reason">사유(필수)</label>
                <input id="mn-ab-reason" name="reason" type="text" required maxLength={500} />
                <label>
                  <input type="checkbox" name="acknowledged" /> 외부에 글이 남아 있을 수 있음을 확인했습니다. 중단해도 이 버전·채널의 작업 키는 계속 점유됩니다.
                </label>
                <button type="submit" className="ds-button ds-button--secondary">
                  수동 작업 중단
                </button>
              </ActionForm>
            </section>
          ) : null}

          {!actions.markPosted && !actions.recordEvidence && !actions.abandon && !actions.markUncertain ? (
            <p className="ds-muted dc-block">이 상태에서는 수동 게시 행동이 없습니다.</p>
          ) : null}
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
