/**
 * AUTOPOST-BLOG-FLOW-015 — Blog 수동 흐름 서비스 → RPC 왕복 검증(PGlite 대역).
 * `PGLITE_PROJECT`가 있을 때만 실행(평소 npm test에서는 건너뜀 — 통과로 세지 않음).
 * 실행: node web/scripts/distribution-local-verify/blog-flow-run.mjs --pglite-project <dir>
 * 앱 서비스(content/approval/jobs-service, handoff-request/status, jobs-read)를 그대로 쓰고 DB만 대역 어댑터로 바꾼다.
 * 확장 쪽(claim·입력 기록)만 SQL RPC를 직접 부른다(확장 코드 대신). 실제 Supabase·네이버·네트워크 아님.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { decideApproval } from "@/server/distribution/approval-service";
import { requestExtensionHandoff } from "@/server/distribution/blog/handoff-request";
import { listExtensionHandoffs } from "@/server/distribution/blog/handoff-status";
import { appendDraftRevision, createChannelDraft, createContent } from "@/server/distribution/content-service";
import { jobActions } from "@/server/distribution/jobs-dto";
import { getJobDetail, listJobs } from "@/server/distribution/jobs-read";
import {
  abandonManualJob,
  cancelJob,
  createBlogManualJob,
  markManualPosted,
  markManualUncertain,
  recordManualEvidence,
  recordReconciliation,
} from "@/server/distribution/jobs-service";
import { getContentDetail } from "@/server/distribution/read";
import { writeNoticeOf } from "@/server/distribution/write-notice";
import type { RpcClient } from "@/server/distribution/write-runner";
import { inTx, openDb, readSourceOf, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const U = {
  admin: "00000000-0000-4000-8000-00000000000a",
  pending: "00000000-0000-4000-8000-0000000000c1",
};
const TOKEN_HASH = "ab".repeat(32);

let db: Db;
let rpc: RpcClient;
const as = (id: string) => async (): Promise<ActorResult> => ({ ok: true, actorId: id });
const deps = (id = U.admin) => ({ resolveActor: as(id), getClient: () => rpc });
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
const read = () => readSourceOf(db, U.admin);

async function job(id: string) {
  const d = await getJobDetail(read(), id);
  if (d.status !== "ok" || !d.data) throw new Error(`job detail ${JSON.stringify(d)}`);
  return d.data;
}

/** 원문 + Blog 초안(+선택 승인) */
async function prepared(title: string, approve: boolean, utm?: Record<string, string>) {
  const c = await createContent(deps(), form({ title, body: `${title} 본문` }));
  if (c.status !== "ok") throw new Error(`content ${JSON.stringify(c)}`);
  const cid = c.data.contentId;
  const d = await getContentDetail(read(), cid);
  if (d.status !== "ok" || !d.data?.current) throw new Error("detail");
  const v = d.data.current;
  const dr = await createChannelDraft(deps(), form({ contentId: cid, channel: "blog" }));
  if (dr.status !== "ok") throw new Error("draft");
  const rev = await appendDraftRevision(deps(), form({ draftId: dr.data.draftId, expectedRevisionNo: "0", expectedContentVersionId: v.id, body: `${title} 블로그`, ...(utm ? { preserveUtm: JSON.stringify(utm) } : {}) }));
  if (rev.status !== "ok") throw new Error(`rev ${JSON.stringify(rev)}`);
  if (approve) {
    const a1 = await decideApproval(deps(), form({ subjectType: "content_version", subjectId: v.id, decision: "approved", expectedSubjectHash: v.contentHash, check_facts_checked: "on", check_sources_checked: "on", check_public_ok: "on" }));
    const a2 = await decideApproval(deps(), form({ subjectType: "draft_revision", subjectId: rev.data.revisionId, decision: "approved", expectedSubjectHash: rev.data.revisionHash, check_matches_content: "on", check_facts_checked: "on", check_links_checked: "on", check_media_rights_checked: "on" }));
    if (a1.status !== "ok" || a2.status !== "ok") throw new Error(`approve ${JSON.stringify([a1, a2])}`);
  }
  return { cid, draftId: dr.data.draftId, versionId: v.id, revId: rev.data.revisionId };
}

