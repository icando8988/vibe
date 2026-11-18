/**
 * 초안 생성 런타임 배선(server-only). DRAFT-GEN-001 / task_7fa07439c742 / DRAFT-GEN-QUOTA(task_a1291a313112).
 *
 * - actor: requireDistributionActor(요청마다 auth.getUser 검증 → D1: admin 역할 + approved)
 * - 원문 읽기: getSessionReadSource(사용자 세션 + RLS). service가 설정 확인을 통과한 뒤에만 만든다.
 * - 설정: loadGenerationConfig(process.env) — 서버 전용 env(config.ts). 기본 닫힘.
 * - HTTP: 서버 fetch. service가 설정·원문·한도 확인을 모두 통과한 경우에만 호출된다.
 * - 사용량 한도: buildQuota(process.env, getServiceRpcClient) — 한도 env 4개가 모두 올바르고 service RPC가 있을 때만
 *   distribution_reserve_generation_quota 예약기를 등록한다. 하나라도 없으면 null → not_configured("rate_limit").
 *   (요청 생성 시 client 객체만 만들고 네트워크 호출은 예약 시점에만 한다.)
 */
import "server-only";
import { requireDistributionActor } from "../actor";
import { getServiceRpcClient } from "../blog/service";
import { getSessionReadSource } from "../read-session";
import { loadGenerationConfig } from "./config";
import type { GenerationHttpDeps } from "./openai-chat";
import { buildQuota } from "./quota";
import type { GenerateDraftDeps } from "./service";
import type { AcquireGenerationQuota } from "./types";

const serverHttp: GenerationHttpDeps = {
  fetch: (input, init) => globalThis.fetch(input, init),
  timeoutMs: 60_000,
};

export function createGenerationRuntimeDeps(opts: { acquireQuota?: AcquireGenerationQuota | null } = {}): GenerateDraftDeps {
  return {
    resolveActor: requireDistributionActor,
    getReadSource: getSessionReadSource,
    getConfig: () => loadGenerationConfig(process.env),
    http: serverHttp,
    acquireQuota: opts.acquireQuota !== undefined ? opts.acquireQuota : buildQuota(process.env, getServiceRpcClient),
  };
}
