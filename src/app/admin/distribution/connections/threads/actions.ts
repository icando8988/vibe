"use server";

/**
 * Threads 연결 해제(M3 철회). AUTOPOST-THREADS-OAUTH-019 / BE-THREADS-REVOKE-GUARD-059.
 * 세션 actor + D1 → 사전 확인(본인 범위 listConnections에서 대상이 channel=threads이고 렌더된 row_version과 같은지)
 * → 기존 공용 revokeConnection 1회. Instagram 연결 id·위조 id·목록 조회 실패·오래된 버전이면 RPC 0회로 거절한다
 * (Instagram 화면 해제 동작과 같은 사전 확인). credential(암호문)은 DB에서 지워지고 연결은 최종 철회 상태.
 * 채널은 연결 생성 뒤 바뀌지 않으므로 사전 확인 뒤 채널이 바뀌는 경합은 없다(버전은 revoke RPC가 다시 검사).
 * 공급자 쪽 앱 권한 회수(Meta 설정)는 이 동작에 포함되지 않는다 — 화면 안내로 알린다.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDistributionActor } from "@/server/distribution/actor";
import { getServiceRpcClient } from "@/server/distribution/blog/service";
import { listConnections, revokeConnection } from "@/server/distribution/connections/service";
import { failureState, type FormState } from "@/server/distribution/write-notice";

const PAGE = "/admin/distribution/connections/threads";
const deps = { resolveActor: requireDistributionActor, getClient: getServiceRpcClient };

export async function revokeThreadsConnectionAction(prev: FormState, formData: FormData): Promise<FormState> {
  if (formData.get("confirmRevoke") !== "on") return failureState({ status: "invalid", errors: [{ field: "confirmRevoke", rule: "required" }] }, prev);
  const id = formData.get("connectionId");
  const v = formData.get("expectedVersion");
  const expectedVersion = typeof v === "string" && /^[1-9][0-9]{0,8}$/.test(v) ? Number(v) : null;
  if (typeof id !== "string" || id === "" || expectedVersion === null) {
    return failureState({ status: "invalid", errors: [{ field: typeof id !== "string" || id === "" ? "connectionId" : "expectedVersion", rule: "format" }] }, prev);
  }

  // 사전 확인: 이 화면이 다루는 Threads 연결인지. 조회 실패는 그대로 실패 안내(해제 시도 안 함).
  const listed = await listConnections(deps);
  if (listed.status !== "ok") return failureState(listed, prev);
  const target = listed.connections.find((c) => c.id === id);
  if (!target || target.channel !== "threads") return failureState({ status: "invalid", errors: [{ field: "connectionId", rule: "not_threads" }] }, prev);
  if (target.rowVersion !== expectedVersion) return failureState({ status: "db_error", error: { code: "conflict_version", token: null, sqlstate: null } }, prev);

  const out = await revokeConnection(deps, { connectionId: id, expectedVersion, reason: formData.get("reason") || null });
  if (out.status === "ok") {
    revalidatePath(PAGE);
    redirect(`${PAGE}?notice=saved`);
  }
  return failureState(out, prev);
}
