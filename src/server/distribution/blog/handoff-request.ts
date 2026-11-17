/**
 * 관리자 쪽 "확장으로 보내기" 요청 — 의존성 주입 순수 함수(테스트 대상). AUTOPOST-BLOG-HANDOFF-007.
 * 세션 actor + D1 → job uuid 검증 → service RPC(distribution_request_extension_handoff).
 * 화면 버튼 연결은 UI 범위라 이번에 하지 않았다(다음 작업).
 */
import { runDistributionWrite, type WriteOutcome } from "../write-runner";
import { isUuid } from "../validation";
import type { Deps } from "./token-service";
import { HANDOFF_RPC } from "./handoff";

export type HandoffRequested = { handoffId: string; jobId: string; refreshed: boolean };

export function requestExtensionHandoff(deps: Deps, form: { jobId: unknown }): Promise<WriteOutcome<HandoffRequested>> {
  return runDistributionWrite<string, HandoffRequested>({
    resolveActor: deps.resolveActor,
    validate: () => (isUuid(form.jobId) ? { ok: true, value: form.jobId } : { ok: false, errors: [{ field: "jobId", rule: "uuid" }] }),
    getClient: deps.getClient,
    fn: HANDOFF_RPC.request,
    params: (actorId, jobId) => ({ p_actor_id: actorId, p_job_id: jobId }),
    parse: (data) => {
      const d = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
      if (!d || !isUuid(d.handoff_id) || !isUuid(d.job_id) || typeof d.refreshed !== "boolean") return null;
      return { handoffId: d.handoff_id, jobId: d.job_id, refreshed: d.refreshed };
    },
  });
}
