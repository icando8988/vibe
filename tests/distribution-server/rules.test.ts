import { describe, expect, it } from "vitest";
import { extractToken, mapDistributionDbError } from "@/server/distribution/errors";
import { parseServiceConfig } from "@/server/distribution/service-config";
import {
  isSubjectHash,
  parseExpectedInt,
  parseTargetPath,
  validateBlogManualEvidence,
  validateChecklist,
  validateContentInput,
  validateUtm,
} from "@/server/distribution/validation";
import {
  createBlogManualJobParams,
  decideApprovalParams,
  parseUuidResult,
  recordReconciliationParams,
} from "@/server/distribution/rpc-params";
import { buildBlogExtensionTask, type ApprovedBlogSource } from "@/server/distribution/blog-task";

const ACTOR = "11111111-2222-4333-8444-555555555555";

describe("mapDistributionDbError", () => {
  it.each([
    [{ code: "42501", message: "actor is not an approved distribution admin" }, "forbidden"],
    [{ code: "P0001", message: "REVISION_CONFLICT: draft x" }, "conflict_revision"],
    [{ code: "23514", message: "STALE_CONTENT_VERSION: latest" }, "stale_content"],
    [{ code: "P0001", message: "SUBJECT_CHANGED: reviewed hash does not match the subject" }, "subject_changed"],
    [{ code: "XX001", message: "HASH_INTEGRITY: stored hash" }, "integrity_error"],
    [{ code: "23505", message: "DUPLICATE: job already exists" }, "duplicate"],
    [{ code: "23514", message: "NOT_APPROVED: revision" }, "not_approved"],
    [{ code: "0A000", message: "LIVE_GATE_CLOSED" }, "live_gate_closed"],
    [{ code: "23514", message: "EVIDENCE_CONFLICT: other job" }, "evidence_conflict"],
    [{ code: "P0002", message: "distribution job x not found" }, "not_found"],
    [{ code: "22023", message: "title and body are required" }, "invalid_input"],
    [{ code: "55P03", message: "lease is held by another worker" }, "worker_error"],
    [{ message: "weird" }, "unexpected"],
    [null, "unexpected"],
  ])("%o → %s", (err, code) => {
    expect(mapDistributionDbError(err).code).toBe(code);
  });
  it("토큰은 대문자 접두만", () => {
    expect(extractToken("VERSION_CONFLICT: x")).toBe("VERSION_CONFLICT");
    expect(extractToken("lowercase: x")).toBeNull();
    expect(extractToken(42)).toBeNull();
  });
});

describe("parseServiceConfig", () => {
  const url = "https://abc.supabase.co";
  it("sb_secret_ 키 + https만", () => {
    expect(parseServiceConfig(url + "/", "sb_secret_" + "x".repeat(20))).toEqual({ url, secretKey: "sb_secret_" + "x".repeat(20) });
  });
  it.each([
    [url, undefined],
    [undefined, "sb_secret_" + "x".repeat(20)],
    [url, "sb_publishable_" + "x".repeat(20)],
    [url, "eyJhbGciOiJIUzI1NiJ9.e30.sig"],
    [url, "sb_secret_short"],
    ["http://abc.supabase.co", "sb_secret_" + "x".repeat(20)],
    ["https://u:p@abc.supabase.co", "sb_secret_" + "x".repeat(20)],
  ])("거절 %s", (u, k) => {
    expect(parseServiceConfig(u, k)).toBeNull();
  });
});

