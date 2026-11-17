"use server";

/**
 * 작업 화면 서버 액션(A9~A14 + 확장 인계 요청). AUTOPOST-BLOG-FLOW-015.
 * 검증된 세션 actor + D1 → 렌더된 expected_version 그대로 → service RPC 1회. 자동 재전송 없음.
 * 성공: redirect(+notice=saved). 실패: 폼 상태만(입력은 클라이언트 폼에 남음).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDistributionActor } from "@/server/distribution/actor";
import { requestExtensionHandoff } from "@/server/distribution/blog/handoff-request";
import { getServiceRpcClient } from "@/server/distribution/blog/service";
import { abandonManualJob, cancelJob, markManualPosted, markManualUncertain, recordManualEvidence, recordReconciliation } from "@/server/distribution/jobs-service";
import { isUuid } from "@/server/distribution/validation";
import { failureState, type FormState } from "@/server/distribution/write-notice";
import type { WriteOutcome } from "@/server/distribution/write-runner";

const deps = { resolveActor: requireDistributionActor, getClient: getServiceRpcClient };

function jobPath(id: unknown, tail = ""): string {
  return isUuid(id) ? `/admin/distribution/jobs/${id}${tail}` : "/admin/distribution/jobs";
}

function finish(out: WriteOutcome<unknown>, prev: FormState, formData: FormData, tail: string): FormState {
  if (out.status === "ok") {
    const path = jobPath(formData.get("jobId"), tail);
    revalidatePath(path);
    revalidatePath("/admin/distribution/jobs");
    redirect(`${path}?notice=saved`);
  }
  return failureState(out, prev);
}

export async function markManualPostedAction(prev: FormState, fd: FormData) {
  return finish(await markManualPosted(deps, fd), prev, fd, "/manual");
}
export async function recordManualEvidenceAction(prev: FormState, fd: FormData) {
  return finish(await recordManualEvidence(deps, fd), prev, fd, "/manual");
}
export async function abandonManualJobAction(prev: FormState, fd: FormData) {
  return finish(await abandonManualJob(deps, fd), prev, fd, "");
}
export async function markManualUncertainAction(prev: FormState, fd: FormData) {
  return finish(await markManualUncertain(deps, fd), prev, fd, "/reconcile");
}
export async function recordReconciliationAction(prev: FormState, fd: FormData) {
  return finish(await recordReconciliation(deps, fd), prev, fd, "");
}
export async function cancelJobAction(prev: FormState, fd: FormData) {
  return finish(await cancelJob(deps, fd), prev, fd, "");
}
/** 확장으로 보내기(manual_ready·blog만, 서버 SQL이 최종 판단). 성공은 '요청됨'이지 입력·게시가 아니다. */
export async function requestHandoffAction(prev: FormState, fd: FormData) {
  return finish(await requestExtensionHandoff(deps, { jobId: fd.get("jobId") }), prev, fd, "/manual");
}