async function createJob(revId: string) {
  const out = await createBlogManualJob(deps(), form({ draftRevisionId: revId }));
  if (out.status !== "ok") throw new Error(`job ${JSON.stringify(out)}`);
  return out.data;
}

describe.skipIf(!PROJECT)("PGlite 왕복: prepare → Blog 수동 작업 → 인계 → A9~A14", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [U.admin, U.pending], [U.pending], [U.admin, U.pending]);
    db = opened.db;
    rpc = rpcClientOf(db, new Set(["distribution_list_extension_handoffs"]));
    console.log(`applied: ${opened.applied.map((f) => f.slice(0, 14)).join(", ")}`);
  }, 120_000);

  it("작업 생성 조건·D1·중복", async () => {
    expect(await listJobs(read())).toEqual({ status: "ok", data: [] });
    const unapproved = await prepared("승인 전 원문", false);
    expect(writeNoticeOf(await createBlogManualJob(deps(), form({ draftRevisionId: unapproved.revId })))).toBe("not_approved");

    const a = await prepared("승인된 원문", true);
    expect(writeNoticeOf(await createBlogManualJob(deps(U.pending), form({ draftRevisionId: a.revId })))).toBe("denied");
    const jobId = await createJob(a.revId);
    expect(writeNoticeOf(await createBlogManualJob(deps(), form({ draftRevisionId: a.revId })))).toBe("duplicate");
    const d = await job(jobId);
    expect(d.job).toMatchObject({ status: "manual_ready", mode: "manual", channel: "blog" });
    expect(d.approvedText).toEqual({ title: "승인된 원문", body: "승인된 원문 블로그" });
    const listed = await listJobs(read(), { contentId: a.cid });
    expect(listed.status === "ok" && listed.data.map((j) => j.id)).toEqual([jobId]);
  }, 120_000);

  it("A4 보존: 편집하지 않는 UTM이 다음 리비전에 유지", async () => {
    const p = await prepared("UTM 보존", false, { utm_source: "blog", utm_medium: "social" });
    let d = await getContentDetail(read(), p.cid);
    if (d.status !== "ok" || !d.data) throw new Error("detail");
    const r1 = d.data.drafts.blog?.revision;
    expect(r1?.utm).toEqual({ utm_source: "blog", utm_medium: "social" });
    // 화면이 렌더한 보존 값을 그대로 다시 보냄
    const r2 = await appendDraftRevision(deps(), form({ draftId: p.draftId, expectedRevisionNo: "1", expectedContentVersionId: p.versionId, body: "수정 본문", preserveUtm: JSON.stringify(r1?.utm), preserveMedia: JSON.stringify(r1?.media) }));
    expect(r2.status).toBe("ok");
    d = await getContentDetail(read(), p.cid);
    expect(d.status === "ok" && d.data?.drafts.blog?.revision?.utm).toEqual({ utm_source: "blog", utm_medium: "social" });
  }, 120_000);

  it("확장 인계 completed ≠ 게시, A9 버전 충돌, A10 증거 수락 시에만 published", async () => {
    const p = await prepared("인계 원문", true);
    const jobId = await createJob(p.revId);

    // 인계 요청 → 확장 claim → 입력 완료(SQL 직접, 확장 대신)
    const issued = await inTx(db, "service_role", null, () => db.query(`select public.distribution_issue_extension_token($1::uuid, $2, 'pglite', 30) as r`, [U.admin, TOKEN_HASH]));
    expect(issued.rows[0]?.r).toBeTruthy();
    const req = await requestExtensionHandoff(deps(), { jobId });
    expect(req.status).toBe("ok");
    const claim = await inTx(db, "service_role", null, () => db.query(`select public.distribution_claim_extension_handoff($1) as r`, [TOKEN_HASH]));
    const claimed = claim.rows[0]?.r as { job_id: string; run_id: string };
    expect(claimed.job_id).toBe(jobId);
    await inTx(db, "service_role", null, () => db.query(`select public.distribution_record_extension_input($1, $2::uuid, $3::uuid, 'completed') as r`, [TOKEN_HASH, jobId, claimed.run_id]));

    const hs = await listExtensionHandoffs(deps());
    const h = hs.status === "ok" ? hs.handoffs.find((x) => x.jobId === jobId) : undefined;
    expect(h?.status).toBe("completed");
    let d = await job(jobId);
    expect(d.job.status).toBe("manual_ready"); // 입력 완료는 게시가 아니다
    expect(d.evidence).toEqual([]);
    const acts = jobActions(d.job, h?.status ?? null);
    expect(acts.requestHandoff).toBe(false); // 재인계 없음
    expect(acts.markPosted).toBe(true);

    // A9: 렌더된 version보다 낡은 값 → 충돌, 렌더 값 → awaiting_evidence
    const v = d.job.version;
    expect(writeNoticeOf(await markManualPosted(deps(), form({ jobId, expectedVersion: String(v + 5), confirmPosted: "on" })))).toBe("conflict_version");
    expect((await markManualPosted(deps(), form({ jobId, expectedVersion: String(v), confirmPosted: "on" }))).status).toBe("ok");
    d = await job(jobId);
    expect(d.job.status).toBe("awaiting_evidence");
    // 같은 version 재전송 → 충돌(자동 재전송·중복 처리 없음)
    expect(writeNoticeOf(await markManualPosted(deps(), form({ jobId, expectedVersion: String(v), confirmPosted: "on" })))).toMatch(/^(conflict_version|invalid_transition)$/);

    // A10: 허용 외 호스트는 앱에서 거절(RPC 전), 올바른 증거 → DB 수락 → published
    expect((await recordManualEvidence(deps(), form({ jobId, expectedVersion: String(d.job.version), externalUrl: "https://example.com/p/1", observedAt: "2026-11-17T09:00" }))).status).toBe("invalid");
    expect(d.job.status).toBe("awaiting_evidence");
    const ev = await recordManualEvidence(deps(), form({ jobId, expectedVersion: String(d.job.version), externalUrl: "https://blog.naver.com/pglite/100", observedAt: "2026-11-17T09:00", methodNote: "블로그 관리 화면 확인" }));
    expect(ev.status).toBe("ok");
    d = await job(jobId);
    expect(d.job.status).toBe("published");
    expect(d.evidence.map((e) => e.status)).toContain("accepted");
    const done = jobActions(d.job, null);
    expect([done.markPosted, done.recordEvidence, done.cancel, done.abandon, done.reconcile, done.requestHandoff].some(Boolean)).toBe(false);
  }, 120_000);

  it("중복 증거 EVIDENCE_CONFLICT → 결과 불명 → 대사(부재 확인 ≠ 재게시)", async () => {
    const p = await prepared("충돌 원문", true);
    const jobId = await createJob(p.revId);
    let d = await job(jobId);
    expect((await markManualPosted(deps(), form({ jobId, expectedVersion: String(d.job.version), confirmPosted: "on" }))).status).toBe("ok");
    d = await job(jobId);
    // 다른 작업이 이미 가진 게시물 → 증거 충돌, published 아님
    const conflict = await recordManualEvidence(deps(), form({ jobId, expectedVersion: String(d.job.version), externalUrl: "https://blog.naver.com/pglite/100", observedAt: "2026-11-17T09:10" }));
    if (conflict.status !== "db_error") console.log("conflict:", JSON.stringify(conflict));
    expect(writeNoticeOf(conflict)).toBe("evidence_conflict");
    d = await job(jobId);
    expect(d.job.status).not.toBe("published");

    // A12 결과 불명 → 대사만
    expect((await markManualUncertain(deps(), form({ jobId, expectedVersion: String(d.job.version), reason: "발행 버튼 후 화면 멈춤" }))).status).toBe("ok");
    d = await job(jobId);
    expect(d.job.status).toBe("unknown");
    const acts = jobActions(d.job, null);
    expect(acts).toMatchObject({ reconcile: true, markPosted: false, recordEvidence: false, requestHandoff: false, cancel: false });

    // A13 found_published 증거 없음 → 앱 거절, still_unknown → 여전히 unknown
    expect((await recordReconciliation(deps(), form({ jobId, expectedVersion: String(d.job.version), finding: "found_published", checkedScope: "글 목록", observedAt: "2026-11-17T10:00" }))).status).toBe("invalid");
    const still = await recordReconciliation(deps(), form({ jobId, expectedVersion: String(d.job.version), finding: "still_unknown", checkedScope: "글 목록 1페이지", observedAt: "2026-11-17T10:00" }));
    if (still.status !== "ok") console.log("still:", JSON.stringify(still));
    expect(still.status).toBe("ok");
    d = await job(jobId);
    expect(d.job.status).toBe("unknown");
    expect(d.reconciliations.map((r) => r.finding)).toEqual(["still_unknown"]);

    // 부재 확인 → 기록되지만 재게시·수동 우회 동선 없음, 같은 키는 계속 점유
    expect((await recordReconciliation(deps(), form({ jobId, expectedVersion: String(d.job.version), finding: "confirmed_absent", checkedScope: "글 목록 전체·임시저장", observedAt: "2026-11-17T10:30" }))).status).toBe("invalid"); // 계정·기간·근거 없음
    const absent = await recordReconciliation(deps(), form({ jobId, expectedVersion: String(d.job.version), finding: "confirmed_absent", checkedScope: "글 목록 전체·임시저장", checkedAccount: "pglite", checkedPeriod: "11/17 09:00~10:30 KST", observation: "해당 시간대 글 없음", observedAt: "2026-11-17T10:30" }));
    if (absent.status !== "ok") console.log("absent:", JSON.stringify(absent));
    expect(absent.status).toBe("ok");
    d = await job(jobId);
    expect(d.job.status).toBe("failed"); // SQL: confirmed_absent → failed(operator_only), 자동 재시도 없음
    expect(d.job.retryPolicy).toBe("operator_only");
    const after = jobActions(d.job, null);
    expect(after.markPosted || after.requestHandoff || after.recordEvidence).toBe(false);
    expect(writeNoticeOf(await createBlogManualJob(deps(), form({ draftRevisionId: p.revId })))).toBe("duplicate");
  }, 120_000);

  it("A11 중단(확인·사유 필수, 키 점유) · A14 취소", async () => {
    const p = await prepared("중단 원문", true);
    const jobId = await createJob(p.revId);
    let d = await job(jobId);
    expect((await abandonManualJob(deps(), form({ jobId, expectedVersion: String(d.job.version), reason: "게시 취소" }))).status).toBe("invalid");
    expect((await abandonManualJob(deps(), form({ jobId, expectedVersion: String(d.job.version), reason: "게시 취소", acknowledged: "on" }))).status).toBe("ok");
    d = await job(jobId);
    expect(d.job.status).toBe("abandoned");
    expect(writeNoticeOf(await createBlogManualJob(deps(), form({ draftRevisionId: p.revId })))).toBe("duplicate");

    const q = await prepared("취소 원문", true);
    const j2 = await createJob(q.revId);
    d = await job(j2);
    expect(writeNoticeOf(await cancelJob(deps(), form({ jobId: j2, expectedVersion: String(d.job.version + 1), confirmCancel: "on" })))).toBe("conflict_version");
    expect(await cancelJob(deps(), form({ jobId: j2, expectedVersion: String(d.job.version), confirmCancel: "on", reason: "일정 변경" }))).toEqual({ status: "ok", data: "cancelled" });
    d = await job(j2);
    expect(d.job.status).toBe("cancelled");
  }, 120_000);
});