describe("validation", () => {
  it("원문: 필수·길이·내부 경로", () => {
    expect(validateContentInput({ title: "t", body: "b", targetPath: "" }).ok).toBe(true);
    const bad = validateContentInput({ title: "x".repeat(201), body: " ", targetPath: "https://evil.example" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.field).sort()).toEqual(["body", "targetPath", "title"]);
  });
  it("텍스트를 다듬지 않는다(해시 기준 보존)", () => {
    const r = validateContentInput({ title: " 제목 ", body: "본문\r\n" });
    expect(r.ok && r.value.title).toBe(" 제목 ");
    expect(r.ok && r.value.body).toBe("본문\r\n");
  });
  it.each(["//evil", "/a b", "/a\u0000", "relative"])("target_path 거절 %s", (p) => {
    expect(parseTargetPath(p).ok).toBe(false);
  });
  it("기대 번호·해시", () => {
    expect(parseExpectedInt("3")).toBe(3);
    expect(parseExpectedInt("0")).toBeNull();
    expect(parseExpectedInt("-1")).toBeNull();
    expect(parseExpectedInt("3.5")).toBeNull();
    expect(isSubjectHash("f".repeat(64))).toBe(true);
    expect(isSubjectHash("F".repeat(64))).toBe(false);
  });
  it("UTM 규칙", () => {
    expect(validateUtm({ utm_source: "blog" }).ok).toBe(true);
    expect(validateUtm({ UTM: "x" }).ok).toBe(false);
    expect(validateUtm({ a: "" }).ok).toBe(false);
    expect(validateUtm(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"]))).ok).toBe(false);
  });
  it("승인 체크리스트는 비어 있지 않고 모두 true", () => {
    expect(validateChecklist({ facts_checked: true }, true).ok).toBe(true);
    expect(validateChecklist({}, true).ok).toBe(false);
    expect(validateChecklist({ facts_checked: false }, true).ok).toBe(false);
    expect(validateChecklist({ facts_checked: false }, false).ok).toBe(true);
    expect(validateChecklist({ "Bad-Key": true }, false).ok).toBe(false);
  });
  it("Blog 수동 증거: blog.naver.com만, ID만이면 메모 필수, 시간대 필수", () => {
    const observedAt = "2026-11-16T10:00:00+09:00";
    expect(validateBlogManualEvidence({ externalUrl: "https://blog.naver.com/me/1", observedAt }).ok).toBe(true);
    const host = validateBlogManualEvidence({ externalUrl: "https://evil.example/p", observedAt });
    expect(host.ok).toBe(false);
    const idOnly = validateBlogManualEvidence({ externalPostId: "223000", observedAt });
    expect(idOnly.ok).toBe(false);
    expect(validateBlogManualEvidence({ externalPostId: "223000", observedAt, methodNote: "관리 화면에서 확인" }).ok).toBe(true);
    expect(validateBlogManualEvidence({ externalUrl: "https://blog.naver.com/me/1", observedAt: "2026-11-16T10:00:00" }).ok).toBe(false);
    const ok = validateBlogManualEvidence({ externalUrl: "https://blog.naver.com/me/1", observedAt });
    expect(ok.ok && ok.value.observedAt).toBe("2026-11-16T01:00:00.000Z");
  });
});

describe("rpc-params", () => {
  it("Blog manual 작업은 mode=manual, 예약·재게시 없음", () => {
    expect(createBlogManualJobParams(ACTOR, { draftRevisionId: "r" })).toMatchObject({
      p_actor_id: ACTOR,
      p_mode: "manual",
      p_scheduled_at: null,
      p_allow_republish: false,
    });
  });
  it("대사 actor_kind는 서버 상수 admin", () => {
    const p = recordReconciliationParams(ACTOR, {
      jobId: "j",
      expectedVersion: 2,
      method: "manual_check",
      finding: "confirmed_absent",
      checkedScope: {},
      observedAt: "2026-11-16T00:00:00Z",
      observation: "x",
    });
    expect(p.p_actor_kind).toBe("admin");
    expect(p.p_actor_id).toBe(ACTOR);
  });
  it("승인은 기대 해시를 그대로 전달", () => {
    const p = decideApprovalParams(ACTOR, {
      subjectType: "draft_revision",
      subjectId: "s",
      decision: "approved",
      expectedSubjectHash: "a".repeat(64),
      checklist: { ok: true },
      reason: null,
    });
    expect(p.p_expected_subject_hash).toBe("a".repeat(64));
  });
  it("uuid 반환만 수용", () => {
    expect(parseUuidResult("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(parseUuidResult({ id: 1 })).toBeNull();
  });
});

describe("buildBlogExtensionTask", () => {
  const base: ApprovedBlogSource = {
    jobId: "job-1",
    runId: "run-1",
    jobMode: "manual",
    jobStatus: "manual_ready",
    channel: "blog",
    contentVersion: { title: "원문 제목", approved: true },
    revision: { body: "첫 문단\n둘째 줄\n\n\n둘째 문단\r\n\r\n", approved: true, channel: "blog" },
  };
  it("제목은 승인된 원문 버전 title, 본문은 문단 블록", () => {
    const r = buildBlogExtensionTask(base);
    expect(r).toEqual({
      ok: true,
      task: {
        id: "job-1",
        runId: "run-1",
        title: "원문 제목",
        blocks: [
          { type: "text", text: "첫 문단\n둘째 줄" },
          { type: "text", text: "둘째 문단" },
        ],
        tags: [],
      },
    });
  });
  it.each([
    [{ channel: "threads" }, "not_blog"],
    [{ jobMode: "dry_run" }, "not_manual"],
    [{ jobStatus: "awaiting_evidence" }, "not_manual_ready"],
    [{ revision: { ...base.revision, approved: false } }, "revision_not_approved"],
    [{ contentVersion: { title: "t", approved: false } }, "content_not_approved"],
    [{ contentVersion: { title: "  ", approved: true } }, "empty_title"],
    [{ revision: { ...base.revision, body: "\n\n" } }, "empty_body"],
  ])("거절 %o → %s", (patch, problem) => {
    expect(buildBlogExtensionTask({ ...base, ...patch } as ApprovedBlogSource)).toEqual({ ok: false, problem });
  });
});
