import Link from "next/link";
import { ActionForm } from "@/components/distribution-console/action-form";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { CONTENT_FLOW } from "@/components/distribution-console/nav";
import { CHANNEL_INFO, CHANNELS, isWellFormedId } from "@/components/distribution-console/readiness";
import { ChannelMark, InvalidParam } from "@/components/distribution-console/states";
import { ReadStateNotice, WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { isWriteConfigured, loadContentDetail } from "@/server/distribution/content-page";
import { APPROVAL_LABEL, CHECKLIST, type ApprovalState } from "@/server/distribution/dto";
import { appendContentVersionAction, decideApprovalAction, revokeApprovalAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "원문" };

const kst = (iso: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + " KST";
const TEXT_STYLE = { whiteSpace: "pre-wrap" as const };

/**
 * W3 원문 — 디자인 A 대표 편집(AUTOPOST-CONTENT-CONNECT-014).
 * 조회: 사용자 세션 + RLS. 쓰기: A2 새 버전, A5 원문 승인·반려, A7 철회(서버 액션 → service RPC).
 * 기대 버전·기대 해시는 이 화면에 렌더된 값 그대로 보낸다. 텍스트는 React 텍스트로만 렌더(HTML 해석 없음).
 */
export default async function ContentDetailPage({
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
  const crumbsBase = [{ href: "/admin/distribution/contents", label: "콘텐츠 보관함" }];

  if (!isWellFormedId(contentId)) {
    return (
      <ConsoleShell section="contents" title="원문" crumbs={[...crumbsBase, { label: "원문" }]}>
        <InvalidParam what="콘텐츠 ID" back={{ href: "/admin/distribution/contents", label: "콘텐츠 보관함으로" }} />
      </ConsoleShell>
    );
  }

  const loaded = await loadContentDetail(contentId);
  const writeConfigured = isWriteConfigured();
  const base = `/admin/distribution/contents/${contentId}`;
  const detail = loaded.status === "ok" ? loaded.data : null;
  const canWrite = writeConfigured && detail !== null && !detail.archived;
  const current = detail?.current ?? null;

  return (
    <ConsoleShell
      section="contents"
      eyebrow="공통 원문"
      title={current ? current.title : "원문"}
      description="원문이 모든 채널의 기준입니다. 원문이 바뀌면 이전 채널 승인은 다시 받아야 합니다."
      crumbs={[...crumbsBase, { label: "원문" }]}
      actions={
        <Link className="ds-button ds-button--secondary" href={`${base}/prepare`}>
          실행 준비 비교
        </Link>
      }
    >
      <WriteNoticeView notice={sp.notice} />
      <ol className="dc-stepflow" aria-label="작업 순서">
        {CONTENT_FLOW.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      {loaded.status !== "ok" ? (
        <ReadStateNotice status={loaded.status} what="원문" />
      ) : !detail ? (
        <p className="ds-muted dc-block">이 원문을 찾지 못했습니다(없거나 볼 권한이 없음).</p>
      ) : (
        <>
          {detail.archived ? <p className="dc-tag dc-tag-amber">보관된 원문 — 수정·승인할 수 없습니다</p> : null}
          {!writeConfigured ? <p className="ds-muted">저장 준비 전: 서버 저장 연결이 설정되지 않아 보기만 할 수 있습니다.</p> : null}
          <div className="dc-split dc-block">
            <section aria-labelledby="cd-source" className="dc-panel">
              <div className="dc-panel-head">
                <h2 id="cd-source">공통 원문</h2>
                <span className="dc-tag">{current ? `v${current.versionNo}` : "버전 없음"}</span>
              </div>
              {current ? (
                <>
                  <p style={TEXT_STYLE}>{current.body}</p>
                  <p className="ds-muted">
                    저장: {kst(current.createdAt)}
                    {current.targetPath ? ` · 연결 경로 ${current.targetPath}` : ""}
                  </p>
                </>
              ) : (
                <p className="ds-muted">아직 저장된 버전이 없습니다.</p>
              )}

              <ContentApproval
                state={detail.contentApproval}
                contentId={contentId}
                subjectId={current?.id ?? null}
                subjectHash={current?.contentHash ?? null}
                canWrite={canWrite && current !== null}
              />

              <details className="dc-block">
                <summary>새 버전으로 수정</summary>
                <ActionForm action={appendContentVersionAction} disabled={!canWrite} className="ds-editor-fields">
                  <input type="hidden" name="contentId" value={contentId} />
                  {/* 렌더 시점 버전 번호. 그 사이 다른 곳에서 저장되면 서버가 충돌로 거절한다. */}
                  <input type="hidden" name="expectedVersionNo" value={String(detail.currentVersionNo)} />
                    <p><strong>원문 v{detail.currentVersionNo + 1}</strong></p>
                    <label htmlFor="cv-title">제목</label>
                    <input id="cv-title" name="title" type="text" required maxLength={200} defaultValue={current?.title ?? ""} />
                    <label htmlFor="cv-body">본문</label>
                    <textarea id="cv-body" name="body" rows={10} required defaultValue={current?.body ?? ""} />
                    <label htmlFor="cv-path">연결할 사이트 경로(선택)</label>
                    <input id="cv-path" name="targetPath" type="text" maxLength={512} defaultValue={current?.targetPath ?? ""} />
                    <label htmlFor="cv-summary">변경 메모(선택)</label>
                    <input id="cv-summary" name="changeSummary" type="text" maxLength={500} />
                    <div className="ds-actions">
                      <button type="submit" className="ds-button ds-button--primary">
                        새 버전 저장
                      </button>
                    </div>
                </ActionForm>
                <p className="ds-muted dc-reason">새 버전을 저장하면 이 원문 기준 채널 초안의 승인은 다시 받아야 합니다.</p>
              </details>

              <section aria-labelledby="cd-history" className="dc-block">
                <h3 id="cd-history">버전 이력</h3>
                {detail.versions.length === 0 ? (
                  <p className="ds-muted">버전 이력이 없습니다.</p>
                ) : (
                  <ul>
                    {detail.versions.map((v) => (
                      <li key={v.id}>
                        v{v.versionNo} · {kst(v.createdAt)}
                        {v.changeSummary ? ` · ${v.changeSummary}` : ""}
                        {v.id === current?.id ? " (현재)" : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </section>

            <section aria-labelledby="cd-channels" className="dc-panel">
              <h2 id="cd-channels">채널 초안·검토</h2>
              <ul className="dc-action-list">
                {CHANNELS.map((c) => {
                  const d = detail.drafts[c];
                  const status = !d
                    ? "초안 없음"
                    : !d.revision
                      ? "초안 생성됨 · 내용 없음"
                      : d.basedOnLatest === false
                        ? `r${d.revision.revisionNo} · 원문 변경됨 — 다시 작성·승인 필요`
                        : `r${d.revision.revisionNo} · ${APPROVAL_LABEL[d.approval.state]}`;
                  return (
                    <li key={c} className="dc-channel-row">
                      <div>
                        <ChannelMark channel={c} />
                        <span>
                          <strong>{CHANNEL_INFO[c].label}</strong>
                          <br />
                          <span className="ds-muted">{status}</span>
                        </span>
                      </div>
                      <Link className="dc-action" href={`${base}/channels/${c}`}>
                        초안 열기 →
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </>
      )}
    </ConsoleShell>
  );
}

/** 원문 버전 승인(A5)·반려·철회(A7). 승인은 확인 항목 전부, 반려·철회는 사유 필수. */
function ContentApproval({
  state,
  contentId,
  subjectId,
  subjectHash,
  canWrite,
}: {
  state: ApprovalState;
  contentId: string;
  subjectId: string | null;
  subjectHash: string | null;
  canWrite: boolean;
}) {
  return (
    <section aria-labelledby="cd-approval" className="dc-block">
      <h3 id="cd-approval">원문 승인: {APPROVAL_LABEL[state.state]}</h3>
      {state.state === "approved" ? (
        <ActionForm action={revokeApprovalAction} disabled={!canWrite} className="ds-editor-fields">
          <input type="hidden" name="contentId" value={contentId} />
          <input type="hidden" name="approvalId" value={state.approvalId} />
            <p><strong>승인 철회</strong></p>
            <label htmlFor="cd-revoke-reason">철회 사유(필수)</label>
            <input id="cd-revoke-reason" name="reason" type="text" required maxLength={1000} />
            <button type="submit" className="ds-button ds-button--secondary">
              승인 철회
            </button>
        </ActionForm>
      ) : subjectId && subjectHash ? (
        <ActionForm action={decideApprovalAction} disabled={!canWrite} className="ds-editor-fields">
          <input type="hidden" name="contentId" value={contentId} />
          <input type="hidden" name="subjectType" value="content_version" />
          <input type="hidden" name="subjectId" value={subjectId} />
          {/* 검토한 내용의 해시(렌더 값). 그 사이 내용이 바뀌면 서버가 거절한다. */}
          <input type="hidden" name="expectedSubjectHash" value={subjectHash} />
            <p><strong>이 버전 검토</strong></p>
            {CHECKLIST.content_version.map((i) => (
              <label key={i.key}>
                <input type="checkbox" name={`check_${i.key}`} /> {i.label}
              </label>
            ))}
            <label htmlFor="cd-reason">반려 사유(반려할 때 필수)</label>
            <input id="cd-reason" name="reason" type="text" maxLength={1000} />
            <div className="ds-actions">
              <button type="submit" name="decision" value="approved" className="ds-button ds-button--primary">
                이 버전 승인
              </button>
              <button type="submit" name="decision" value="rejected" className="ds-button ds-button--secondary">
                반려
              </button>
            </div>
        </ActionForm>
      ) : null}
      {state.state === "rejected" && state.reason ? <p className="ds-muted">반려 사유: {state.reason}</p> : null}
    </section>
  );
}
