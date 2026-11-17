import Link from "next/link";
import { ActionForm } from "@/components/distribution-console/action-form";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { CHANNEL_INFO, CHANNELS, isWellFormedId } from "@/components/distribution-console/readiness";
import { DisabledAction, IdLine, InvalidParam, StatusDictionary } from "@/components/distribution-console/states";
import { ReadStateNotice, WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { isWriteConfigured, loadContentDetail, loadJobs } from "@/server/distribution/content-page";
import { APPROVAL_LABEL } from "@/server/distribution/dto";
import { JOB_STATUS_LABEL, jobStatusText } from "@/server/distribution/jobs-dto";
import { createBlogManualJobAction, createThreadsDryRunJobAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "실행 준비 비교" };

/**
 * W9 채널별 실행 준비 비교(AUTOPOST-BLOG-FLOW-015).
 * Blog: 원문 버전 승인 + 최신 원문 기준 Blog 리비전 승인이 모두 유효할 때만 "수동 게시 작업 만들기"(A8)를 연다.
 * Threads: 같은 조건으로 모의 실행(dry_run) 대기 작업을 만든다. 자동 실행기(스케줄러)는 없고, 관리자가 작업 상세의 모의 실행 버튼으로 직접 실행한다. Instagram은 비활성. 최종 판단은 서버 create_job.
 * 여러 채널을 한 번에 접수하지 않는다('모두 선택' 없음).
 */
export default async function PreparePage({
  params,
  searchParams,
}: {
  params: Promise<{ contentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const { contentId } = await params;
  const sp = await searchParams;
  const crumbs = [{ href: "/admin/distribution/contents", label: "콘텐츠 보관함" }];

  if (!isWellFormedId(contentId)) {
    return (
      <ConsoleShell section="contents" title="실행 준비 비교" crumbs={[...crumbs, { label: "실행 준비 비교" }]}>
        <InvalidParam what="콘텐츠 ID" back={{ href: "/admin/distribution/contents", label: "콘텐츠 보관함으로" }} />
      </ConsoleShell>
    );
  }

  const contentHref = `/admin/distribution/contents/${contentId}`;
  const [loaded, jobs] = await Promise.all([loadContentDetail(contentId), loadJobs({ contentId })]);
  const detail = loaded.status === "ok" ? loaded.data : null;
  const blog = detail?.drafts.blog ?? null;
  const blogJobs = jobs.status === "ok" ? jobs.data.filter((j) => j.channel === "blog") : [];
  const openBlogJob = blogJobs.find((j) => !["cancelled", "published", "abandoned"].includes(j.rawStatus)) ?? null;

  const blogBlockers: string[] = [];
  if (!detail?.current) blogBlockers.push("원문이 없습니다");
  if (detail && detail.contentApproval.state !== "approved") blogBlockers.push(`원문 버전 승인 필요(현재: ${APPROVAL_LABEL[detail.contentApproval.state]})`);
  if (!blog?.revision) blogBlockers.push("Blog 초안이 없습니다");
  else if (blog.basedOnLatest === false) blogBlockers.push("Blog 초안이 이전 원문 기준입니다 — 다시 저장·승인 필요");
  else if (blog.approval.state !== "approved") blogBlockers.push(`Blog 초안 승인 필요(현재: ${APPROVAL_LABEL[blog.approval.state]})`);
  if (detail?.archived) blogBlockers.push("보관된 원문입니다");
  if (openBlogJob) blogBlockers.push("이미 진행 중인 Blog 작업이 있습니다");
  const writeConfigured = isWriteConfigured();
  const canCreate = writeConfigured && blogBlockers.length === 0 && blog?.revision != null;

  // Threads 모의 실행(THREADS-PORT-016): 최신 원문 승인 + 최신 원문 기준 Threads 리비전 승인. 최종 판단은 create_job.
  const threads = detail?.drafts.threads ?? null;
  const currentVersionNo = detail?.current?.versionNo ?? null;
  const openThreadsDry =
    (jobs.status === "ok" ? jobs.data : []).find((j) => j.channel === "threads" && j.mode === "dry_run" && j.contentVersionNo === currentVersionNo && j.rawStatus !== "cancelled") ?? null;
  const threadsBlockers: string[] = [];
  if (!detail?.current) threadsBlockers.push("원문이 없습니다");
  if (detail && detail.contentApproval.state !== "approved") threadsBlockers.push(`원문 버전 승인 필요(현재: ${APPROVAL_LABEL[detail.contentApproval.state]})`);
  if (!threads?.revision) threadsBlockers.push("Threads 초안이 없습니다");
  else if (threads.basedOnLatest === false) threadsBlockers.push("Threads 초안이 이전 원문 기준입니다 — 다시 저장·승인 필요");
  else if (threads.approval.state !== "approved") threadsBlockers.push(`Threads 초안 승인 필요(현재: ${APPROVAL_LABEL[threads.approval.state]})`);
  if (detail?.archived) threadsBlockers.push("보관된 원문입니다");
  if (openThreadsDry) threadsBlockers.push("이 원문 버전의 모의 실행 작업이 이미 있습니다(같은 버전은 한 번만)");
  const canCreateThreadsDry = writeConfigured && threadsBlockers.length === 0 && threads?.revision != null;

  return (
    <ConsoleShell
      section="contents"
      eyebrow="개별 실행 준비"
      title="실행 준비 비교"
      description="채널마다 승인 상태와 막힌 이유를 확인하고 따로 진행합니다. 한 채널의 결과가 다른 채널에 영향을 주지 않습니다."
      crumbs={[...crumbs, { href: contentHref, label: "원문" }, { label: "실행 준비 비교" }]}
    >
      <WriteNoticeView notice={sp.notice} />
      <IdLine label="콘텐츠 ID" value={contentId} />
      {loaded.status !== "ok" ? <ReadStateNotice status={loaded.status} what="원문·초안" /> : null}
      {jobs.status !== "ok" ? <ReadStateNotice status={jobs.status} what="작업" /> : null}

      <ul className="dc-cards dc-block">
        {CHANNELS.map((c) => (
          <li key={c} className="dc-card">
            <h3>{CHANNEL_INFO[c].label}</h3>
            {c === "blog" ? (
              <>
                <p className="ds-muted">
                  원문 승인: {detail ? APPROVAL_LABEL[detail.contentApproval.state] : "확인 불가"} · Blog 초안: {blog?.revision ? `r${blog.revision.revisionNo} ${APPROVAL_LABEL[blog.approval.state]}` : "없음"}
                </p>
                {openBlogJob ? (
                  <p>
                    <Link className="dc-action" href={`/admin/distribution/jobs/${openBlogJob.id}`}>
                      진행 중 작업: {JOB_STATUS_LABEL[openBlogJob.status]} →
                    </Link>
                  </p>
                ) : null}
                {blogBlockers.length ? (
                  <ul>
                    {blogBlockers.map((b) => (
                      <li key={b} className="ds-muted">
                        {b}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ActionForm action={createBlogManualJobAction} disabled={!canCreate} className="" fieldLabels={{ draftRevisionId: "승인된 초안" }}>
                  <input type="hidden" name="draftRevisionId" value={blog?.revision?.id ?? ""} />
                  <button type="submit" className="ds-button ds-button--primary">
                    수동 게시 작업 만들기
                  </button>
                </ActionForm>
                <p className="ds-muted dc-reason">
                  {canCreate
                    ? "작업을 만들면 승인본을 사람이 네이버에서 직접 발행하고 증거를 기록합니다. 게시는 자동으로 일어나지 않습니다."
                    : !writeConfigured
                      ? "저장 준비 전: 서버 저장 연결이 설정되지 않았습니다."
                      : "위 조건을 해결하면 만들 수 있습니다. 최종 판단은 서버가 다시 합니다."}
                </p>
              </>
            ) : c === "threads" ? (
              <>
                <p className="ds-muted">
                  원문 승인: {detail ? APPROVAL_LABEL[detail.contentApproval.state] : "확인 불가"} · Threads 초안: {threads?.revision ? `r${threads.revision.revisionNo} ${APPROVAL_LABEL[threads.approval.state]}` : "없음"}
                </p>
                {openThreadsDry ? (
                  <p>
                    <Link className="dc-action" href={`/admin/distribution/jobs/${openThreadsDry.id}`}>
                      이 버전의 모의 실행 작업: {jobStatusText(openThreadsDry)} →
                    </Link>
                  </p>
                ) : null}
                {threadsBlockers.length ? (
                  <ul>
                    {threadsBlockers.map((b) => (
                      <li key={b} className="ds-muted">
                        {b}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ActionForm action={createThreadsDryRunJobAction} disabled={!canCreateThreadsDry} className="" fieldLabels={{ draftRevisionId: "승인된 초안", channel: "채널" }}>
                  <input type="hidden" name="draftRevisionId" value={threads?.revision?.id ?? ""} />
                  <input type="hidden" name="channel" value="threads" />
                  <button type="submit" className="ds-button ds-button--secondary">
                    모의 실행 작업 만들기
                  </button>
                </ActionForm>
                <p className="ds-muted dc-reason">
                  {!writeConfigured
                    ? "저장 준비 전: 서버 저장 연결이 설정되지 않았습니다."
                    : "작업은 '모의 실행 대기'로 만들어집니다. 자동 실행기(스케줄러)는 없으므로, 만든 뒤 작업 상세의 '모의 실행' 버튼으로 관리자가 직접 실행합니다. 모의 실행은 Threads에 게시하지 않으며, 작업을 만든 것만으로 모의 실행이 끝난 것도 아닙니다. 실제 게시(live)는 게시 실행기가 없고 live gate가 닫혀 있어 할 수 없습니다. 계정 연결은 Threads 연결 화면에서 따로 확인하며, 연결돼도 게시 가능을 뜻하지 않습니다(운영 설정 검증 별도)."}
                </p>
              </>
            ) : (
              <DisabledAction id={`prep-${c}`} label="모의 실행·게시 요청" reason={CHANNEL_INFO[c].blocked} />
            )}
          </li>
        ))}
      </ul>

      <section aria-labelledby="prep-dict" className="dc-block">
        <h2 id="prep-dict">실행 후 상태 설명</h2>
        <StatusDictionary />
      </section>
      <p>
        <Link className="ds-text-link" href={contentHref}>
          원문으로 돌아가기
        </Link>
      </p>
    </ConsoleShell>
  );
}
