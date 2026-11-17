import { describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { appendDraftRevision, parsePreserved } from "@/server/distribution/content-service";
import { jobActions, toJob, type JobDto } from "@/server/distribution/jobs-dto";
import { sortForAttention } from "@/server/distribution/jobs-read";
import {
  abandonManualJob,
  cancelJob,
  createBlogManualJob,
  kstLocalToZoned,
  markManualPosted,
  markManualUncertain,
  recordManualEvidence,
  recordReconciliation,
} from "@/server/distribution/jobs-service";
import { failureState, INITIAL_FORM_STATE, writeNoticeOf } from "@/server/distribution/write-notice";
import type { RpcClient } from "@/server/distribution/write-runner";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REV = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const allowed = async (): Promise<ActorResult> => ({ ok: true, actorId: ADMIN });
const denied = async (): Promise<ActorResult> => ({ ok: false, reason: "not_approved" });
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
function client(r: { data: unknown; error: unknown } | Error) {
  const rpc = vi.fn(async () => {
    if (r instanceof Error) throw r;
    return r;
  });
  return { c: { rpc } as unknown as RpcClient, rpc };
}
const callsOf = (rpc: ReturnType<typeof vi.fn>) => rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>;

const jobRow = (o: Record<string, unknown> = {}) => ({
  id: JOB, content_id: OTHER, content_version_id: REV, content_version_no: 1, draft_id: REV, draft_revision_id: REV,
  channel: "blog", mode: "manual", status: "manual_ready", hold_reason: null, retry_policy: null, last_error: null,
  reconciliation_required: false, has_issues: false, external_id: null, external_url: null, version: 3,
  created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z", ...o,
});
const job = (o: Record<string, unknown> = {}) => toJob(jobRow(o)) as JobDto;

describe("jobActions(M2 전이 규칙)", () => {
  it("manual_ready: 게시 표시·중단·취소·확장 인계", () => {
    expect(jobActions(job(), null)).toMatchObject({ markPosted: true, abandon: true, cancel: true, requestHandoff: true, recordEvidence: false, reconcile: false });
  });
  it("awaiting_evidence: 증거·중단·불명, 게시 표시·인계 없음", () => {
    expect(jobActions(job({ status: "awaiting_evidence" }), null)).toMatchObject({ recordEvidence: true, abandon: true, markUncertain: true, markPosted: false, requestHandoff: false, cancel: false });
  });
  it("unknown: 대사만(수동 게시·인계·취소·재게시 없음)", () => {
    const a = jobActions(job({ status: "unknown" }), null);
    expect(a).toMatchObject({ reconcile: true, markPosted: false, recordEvidence: false, requestHandoff: false, cancel: false, abandon: false });
    expect(a.warnings.join(" ")).toContain("다시 게시하지 않습니다");
  });
  it("reconciliation_required: 수동 게시 표시·확장 인계·증거 우회 금지", () => {
    expect(jobActions(job({ reconciliation_required: true }), null)).toMatchObject({ markPosted: false, requestHandoff: false });
    expect(jobActions(job({ status: "awaiting_evidence", reconciliation_required: true }), null).recordEvidence).toBe(false);
  });
  it.each(["needs_check", "in_progress", "completed", "publish_ready", "failed"] as const)("인계 %s → 재인계 없음", (h) => {
    expect(jobActions(job(), h).requestHandoff).toBe(false);
  });
  it("needs_check는 사람 확인 안내", () => {
    expect(jobActions(job(), "needs_check").warnings.join(" ")).toContain("사람 확인");
  });
  it("인계 완료·발행 준비는 게시 아님 안내, 게시 표시는 사람이", () => {
    const a = jobActions(job(), "publish_ready");
    expect(a.warnings.join(" ")).toContain("입력 완료는 게시가 아닙니다");
    expect(a.markPosted).toBe(true);
  });
  it("알 수 없는 상태(예: recovery_failed:…)는 정상 상태로 매핑하지 않고 행동 0", () => {
    const j = job({ status: "recovery_failed:23514" });
    expect(j.status).toBe("unrecognized");
    const a = jobActions(j, null);
    expect(Object.entries(a).filter(([k, v]) => k !== "warnings" && v === true)).toEqual([]);
  });
  it("published·cancelled·abandoned: 행동 없음", () => {
    for (const s of ["published", "cancelled", "abandoned"]) {
      const a = jobActions(job({ status: s }), null);
      expect([a.markPosted, a.recordEvidence, a.abandon, a.cancel, a.reconcile, a.requestHandoff].some(Boolean)).toBe(false);
    }
  });
  it("조치 필요 정렬: 대사 필요 → unknown → failed → 증거 대기", () => {
    const list = [job({ id: "1", status: "manual_ready" }), job({ id: "2", status: "unknown" }), job({ id: "3", status: "failed" }), job({ id: "4", status: "awaiting_evidence", reconciliation_required: true })];
    expect(sortForAttention(list).map((j) => j.id)).toEqual(["4", "2", "3", "1"]);
  });
});

describe("작업 쓰기 서비스(A8~A14)", () => {
  it("D1 거부 → RPC 0회", async () => {
    const { c, rpc } = client({ data: null, error: null });
    for (const fn of [markManualPosted, abandonManualJob, recordManualEvidence]) {
      expect((await fn({ resolveActor: denied, getClient: () => c }, form({ jobId: JOB, expectedVersion: "3" }))).status).toBe("denied");
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("A8: 승인된 리비전으로 manual 작업 생성(예약·재게시 없음), actor는 세션", async () => {
    const { c, rpc } = client({ data: JOB, error: null });
    expect(await createBlogManualJob({ resolveActor: allowed, getClient: () => c }, form({ draftRevisionId: REV, p_actor_id: OTHER }))).toEqual({ status: "ok", data: JOB });
    expect(callsOf(rpc)[0]?.[1]).toMatchObject({ p_actor_id: ADMIN, p_draft_revision_id: REV, p_mode: "manual", p_scheduled_at: null, p_allow_republish: false });
  });
  it("A8: NOT_APPROVED·DUPLICATE 안내", async () => {
    expect(writeNoticeOf(await createBlogManualJob({ resolveActor: allowed, getClient: () => client({ data: null, error: { code: "23514", message: "NOT_APPROVED: revision" } }).c }, form({ draftRevisionId: REV })))).toBe("not_approved");
    expect(writeNoticeOf(await createBlogManualJob({ resolveActor: allowed, getClient: () => client({ data: null, error: { code: "23505", message: "DUPLICATE: job x already exists" } }).c }, form({ draftRevisionId: REV })))).toBe("duplicate");
  });
  it("A9: 발행 확인 체크 필수, 렌더된 version 그대로", async () => {
    const { c, rpc } = client({ data: null, error: null });
    expect((await markManualPosted({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "3" }))).status).toBe("invalid");
    expect((await markManualPosted({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "3", confirmPosted: "on" }))).status).toBe("ok");
    expect(callsOf(rpc)).toEqual([["distribution_mark_manual_posted", { p_actor_id: ADMIN, p_job_id: JOB, p_expected_version: 3 }]]);
  });
  it("A9 충돌: VERSION_CONFLICT → conflict_version, 재전송 없음", async () => {
    const { c, rpc } = client({ data: null, error: { code: "P0001", message: "VERSION_CONFLICT: job x is at version 4 (expected 3)" } });
    expect(writeNoticeOf(await markManualPosted({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "3", confirmPosted: "on" })))).toBe("conflict_version");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("A10: blog.naver.com만, 시각은 KST→시간대 ISO, 증거 충돌 안내", async () => {
    const { c, rpc } = client({ data: null, error: { code: "23505", message: "EVIDENCE_CONFLICT: another job already holds this external post" } });
    expect((await recordManualEvidence({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "4", externalUrl: "https://evil.example/p", observedAt: "2026-11-17T09:00" }))).status).toBe("invalid");
    const out = await recordManualEvidence({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "4", externalUrl: "https://blog.naver.com/me/1", observedAt: "2026-11-17T09:00" }));
    expect(writeNoticeOf(out)).toBe("evidence_conflict");
    expect(callsOf(rpc)[0]?.[1]).toMatchObject({ p_external_url: "https://blog.naver.com/me/1", p_observed_at: "2026-11-17T00:00:00.000Z", p_expected_version: 4 });
  });
  it("kstLocalToZoned", () => {
    expect(kstLocalToZoned("2026-11-17T09:00")).toBe("2026-11-17T09:00:00+09:00");
    expect(kstLocalToZoned("2026-11-17T09:00:00Z")).toBe("2026-11-17T09:00:00Z");
    expect(kstLocalToZoned("어제")).toBeNull();
  });
  it("A11: 사유와 외부 잔존 확인 모두 필요", async () => {
    const { c, rpc } = client({ data: null, error: null });
    expect((await abandonManualJob({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "3", reason: "중단" }))).status).toBe("invalid");
    expect((await abandonManualJob({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "3", reason: "중단", acknowledged: "on" }))).status).toBe("ok");
    expect(callsOf(rpc)[0]?.[1]).toMatchObject({ p_acknowledge_may_remain_external: true, p_reason: "중단" });
  });
  it("A12: 사유 필수", async () => {
    const { c } = client({ data: null, error: null });
    expect((await markManualUncertain({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "4" }))).status).toBe("invalid");
  });
  it("A13: actor_kind admin·method operator_manual 고정, found_published는 증거 필요, 확인 범위 필수", async () => {
    const { c, rpc } = client({ data: JOB, error: null });
    expect((await recordReconciliation({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "5", finding: "found_published", checkedScope: "블로그 관리", observedAt: "2026-11-17T09:00" }))).status).toBe("invalid");
    expect((await recordReconciliation({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "5", finding: "absence_candidate", checkedScope: "x", observedAt: "2026-11-17T09:00" }))).status).toBe("invalid");
    const ok = await recordReconciliation({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "5", finding: "confirmed_absent", checkedScope: "블로그 글 목록 전체", checkedAccount: "me", checkedPeriod: "오늘 오전", observation: "없음", observedAt: "2026-11-17T09:00", method: "provider_recent_posts", p_actor_kind: "worker" }));
    expect(ok.status).toBe("ok");
    expect(callsOf(rpc)[0]?.[1]).toMatchObject({ p_actor_kind: "admin", p_method: "operator_manual", p_finding: "confirmed_absent", p_checked_scope: { note: "블로그 글 목록 전체", account: "me", period: "오늘 오전" }, p_external_url: null });
  });
  it("A14: 취소 확인 필수, 결과 문자열만 수용", async () => {
    const { c } = client({ data: "cancelled", error: null });
    expect((await cancelJob({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "3" }))).status).toBe("invalid");
    expect(await cancelJob({ resolveActor: allowed, getClient: () => c }, form({ jobId: JOB, expectedVersion: "3", confirmCancel: "on" }))).toEqual({ status: "ok", data: "cancelled" });
    expect((await cancelJob({ resolveActor: allowed, getClient: () => client({ data: "weird", error: null }).c }, form({ jobId: JOB, expectedVersion: "3", confirmCancel: "on" }))).status).toBe("bad_response");
  });
  it("INVALID_TRANSITION·응답 유실 안내", async () => {
    expect(writeNoticeOf(await markManualPosted({ resolveActor: allowed, getClient: () => client({ data: null, error: { code: "23514", message: "INVALID_TRANSITION: job is awaiting_evidence" } }).c }, form({ jobId: JOB, expectedVersion: "3", confirmPosted: "on" })))).toBe("invalid_transition");
    expect(writeNoticeOf(await markManualPosted({ resolveActor: allowed, getClient: () => client(new Error("net")).c }, form({ jobId: JOB, expectedVersion: "3", confirmPosted: "on" })))).toBe("uncertain");
  });
});

