import Link from "next/link";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { QuickOriginalPanel } from "@/components/distribution-console/quick-original-panel";
import { ReadStateNotice } from "@/components/distribution-console/write-notice-view";
import { isWriteConfigured, loadContentList } from "@/server/distribution/content-page";
import { createGenerationRuntimeDeps } from "@/server/distribution/generation/runtime";

export const dynamic = "force-dynamic";
export const metadata = { title: "주제로 바로 만들기" };

/**
 * 생성 설정 준비 상태를 항목 이름만으로 판정한다(키·모델 값은 클라이언트로 넘기지 않음, 공급자 호출 없음).
 * 최종 판정은 요청 시 서버 액션이 다시 한다.
 */
function generationMissing(): string[] {
  const deps = createGenerationRuntimeDeps();
  const config = deps.getConfig();
  const missing: string[] = config.status === "ok" ? [] : [...config.missing];
  if (!deps.http) missing.push("http");
  if (!deps.acquireQuota) missing.push("rate_limit");
  return missing;
}

/**
 * 주제로 바로 만들기(task_81ebb056ec4c, 계약 BE-SNS-QUICK-129).
 * 주제 → AI 제목·본문 제안(저장 전) → 검토·수정 → 기존 createContentAction으로 원문 저장 → 기존 원문·채널 초안 흐름.
 * 저장소 조회나 서버 저장 연결이 없으면 비용이 드는 생성도 잠근다. 자동 저장·승인·게시 없음.
 */
export default async function QuickOriginalPage() {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const probe = await loadContentList();
  const writeConfigured = isWriteConfigured();
  const saveDisabledReason =
    probe.status !== "ok"
      ? "원문 저장소를 확인할 수 없어 제안을 받아도 저장할 수 없습니다."
      : !writeConfigured
        ? "서버 저장 연결이 설정되지 않아 제안을 받아도 저장할 수 없습니다."
        : null;

  return (
    <ConsoleShell
      section="overview"
      eyebrow="콘텐츠 시작"
      title="주제로 바로 만들기"
      description="주제를 입력하면 AI가 공통 원문의 제목과 본문을 제안합니다. 사람이 검토·수정해 저장해야 원문이 되고, 승인·게시는 하지 않습니다."
      crumbs={[{ href: "/admin/distribution", label: "SNS 관리" }, { label: "주제로 바로 만들기" }]}
    >
      {probe.status !== "ok" ? <ReadStateNotice status={probe.status} what="원문 저장소" /> : null}
      <QuickOriginalPanel generationMissing={generationMissing()} saveDisabledReason={saveDisabledReason} />
      <p className="dc-block">
        <Link className="ds-text-link" href="/admin/distribution/contents/new">
          AI 없이 직접 작성하기
        </Link>
        {" · "}
        <Link className="ds-text-link" href="/admin/distribution">
          SNS 관리로
        </Link>
      </p>
    </ConsoleShell>
  );
}
