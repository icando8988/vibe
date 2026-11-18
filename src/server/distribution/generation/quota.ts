/**
 * 생성 요청 수 예약 어댑터(서버, 의존성 주입). DRAFT-GEN-QUOTA.
 * - 한도 값은 서버 전용 env에서 **명시적으로** 받는다(기본값 없음). 하나라도 없거나 형식·범위가 틀리면 not_configured.
 * - 예약은 service_role RPC distribution_reserve_generation_quota 1회(DB가 D1 재검사 + 관리자별·전체 상한을 원자적으로 강제).
 * - RPC 오류·응답 유실·형식 불명은 모두 거절(fail closed) — 공급자 호출로 이어지지 않는다.
 * - 이것은 요청 수 상한이다. 금액 예산은 공급자 프로젝트 예산과 요청당 토큰 상한으로 따로 막는다.
 */
import { isUuid } from "../validation";
import type { RpcClient } from "../write-runner";
import type { AcquireGenerationQuota, GenerationQuotaResult } from "./types";

export const QUOTA_ENV = Object.freeze({
  actorPerMinute: "DISTRIBUTION_AI_ACTOR_PER_MINUTE",
  actorPerDay: "DISTRIBUTION_AI_ACTOR_PER_DAY",
  globalPerMinute: "DISTRIBUTION_AI_GLOBAL_PER_MINUTE",
  globalPerDay: "DISTRIBUTION_AI_GLOBAL_PER_DAY",
} as const);

/** DB 함수와 같은 범위 */
export const QUOTA_RANGES = Object.freeze({
  actorPerMinute: [1, 30],
  actorPerDay: [1, 500],
  globalPerMinute: [1, 120],
  globalPerDay: [1, 5000],
} as const);

export const QUOTA_RPC = "distribution_reserve_generation_quota";

export type QuotaLimits = { actorPerMinute: number; actorPerDay: number; globalPerMinute: number; globalPerDay: number };
export type QuotaLimitsResult = { status: "ok"; limits: QuotaLimits } | { status: "invalid"; fields: Array<keyof QuotaLimits | "relation"> };

const INT_RE = /^[1-9][0-9]{0,4}$/;

export function loadQuotaLimits(env: Readonly<Record<string, string | undefined>>): QuotaLimitsResult {
  const fields: Array<keyof QuotaLimits | "relation"> = [];
  const out = {} as QuotaLimits;
  for (const key of Object.keys(QUOTA_ENV) as Array<keyof QuotaLimits>) {
    const raw = env[QUOTA_ENV[key]];
    const [min, max] = QUOTA_RANGES[key];
    const n = typeof raw === "string" && INT_RE.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < min || n > max) fields.push(key);
    else out[key] = n;
  }
  if (fields.length) return { status: "invalid", fields };
  if (out.actorPerMinute > out.actorPerDay || out.globalPerMinute > out.globalPerDay || out.actorPerMinute > out.globalPerMinute || out.actorPerDay > out.globalPerDay) {
    return { status: "invalid", fields: ["relation"] };
  }
  return { status: "ok", limits: out };
}

const DENY: GenerationQuotaResult = { ok: false, retryAfterSeconds: null };

export function createRpcQuota(client: RpcClient, limits: QuotaLimits): AcquireGenerationQuota {
  return async ({ actorId, channel, model }) => {
    if (!isUuid(actorId)) return DENY;
    let res;
    try {
      res = await client.rpc(QUOTA_RPC, {
        p_actor_id: actorId,
        p_channel: channel,
        p_model: model,
        p_actor_per_minute: limits.actorPerMinute,
        p_actor_per_day: limits.actorPerDay,
        p_global_per_minute: limits.globalPerMinute,
        p_global_per_day: limits.globalPerDay,
      });
    } catch {
      return DENY; // 응답 유실: 예약됐을 수도 있으나 호출하지 않는다(한도 쪽으로 안전)
    }
    if (res.error) return DENY;
    const d = res.data && typeof res.data === "object" && !Array.isArray(res.data) ? (res.data as Record<string, unknown>) : null;
    if (d?.reserved === true && isUuid(d.reservation_id)) return { ok: true };
    if (d?.reserved === false && Number.isInteger(d.retry_after_seconds) && (d.retry_after_seconds as number) >= 1 && (d.retry_after_seconds as number) <= 86_400) {
      return { ok: false, retryAfterSeconds: d.retry_after_seconds as number };
    }
    return DENY; // 형식 불명
  };
}

/** 런타임용: 한도 설정과 service RPC가 모두 있을 때만 예약기를 만든다. 아니면 null(→ not_configured "rate_limit"). */
export function buildQuota(env: Readonly<Record<string, string | undefined>>, getClient: () => RpcClient | null): AcquireGenerationQuota | null {
  const limits = loadQuotaLimits(env);
  if (limits.status !== "ok") return null;
  const client = getClient();
  if (!client) return null;
  return createRpcQuota(client, limits.limits);
}
