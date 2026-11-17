import Link from "next/link";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { ReadStateNotice, WriteNoticeView } from "@/components/distribution-console/write-notice-view";
import { isWriteConfigured, loadContentList } from "@/server/distribution/content-page";
import { ActionForm } from "@/components/distribution-console/action-form";
import { createContentAction } from "../actions";

const FIELD_LABELS = { title: "제목", body: "본문", targetPath: "연결할 사이트 경로", changeSummary: "변경 메모" };

export const dynamic = "force-dynamic";
export const metadata = { title: "새 원문" };

/**
 * 새 원문(A1). 저장소 조회가 되고(데이터 구조 존재) 서버 저장 키가 있을 때만 폼이 열린다.
 * 그 밖에는 필드·저장을 비활성으로 두고 이유를 보인다(가짜 저장 없음).
 */
export default async function NewContentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const params = await searchParams;
  const probe = await loadContentList();
  const writeConfigured = isWriteConfigured();
  const canWrite = probe.status === "ok" && writeConfigured;

  return (
    <ConsoleShell
      section="contents"
      eyebrow="공통 원문"
      title="새 원문"
      description="원문을 저장하면 버전 1이 생기고, 그 버전을 기준으로 채널 초안을 만듭니다. 원문 저장은 사이트나 외부 채널에 공개하는 것이 아닙니다."
      crumbs={[{ href: "/admin/distribution/contents", label: "콘텐츠 보관함" }, { label: "새 원문" }]}
    >
      <WriteNoticeView notice={params.notice} />
      {probe.status !== "ok" ? <ReadStateNotice status={probe.status} what="원문 저장소" /> : null}
      <ActionForm action={createContentAction} disabled={!canWrite} legend="원문" className="ds-editor-fields dc-panel" fieldLabels={FIELD_LABELS}>
          <label htmlFor="nc-title">제목(1~200자)</label>
          <input id="nc-title" name="title" type="text" required maxLength={200} />
          <label htmlFor="nc-body">본문</label>
          <textarea id="nc-body" name="body" rows={12} required />
          <label htmlFor="nc-path">연결할 사이트 경로(선택, 예: /about)</label>
          <input id="nc-path" name="targetPath" type="text" maxLength={512} />
          <label htmlFor="nc-summary">변경 메모(선택)</label>
          <input id="nc-summary" name="changeSummary" type="text" maxLength={500} />
          <div className="ds-actions">
            <button type="submit" className="ds-button ds-button--primary">
              원문 저장
            </button>
          </div>
      </ActionForm>
      <p id="new-content-reason" className="ds-muted dc-reason">
        {canWrite
          ? "저장은 서버가 확인한 뒤에만 완료로 표시됩니다. 입력값은 다듬지 않고 그대로 저장합니다."
          : !writeConfigured
            ? "저장 준비 전: 서버 저장 연결이 설정되지 않아 입력할 수 없습니다."
            : "저장 준비 전: 원문 저장소를 확인할 수 없어 입력할 수 없습니다."}
      </p>
      <p>
        <Link className="ds-text-link" href="/admin/distribution/contents">
          콘텐츠 보관함으로
        </Link>
      </p>
    </ConsoleShell>
  );
}
