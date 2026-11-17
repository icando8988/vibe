/**
 * Threads dry_run 수동 실행기 — 의존성 주입 순수 함수(테스트 대상). AUTOPOST-DRYRUN-EXEC-020.
 *
 * 경계: 이 모듈은 외부 fetch·공급자 클라이언트(threads/client·oauth)·토큰을 import하지 않는다(테스트가 import 목록을 고정).
 *   모의 실행 = 승인 리비전 본문을 Threads 텍스트 규칙으로 검사하는 것뿐. 외부 게시·증거 없음. live gate는 건드리지 않는다.
 * 순서(모두 기존 M2 규칙 위):
 *   1) 세션 actor + D1 → 입력(jobId·렌더된 expectedVersion) → distribution_claim_dry_run_job(지정 작업 1건만, mode=dry_run·
 *      channel=threads·scheduled·보류 없음·예약 도래·근거 재검사 — 근거 문제면 hold만 걸고 선점하지 않음)
 *   2) 검사 실패 → distribution_complete_attempt(failed, never, DRY_RUN_INVALID_TEXT)
 *   3) distribution_advance_phase로 container_requested → container_created → processing → ready → publish_requested
 *      (dry_run은 컨테이너 ID·상태 없음 — M2 함수가 강제)
 *   4) distribution_complete_attempt(dry_run_ok) → dry_run_succeeded/done
 * 단계 오류: 시도를 failed(operator_only, DRY_RUN_STEP_FAILED)로 닫기를 1번 시도. 그것도 실패하면 interrupted —
 *   작업은 dispatching으로 남고 리스 만료 뒤 회수(distribution_recover_expired_leases, 운영 실행기 미구현)로 failed가 된다.
 * 완료 응답 유실: uncertain(성공으로 단정하지 않음, 재전송 없음 — 화면을 새로 불러와 확인).
 * 자동 재시도 없음. 작업 생성만으로는 성공이 아니다.
 */
import { randomBytes } from "node:crypto";
import type { ActorResult } from "../actor-core";
import { mapDistributionDbError, unavailableError, type MappedDbError } from "../errors";
import { isUuid, parseExpectedInt, type FieldError } from "../validation";
import { runDistributionWrite, type RpcClient, type WriteOutcome } from "../write-runner";

export const DRY_RUN_RPC = Object.freeze({
  claim: "distribution_claim_dry_run_job",
  advance: "distribution_advance_phase",
  complete: "distribution_complete_attempt",
} as const);

export const DRY_RUN_PHASES = ["container_requested", "container_created", "processing", "ready", "publish_requested"] as const;
/** Threads 텍스트 글자 수 상한(공급자 문서 기준 알려진 값, threads/client와 같은 값 — 이 모듈은 그 파일을 import하지 않는다). */
export const DRY_RUN_THREADS_TEXT_MAX = 500;
const LEASE_SECONDS = 60;

export type DryRunDeps = {
  resolveActor: () => Promise<ActorResult>;
  getClient: () => RpcClient | null;
  workerId?: () => string;
  leaseSeconds?: number;
};

export type DryRunResult =
  | { status: "succeeded"; textLength: number }
  | { status: "held"; holdReason: string }
  | { status: "failed"; code: "DRY_RUN_INVALID_TEXT" | "DRY_RUN_STEP_FAILED"; stage: string | null }
  | { status: "interrupted"; stage: string; error: MappedDbError }
  | { status: "uncertain"; stage: string };

export type DryRunOutcome = WriteOutcome<DryRunResult>;

/** 모의 검사: 비어 있지 않음, 500자 이하(코드포인트), 줄바꿈 외 제어문자 없음. */
export function checkThreadsDryRunText(body: unknown): { ok: true; length: number } | { ok: false } {
  if (typeof body !== "string" || body.trim().length === 0) return { ok: false };
  const length = [...body].length;
  if (length > DRY_RUN_THREADS_TEXT_MAX || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(body)) return { ok: false };
  return { ok: true, length };
}

type Claimed = { claimed: true; attemptId: string; channel: string; body: unknown } | { claimed: false; holdReason: string };

function parseClaim(d: unknown): Claimed | null {
  const o = d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
  if (!o) return null;
  if (o.claimed === false && typeof o.hold_reason === "string") return { claimed: false, holdReason: o.hold_reason };
  if (o.claimed === true && isUuid(o.attempt_id) && typeof o.channel === "string") return { claimed: true, attemptId: o.attempt_id, channel: o.channel, body: o.body };
  return null;
}

async function call(client: RpcClient, fn: string, params: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: MappedDbError; lost: boolean }> {
  try {
    const r = await client.rpc(fn, params);
    if (r.error) return { ok: false, error: mapDistributionDbError(r.error), lost: false };
    return { ok: true, data: r.data };
  } catch {
    return { ok: false, error: unavailableError(), lost: true };
  }
}

