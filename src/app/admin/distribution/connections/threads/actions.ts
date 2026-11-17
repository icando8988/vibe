"use server";

/**
 * Threads 연결 해제(M3 철회). AUTOPOST-THREADS-OAUTH-019.
 * 세션 actor + D1 → 렌더된 row_version 그대로 → service RPC 1회. credential(암호문)은 DB에서 지워지고 연결은 최종 철회 상태.
 * 공급자 쪽 앱 권한 회수(Meta 설정)는 이 동작에 포함되지 않는다 — 화면 안내로 알린다.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDistributionActor } from "@/server/distribution/actor";
import { getServiceRpcClient } from "@/server/distribution/blog/service";
import { revokeConnection } from "@/server/distribution/connections/service";
import { failureState, type FormState } from "@/server/distribution/write-notice";

const PAGE = "/admin/distribution/connections/threads";

export async function revokeThreadsConnectionAction(prev: FormState, formData: FormData): Promise<FormState> {
  if (formData.get("confirmRevoke") !== "on") return failureState({ status: "invalid", errors: [{ field: "confirmRevoke", rule: "required" }] }, prev);
  const v = formData.get("expectedVersion");
  const out = await revokeConnection(
    { resolveActor: requireDistributionActor, getClient: getServiceRpcClient },
    { connectionId: formData.get("connectionId"), expectedVersion: typeof v === "string" && /^[1-9][0-9]{0,8}$/.test(v) ? Number(v) : null, reason: formData.get("reason") || null },
  );
  if (out.status === "ok") {
    revalidatePath(PAGE);
    redirect(`${PAGE}?notice=saved`);
  }
  return failureState(out, prev);
}
