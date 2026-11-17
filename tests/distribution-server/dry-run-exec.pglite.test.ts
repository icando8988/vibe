/**
 * AUTOPOST-DRYRUN-EXEC-020 — Threads dry_run 수동 실행 서비스 → RPC 왕복(PGlite 대역).
 * `PGLITE_PROJECT`가 있을 때만 실행(평소 npm test에서는 건너뜀 — 통과로 세지 않음).
 * 실행: node web/scripts/distribution-local-verify/dry-run-exec-run.mjs --pglite-project <dir>
 * 주의: PGlite는 단일 연결이라 "동시" 호출도 직렬로 실행된다 — 다중 connection 동시성 증명이 아니다(행 잠금·버전 검사 논리만 확인).
 * 실제 Threads/Meta·Supabase 호출 없음(globalThis.fetch 호출 0회 확인).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { decideApproval, revokeApproval } from "@/server/distribution/approval-service";
import { appendContentVersion, appendDraftRevision, createChannelDraft, createContent } from "@/server/distribution/content-service";
import { runThreadsDryRun } from "@/server/distribution/dry-run/executor";
import { getJobDetail } from "@/server/distribution/jobs-read";
import { cancelJob, createBlogManualJob, createThreadsDryRunJob } from "@/server/distribution/jobs-service";
import { getContentDetail } from "@/server/distribution/read";
import { writeNoticeOf } from "@/server/distribution/write-notice";
import type { RpcClient } from "@/server/distribution/write-runner";
import { openDb, readSourceOf, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const U = { admin: "00000000-0000-4000-8000-00000000000a", pending: "00000000-0000-4000-8000-0000000000c1" };
let db: Db;
let rpc: RpcClient;
const fetchSpy = vi.spyOn(globalThis, "fetch");
const as = (id: string) => async (): Promise<ActorResult> => ({ ok: true, actorId: id });
const deps = (id = U.admin, client?: () => RpcClient) => ({ resolveActor: as(id), getClient: client ?? (() => rpc) });
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
const read = () => readSourceOf(db, U.admin);
const REV_CHECKS = { check_matches_content: "on", check_facts_checked: "on", check_links_checked: "on", check_media_rights_checked: "on" };

async function owner<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("set role supa_owner");
  try {
    return (await db.query(sql, params)).rows as T[];
  } finally {
    await db.exec("reset role");
  }
}
async function job(id: string) {
  const d = await getJobDetail(read(), id);
  if (d.status !== "ok" || !d.data) throw new Error("job");
  return d.data;
}
/** 승인된 원문 + 채널 리비전 */
async function approved(title: string, channel: "threads" | "blog", body = `${title} 본문`) {
  const c = await createContent(deps(), form({ title, body: `${title} 원문` }));
  if (c.status !== "ok") throw new Error("content");
  const d = await getContentDetail(read(), c.data.contentId);
  if (d.status !== "ok" || !d.data?.current) throw new Error("detail");
  const v = d.data.current;
  await decideApproval(deps(), form({ subjectType: "content_version", subjectId: v.id, decision: "approved", expectedSubjectHash: v.contentHash, check_facts_checked: "on", check_sources_checked: "on", check_public_ok: "on" }));
  const dr = await createChannelDraft(deps(), form({ contentId: c.data.contentId, channel }));
  if (dr.status !== "ok") throw new Error("draft");
  const rev = await appendDraftRevision(deps(), form({ draftId: dr.data.draftId, expectedRevisionNo: "0", expectedContentVersionId: v.id, body }));
  if (rev.status !== "ok") throw new Error(`rev ${JSON.stringify(rev)}`);
  const a = await decideApproval(deps(), form({ subjectType: "draft_revision", subjectId: rev.data.revisionId, decision: "approved", expectedSubjectHash: rev.data.revisionHash, ...REV_CHECKS }));
  if (a.status !== "ok") throw new Error("approve");
  return { cid: c.data.contentId, revId: rev.data.revisionId, versionNo: v.versionNo };
}
async function dryJob(title: string, body?: string) {
  const p = await approved(title, "threads", body);
  const out = await createThreadsDryRunJob(deps(), form({ draftRevisionId: p.revId, channel: "threads" }));
  if (out.status !== "ok") throw new Error(`job ${JSON.stringify(out)}`);
  return { ...p, jobId: out.data };
}
const run = (jobId: string, version: number, id = U.admin, client?: () => RpcClient) =>
  runThreadsDryRun(deps(id, client), form({ jobId, expectedVersion: String(version), confirmDryRun: "on" }));

