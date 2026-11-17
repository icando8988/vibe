/**
 * AUTOPOST-THREADS-PORT-016 — Threads 모의 실행 작업 서비스 → RPC 왕복(PGlite 대역).
 * `PGLITE_PROJECT`가 있을 때만 실행(평소 npm test에서는 건너뜀 — 통과로 세지 않음).
 * 실행: node web/scripts/distribution-local-verify/threads-connect-run.mjs --pglite-project <dir>
 * 외부 Threads 호출 없음(작업 생성·조회·취소만). 실제 Supabase 아님.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { decideApproval, revokeApproval } from "@/server/distribution/approval-service";
import { appendDraftRevision, createChannelDraft, createContent } from "@/server/distribution/content-service";
import { jobActions, jobStatusText } from "@/server/distribution/jobs-dto";
import { getJobDetail, listJobs } from "@/server/distribution/jobs-read";
import { cancelJob, createBlogManualJob, createThreadsDryRunJob } from "@/server/distribution/jobs-service";
import { getContentDetail } from "@/server/distribution/read";
import { writeNoticeOf } from "@/server/distribution/write-notice";
import type { RpcClient } from "@/server/distribution/write-runner";
import { openDb, readSourceOf, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const U = {
  admin: "00000000-0000-4000-8000-00000000000a",
  admin2: "00000000-0000-4000-8000-00000000000b",
  pending: "00000000-0000-4000-8000-0000000000c1",
};
let db: Db;
let rpc: RpcClient;
const as = (id: string) => async (): Promise<ActorResult> => ({ ok: true, actorId: id });
const deps = (id = U.admin) => ({ resolveActor: as(id), getClient: () => rpc });
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
const read = () => readSourceOf(db, U.admin);
const REV_CHECKS = { check_matches_content: "on", check_facts_checked: "on", check_links_checked: "on", check_media_rights_checked: "on" };

async function prepared(title: string, channels: Array<"threads" | "blog">, approve = true) {
  const c = await createContent(deps(), form({ title, body: `${title} 본문` }));
  if (c.status !== "ok") throw new Error(`content ${JSON.stringify(c)}`);
  const cid = c.data.contentId;
  const d = await getContentDetail(read(), cid);
  if (d.status !== "ok" || !d.data?.current) throw new Error("detail");
  const v = d.data.current;
  if (approve) {
    const a = await decideApproval(deps(), form({ subjectType: "content_version", subjectId: v.id, decision: "approved", expectedSubjectHash: v.contentHash, check_facts_checked: "on", check_sources_checked: "on", check_public_ok: "on" }));
    if (a.status !== "ok") throw new Error("content approval");
  }
  const revs = {} as Record<"threads" | "blog", { revId: string; approvalId: string | null }>;
  for (const ch of channels) {
    const dr = await createChannelDraft(deps(), form({ contentId: cid, channel: ch }));
    if (dr.status !== "ok") throw new Error("draft");
    const rev = await appendDraftRevision(deps(), form({ draftId: dr.data.draftId, expectedRevisionNo: "0", expectedContentVersionId: v.id, body: `${title} ${ch}` }));
    if (rev.status !== "ok") throw new Error("rev");
    let approvalId: string | null = null;
    if (approve) {
      const a = await decideApproval(deps(), form({ subjectType: "draft_revision", subjectId: rev.data.revisionId, decision: "approved", expectedSubjectHash: rev.data.revisionHash, ...REV_CHECKS }));
      if (a.status !== "ok") throw new Error("rev approval");
      const after = await getContentDetail(read(), cid);
      const appr = after.status === "ok" ? after.data?.drafts[ch]?.approval : null;
      approvalId = appr && appr.state === "approved" ? appr.approvalId : null;
    }
    revs[ch] = { revId: rev.data.revisionId, approvalId };
  }
  return { cid, revs };
}

describe.skipIf(!PROJECT)("PGlite 왕복: Threads 모의 실행 작업 생성·조회·취소", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [U.admin, U.admin2, U.pending], [U.pending], [U.admin, U.admin2, U.pending]);
    db = opened.db;
    rpc = rpcClientOf(db);
    console.log(`applied: ${opened.applied.map((f) => f.slice(0, 14)).join(", ")}`);
  }, 120_000);

  it("생성 → scheduled(모의 실행 대기) · 조회 · 중복 · 취소 · 취소 후 재생성", async () => {
    const p = await prepared("스레드 원문", ["threads"]);
    const rev = p.revs.threads.revId;
    // 비승인 admin(D1) 거부
    expect(writeNoticeOf(await createThreadsDryRunJob(deps(U.pending), form({ draftRevisionId: rev, channel: "threads" })))).toBe("denied");

    const out = await createThreadsDryRunJob(deps(), form({ draftRevisionId: rev, channel: "threads" }));
    if (out.status !== "ok") console.log("create:", JSON.stringify(out));
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    const jobId = out.data;

    const d = await getJobDetail(read(), jobId);
    if (d.status !== "ok" || !d.data) throw new Error("detail");
    expect(d.data.job).toMatchObject({ channel: "threads", mode: "dry_run", status: "scheduled", externalUrl: null });
    expect(d.data.evidence).toEqual([]);
    expect(jobStatusText(d.data.job)).toBe("모의 실행 대기(수동 실행)");
    const acts = jobActions(d.data.job, null);
    expect(acts).toMatchObject({ cancel: true, markPosted: false, recordEvidence: false, requestHandoff: false, reconcile: false });

    const listed = await listJobs(read(), { contentId: p.cid });
    expect(listed.status === "ok" && listed.data.map((j) => [j.channel, j.mode, j.rawStatus])).toEqual([["threads", "dry_run", "scheduled"]]);

    // 같은 버전·채널·모드 → 중복
    expect(writeNoticeOf(await createThreadsDryRunJob(deps(), form({ draftRevisionId: rev, channel: "threads" })))).toBe("duplicate");

    // Threads 리비전에 manual은 SQL이 거절(manual은 blog 전용) — 앱 manual 경로로 Threads 우회 불가
    expect((await createBlogManualJob(deps(), form({ draftRevisionId: rev }))).status).toBe("db_error");

    // 취소: 낡은 version 충돌 → 렌더 version 성공
    expect(writeNoticeOf(await cancelJob(deps(), form({ jobId, expectedVersion: String(d.data.job.version + 1), confirmCancel: "on" })))).toBe("conflict_version");
    expect(await cancelJob(deps(), form({ jobId, expectedVersion: String(d.data.job.version), confirmCancel: "on", reason: "테스트 정리" }))).toEqual({ status: "ok", data: "cancelled" });
    const after = await getJobDetail(read(), jobId);
    expect(after.status === "ok" && after.data?.job.status).toBe("cancelled");
    // 취소된 작업은 키를 점유하지 않는다(SQL: status <> 'cancelled') → 재생성 가능
    const again = await createThreadsDryRunJob(deps(), form({ draftRevisionId: rev, channel: "threads" }));
    expect(again.status).toBe("ok");
  }, 120_000);

  it("비승인·승인 철회·권한 회수 거부", async () => {
    const un = await prepared("미승인 스레드", ["threads"], false);
    expect(writeNoticeOf(await createThreadsDryRunJob(deps(), form({ draftRevisionId: un.revs.threads.revId, channel: "threads" })))).toBe("not_approved");

    const p = await prepared("철회될 스레드", ["threads"]);
    const appr = p.revs.threads.approvalId;
    if (!appr) throw new Error("approval id");
    expect((await revokeApproval(deps(), form({ approvalId: appr, reason: "다시 검토" }))).status).toBe("ok");
    expect(writeNoticeOf(await createThreadsDryRunJob(deps(), form({ draftRevisionId: p.revs.threads.revId, channel: "threads" })))).toBe("not_approved");

    // 권한 회수: admin2의 admin 역할 삭제 → DB D1이 거부
    const q = await prepared("권한 회수 스레드", ["threads"]);
    await db.exec(`set role supa_owner; delete from public.role_assignments where user_id = '${U.admin2}'; reset role;`);
    expect(writeNoticeOf(await createThreadsDryRunJob(deps(U.admin2), form({ draftRevisionId: q.revs.threads.revId, channel: "threads" })))).toBe("denied");
  }, 120_000);

  it("같은 원문에서 Blog 수동 작업과 Threads 모의 실행은 서로 독립", async () => {
    const p = await prepared("두 채널 원문", ["blog", "threads"]);
    const b = await createBlogManualJob(deps(), form({ draftRevisionId: p.revs.blog.revId }));
    const t = await createThreadsDryRunJob(deps(), form({ draftRevisionId: p.revs.threads.revId, channel: "threads" }));
    expect([b.status, t.status]).toEqual(["ok", "ok"]);
    const listed = await listJobs(read(), { contentId: p.cid });
    expect(listed.status === "ok" && listed.data.map((j) => `${j.channel}:${j.rawStatus}`).sort()).toEqual(["blog:manual_ready", "threads:scheduled"]);
  }, 120_000);
});
