/**
 * DRAFT-GEN-001 런타임·서버 액션(task_7fa07439c742) — 모듈 mock으로 배선만 검증.
 * 실제 세션·Supabase·OpenAI 없음. env는 가짜 값만 stub. 실제 네트워크 호출 0(globalThis.fetch는 mock으로 교체해 기록).
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import type { Query, ReadSource } from "@/server/distribution/read";

vi.mock("server-only", () => ({}));
const actor = vi.fn<() => Promise<ActorResult>>();
const readSource = vi.fn<() => Promise<ReadSource | null>>();
vi.mock("@/server/distribution/actor", () => ({ requireDistributionActor: () => actor() }));
vi.mock("@/server/distribution/read-session", () => ({ getSessionReadSource: () => readSource() }));
const serviceRpc = vi.fn<(fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>();
const serviceClient = vi.fn<() => { rpc: typeof serviceRpc } | null>();
vi.mock("@/server/distribution/blog/service", () => ({ getServiceRpcClient: () => serviceClient() }));

const { generateChannelDraftAction } = await import("@/app/admin/distribution/generation-actions");
const { createGenerationRuntimeDeps } = await import("@/server/distribution/generation/runtime");
const { generateChannelDraft } = await import("@/server/distribution/generation/service");

const KEY = `sk-test-${randomBytes(20).toString("hex")}`;
const ADMIN = "00000000-0000-4000-8000-00000000000a";
const CID = "00000000-0000-4000-8000-0000000000c1";
const VID = "00000000-0000-4000-8000-0000000000d1";
const HASH = "c".repeat(64);

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}
const okFd = () => fd({ contentId: CID, channel: "threads", expectedContentVersionId: VID, confirmGenerate: "on" });
function approvedSource(): { src: ReadSource; queries: Query[] } {
  const queries: Query[] = [];
  const tables: Record<string, Record<string, unknown>[]> = {
    distribution_contents: [{ id: CID, current_version_id: VID, current_version_no: 1, archived_at: null, updated_at: "2026-11-18T00:00:00Z" }],
    distribution_content_versions: [{ id: VID, content_id: CID, version_no: 1, title: "제목", body: "승인된 원문 본문", target_path: null, content_hash: HASH, change_summary: null, created_at: "2026-11-18T00:00:00Z" }],
    distribution_channel_drafts: [],
    distribution_approvals: [{ id: "00000000-0000-4000-8000-0000000000e1", subject_type: "content_version", content_version_id: VID, draft_revision_id: null, subject_hash: HASH, decision: "approved", revokes_approval_id: null, reason: null, actor_id: ADMIN, created_at: "2026-11-18T00:00:00Z" }],
  };
  return { queries, src: { select: async (q) => (queries.push(q), { rows: tables[q.table] ?? [] }) } };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  actor.mockReset().mockResolvedValue({ ok: true, actorId: ADMIN });
  readSource.mockReset().mockImplementation(async () => approvedSource().src);
  serviceRpc.mockReset().mockResolvedValue({ data: { reserved: true, reservation_id: "00000000-0000-4000-8000-0000000000f1" }, error: null });
  serviceClient.mockReset().mockReturnValue({ rpc: serviceRpc });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ body: "모의 초안" }) }, finish_reason: "stop" }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const setEnv = () => {
  vi.stubEnv("DISTRIBUTION_AI_GENERATION_ENABLED", "true");
  vi.stubEnv("DISTRIBUTION_OPENAI_API_KEY", KEY);
};

describe("서버 액션 generateChannelDraftAction — 기본 닫힘", () => {
  it("env 없음 → not_configured(스위치·키·한도), 원문 읽기·공급자 0", async () => {
    vi.stubEnv("DISTRIBUTION_AI_GENERATION_ENABLED", "");
    vi.stubEnv("DISTRIBUTION_OPENAI_API_KEY", "");
    expect(await generateChannelDraftAction(okFd())).toEqual({ status: "not_configured", missing: ["enabled_flag", "api_key", "rate_limit"] });
    expect(readSource).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("env를 모두 넣어도 사용량 한도 미등록이면 not_configured(rate_limit), 공급자 0", async () => {
    setEnv();
    const out = await generateChannelDraftAction(okFd());
    expect(out).toEqual({ status: "not_configured", missing: ["rate_limit"] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(out)).not.toContain(KEY);
  });
  it("D1 실패(승인 전 관리자·비로그인)는 다른 검사보다 먼저 denied", async () => {
    setEnv();
    for (const reason of ["not_approved", "unauthenticated", "forbidden"] as const) {
      actor.mockResolvedValueOnce({ ok: false, reason });
      expect(await generateChannelDraftAction(okFd())).toEqual({ status: "denied", reason });
    }
    expect(readSource).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("입력 오류 → invalid(서버에서 확인 체크 필수)", async () => {
    const out = await generateChannelDraftAction(fd({ contentId: CID, channel: "threads", expectedContentVersionId: VID }));
    expect(out).toMatchObject({ status: "invalid", errors: [{ field: "confirmGenerate", rule: "required" }] });
  });
});

const setLimits = (o: Partial<Record<string, string>> = {}) => {
  const v = { DISTRIBUTION_AI_ACTOR_PER_MINUTE: "2", DISTRIBUTION_AI_ACTOR_PER_DAY: "20", DISTRIBUTION_AI_GLOBAL_PER_MINUTE: "5", DISTRIBUTION_AI_GLOBAL_PER_DAY: "100", ...o };
  for (const [k, val] of Object.entries(v)) vi.stubEnv(k, val as string);
};

describe("서버 액션 — 한도 env·service RPC 배선(모의)", () => {
  it("한도 env 4개가 모두 맞고 service RPC가 있으면 예약 RPC 1회 후 공급자(모의) 1회", async () => {
    setEnv();
    setLimits();
    const out = await generateChannelDraftAction(okFd());
    expect(out).toMatchObject({ status: "ok", draft: { requiresHumanReview: true } });
    expect(serviceRpc).toHaveBeenCalledTimes(1);
    expect(serviceRpc.mock.calls[0]).toEqual([
      "distribution_reserve_generation_quota",
      { p_actor_id: ADMIN, p_channel: "threads", p_model: "gpt-4o-mini", p_actor_per_minute: 2, p_actor_per_day: 20, p_global_per_minute: 5, p_global_per_day: 100 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 예약 인자에 원문·초안 본문·키 없음
    expect(JSON.stringify(serviceRpc.mock.calls)).not.toMatch(/승인된 원문 본문|모의 초안/);
    expect(JSON.stringify(serviceRpc.mock.calls)).not.toContain(KEY);
  });
  it("한도 env 누락·형식 오류·범위·관계 위반·service 키 없음 → not_configured(rate_limit), 예약·공급자 0", async () => {
    setEnv();
    for (const over of [
      { DISTRIBUTION_AI_GLOBAL_PER_DAY: "" },
      { DISTRIBUTION_AI_ACTOR_PER_MINUTE: "abc" },
      { DISTRIBUTION_AI_ACTOR_PER_MINUTE: "0" },
      { DISTRIBUTION_AI_ACTOR_PER_MINUTE: "2.5" },
      { DISTRIBUTION_AI_GLOBAL_PER_DAY: "99999" },
      { DISTRIBUTION_AI_ACTOR_PER_DAY: "200", DISTRIBUTION_AI_GLOBAL_PER_DAY: "100" },
    ]) {
      setLimits(over);
      expect(await generateChannelDraftAction(okFd())).toEqual({ status: "not_configured", missing: ["rate_limit"] });
    }
    setLimits();
    serviceClient.mockReturnValue(null);
    expect(await generateChannelDraftAction(okFd())).toEqual({ status: "not_configured", missing: ["rate_limit"] });
    expect(serviceRpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("예약 거절 → quota_exceeded(retryAfter). 예약 RPC 오류·유실·형식 불명 → quota_exceeded(null). 공급자 0", async () => {
    setEnv();
    setLimits();
    const cases: Array<[() => Promise<{ data: unknown; error: unknown }>, number | null]> = [
      [async () => ({ data: { reserved: false, scope: "actor_minute", retry_after_seconds: 42 }, error: null }), 42],
      [async () => ({ data: null, error: { code: "42501", message: "actor is not an approved distribution admin" } }), null],
      [async () => { throw new Error("lost"); }, null],
      [async () => ({ data: { reserved: true }, error: null }), null],
      [async () => ({ data: { reserved: false, retry_after_seconds: 0 }, error: null }), null],
      [async () => ({ data: "true", error: null }), null],
    ];
    for (const [impl, retry] of cases) {
      serviceRpc.mockImplementationOnce(impl);
      expect(await generateChannelDraftAction(okFd())).toEqual({ status: "quota_exceeded", retryAfterSeconds: retry });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("stale 버전이면 예약하지 않는다(원문 확인 → 예약 순서)", async () => {
    setEnv();
    setLimits();
    expect(await generateChannelDraftAction(fd({ contentId: CID, channel: "blog", expectedContentVersionId: "00000000-0000-4000-8000-0000000000d9", confirmGenerate: "on" }))).toEqual({ status: "source_not_ready", reason: "stale" });
    expect(serviceRpc).not.toHaveBeenCalled();
  });
  it("공급자 timeout이어도 예약은 이미 1건 기록됨(다시 누르면 다시 예약을 거친다)", async () => {
    setEnv();
    setLimits();
    const deps = createGenerationRuntimeDeps();
    const hang = (_u: string, init: RequestInit) => new Promise<Response>((_r, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    const out = await generateChannelDraft({ ...deps, http: { fetch: hang, timeoutMs: 20 } }, okFd());
    expect(out).toEqual({ status: "provider_error", code: "timeout", httpStatus: null });
    expect(serviceRpc).toHaveBeenCalledTimes(1);
  });
});

describe("런타임 배선(한도를 주입한 모의 활성 경로 — 실제 키·공급자 아님)", () => {
  it("세션 읽기 → 승인된 현재 버전 → 한도 → 서버 fetch 1회 → 저장하지 않은 제안", async () => {
    setEnv();
    const quota = vi.fn(async () => ({ ok: true as const }));
    const out = await generateChannelDraft(createGenerationRuntimeDeps({ acquireQuota: quota }), okFd());
    expect(out).toMatchObject({ status: "ok", draft: { body: "모의 초안", requiresHumanReview: true, sourceContentVersionId: VID }, prefill: { body: "모의 초안", expectedContentVersionId: VID } });
    expect(quota).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(out)).not.toContain(KEY);
  });
  it("렌더 버전이 최신이 아니면 stale — 한도 차감·공급자 0", async () => {
    setEnv();
    const quota = vi.fn(async () => ({ ok: true as const }));
    const out = await generateChannelDraft(createGenerationRuntimeDeps({ acquireQuota: quota }), fd({ contentId: CID, channel: "blog", expectedContentVersionId: "00000000-0000-4000-8000-0000000000d9", confirmGenerate: "on" }));
    expect(out).toEqual({ status: "source_not_ready", reason: "stale" });
    expect(quota).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("세션 읽기 소스 없음(Supabase 미설정) → source_unavailable", async () => {
    setEnv();
    readSource.mockResolvedValueOnce(null);
    expect(await generateChannelDraft(createGenerationRuntimeDeps({ acquireQuota: async () => ({ ok: true }) }), okFd())).toEqual({ status: "source_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("경계(소스)", () => {
  const action = readFileSync("src/app/admin/distribution/generation-actions.ts", "utf8");
  const actionCode = action.replace(/\/\*[\s\S]*?\*\//g, "");
  const runtime = readFileSync("src/server/distribution/generation/runtime.ts", "utf8");
  it("액션 파일: use server, 고정 export 1개, 저장·승인·redirect·revalidate 없음", () => {
    expect(action.startsWith('"use server";')).toBe(true);
    expect(action.match(/^export /gm)).toHaveLength(1);
    expect(action).toMatch(/export async function generateChannelDraftAction\(formData: FormData\): Promise<GenerateDraftOutcome>/);
    expect(actionCode).not.toMatch(/appendDraftRevision|decideApproval|redirect\(|revalidatePath|\.rpc\(/);
  });
  it("런타임: server-only, 한도 기본 미등록, 공개 env 이름 없음", () => {
    expect(runtime).toMatch(/^import "server-only";$/m);
    expect(runtime).toMatch(/buildQuota\(process\.env, getServiceRpcClient\)/);
    expect(runtime).not.toMatch(/NEXT_PUBLIC_/);
  });
});
