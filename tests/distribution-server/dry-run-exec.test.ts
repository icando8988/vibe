/**
 * AUTOPOST-DRYRUN-EXEC-020 — Threads dry_run 수동 실행기 단위 검증(mock RPC) + 경계·안내·next.config 헤더 순서.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import type { ActorResult } from "@/server/distribution/actor-core";
import { checkThreadsDryRunText, DRY_RUN_PHASES, runThreadsDryRun } from "@/server/distribution/dry-run/executor";
import { jobActions, jobStatusText, toJob, type JobDto } from "@/server/distribution/jobs-dto";
import { writeNoticeOf } from "@/server/distribution/write-notice";
import type { RpcClient } from "@/server/distribution/write-runner";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const allowed = async (): Promise<ActorResult> => ({ ok: true, actorId: ADMIN });
const denied = async (): Promise<ActorResult> => ({ ok: false, reason: "not_approved" });
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
const ok = { jobId: JOB, expectedVersion: "2", confirmDryRun: "on" };

type Impl = (fn: string, p: Record<string, unknown>) => { data: unknown; error: unknown } | "throw";
function rpcOf(impl: Impl) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const rpc = vi.fn(async (fn: string, p: Record<string, unknown>) => {
    calls.push([fn, p]);
    const r = impl(fn, p);
    if (r === "throw") throw new Error("lost");
    return r;
  });
  return { c: { rpc } as unknown as RpcClient, calls };
}
const claimedOk = (body = "모의 실행 본문") => ({ data: { claimed: true, job_id: JOB, attempt_id: ATT, attempt_no: 1, channel: "threads", body, link_url: null }, error: null });
const happy: Impl = (fn, p) => {
  if (fn === "distribution_claim_dry_run_job") return claimedOk();
  if (fn === "distribution_advance_phase") return { data: 3, error: null };
  if (fn === "distribution_complete_attempt") return { data: p.p_outcome === "dry_run_ok" ? "dry_run_succeeded" : "failed", error: null };
  return { data: null, error: { code: "42883", message: "x" } };
};
const deps = (c: RpcClient, actor = allowed) => ({ resolveActor: actor, getClient: () => c, workerId: () => "dryrun-test01" });

describe("경계: 외부 호출·공급자 클라이언트 import 없음", () => {
  it("executor는 fetch·threads/oauth/connections·토큰 모듈을 import하지 않는다", () => {
    const src = readFileSync(join(process.cwd(), "src", "server", "distribution", "dry-run", "executor.ts"), "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../actor-core", "../errors", "../validation", "../write-runner", "node:crypto"].sort());
    expect(/\bfetch\s*\(/.test(src)).toBe(false);
  });
});

describe("모의 검사", () => {
  it("빈 글·500자 초과·제어문자 거절, 줄바꿈 허용", () => {
    expect(checkThreadsDryRunText("안녕\n둘째 줄")).toEqual({ ok: true, length: 7 });
    expect(checkThreadsDryRunText("  ").ok).toBe(false);
    expect(checkThreadsDryRunText("가".repeat(501)).ok).toBe(false);
    expect(checkThreadsDryRunText("a\u0007b").ok).toBe(false);
    expect(checkThreadsDryRunText(null).ok).toBe(false);
  });
});

describe("실행기(mock RPC)", () => {
  it("D1 거부·확인 체크 없음·형식 오류 → RPC 0회", async () => {
    const r = rpcOf(happy);
    expect((await runThreadsDryRun(deps(r.c, denied), form(ok))).status).toBe("denied");
    expect((await runThreadsDryRun(deps(r.c), form({ jobId: JOB, expectedVersion: "2" }))).status).toBe("invalid");
    expect((await runThreadsDryRun(deps(r.c), form({ ...ok, expectedVersion: "0" }))).status).toBe("invalid");
    expect(r.calls).toEqual([]);
  });
  it("성공: 지정 job·렌더 version으로 claim → 기존 advance 5단계 → complete(dry_run_ok), 증거·게시 인자 없음", async () => {
    const r = rpcOf(happy);
    expect(await runThreadsDryRun(deps(r.c), form({ ...ok, p_actor_id: "x" }))).toEqual({ status: "ok", data: { status: "succeeded", textLength: 8 } });
    expect(r.calls.map((c) => c[0] + (c[1].p_to_phase ? `:${c[1].p_to_phase}` : ""))).toEqual([
      "distribution_claim_dry_run_job",
      ...DRY_RUN_PHASES.map((p) => `distribution_advance_phase:${p}`),
      "distribution_complete_attempt",
    ]);
    expect(r.calls[0]?.[1]).toMatchObject({ p_actor_id: ADMIN, p_job_id: JOB, p_expected_version: 2, p_worker_id: "dryrun-test01" });
    const last = r.calls.at(-1)?.[1] ?? {};
    expect(last).toMatchObject({ p_outcome: "dry_run_ok", p_attempt_id: ATT, p_worker_id: "dryrun-test01" });
    expect(["p_external_post_id", "p_external_url", "p_external_account_id"].some((k) => k in last)).toBe(false);
    expect(r.calls.slice(1).every((c) => c[1].p_provider_container_id === undefined && c[1].p_container_status === undefined)).toBe(true);
  });
  it("근거 문제 → held(단계 진행 없음)", async () => {
    const r = rpcOf((fn) => (fn === "distribution_claim_dry_run_job" ? { data: { claimed: false, hold_reason: "approval_revoked" }, error: null } : { data: null, error: null }));
    expect(await runThreadsDryRun(deps(r.c), form(ok))).toEqual({ status: "ok", data: { status: "held", holdReason: "approval_revoked" } });
    expect(r.calls).toHaveLength(1);
  });
  it("본문 검사 실패 → failed(never, DRY_RUN_INVALID_TEXT), 단계 진행 없음", async () => {
    const r = rpcOf((fn, p) => (fn === "distribution_claim_dry_run_job" ? claimedOk("가".repeat(600)) : happy(fn, p)));
    expect(await runThreadsDryRun(deps(r.c), form(ok))).toEqual({ status: "ok", data: { status: "failed", code: "DRY_RUN_INVALID_TEXT", stage: null } });
    expect(r.calls.map((c) => c[0])).toEqual(["distribution_claim_dry_run_job", "distribution_complete_attempt"]);
    expect(r.calls[1]?.[1]).toMatchObject({ p_outcome: "failed", p_retry_policy: "never", p_error: { code: "DRY_RUN_INVALID_TEXT", retryable: false, autoRetry: false } });
  });
  it("단계 오류 → 시도를 failed(operator_only)로 닫음, 닫기도 실패하면 interrupted(성공 아님)", async () => {
    const stepFail: Impl = (fn, p) => (fn === "distribution_advance_phase" && p.p_to_phase === "processing" ? { data: null, error: { code: "55P03", message: "LEASE_NOT_HELD: x" } } : happy(fn, p));
    expect(await runThreadsDryRun(deps(rpcOf(stepFail).c), form(ok))).toEqual({ status: "ok", data: { status: "failed", code: "DRY_RUN_STEP_FAILED", stage: "processing" } });
    const both: Impl = (fn, p) => (fn === "distribution_advance_phase" && p.p_to_phase === "processing" ? "throw" : fn === "distribution_complete_attempt" ? "throw" : happy(fn, p));
    const out = await runThreadsDryRun(deps(rpcOf(both).c), form(ok));
    expect(out.status === "ok" && out.data.status).toBe("interrupted");
    expect(out.status === "ok" && out.data.status === "interrupted" && out.data.stage).toBe("processing");
  });
  it("완료 응답 유실 → uncertain(재전송 없음)", async () => {
    let completes = 0;
    const r = rpcOf((fn, p) => {
      if (fn === "distribution_complete_attempt") {
        completes += 1;
        return "throw";
      }
      return happy(fn, p);
    });
    expect(await runThreadsDryRun(deps(r.c), form(ok))).toEqual({ status: "ok", data: { status: "uncertain", stage: "complete" } });
    expect(completes).toBe(1);
  });
  it("claim 거부 토큰 → 안내 코드", async () => {
    const err = (code: string, message: string) => rpcOf(() => ({ data: null, error: { code, message } })).c;
    expect(writeNoticeOf(await runThreadsDryRun(deps(err("P0001", "VERSION_CONFLICT: job x")), form(ok)))).toBe("conflict_version");
    expect(writeNoticeOf(await runThreadsDryRun(deps(err("23514", "MODE_MISMATCH: only dry-run")), form(ok)))).toBe("invalid_transition");
    expect(writeNoticeOf(await runThreadsDryRun(deps(err("23514", "INVALID_TRANSITION: job is cancelled")), form(ok)))).toBe("invalid_transition");
    expect(writeNoticeOf(await runThreadsDryRun(deps(err("42501", "actor is not")), form(ok)))).toBe("denied");
    expect(writeNoticeOf(await runThreadsDryRun(deps(rpcOf(() => "throw").c), form(ok)))).toBe("uncertain");
  });
});

describe("dry_run 화면 판정", () => {
  const job = (o: Record<string, unknown> = {}) =>
    toJob({
      id: JOB, content_id: JOB, content_version_id: JOB, content_version_no: 1, draft_id: JOB, draft_revision_id: JOB, channel: "threads", mode: "dry_run",
      status: "scheduled", hold_reason: null, retry_policy: null, last_error: null, reconciliation_required: false, has_issues: false, external_id: null,
      external_url: null, version: 1, phase: "none", scheduled_at: null, lease_expires_at: null, attempts: 0, created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z", ...o,
    }) as JobDto;
  const NOW = Date.parse("2026-11-17T01:00:00Z");
  it("실행 가능: scheduled·보류 없음·예약 도래만", () => {
    expect(jobActions(job(), null, NOW).runDryRun).toBe(true);
    expect(jobActions(job({ scheduled_at: "2026-11-18T00:00:00Z" }), null, NOW).runDryRun).toBe(false);
    expect(jobActions(job({ hold_reason: "approval_revoked" }), null, NOW).runDryRun).toBe(false);
    expect(jobActions(job({ mode: "live" }), null, NOW).runDryRun).toBe(false);
    expect(jobActions(job({ mode: "manual", status: "manual_ready" }), null, NOW).runDryRun).toBe(false);
    expect(jobActions(job({ status: "dry_run_succeeded", phase: "done" }), null, NOW).runDryRun).toBe(false);
  });
  it("진행·멈춤·회수 실패·성공을 구분해 안내, 성공도 외부 게시 아님", () => {
    expect(jobStatusText(job({ status: "dispatching" }))).toBe("모의 실행 중");
    expect(jobActions(job({ status: "dispatching", lease_expires_at: "2026-11-17T00:30:00Z" }), null, NOW).warnings.join(" ")).toContain("중간에 멈췄습니다");
    expect(jobActions(job({ status: "dispatching", lease_expires_at: "2026-11-17T02:00:00Z" }), null, NOW).warnings.join(" ")).toContain("모의 실행 중입니다");
    expect(jobActions(job({ status: "failed", last_error: { code: "LEASE_EXPIRED_BEFORE_CONTAINER" } }), null, NOW).warnings.join(" ")).toContain("만료돼 실패로 회수");
    expect(jobActions(job({ status: "dry_run_succeeded", phase: "done" }), null, NOW).warnings.join(" ")).toContain("외부에 게시하지 않았고");
    expect(jobStatusText(job({ hold_reason: "stale" }))).toBe("모의 실행 보류");
    // 회수 실패 문자열은 정상 상태로 매핑하지 않음
    expect(job({ status: "recovery_failed:23514" }).status).toBe("unrecognized");
  });
});

describe("next.config: OAuth 경로 no-referrer가 전역 값보다 뒤", () => {
  it("헤더 규칙 순서", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const idxGlobal = rules.findIndex((r) => r.source === "/:path*");
    const idxOauth = rules.findIndex((r) => r.source === "/api/distribution/oauth/:path*");
    expect(idxOauth).toBeGreaterThan(idxGlobal);
    expect(rules[idxOauth]?.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
    expect(rules.slice(idxOauth + 1).some((r) => r.headers.some((h) => h.key === "Referrer-Policy"))).toBe(false);
  });
});
