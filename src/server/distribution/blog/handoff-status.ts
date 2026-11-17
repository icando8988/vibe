/**
 * 관리자 인계 상태 조회(F-3, REVIEW-009) — 의존성 주입 순수 함수(테스트 대상).
 * 세션 actor + D1 → service RPC(distribution_list_extension_handoffs). RPC가 조회 시점에 본인 인계 중
 * 리스 만료·토큰 철회/만료된 진행 건을 needs_check로 정리한다. 본문·토큰·해시·run은 받지도 돌려주지도 않는다.
 * 화면 연결은 다음 작업(이번에는 모듈·RPC까지).
 */
import { mapDistributionDbError, unavailableError, type MappedDbError } from "../errors";
import { isUuid } from "../validation";
import type { Deps } from "./token-service";
import type { DistributionDenyReason } from "@/components/distribution-console/access";

export const HANDOFF_STATUSES = ["requested", "in_progress", "completed", "publish_ready", "failed", "needs_check", "rejected"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export type HandoffSummary = {
  jobId: string;
  status: HandoffStatus;
  lastCode: string | null;
  requestedAt: string;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type HandoffListOutcome =
  | { status: "ok"; handoffs: HandoffSummary[] }
  | { status: "denied"; reason: DistributionDenyReason }
  | { status: "not_ready" }
  | { status: "db_error"; error: MappedDbError }
  | { status: "bad_response" };

const ALLOWED_KEYS = new Set(["job_id", "status", "last_code", "requested_at", "claimed_at", "lease_expires_at", "finished_at", "updated_at"]);
const str = (v: unknown) => (typeof v === "string" ? v : null);

export async function listExtensionHandoffs(deps: Deps): Promise<HandoffListOutcome> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return { status: "denied", reason: actor.reason };
  const client = deps.getClient();
  if (!client) return { status: "not_ready" };
  let res;
  try {
    res = await client.rpc("distribution_list_extension_handoffs", { p_actor_id: actor.actorId });
  } catch {
    return { status: "db_error", error: unavailableError() };
  }
  if (res.error) return { status: "db_error", error: mapDistributionDbError(res.error) };
  if (!Array.isArray(res.data)) return { status: "bad_response" };
  const out: HandoffSummary[] = [];
  for (const row of res.data) {
    const r = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
    // 예상 밖 열(본문·토큰 등)이 섞이면 전체를 거부한다.
    if (!r || Object.keys(r).some((k) => !ALLOWED_KEYS.has(k))) return { status: "bad_response" };
    const status = r.status;
    if (!isUuid(r.job_id) || typeof status !== "string" || !(HANDOFF_STATUSES as readonly string[]).includes(status)) return { status: "bad_response" };
    const requestedAt = str(r.requested_at);
    const updatedAt = str(r.updated_at);
    if (!requestedAt || !updatedAt) return { status: "bad_response" };
    out.push({
      jobId: r.job_id,
      status: status as HandoffStatus,
      lastCode: str(r.last_code),
      requestedAt,
      claimedAt: str(r.claimed_at),
      leaseExpiresAt: str(r.lease_expires_at),
      finishedAt: str(r.finished_at),
      updatedAt,
    });
  }
  return { status: "ok", handoffs: out };
}

/** needs_check는 사람이 네이버 화면을 확인해야 하는 상태다(자동 재인계 없음). */
export function needsHumanCheck(h: HandoffSummary): boolean {
  return h.status === "needs_check";
}