describe.skipIf(!PROJECT)("PGlite 왕복: Threads dry_run 수동 실행", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [U.admin, U.pending], [U.pending], [U.admin, U.pending]);
    db = opened.db;
    rpc = rpcClientOf(db, new Set(["distribution_recover_expired_leases"]));
    expect(opened.applied).toContain("20261116110000_distribution_dry_run_dispatch.sql");
    console.log(`applied: ${opened.applied.map((f) => f.slice(0, 14)).join(", ")}`);
  }, 120_000);
  afterAll(() => {
    expect(fetchSpy).not.toHaveBeenCalled(); // 외부 호출 0
  });

  it("ACL: 선점 RPC는 service_role만", async () => {
    const acl = await owner<{ a: boolean; u: boolean; s: boolean; d: boolean }>(
      `select has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u,
              has_function_privilege('service_role', p.oid, 'EXECUTE') s, p.prosecdef d
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'distribution_claim_dry_run_job'`,
    );
    expect(acl).toEqual([{ a: false, u: false, s: true, d: true }]);
  });

  it("생성만으로는 성공 아님 → 실행 → dry_run_succeeded/done, 증거 없음, 다른 작업 비선점", async () => {
    const a = await dryJob("실행 A");
    const b = await dryJob("대기 B");
    let ja = await job(a.jobId);
    expect([ja.job.status, ja.job.phase, ja.job.attempts]).toEqual(["scheduled", "none", 0]);
    expect(writeNoticeOf(await run(a.jobId, ja.job.version, U.pending))).toBe("denied");

    const out = await run(a.jobId, ja.job.version);
    expect(out).toMatchObject({ status: "ok", data: { status: "succeeded" } });
    ja = await job(a.jobId);
    expect([ja.job.status, ja.job.phase, ja.job.attempts, ja.job.externalUrl, ja.job.externalId]).toEqual(["dry_run_succeeded", "done", 1, null, null]);
    expect(ja.evidence).toEqual([]);
    expect(ja.events.map((e) => e.reasonCode)).toEqual(expect.arrayContaining(["claimed", "phase_advanced", "dry_run_succeeded"]));
    const att = await owner<{ outcome: string; phase_reached: string; provider_container_id: string | null; publish_requested_at: string | null }>(
      "select outcome, phase_reached, provider_container_id, publish_requested_at from public.distribution_job_attempts where job_id = $1::uuid", [a.jobId],
    );
    expect(att.map((x) => [x.outcome, x.phase_reached, x.provider_container_id])).toEqual([["dry_run_ok", "done", null]]);
    // 다른 작업은 그대로
    const jb = await job(b.jobId);
    expect([jb.job.status, jb.job.attempts]).toEqual(["scheduled", 0]);
    // 같은 version 재실행 → 충돌, 새 version → 상태 전이 거부(재실행·재게시 없음)
    expect(writeNoticeOf(await run(a.jobId, 1))).toBe("conflict_version");
    expect(writeNoticeOf(await run(a.jobId, ja.job.version))).toBe("invalid_transition");
  });

  it("동시 두 요청(같은 렌더 version) → 하나만 선점(PGlite는 직렬 — 동시성 증명 아님)", async () => {
    const p = await dryJob("동시");
    const v = (await job(p.jobId)).job.version;
    const [x, y] = await Promise.all([run(p.jobId, v), run(p.jobId, v)]);
    const kinds = [x, y].map((o) => (o.status === "ok" ? o.data.status : writeNoticeOf(o))).sort();
    expect(kinds).toEqual(["conflict_version", "succeeded"]);
    const att = await owner("select 1 from public.distribution_job_attempts where job_id = $1::uuid", [p.jobId]);
    expect(att.length).toBe(1);
  });

  it("승인 철회·원문 새 버전(stale) → 선점 없이 보류, 이후 실행 거부", async () => {
    const p = await dryJob("철회");
    const d = await getContentDetail(read(), p.cid);
    const appr = d.status === "ok" ? d.data?.drafts.threads?.approval : null;
    if (!appr || appr.state !== "approved") throw new Error("approval");
    await revokeApproval(deps(), form({ approvalId: appr.approvalId, reason: "다시 검토" }));
    const v = (await job(p.jobId)).job.version;
    expect(await run(p.jobId, v)).toEqual({ status: "ok", data: { status: "held", holdReason: "approval_revoked" } });
    let j = await job(p.jobId);
    expect([j.job.status, j.job.holdReason, j.job.attempts]).toEqual(["scheduled", "approval_revoked", 0]);
    expect(writeNoticeOf(await run(p.jobId, j.job.version))).toBe("invalid_transition");

    const s = await dryJob("최신성");
    await appendContentVersion(deps(), form({ contentId: s.cid, expectedVersionNo: String(s.versionNo), title: "바뀐 원문", body: "새 본문" }));
    j = await job(s.jobId);
    expect(await run(s.jobId, j.job.version)).toEqual({ status: "ok", data: { status: "held", holdReason: "stale" } });
  });

  it("취소·미래 예약·다른 모드/채널 거부, 작업 변경 없음", async () => {
    const c = await dryJob("취소");
    let j = await job(c.jobId);
    await cancelJob(deps(), form({ jobId: c.jobId, expectedVersion: String(j.job.version), confirmCancel: "on" }));
    j = await job(c.jobId);
    expect(writeNoticeOf(await run(c.jobId, j.job.version))).toBe("invalid_transition");

    // 미래 예약(dry_run 예약은 화면에 없어 RPC 직접 생성)
    const f = await approved("미래", "threads");
    const fut = await rpc.rpc("distribution_create_job", { p_actor_id: U.admin, p_draft_revision_id: f.revId, p_mode: "dry_run", p_scheduled_at: new Date(Date.now() + 3_600_000).toISOString(), p_schedule_tz: null, p_max_attempts: 3, p_allow_republish: false });
    const futId = fut.data as string;
    const fr = await run(futId, (await job(futId)).job.version);
    expect(fr.status === "db_error" && fr.error.token).toBe("NOT_DUE");
    expect((await job(futId)).job.status).toBe("scheduled");

    // Blog manual 작업 → MODE_MISMATCH(manual 흐름 영향 없음)
    const m = await approved("블로그", "blog");
    const mj = await createBlogManualJob(deps(), form({ draftRevisionId: m.revId }));
    if (mj.status !== "ok") throw new Error("manual");
    expect(writeNoticeOf(await run(mj.data, (await job(mj.data)).job.version))).toBe("invalid_transition");
    expect((await job(mj.data)).job.status).toBe("manual_ready");
    // Blog dry_run(RPC 직접) → CHANNEL_NOT_SUPPORTED
    const bd = await rpc.rpc("distribution_create_job", { p_actor_id: U.admin, p_draft_revision_id: m.revId, p_mode: "dry_run", p_scheduled_at: null, p_schedule_tz: null, p_max_attempts: 3, p_allow_republish: false });
    const br = await run(bd.data as string, 1);
    expect(br.status === "db_error" && br.error.token).toBe("CHANNEL_NOT_SUPPORTED");
    // live는 생성 자체가 live gate로 거부(실행기도 MODE_MISMATCH로 거부하도록 RPC가 검사)
    const live = await rpc.rpc("distribution_create_job", { p_actor_id: U.admin, p_draft_revision_id: f.revId, p_mode: "live", p_scheduled_at: null, p_schedule_tz: null, p_max_attempts: 3, p_allow_republish: false });
    expect(String((live.error as { message?: string } | null)?.message ?? "")).toContain("LIVE_GATE_CLOSED");
  });

  it("본문 검사 실패 → failed(never), 게시 없음", async () => {
    const p = await dryJob("긴 본문", "가".repeat(600));
    const out = await run(p.jobId, (await job(p.jobId)).job.version);
    expect(out).toEqual({ status: "ok", data: { status: "failed", code: "DRY_RUN_INVALID_TEXT", stage: null } });
    const j = await job(p.jobId);
    expect([j.job.status, j.job.retryPolicy, j.job.lastErrorCode]).toEqual(["failed", "never", "DRY_RUN_INVALID_TEXT"]);
  });

  it("실행 중 단계 실패: 시도를 operator_only failed로 닫음 / 닫기도 실패하면 interrupted → 리스 만료 회수로 failed(성공 아님)", async () => {
    // 단계 실패 + 닫기 성공
    const p = await dryJob("단계 실패");
    const failing = (phase: string, alsoComplete: boolean): RpcClient => ({
      rpc: async (fn, params) => {
        if (fn === "distribution_advance_phase" && params.p_to_phase === phase) throw new Error("lost");
        if (alsoComplete && fn === "distribution_complete_attempt") throw new Error("lost");
        return rpc.rpc(fn, params);
      },
    });
    const o1 = await run(p.jobId, (await job(p.jobId)).job.version, U.admin, () => failing("ready", false));
    expect(o1).toEqual({ status: "ok", data: { status: "failed", code: "DRY_RUN_STEP_FAILED", stage: "ready" } });
    expect((await job(p.jobId)).job).toMatchObject({ status: "failed", retryPolicy: "operator_only", lastErrorCode: "DRY_RUN_STEP_FAILED" });

    // 단계 실패 + 닫기 실패 → interrupted, dispatching으로 남음
    const q = await dryJob("멈춤");
    const o2 = await run(q.jobId, (await job(q.jobId)).job.version, U.admin, () => failing("container_created", true));
    expect(o2.status === "ok" && o2.data.status).toBe("interrupted");
    let j = await job(q.jobId);
    expect([j.job.status, j.job.phase]).toEqual(["dispatching", "container_requested"]);
    // 리스 만료(가드가 허용하는 worker 컨텍스트로 만료 시각만 당김) → 기존 회수 함수 → failed(auto, LEASE_EXPIRED_BEFORE_CONTAINER)
    const lease = await owner<{ lease_owner: string }>("select lease_owner from public.distribution_jobs where id = $1::uuid", [q.jobId]);
    await db.exec("set role supa_owner");
    await db.exec("begin");
    await db.query("select public.distribution_set_event_context('worker', null, 'phase_advanced', null, $1)", [lease[0]?.lease_owner]);
    await db.query("update public.distribution_jobs set lease_expires_at = now() - interval '1 second' where id = $1::uuid", [q.jobId]);
    await db.exec("commit");
    await db.exec("reset role");
    const rec = await rpc.rpc("distribution_recover_expired_leases", { p_limit: 20 });
    const recovered = (rec.data as Array<{ recovered_job_id: string; recovered_status: string }>) ?? [];
    expect(recovered.map((r) => [r.recovered_job_id, r.recovered_status])).toEqual([[q.jobId, "failed"]]); // 다른 작업 미회수
    j = await job(q.jobId);
    expect([j.job.status, j.job.lastErrorCode]).toEqual(["failed", "LEASE_EXPIRED_BEFORE_CONTAINER"]);
  });
});