describe("A4 보존 필드·폼 상태", () => {
  it("편집하지 않는 UTM·미디어·대상 계정을 그대로 보존해 전달", async () => {
    const { c, rpc } = client({ data: null, error: null });
    const media = [{ asset_id: JOB, variant_id: null, alt_text: "대체 텍스트" }];
    await appendDraftRevision({ resolveActor: allowed, getClient: () => c }, form({
      draftId: REV, expectedRevisionNo: "1", expectedContentVersionId: REV, body: "b",
      preserveUtm: JSON.stringify({ utm_source: "blog" }), preserveMedia: JSON.stringify(media), preserveTargetConnectionId: OTHER, preserveTargetAccountId: "acct",
    }));
    expect(callsOf(rpc)[0]?.[1]).toMatchObject({ p_utm: { utm_source: "blog" }, p_media: media, p_target_connection_id: OTHER, p_target_external_account_id: "acct" });
  });
  it("보존 값 형식이 틀리면 저장 거절(조용히 비우지 않음)", () => {
    expect(parsePreserved(form({ preserveMedia: "[{\"asset_id\":\"x\"}]" })).ok).toBe(false);
    expect(parsePreserved(form({ preserveUtm: "{bad" })).ok).toBe(false);
    expect(parsePreserved(form({})).ok).toBe(true);
  });
  it("실패 폼 상태: 안내 코드·필드 이름만(입력 원문 없음)", () => {
    const s = failureState({ status: "invalid", errors: [{ field: "body", rule: "required" }, { field: "body", rule: "x" }] }, INITIAL_FORM_STATE);
    expect(s).toEqual({ notice: "invalid", fields: ["body"], seq: 1 });
  });
});
