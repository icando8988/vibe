import { describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import {
  extractErrorCode,
  handleClaimTask,
  handleHeartbeat,
  handleInputResult,
  toResponse,
} from "@/server/distribution/blog/handoff";
import { requestExtensionHandoff } from "@/server/distribution/blog/handoff-request";
import { listExtensionHandoffs, needsHumanCheck } from "@/server/distribution/blog/handoff-status";
import { hashExtensionToken } from "@/server/distribution/blog/token";
import type { RpcClient } from "@/server/distribution/write-runner";

const TOKEN = `pat_${"e".repeat(64)}`;
const AUTH = `Bearer ${TOKEN}`;
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "11111111-2222-4333-8444-555555555555";

function client(...responses: Array<{ data: unknown; error: unknown } | Error>) {
  let i = 0;
  const rpc = vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  });
  return { c: { rpc } as unknown as RpcClient, rpc };
}
const calls = (rpc: ReturnType<typeof vi.fn>) => rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>;

describe("task(선점)", () => {
  it("Bearer 형식 오류 → 401, RPC 0회 / 키 없음 → 503", async () => {
    const { c, rpc } = client({ data: null, error: null });
    expect((await handleClaimTask("Bearer x", () => c)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect((await handleClaimTask(AUTH, () => null)).status).toBe(503);
  });

  it("해시로만 호출, 대기 없음 → task:null", async () => {
    const { c, rpc } = client({ data: null, error: null });
    expect(await handleClaimTask(AUTH, () => c)).toEqual({ status: 200, body: { task: null } });
    expect(calls(rpc)[0]).toEqual(["distribution_claim_extension_handoff", { p_token_hash: hashExtensionToken(TOKEN) }]);
  });

  it("선점 성공 → 원본 확장 형식(id=작업, runId, title, blocks, tags, leaseSeconds), 토큰·해시 없음", async () => {
    const { c } = client({ data: { job_id: JOB, run_id: RUN, lease_seconds: 180, title: "승인 제목", body: "문단1\n\n문단2" }, error: null });
    const r = await handleClaimTask(AUTH, () => c);
    expect(r).toEqual({
      status: 200,
      body: {
        task: {
          id: JOB,
          runId: RUN,
          title: "승인 제목",
          blocks: [
            { type: "text", text: "문단1" },
            { type: "text", text: "문단2" },
          ],
          tags: [],
          leaseSeconds: 180,
          category: null,
        },
      },
    });
    const text = JSON.stringify(r);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(hashExtensionToken(TOKEN));
  });

  it("빈 본문으로 선점되면 내용 없이 failed 기록(재인계 없음)", async () => {
    const { c, rpc } = client(
      { data: { job_id: JOB, run_id: RUN, lease_seconds: 180, title: "t", body: "\n\n" }, error: null },
      { data: { success: true, persisted: true, status: "failed" }, error: null },
    );
    expect(await handleClaimTask(AUTH, () => c)).toEqual({ status: 200, body: { task: null } });
    expect(calls(rpc)[1]?.[1]).toMatchObject({ p_job_id: JOB, p_run_id: RUN, p_status: "failed", p_code: "EMPTY_BODY" });
  });

  it.each([
    [{ code: "28000", message: "UNAUTHENTICATED: extension token is invalid" }, 401],
    [{ code: "XX000", message: "boom with secret detail" }, 503],
  ])("DB 오류 %o → %s, 원문 미노출", async (error, status) => {
    const { c } = client({ data: null, error });
    const r = await handleClaimTask(AUTH, () => c);
    expect(r.status).toBe(status);
    expect(JSON.stringify(r)).not.toContain("secret detail");
  });
  it("잘못된 선점 응답 → 503", async () => {
    const { c } = client({ data: { job_id: "x" }, error: null });
    expect((await handleClaimTask(AUTH, () => c)).status).toBe(503);
  });
});

describe("heartbeat", () => {
  it("jobId·runId uuid 필수 → 400, RPC 0회", async () => {
    const { c, rpc } = client({ data: { ok: true, lease_seconds: 180 }, error: null });
    expect((await handleHeartbeat(AUTH, "1", { runId: RUN }, () => c)).status).toBe(400);
    expect((await handleHeartbeat(AUTH, JOB, { runId: "nope" }, () => c)).status).toBe(400);
    expect((await handleHeartbeat(AUTH, JOB, null, () => c)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("연장 성공 / 만료 superseded → 409 / SUPERSEDED 예외 → 409 / 남의 작업 → 404", async () => {
    expect(await handleHeartbeat(AUTH, JOB, { runId: RUN }, () => client({ data: { ok: true, lease_seconds: 180 }, error: null }).c))
      .toEqual({ status: 200, body: { ok: true, leaseSeconds: 180 } });
    expect((await handleHeartbeat(AUTH, JOB, { runId: RUN }, () => client({ data: { ok: false, superseded: true, reason: "LEASE_EXPIRED" }, error: null }).c)).body)
      .toEqual({ ok: false, error: "superseded", superseded: true });
    expect((await handleHeartbeat(AUTH, JOB, { runId: RUN }, () => client({ data: null, error: { code: "P0001", message: "SUPERSEDED: run" } }).c)).status).toBe(409);
    expect((await handleHeartbeat(AUTH, JOB, { runId: RUN }, () => client({ data: null, error: { code: "P0002", message: "handoff not found" } }).c)).status).toBe(404);
  });
  it("RPC 인자는 해시·작업·run뿐", async () => {
    const { c, rpc } = client({ data: { ok: true, lease_seconds: 180 }, error: null });
    await handleHeartbeat(AUTH, JOB, { runId: RUN, actorId: ADMIN }, () => c);
    expect(calls(rpc)[0]?.[1]).toEqual({ p_token_hash: hashExtensionToken(TOKEN), p_job_id: JOB, p_run_id: RUN });
  });
});

describe("input-result", () => {
  it("상태 허용 목록·runId 필수", async () => {
    const { c, rpc } = client({ data: null, error: null });
    for (const status of ["published", "awaiting_evidence", "", 1]) {
      expect((await handleInputResult(AUTH, JOB, { status, runId: RUN }, () => c)).status).toBe(400);
    }
    expect((await handleInputResult(AUTH, JOB, { status: "completed" }, () => c)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("기록 성공 응답은 확장 확인 형식(success·persisted·status)", async () => {
    const { c } = client({ data: { success: true, persisted: true, status: "publish_ready", unchanged: false }, error: null });
    expect(await handleInputResult(AUTH, JOB, { status: "publish_ready", runId: RUN }, () => c)).toEqual({
      status: 200,
      body: { success: true, persisted: true, status: "publish_ready", unchanged: false },
    });
  });
  it("failed는 [CODE]만 전달, 문장은 보내지 않음", async () => {
    const { c, rpc } = client({ data: { success: true, persisted: true, status: "failed", unchanged: false }, error: null });
    await handleInputResult(AUTH, JOB, { status: "failed", runId: RUN, error: "[TITLE_MISMATCH] 제목 입력값이 다릅니다: 비밀 본문" }, () => c);
    expect(calls(rpc)[0]?.[1]).toEqual({ p_token_hash: hashExtensionToken(TOKEN), p_job_id: JOB, p_run_id: RUN, p_status: "failed", p_code: "TITLE_MISMATCH" });
    expect(JSON.stringify(calls(rpc))).not.toContain("비밀 본문");
  });
  it("superseded 결과·예외 → 409, 서버가 다른 상태를 돌려주면 503", async () => {
    expect((await handleInputResult(AUTH, JOB, { status: "completed", runId: RUN }, () => client({ data: { success: false, superseded: true }, error: null }).c)).status).toBe(409);
    expect((await handleInputResult(AUTH, JOB, { status: "completed", runId: RUN }, () => client({ data: { success: true, persisted: true, status: "failed" }, error: null }).c)).status).toBe(503);
  });
  it("extractErrorCode", () => {
    expect(extractErrorCode("[NAVER_LOGIN_REQUIRED] 로그인")).toBe("NAVER_LOGIN_REQUIRED");
    expect(extractErrorCode("no code")).toBeNull();
    expect(extractErrorCode("[lower] x")).toBeNull();
    expect(extractErrorCode(null)).toBeNull();
  });
});

describe("응답 헤더", () => {
  it("no-store, CORS 없음, 401에 WWW-Authenticate", () => {
    const r = toResponse({ status: 401, body: { ok: false, error: "unauthorized" } });
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    expect(r.headers.get("www-authenticate")).toContain("Bearer");
  });
});

describe("관리자 인계 상태 조회(F-3)", () => {
  const allowedActor = async (): Promise<ActorResult> => ({ ok: true, actorId: ADMIN });
  const row = { job_id: JOB, status: "needs_check", last_code: "TOKEN_REVOKED", requested_at: "2026-11-17T00:00:00Z", claimed_at: "2026-11-17T00:01:00Z", lease_expires_at: null, finished_at: "2026-11-17T00:05:00Z", updated_at: "2026-11-17T00:05:00Z" };
  it("D1 거부 → RPC 0회, 키 없음 → not_ready", async () => {
    const { c, rpc } = client({ data: [row], error: null });
    expect((await listExtensionHandoffs({ resolveActor: async () => ({ ok: false, reason: "forbidden" }), getClient: () => c })).status).toBe("denied");
    expect(rpc).not.toHaveBeenCalled();
    expect((await listExtensionHandoffs({ resolveActor: allowedActor, getClient: () => null })).status).toBe("not_ready");
  });
  it("정상 조회·needs_check 표시, 세션 actor만 전달", async () => {
    const { c, rpc } = client({ data: [row], error: null });
    const out = await listExtensionHandoffs({ resolveActor: allowedActor, getClient: () => c });
    expect(out.status === "ok" && out.handoffs[0]).toMatchObject({ jobId: JOB, status: "needs_check", lastCode: "TOKEN_REVOKED" });
    expect(out.status === "ok" && needsHumanCheck(out.handoffs[0]!)).toBe(true);
    expect(calls(rpc)[0]).toEqual(["distribution_list_extension_handoffs", { p_actor_id: ADMIN }]);
  });
  it("본문·토큰·run 등 예상 밖 열이나 모르는 상태면 bad_response", async () => {
    for (const bad of [{ ...row, body: "본문" }, { ...row, run_id: RUN }, { ...row, status: "published" }]) {
      const { c } = client({ data: [bad], error: null });
      expect((await listExtensionHandoffs({ resolveActor: allowedActor, getClient: () => c })).status).toBe("bad_response");
    }
  });
});

describe("관리자 인계 요청", () => {
  const allowed = async (): Promise<ActorResult> => ({ ok: true, actorId: ADMIN });
  it("D1 거부 → RPC 0회, 성공 → 파싱", async () => {
    const { c, rpc } = client({ data: { handoff_id: RUN, job_id: JOB, status: "requested", refreshed: false }, error: null });
    expect((await requestExtensionHandoff({ resolveActor: async () => ({ ok: false, reason: "not_approved" }), getClient: () => c }, { jobId: JOB })).status).toBe("denied");
    expect(rpc).not.toHaveBeenCalled();
    expect(await requestExtensionHandoff({ resolveActor: allowed, getClient: () => c }, { jobId: JOB })).toEqual({
      status: "ok",
      data: { handoffId: RUN, jobId: JOB, refreshed: false },
    });
    expect(calls(rpc)[0]).toEqual(["distribution_request_extension_handoff", { p_actor_id: ADMIN, p_job_id: JOB }]);
  });
});
