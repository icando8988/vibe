import Link from "next/link";
import { ActionForm } from "@/components/distribution-console/action-form";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { CHANNEL_INFO, isChannel, isWellFormedId } from "@/components/distribution-console/readiness";
import { IdLine, InvalidParam } from "@/components/distribution-console/states";
import { ReadStateNotice, WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { isWriteConfigured, loadContentDetail } from "@/server/distribution/content-page";
import { APPROVAL_LABEL, CHECKLIST } from "@/server/distribution/dto";
import { decideApprovalAction, revokeApprovalAction } from "../../../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "승인 검토" };

const TEXT_STYLE = { whiteSpace: "pre-wrap" as const };

/**
 * W4 채널 초안 승인 검토(A6 승인·반려, A7 철회) — AUTOPOST-CONTENT-CONNECT-014.
 * 검토 대상 = 초안의 현재 리비전. 렌더된 revision_hash를 기대 해시로 보낸다.
 * 원문이 새 버전이면(최신 원문 기준이 아니면) 승인 폼을 내리고 다시 작성을 안내한다(서버도 STALE로 거절).
 * 승인 성공은 서버 확인 뒤에만 표시한다. 실행·작업 생성은 이번에 연결하지 않는다.
 */
export default async function ChannelReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ contentId: string; channel: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const { contentId, channel } = await params;
  const sp = await searchParams;

  if (!isWellFormedId(contentId) || !isChannel(channel)) {
    return (
      <ConsoleShell section="contents" title="승인 검토" crumbs={[{ href: "/admin/distribution/contents", label: "콘텐츠 보관함" }, { label: "승인 검토" }]}>
        <InvalidParam what={isWellFormedId(contentId) ? "채널" : "콘텐츠 ID"} back={{ href: "/admin/distribution/contents", label: "콘텐츠 보관함으로" }} />
      </ConsoleShell>
    );
  }

  const info = CHANNEL_INFO[channel];
  const contentHref = `/admin/distribution/contents/${contentId}`;
  const loaded = await loadContentDetail(contentId);
  const detail = loaded.status === "ok" ? loaded.data : null;
  const draft = detail?.drafts[channel] ?? null;
  const revision = draft?.revision ?? null;
  const canWrite = isWriteConfigured() && detail !== null && !detail.archived && !(draft?.archived ?? false);

  return (
    <ConsoleShell
      section="contents"
      eyebrow="채널별 검토"
      title={`${info.label} 승인 검토`}
      description="채널마다 따로 승인합니다. 원문·초안이 바뀌면 이전 승인은 효력이 없습니다."
      crumbs={[
        { href: "/admin/distribution/contents", label: "콘텐츠 보관함" },
        { href: contentHref, label: "원문" },
        { href: `${contentHref}/channels/${channel}`, label: `${info.label} 초안` },
        { label: "승인 검토" },
      ]}
    >
      <WriteNoticeView notice={sp.notice} />
      <IdLine label="콘텐츠 ID" value={contentId} />
      {loaded.status !== "ok" ? (
        <ReadStateNotice status={loaded.status} what="초안" />
      ) : !detail || !draft || !revision ? (
        <p className="ds-muted">검토할 초안 리비전이 없습니다. 먼저 초안을 저장하세요.</p>
      ) : (
        <div className="dc-split">
          <section aria-labelledby="rv-draft" className="dc-panel">
            <h2 id="rv-draft">검토할 초안 r{revision.revisionNo}</h2>
            {channel === "blog" && detail.current ? (
              <p>
                <strong>{detail.current.title}</strong> <span className="ds-muted">(원문 제목)</span>
              </p>
            ) : null}
            <p style={TEXT_STYLE}>{revision.body}</p>
            {revision.linkUrl ? <p className="ds-muted">링크: {revision.linkUrl}</p> : null}
          </section>

          <section aria-labelledby="rv-decision" className="dc-panel">
            <h2 id="rv-decision">현재 상태: {APPROVAL_LABEL[draft.approval.state]}</h2>
            {draft.approval.state === "rejected" && draft.approval.reason ? <p className="ds-muted">반려 사유: {draft.approval.reason}</p> : null}
            {detail.contentApproval.state !== "approved" ? (
              <p className="dc-tag dc-tag-amber">원문 버전이 아직 승인되지 않았습니다. 실행 준비에는 원문 승인과 채널 승인이 모두 필요합니다.</p>
            ) : null}

            {draft.basedOnLatest === false ? (
              <p className="dc-tag dc-tag-amber">원문이 새 버전으로 바뀌었습니다 — 최신 원문 기준으로 초안을 다시 저장한 뒤 검토하세요.</p>
            ) : draft.approval.state === "approved" ? (
              <ActionForm action={revokeApprovalAction} disabled={!canWrite} className="ds-editor-fields">
                <input type="hidden" name="contentId" value={contentId} />
                <input type="hidden" name="channel" value={channel} />
                <input type="hidden" name="approvalId" value={draft.approval.approvalId} />
                  <p><strong>승인 철회</strong></p>
                  <label htmlFor="rv-revoke-reason">철회 사유(필수)</label>
                  <input id="rv-revoke-reason" name="reason" type="text" required maxLength={1000} />
                  <button type="submit" className="ds-button ds-button--secondary">
                    승인 철회
                  </button>
              </ActionForm>
            ) : (
              <ActionForm action={decideApprovalAction} disabled={!canWrite} className="ds-editor-fields">
                <input type="hidden" name="contentId" value={contentId} />
                <input type="hidden" name="channel" value={channel} />
                <input type="hidden" name="subjectType" value="draft_revision" />
                <input type="hidden" name="subjectId" value={revision.id} />
                <input type="hidden" name="expectedSubjectHash" value={revision.revisionHash} />
                  <p><strong>r{revision.revisionNo} 검토</strong></p>
                  {CHECKLIST.draft_revision.map((i) => (
                    <label key={i.key}>
                      <input type="checkbox" name={`check_${i.key}`} /> {i.label}
                    </label>
                  ))}
                  <label htmlFor="rv-reason">반려 사유(반려할 때 필수)</label>
                  <input id="rv-reason" name="reason" type="text" maxLength={1000} />
                  <div className="ds-actions">
                    <button type="submit" name="decision" value="approved" className="ds-button ds-button--primary">
                      이 리비전 승인
                    </button>
                    <button type="submit" name="decision" value="rejected" className="ds-button ds-button--secondary">
                      반려
                    </button>
                  </div>
              </ActionForm>
            )}
            {!canWrite ? <p className="ds-muted dc-reason">저장 준비 전이거나 보관된 원문·초안이라 결정할 수 없습니다.</p> : null}
          </section>
        </div>
      )}
      <p>
        <Link className="ds-text-link" href={`${contentHref}/channels/${channel}`}>
          초안으로 돌아가기
        </Link>
      </p>
    </ConsoleShell>
  );
}