export async function runThreadsDryRun(deps: DryRunDeps, form: { get(name: string): unknown }): Promise<DryRunOutcome> {
  const worker = (deps.workerId ?? (() => `dryrun-${randomBytes(6).toString("hex")}`))();
  let claimClient: RpcClient | null = null;
  const claimed = await runDistributionWrite<{ jobId: string; expectedVersion: number }, Claimed>({
    resolveActor: deps.resolveActor,
    validate: () => {
      const jobId = form.get("jobId");
      const expectedVersion = parseExpectedInt(form.get("expectedVersion"));
      const errors: FieldError[] = [];
      if (!isUuid(jobId)) errors.push({ field: "jobId", rule: "uuid" });
      if (expectedVersion === null) errors.push({ field: "expectedVersion", rule: "expected" });
      if (form.get("confirmDryRun") !== "on") errors.push({ field: "confirmDryRun", rule: "required" });
      if (errors.length || !isUuid(jobId) || expectedVersion === null) return { ok: false, errors };
      return { ok: true, value: { jobId, expectedVersion } };
    },
    getClient: () => (claimClient = deps.getClient()),
    fn: DRY_RUN_RPC.claim,
    params: (actorId, v) => ({ p_actor_id: actorId, p_job_id: v.jobId, p_expected_version: v.expectedVersion, p_worker_id: worker, p_lease_seconds: deps.leaseSeconds ?? LEASE_SECONDS }),
    parse: parseClaim,
  });
  if (claimed.status !== "ok") return claimed;
  if (!claimed.data.claimed) return { status: "ok", data: { status: "held", holdReason: claimed.data.holdReason } };
  const client = claimClient as unknown as RpcClient;
  const jobId = form.get("jobId") as string;
  const attemptId = claimed.data.attemptId;

  const failAttempt = async (code: "DRY_RUN_INVALID_TEXT" | "DRY_RUN_STEP_FAILED", policy: "never" | "operator_only", stage: string | null): Promise<DryRunOutcome> => {
    const r = await call(client, DRY_RUN_RPC.complete, {
      p_job_id: jobId,
      p_attempt_id: attemptId,
      p_worker_id: worker,
      p_outcome: "failed",
      p_error: { code, retryable: policy !== "never", autoRetry: false },
      p_retry_policy: policy,
      p_summary: `manual dry-run ${code}${stage ? ` at ${stage}` : ""}`,
    });
    if (r.ok && r.data === "failed") return { status: "ok", data: { status: "failed", code, stage } };
    return { status: "ok", data: { status: "interrupted", stage: stage ?? "check", error: r.ok ? unavailableError() : r.error } };
  };

  // 2) 모의 검사(외부 호출 없음)
  const check = claimed.data.channel === "threads" ? checkThreadsDryRunText(claimed.data.body) : ({ ok: false } as const);
  if (!check.ok) return failAttempt("DRY_RUN_INVALID_TEXT", "never", null);

  // 3) 단계 진행(기존 advance_phase)
  for (const phase of DRY_RUN_PHASES) {
    const r = await call(client, DRY_RUN_RPC.advance, { p_job_id: jobId, p_attempt_id: attemptId, p_worker_id: worker, p_to_phase: phase, p_lease_seconds: deps.leaseSeconds ?? LEASE_SECONDS });
    if (!r.ok) {
      const closed = await failAttempt("DRY_RUN_STEP_FAILED", "operator_only", phase);
      if (closed.status === "ok" && closed.data.status === "interrupted") return { status: "ok", data: { status: "interrupted", stage: phase, error: r.error } };
      return closed;
    }
  }

  // 4) 완료(기존 complete_attempt dry_run_ok)
  const done = await call(client, DRY_RUN_RPC.complete, {
    p_job_id: jobId,
    p_attempt_id: attemptId,
    p_worker_id: worker,
    p_outcome: "dry_run_ok",
    p_summary: `manual dry-run ok: threads text ${check.length} chars (no external call)`,
  });
  if (done.ok && done.data === "dry_run_succeeded") return { status: "ok", data: { status: "succeeded", textLength: check.length } };
  if (!done.ok && done.lost) return { status: "ok", data: { status: "uncertain", stage: "complete" } };
  return { status: "ok", data: { status: "interrupted", stage: "complete", error: done.ok ? unavailableError() : done.error } };
}

export const DRY_RUN_RESULTS = ["succeeded", "held", "failed", "interrupted", "uncertain"] as const;
export function parseDryRunResult(v: unknown): DryRunResult["status"] | null {
  return typeof v === "string" && (DRY_RUN_RESULTS as readonly string[]).includes(v) ? (v as DryRunResult["status"]) : null;
}
