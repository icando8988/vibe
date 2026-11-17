import Link from "next/link";
import { ActionForm } from "@/components/distribution-console/action-form";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { CHANNEL_INFO, CHANNELS, isChannel, isWellFormedId } from "@/components/distribution-console/readiness";
import { IdLine, InvalidParam, ModeTable } from "@/components/distribution-console/states";
import { ReadStateNotice, WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { isWriteConfigured, loadContentDetail } from "@/server/distribution/content-page";
import { APPROVAL_LABEL } from "@/server/distribution/dto";
import { appendDraftRevisionAction, createChannelDraftAction } from "../../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "채널 초안" };

const TEXT_STYLE = { whiteSpace: "pre-wrap" as const };

/**
 * W4 채널 초안(A3 만들기, A4 리비전 저장) — AUTOPOST-CONTENT-CONNECT-014.
 * 기대 리비전 번호와 기대 원문 버전 ID는 렌더 값 그대로 보낸다(원문이 그 사이 바뀌면 STALE_CONTENT_VERSION).
 * Blog 제목은 원문 버전 title을 그대로 쓴다(리비전에 별도 제목 없음). 이미지·대상 계정은 아직 연결하지 않는다.
 */
export default async function ChannelDraftPage({
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
  const contentHref = `/admin/distribution/contents/${contentId}`;

  if (!isWellFormedId(contentId) || !isChannel(channel)) {
    return (
      <ConsoleShell section="contents" title="채널 초안" crumbs={[{ href: "/admin/distribution/contents", label: "콘텐츠 보관함" }, { label: "채널 초안" }]}>
        <InvalidParam what={isWellFormedId(contentId) ? "채널" : "콘텐츠 ID"} back={{ href: "/admin/distribution/contents", label: "콘텐츠 보관함으로" }} />
      </ConsoleShell>
    );
  }

  const info = CHANNEL_INFO[channel];
  const loaded = await loadContentDetail(contentId);
  const detail = loaded.status === "ok" ? loaded.data : null;
  const draft = detail?.drafts[channel] ?? null;
  const current = detail?.current ?? null;
  const canWrite = isWriteConfigured() && detail !== null && !detail.archived && !(draft?.archived ?? false);

  return (
    <ConsoleShell
      section="contents"
      eyebrow="채널 초안"
      title={`${info.label} 초안`}
      description={info.focus}
      crumbs={[
        { href: "/admin/distribution/contents", label: "콘텐츠 보관함" },
        { href: contentHref, label: "원문" },
        { label: `${info.label} 초안` },
      ]}
    >
      <WriteNoticeView notice={sp.notice} />
      <IdLine label="콘텐츠 ID" value={contentId} />
      <nav aria-label="채널 초안 이동" className="dc-channel-links">
        <ul>
          {CHANNELS.map((c) => (
            <li key={c}>
              <Link href={`${contentHref}/channels/${c}`} aria-current={c === channel ? "page" : undefined}>
                {CHANNEL_INFO[c].label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {loaded.status !== "ok" ? (
        <ReadStateNotice status={loaded.status} what="원문·초안" />
      ) : !detail ? (
        <p className="ds-muted">이 원문을 찾지 못했습니다(없거나 볼 권한이 없음).</p>
      ) : !current ? (
        <p className="ds-muted">원문을 먼저 저장해야 초안을 만들 수 있습니다.</p>
      ) : (
        <div className="dc-split">
          <section aria-labelledby="ch-source" className="dc-panel">
            <h2 id="ch-source">기준 원문 v{current.versionNo}</h2>
            <p>
              <strong>{current.title}</strong>
            </p>
            <p style={TEXT_STYLE}>{current.body}</p>
          </section>

          <section aria-labelledby="ch-draft" className="dc-panel">
            <div className="dc-panel-head">
              <h2 id="ch-draft">{info.label} 초안</h2>
              <span className="dc-tag">{draft?.revision ? `r${draft.revision.revisionNo} · ${APPROVAL_LABEL[draft.approval.state]}` : "초안 없음"}</span>
            </div>
            {draft?.basedOnLatest === false ? (
              <p className="dc-tag dc-tag-amber">원문이 새 버전으로 바뀌었습니다 — 최신 원문 기준으로 다시 저장한 뒤 검토하세요</p>
            ) : null}

            {!draft ? (
              <ActionForm action={createChannelDraftAction} disabled={!canWrite} className="">
                <input type="hidden" name="contentId" value={contentId} />
                <input type="hidden" name="channel" value={channel} />
                  <p className="ds-muted"><strong>이 원문의 {info.label} 초안이 아직 없습니다.</strong></p>
                  <button type="submit" className="ds-button ds-button--primary">
                    {info.label} 초안 만들기
                  </button>
              </ActionForm>
            ) : (
              <ActionForm action={appendDraftRevisionAction} disabled={!canWrite} className="ds-editor-fields">
                <input type="hidden" name="contentId" value={contentId} />
                <input type="hidden" name="channel" value={channel} />
                <input type="hidden" name="draftId" value={draft.id} />
                {/* 렌더 값 그대로: 그 사이 초안·원문이 바뀌면 서버가 충돌·stale로 거절한다. */}
                <input type="hidden" name="expectedRevisionNo" value={String(draft.currentRevisionNo)} />
                <input type="hidden" name="expectedContentVersionId" value={current.id} />
                {/* 이 화면이 편집하지 않는 값은 직전 리비전 값을 그대로 보존(빈 값으로 소실 방지) */}
                <input type="hidden" name="preserveUtm" value={JSON.stringify(draft.revision?.utm ?? {})} />
                <input type="hidden" name="preserveMedia" value={JSON.stringify(draft.revision?.media ?? [])} />
                <input type="hidden" name="preserveTargetConnectionId" value={draft.revision?.targetConnectionId ?? ""} />
                <input type="hidden" name="preserveTargetAccountId" value={draft.revision?.targetExternalAccountId ?? ""} />
                  <p><strong>
                    r{draft.currentRevisionNo + 1} 저장(원문 v{current.versionNo} 기준)
                  </strong></p>
                  {channel === "blog" ? <p className="ds-muted">Blog 제목은 원문 제목을 그대로 씁니다: {current.title}</p> : null}
                  <label htmlFor="d-body">{channel === "instagram" ? "캡션" : channel === "threads" ? "글" : "본문"}</label>
                  <textarea id="d-body" name="body" rows={12} required defaultValue={draft.revision?.body ?? current.body} />
                  {channel === "threads" ? (
                    <>
                      <label htmlFor="d-link">링크(선택, https)</label>
                      <input id="d-link" name="linkUrl" type="url" defaultValue={draft.revision?.linkUrl ?? ""} />
                    </>
                  ) : null}
                  <div className="ds-actions">
                    <button type="submit" className="ds-button ds-button--primary">
                      초안 저장
                    </button>
                    <Link className="ds-button ds-button--secondary" href={`${contentHref}/channels/${channel}/review`}>
                      승인 검토
                    </Link>
                  </div>
              </ActionForm>
            )}
            {!canWrite ? <p className="ds-muted dc-reason">저장 준비 전이거나 보관된 원문·초안이라 저장할 수 없습니다.</p> : null}
            {channel === "instagram" ? (
              <p className="ds-muted">
                이 초안에 이미지 1장을 붙이는 화면은 아직 없습니다. 이미지 없는 캡션은 게시 준비가 아닙니다. 게시에 쓸 이미지의 처리·권리 상태는{" "}
                <Link className="ds-text-link" href="/admin/distribution/media">
                  미디어·권리
                </Link>
                에서 확인합니다.
              </p>
            ) : null}
          </section>
        </div>
      )}

      <section aria-labelledby="draft-modes" className="dc-block">
        <h2 id="draft-modes">실행 방식</h2>
        <ModeTable channel={channel} />
      </section>
    </ConsoleShell>
  );
}
