import { describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { jobActions, jobStatusText, toJob, type JobDto } from "@/server/distribution/jobs-dto";
import { createThreadsDryRunJob } from "@/server/distribution/jobs-service";
import { createJobParams } from "@/server/distribution/rpc-params";
import * as client from "@/server/distribution/threads/client";
import { combinePublishOutcome, createTextContainer, getContainerStatus, getPermalink, publishContainer, THREADS_TEXT_MAX } from "@/server/distribution/threads/client";
import type { ThreadsHttpDeps } from "@/server/distribution/threads/types";
import { writeNoticeOf } from "@/server/distribution/write-notice";
import type { RpcClient } from "@/server/distribution/write-runner";

const TOKEN = "THQVJmock_SECRET_token_value_123";
const USER = "17841400000000001";
const CONTAINER = "18000000000000001";
const POST = "18100000000000001";

type Call = { url: string; init: RequestInit };
function mockFetch(responses: Array<(() => Promise<Response>) | { status: number; body?: unknown }>) {
  const calls: Call[] = [];
  let i = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (!r) throw new Error("no response");
    if (typeof r === "function") return r();
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  });
  return { deps: { fetch, timeoutMs: 50 } as ThreadsHttpDeps, calls, fetch };
}
const at = (calls: Call[], i = 0): Call => {
  const c = calls[i];
  if (!c) throw new Error("no call");
  return c;
};
/** abort 신호가 올 때까지 끝나지 않는 요청(timeout 재현) */
const hang = (calls: Call[]) => (url: string, init: RequestInit) => {
  calls.push({ url, init });
  return new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
};
const noToken = (x: unknown) => expect(JSON.stringify(x)).not.toContain(TOKEN);

