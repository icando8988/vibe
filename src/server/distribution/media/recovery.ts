/**
 * 직접 업로드 소비 후 고착 복구(시스템 작업) — BE-UPLOAD-RECOVERY-030. 의존성 주입 순수 함수(시험 대상).
 * migration 20261116140000 `distribution_recover_stalled_media_uploads(p_limit, p_stall_seconds)` 호출 래퍼.
 *
 * - 화면·사용자 요청 경로에서 부르지 않는다. 호출 주체(Cron 등)는 아직 없다(후속 작업).
 * - stall 하한 600초의 근거는 "완료 라우트 maxDuration 60초가 플랫폼에서 강제된다"는 전제다.
 *   그 전제가 없는 실행(자가 호스팅 `next start` 등)에서는 자동 호출을 **비활성**한다 → `disabled`.
 *   판정은 `runtimeEnforcesMaxDuration`(호출자가 명시) 하나뿐이며, 기본값은 비활성이다.
 * - Storage 원본·변형은 지우지 않는다(후속 sweep 범위). 재시도 없음.
 */
import { mapDistributionDbError, type MappedDbError } from "../errors";
import type { RpcClient } from "../write-runner";

export const RECOVERY_RPC = "distribution_recover_stalled_media_uploads";
export const STALL_POLICY = Object.freeze({
  minStallSeconds: 600,
  maxStallSeconds: 86_400,
  /** 권장 호출값(완료 라우트 maxDuration 60초의 15배). */
  recommendedStallSeconds: 900,
  maxLimit: 500,
});

export type RecoveryResult =
  | { status: "recovered"; count: number }
  /** 런타임이 maxDuration을 강제한다는 근거가 없어 실행하지 않음(자가 호스팅 등). */
  | { status: "disabled" }
  | { status: "not_ready" }
  | { status: "invalid"; field: "limit" | "stallSeconds" }
  | { status: "db_error"; error: MappedDbError }
  /** 응답 유실 — 일부가 복구됐을 수 있음(멱등이라 다음 주기에 다시 불러도 안전). */
  | { status: "unavailable" };

/** Vercel 런타임 표시(`VERCEL=1`, 비밀 아님)만 강제 근거로 본다. 그 밖은 false. */
export function runtimeEnforcesMaxDuration(env: Record<string, string | undefined>): boolean {
  return env.VERCEL === "1";
}

export async function recoverStalledUploads(
  deps: { getClient: () => RpcClient | null; runtimeEnforcesMaxDuration: boolean },
  input: { limit: number; stallSeconds?: number },
): Promise<RecoveryResult> {
  if (!deps.runtimeEnforcesMaxDuration) return { status: "disabled" };
  const stall = input.stallSeconds ?? STALL_POLICY.recommendedStallSeconds;
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > STALL_POLICY.maxLimit) return { status: "invalid", field: "limit" };
  if (!Number.isInteger(stall) || stall < STALL_POLICY.minStallSeconds || stall > STALL_POLICY.maxStallSeconds) return { status: "invalid", field: "stallSeconds" };
  const client = deps.getClient();
  if (!client) return { status: "not_ready" };
  try {
    const r = await client.rpc(RECOVERY_RPC, { p_limit: input.limit, p_stall_seconds: stall });
    if (r.error) return { status: "db_error", error: mapDistributionDbError(r.error) };
    return Number.isInteger(r.data) && (r.data as number) >= 0 ? { status: "recovered", count: r.data as number } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