describe("Threads 텍스트 부품(mock fetch)", () => {
  it("모듈에 create→publish 일괄 helper가 없다(컨테이너 선기록 경계)", () => {
    expect(Object.keys(client).sort()).toEqual(
      ["THREADS_TEXT_MAX", "combinePublishOutcome", "createTextContainer", "getContainerStatus", "getPermalink", "isThreadsPermalink", "publishContainer", "validateThreadsText"].sort(),
    );
    expect("publishThreadsPost" in client).toBe(false);
  });

  it("컨테이너 생성: POST 1회, 토큰은 form body에만(URL 아님), TEXT", async () => {
    const { deps, calls } = mockFetch([{ status: 200, body: { id: CONTAINER } }]);
    const r = await createTextContainer(deps, { accessToken: TOKEN, threadsUserId: USER, text: "안녕\n둘째 줄" });
    expect(r).toEqual({ ok: true, containerId: CONTAINER });
    expect(calls).toHaveLength(1);
    expect(at(calls).url).toBe(`https://graph.threads.net/v1.0/${USER}/threads`);
    expect(at(calls).url).not.toContain(TOKEN);
    expect(at(calls).init.method).toBe("POST");
    const body = new URLSearchParams(String(at(calls).init.body));
    expect(body.get("media_type")).toBe("TEXT");
    expect(body.get("access_token")).toBe(TOKEN);
    expect(body.has("image_url") || body.has("video_url")).toBe(false);
  });

  it("컨테이너 생성은 publish를 부르지 않는다", async () => {
    const { deps, calls } = mockFetch([{ status: 200, body: { id: CONTAINER } }]);
    await createTextContainer(deps, { accessToken: TOKEN, threadsUserId: USER, text: "x" });
    expect(calls.some((c) => c.url.includes("threads_publish"))).toBe(false);
  });

  it("입력 검증 실패 → 요청 안 보냄", async () => {
    const { deps, fetch } = mockFetch([{ status: 200, body: { id: CONTAINER } }]);
    expect((await createTextContainer(deps, { accessToken: TOKEN, threadsUserId: USER, text: "  " })).ok).toBe(false);
    expect((await createTextContainer(deps, { accessToken: TOKEN, threadsUserId: USER, text: "가".repeat(THREADS_TEXT_MAX + 1) })).ok).toBe(false);
    expect((await createTextContainer(deps, { accessToken: TOKEN, threadsUserId: "../me", text: "x" })).ok).toBe(false);
    expect((await publishContainer(deps, { accessToken: "short", threadsUserId: USER, containerId: CONTAINER })).kind).toBe("rejected");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("컨테이너 생성 timeout → definite=false(남았을 수 있음), 오류에 토큰·URL 없음", async () => {
    const calls: Call[] = [];
    const r = await createTextContainer({ fetch: hang(calls), timeoutMs: 20 }, { accessToken: TOKEN, threadsUserId: USER, text: "x" });
    expect(r).toEqual({ ok: false, definite: false, error: { code: "timeout", httpStatus: null, providerCode: null } });
    noToken(r);
  });

  it("publish 성공: POST 1회, 토큰 body만", async () => {
    const { deps, calls } = mockFetch([{ status: 200, body: { id: POST } }]);
    expect(await publishContainer(deps, { accessToken: TOKEN, threadsUserId: USER, containerId: CONTAINER })).toEqual({ kind: "published", postId: POST });
    expect(calls).toHaveLength(1);
    expect(at(calls).url).toBe(`https://graph.threads.net/v1.0/${USER}/threads_publish`);
    expect(new URLSearchParams(String(at(calls).init.body)).get("creation_id")).toBe(CONTAINER);
  });

  it("publish timeout → unknown, 재시도 없음(1회)", async () => {
    const calls: Call[] = [];
    const r = await publishContainer({ fetch: hang(calls), timeoutMs: 20 }, { accessToken: TOKEN, threadsUserId: USER, containerId: CONTAINER });
    expect(r).toEqual({ kind: "unknown", error: { code: "timeout", httpStatus: null, providerCode: null } });
    expect(calls).toHaveLength(1);
  });

  it("publish 응답 유실(network)·5xx·2xx 형식 오류 → unknown(실패로 단정하지 않음)", async () => {
    const lost = mockFetch([() => Promise.reject(new TypeError("fetch failed https://graph.threads.net/?access_token=" + TOKEN))]);
    const r1 = await publishContainer(lost.deps, { accessToken: TOKEN, threadsUserId: USER, containerId: CONTAINER });
    expect(r1).toMatchObject({ kind: "unknown", error: { code: "network" } });
    noToken(r1);
    expect(lost.fetch).toHaveBeenCalledTimes(1);
    expect((await publishContainer(mockFetch([{ status: 503, body: { error: { message: "busy" } } }]).deps, { accessToken: TOKEN, threadsUserId: USER, containerId: CONTAINER })).kind).toBe("unknown");
    expect((await publishContainer(mockFetch([{ status: 200, body: {} }]).deps, { accessToken: TOKEN, threadsUserId: USER, containerId: CONTAINER })).kind).toBe("unknown");
  });

  it("publish 4xx 명시 거절 → rejected, 공급자 메시지는 버리고 코드만", async () => {
    const r = await publishContainer(mockFetch([{ status: 400, body: { error: { message: `bad token ${TOKEN}`, code: 100 } } }]).deps, { accessToken: TOKEN, threadsUserId: USER, containerId: CONTAINER });
    expect(r).toEqual({ kind: "rejected", error: { code: "rejected", httpStatus: 400, providerCode: 100 } });
    noToken(r);
    expect(await publishContainer(mockFetch([{ status: 400, body: { error: { message: "expired", code: 190 } } }]).deps, { accessToken: TOKEN, threadsUserId: USER, containerId: CONTAINER })).toMatchObject({ kind: "rejected", error: { code: "auth" } });
  });

  it("상태 조회(GET): 원본 규격 유지 — 결과·오류에 URL/토큰 미노출", async () => {
    const { deps, calls } = mockFetch([{ status: 200, body: { status: "FINISHED", error_message: "x" } }]);
    const r = await getContainerStatus(deps, { accessToken: TOKEN, containerId: CONTAINER });
    expect(r).toEqual({ ok: true, status: "FINISHED", hasErrorMessage: true });
    noToken(r);
    expect(at(calls).init.method).toBe("GET");
    expect(new URL(at(calls).url).searchParams.get("fields")).toBe("status,error_message");
    expect((await getContainerStatus(mockFetch([{ status: 200, body: { status: "WEIRD" } }]).deps, { accessToken: TOKEN, containerId: CONTAINER })).ok).toBe(false);
  });

  it("publish 성공 뒤 permalink 실패 → 게시 확인 + URL 미확인(실패 아님)", async () => {
    const pub = await publishContainer(mockFetch([{ status: 200, body: { id: POST } }]).deps, { accessToken: TOKEN, threadsUserId: USER, containerId: CONTAINER });
    const link = await getPermalink(mockFetch([{ status: 500 }]).deps, { accessToken: TOKEN, postId: POST });
    expect(combinePublishOutcome(pub, link)).toEqual({ kind: "published", postId: POST, permalink: null, urlConfirmed: false });
    const ok = await getPermalink(mockFetch([{ status: 200, body: { permalink: "https://www.threads.net/@me/post/abc" } }]).deps, { accessToken: TOKEN, postId: POST });
    expect(combinePublishOutcome(pub, ok)).toMatchObject({ kind: "published", urlConfirmed: true });
    // 다른 호스트 permalink는 신뢰하지 않음
    expect((await getPermalink(mockFetch([{ status: 200, body: { permalink: "https://evil.example/p" } }]).deps, { accessToken: TOKEN, postId: POST })).ok).toBe(false);
    // unknown은 그대로 unknown
    expect(combinePublishOutcome({ kind: "unknown", error: { code: "timeout", httpStatus: null, providerCode: null } }, null).kind).toBe("unknown");
  });

  it("요청은 리다이렉트 거부·캐시 없음·abort 신호 포함", async () => {
    const { deps, calls } = mockFetch([{ status: 200, body: { id: CONTAINER } }]);
    await createTextContainer(deps, { accessToken: TOKEN, threadsUserId: USER, text: "x" });
    expect(at(calls).init).toMatchObject({ redirect: "error", cache: "no-store" });
    expect(at(calls).init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("Threads 모의 실행 작업 생성", () => {
  const ADMIN = "11111111-2222-4333-8444-555555555555";
  const REV = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
  const allowed = async (): Promise<ActorResult> => ({ ok: true, actorId: ADMIN });
  const denied = async (): Promise<ActorResult> => ({ ok: false, reason: "not_approved" });
  const client = (r: { data: unknown; error: unknown }) => {
    const rpc = vi.fn(async () => r);
    return { c: { rpc } as unknown as RpcClient, rpc };
  };

  it("mode=dry_run·예약 없음·재게시 없음, actor는 세션", async () => {
    const { c, rpc } = client({ data: REV, error: null });
    expect(await createThreadsDryRunJob({ resolveActor: allowed, getClient: () => c }, form({ draftRevisionId: REV, channel: "threads", p_mode: "live" }))).toEqual({ status: "ok", data: REV });
    expect((rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0]).toEqual([
      "distribution_create_job",
      { p_actor_id: ADMIN, p_draft_revision_id: REV, p_mode: "dry_run", p_scheduled_at: null, p_schedule_tz: null, p_max_attempts: 3, p_allow_republish: false },
    ]);
  });
  it("D1 거부·채널 불일치 → RPC 0회", async () => {
    const { c, rpc } = client({ data: REV, error: null });
    expect((await createThreadsDryRunJob({ resolveActor: denied, getClient: () => c }, form({ draftRevisionId: REV, channel: "threads" }))).status).toBe("denied");
    expect((await createThreadsDryRunJob({ resolveActor: allowed, getClient: () => c }, form({ draftRevisionId: REV, channel: "blog" }))).status).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("NOT_APPROVED·DUPLICATE 안내", async () => {
    expect(writeNoticeOf(await createThreadsDryRunJob({ resolveActor: allowed, getClient: () => client({ data: null, error: { code: "23514", message: "NOT_APPROVED: x" } }).c }, form({ draftRevisionId: REV, channel: "threads" })))).toBe("not_approved");
    expect(writeNoticeOf(await createThreadsDryRunJob({ resolveActor: allowed, getClient: () => client({ data: null, error: { code: "23505", message: "DUPLICATE: job" } }).c }, form({ draftRevisionId: REV, channel: "threads" })))).toBe("duplicate");
  });
  it("앱은 live 작업을 만들지 않는다", () => {
    expect(() => createJobParams(ADMIN, { draftRevisionId: REV, mode: "live" as never })).toThrow();
  });
  it("dry_run scheduled: '모의 실행 대기(수동 실행)' + 수동 모의 실행·취소", () => {
    const j = toJob({
      id: REV, content_id: REV, content_version_id: REV, content_version_no: 1, draft_id: REV, draft_revision_id: REV,
      channel: "threads", mode: "dry_run", status: "scheduled", hold_reason: null, retry_policy: null, last_error: null,
      reconciliation_required: false, has_issues: false, external_id: null, external_url: null, version: 1,
      created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z",
    }) as JobDto;
    expect(jobStatusText(j)).toBe("모의 실행 대기(수동 실행)");
    const a = jobActions(j, null);
    expect(a).toMatchObject({ cancel: true, runDryRun: true, markPosted: false, requestHandoff: false, reconcile: false });
    expect(a.warnings.join(" ")).toContain("모의 실행 성공이 아니며");
  });
});
