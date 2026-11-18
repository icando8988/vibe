/**
 * DRAFT-GEN-001 — 공용 원문 → Blog·Threads·Instagram 텍스트 초안 생성(모의 읽기 + 모의 공급자 fetch).
 * 실제 OpenAI·Supabase 호출 없음(globalThis.fetch 0회), 실제 키 없음(실행마다 만든 임시 값).
 */
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { DEFAULT_GENERATION_MODEL, GENERATION_ENV, loadGenerationConfig } from "@/server/distribution/generation/config";
import { OPENAI_CHAT_URL, type GenerationHttpDeps } from "@/server/distribution/generation/openai-chat";
import { generateOriginal, ORIGINAL_TOPIC_MAX } from "@/server/distribution/generation/original";
import { parseGeneratedOutput } from "@/server/distribution/generation/output";
import { buildMessages, CHANNEL_LIMITS } from "@/server/distribution/generation/prompts";
import { generateChannelDraft, type GenerateDraftDeps } from "@/server/distribution/generation/service";
import type { Query, ReadSource } from "@/server/distribution/read";

const KEY = `sk-test-${randomBytes(20).toString("hex")}`;
const ADMIN = "00000000-0000-4000-8000-00000000000a";
const CID = "00000000-0000-4000-8000-0000000000c1";
const VID = "00000000-0000-4000-8000-0000000000d1";
const HASH = "a".repeat(64);
const globalFetch = vi.spyOn(globalThis, "fetch");
afterAll(() => expect(globalFetch).not.toHaveBeenCalled());

const env = (over: Record<string, string | undefined> = {}) => ({ [GENERATION_ENV.enabled]: "true", [GENERATION_ENV.apiKey]: KEY, ...over });
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
const okForm = (channel = "threads") => form({ contentId: CID, channel, expectedContentVersionId: VID, confirmGenerate: "on" });

type SourceOpts = { archived?: boolean; approval?: "approved" | "rejected" | "none" | "other_hash"; body?: string; missing?: boolean; currentVersionId?: string };
function source(o: SourceOpts = {}): { src: ReadSource; queries: Query[] } {
  const queries: Query[] = [];
  const body = o.body ?? "자전거 세계일주 준비 이야기입니다. 자세한 내용은 https://example.com/plan 에 있습니다.";
  const approvals =
    o.approval === "none"
      ? []
      : [{ id: "00000000-0000-4000-8000-0000000000e1", subject_type: "content_version", content_version_id: VID, draft_revision_id: null, subject_hash: o.approval === "other_hash" ? "b".repeat(64) : HASH, decision: o.approval === "rejected" ? "rejected" : "approved", revokes_approval_id: null, reason: null, actor_id: ADMIN, created_at: "2026-11-18T00:00:00Z" }];
  const tables: Record<string, Record<string, unknown>[]> = {
    distribution_contents: o.missing ? [] : [{ id: CID, current_version_id: o.currentVersionId ?? VID, current_version_no: 1, archived_at: o.archived ? "2026-11-18T00:00:00Z" : null, updated_at: "2026-11-18T00:00:00Z" }],
    distribution_content_versions: [{ id: VID, content_id: CID, version_no: 1, title: "출발 준비", body, target_path: null, content_hash: HASH, change_summary: null, created_at: "2026-11-18T00:00:00Z" }],
    distribution_channel_drafts: [],
    distribution_approvals: approvals,
  };
  return { queries, src: { select: async (q) => (queries.push(q), { rows: tables[q.table] ?? [] }) } };
}

type Reply = { status: number; body?: unknown } | "hang" | "throw";
function provider(reply: Reply | ((init: RequestInit) => Reply)) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const http: GenerationHttpDeps = {
    timeoutMs: 30,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const r = typeof reply === "function" ? reply(init) : reply;
      if (r === "throw") throw new TypeError("network");
      if (r === "hang") return new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    },
  };
  return { http, calls };
}
const completion = (content: unknown, finish = "stop") => ({ status: 200, body: { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: finish }] } });

function deps(over: Partial<GenerateDraftDeps> & { s?: ReturnType<typeof source> } = {}): GenerateDraftDeps {
  const s = over.s ?? source();
  return {
    resolveActor: async (): Promise<ActorResult> => ({ ok: true, actorId: ADMIN }),
    getReadSource: () => s.src,
    getConfig: () => loadGenerationConfig(env()),
    http: provider(completion({ body: "출발 준비 이야기를 나눕니다." })).http,
    now: () => new Date("2026-11-18T12:00:00Z"),
    acquireQuota: async () => ({ ok: true }),
    ...over,
  };
}
const noKey = (...xs: unknown[]) => xs.forEach((x) => expect(JSON.stringify(x)).not.toContain(KEY));

describe("주제에서 공용 원고 생성", () => {
  const input = form({ topic: "  자전거 여행 준비  ", confirmGenerate: "on" });

  it("공용 한도 1건을 예약한 뒤 편집용 제목과 본문만 반환한다", async () => {
    const result = provider(completion({ title: " 여행 준비 ", body: " 첫 문단\r\n다음 문단 " }));
    const acquireQuota = vi.fn(async () => ({ ok: true as const }));
    const outcome = await generateOriginal(deps({ acquireQuota, http: result.http }), input);
    expect(outcome).toEqual({ status: "ok", prefill: { title: "여행 준비", body: "첫 문단\n다음 문단" } });
    expect(acquireQuota).toHaveBeenCalledExactlyOnceWith({ actorId: ADMIN, channel: "common", model: DEFAULT_GENERATION_MODEL });
    expect(result.calls).toHaveLength(1);
    expect(JSON.parse(String(result.calls[0]?.init.body)).messages.at(-1)).toEqual({ role: "user", content: "자전거 여행 준비" });
    noKey(outcome);
  });

  it("항목 초과, 동의 누락, 설정 누락, 한도 거절 시 공급자를 호출하지 않는다", async () => {
    const result = provider(completion({ title: "제목", body: "본문" }));
    const acquireQuota = vi.fn(async () => ({ ok: false as const, retryAfterSeconds: 30 }));
    const d = deps({ acquireQuota, http: result.http });
    expect(await generateOriginal(d, form({ topic: "가".repeat(ORIGINAL_TOPIC_MAX + 1), confirmGenerate: "on" }))).toMatchObject({ status: "invalid" });
    expect(await generateOriginal(d, form({ topic: "여행" }))).toMatchObject({ status: "invalid" });
    expect(await generateOriginal({ ...d, getConfig: () => loadGenerationConfig({}) }, input)).toMatchObject({ status: "not_configured" });
    expect(await generateOriginal(d, input)).toEqual({ status: "quota_exceeded", retryAfterSeconds: 30 });
    expect(acquireQuota).toHaveBeenCalledTimes(1);
    expect(result.calls).toHaveLength(0);
  });

  it.each([
    completion({ title: "제목", body: "본문" }, "length"),
    completion({ title: "제목" }),
    completion({ title: "제목", body: "가".repeat(4001) }),
  ])("불완전하거나 제한을 넘는 공급자 응답은 거절한다", async (reply) => {
    const result = provider(reply);
    expect(await generateOriginal(deps({ http: result.http }), input)).toEqual({ status: "output_invalid" });
  });
});

describe("설정(기본 닫힘)", () => {
  it("스위치가 정확히 true가 아니거나 키가 없으면 not_configured", () => {
    expect(loadGenerationConfig({})).toEqual({ status: "not_configured", missing: ["enabled_flag", "api_key"] });
    expect(loadGenerationConfig(env({ [GENERATION_ENV.enabled]: "1" }))).toMatchObject({ missing: ["enabled_flag"] });
    expect(loadGenerationConfig(env({ [GENERATION_ENV.apiKey]: "short" }))).toMatchObject({ missing: ["api_key"] });
    expect(loadGenerationConfig(env({ [GENERATION_ENV.model]: "bad model" }))).toMatchObject({ missing: ["model"] });
  });
  it("기본 모델은 gpt-4o-mini, 키는 SecretToken으로만 보관(직렬화해도 노출 없음)", () => {
    const r = loadGenerationConfig(env());
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.config.model).toBe(DEFAULT_GENERATION_MODEL);
    noKey(r, String(r.config.apiKey));
  });
  it("env 이름은 서버 전용(NEXT_PUBLIC_ 아님)", () => {
    for (const name of Object.values(GENERATION_ENV)) expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
  });
});

describe("경계: 공급자 호출 전 차단", () => {
  it("승인된 admin이 아니면 denied — 읽기·공급자 0회", async () => {
    const s = source();
    const p = provider(completion({ body: "x" }));
    const out = await generateChannelDraft(deps({ s, http: p.http, resolveActor: async () => ({ ok: false, reason: "not_approved" }) }), okForm());
    expect(out).toEqual({ status: "denied", reason: "not_approved" });
    expect(s.queries).toHaveLength(0);
    expect(p.calls).toHaveLength(0);
  });
  it("입력 오류(채널·uuid·확인 체크) → invalid, 호출 0", async () => {
    const p = provider(completion({ body: "x" }));
    const out = await generateChannelDraft(deps({ http: p.http }), form({ contentId: "x", channel: "tiktok", expectedContentVersionId: VID }));
    expect(out).toMatchObject({ status: "invalid" });
    expect((out as { errors: Array<{ field: string }> }).errors.map((e) => e.field)).toEqual(["contentId", "channel", "confirmGenerate"]);
    expect(p.calls).toHaveLength(0);
  });
  it("설정 없음·HTTP 미등록 → not_configured(누락 항목 명시), 읽기·호출 0", async () => {
    const s = source();
    expect(await generateChannelDraft(deps({ s, getConfig: () => loadGenerationConfig({}) }), okForm())).toEqual({ status: "not_configured", missing: ["enabled_flag", "api_key"] });
    expect(await generateChannelDraft(deps({ s, http: null }), okForm())).toEqual({ status: "not_configured", missing: ["http"] });
    expect(await generateChannelDraft(deps({ s, acquireQuota: null }), okForm())).toEqual({ status: "not_configured", missing: ["rate_limit"] });
    expect(s.queries).toHaveLength(0);
  });
  it("원문 상태: 없음·조회 불가·보관·미승인·해시 불일치·렌더 버전 불일치 → 공급자 0회", async () => {
    const cases: Array<[SourceOpts | null, unknown]> = [
      [{ missing: true }, { status: "not_found" }],
      [null, { status: "source_unavailable" }],
      [{ archived: true }, { status: "source_not_ready", reason: "archived" }],
      [{ approval: "none" }, { status: "source_not_ready", reason: "not_approved" }],
      [{ approval: "rejected" }, { status: "source_not_ready", reason: "not_approved" }],
      [{ approval: "other_hash" }, { status: "source_not_ready", reason: "not_approved" }],
      [{ currentVersionId: "00000000-0000-4000-8000-0000000000d9" }, { status: "source_not_ready", reason: "stale" }],
    ];
    for (const [o, expected] of cases) {
      const p = provider(completion({ body: "x" }));
      const out = await generateChannelDraft(deps({ http: p.http, ...(o ? { s: source(o) } : { getReadSource: () => null }) }), okForm());
      expect(out).toEqual(expected);
      expect(p.calls).toHaveLength(0);
    }
  });
});

describe("생성 성공(채널별)", () => {
  it("Threads: 공급자 1회, 키는 Authorization 헤더로만, 원문은 user 메시지 자료로", async () => {
    const p = provider(completion({ body: "출발 준비 이야기를 나눕니다." }));
    const out = await generateChannelDraft(deps({ http: p.http }), okForm("threads"));
    expect(out).toMatchObject({
      status: "ok",
      draft: { channel: "threads", body: "출발 준비 이야기를 나눕니다.", hashtags: [], provider: "openai", model: "gpt-4o-mini", promptVersion: "vibe-draft-gen-v1", sourceContentVersionId: VID, sourceContentHash: HASH, requiresHumanReview: true, generatedAt: "2026-11-18T12:00:00.000Z", warnings: ["link_removed"] },
      prefill: { body: "출발 준비 이야기를 나눕니다.", expectedContentVersionId: VID },
    });
    expect(p.calls).toHaveLength(1);
    const call = p.calls[0]!;
    expect(call.url).toBe(OPENAI_CHAT_URL);
    expect(call.url).not.toContain(KEY);
    expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const sent = JSON.parse(call.init.body as string);
    expect(sent).toMatchObject({ model: "gpt-4o-mini", response_format: { type: "json_object" }, n: 1 });
    expect(sent.body).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain(KEY);
    expect(sent.messages[0].role).toBe("system");
    expect(JSON.parse(sent.messages[1].content)).toEqual({ title: "출발 준비", body: expect.stringContaining("자전거 세계일주") });
    noKey(out);
  });
  it("Blog: 본문만(제목은 원문 제목 사용), 링크 유지 시 경고 없음", async () => {
    const p = provider(completion({ body: "첫 문단.\n\n둘째 문단 https://example.com/plan" }));
    const out = await generateChannelDraft(deps({ http: p.http }), okForm("blog"));
    expect(out).toMatchObject({ status: "ok", draft: { channel: "blog", body: "첫 문단.\n\n둘째 문단 https://example.com/plan", warnings: [] } });
  });
  it("Instagram: 캡션 + 해시태그 줄을 합친 body, 해시태그 중복 제거", async () => {
    const p = provider(completion({ body: "출발 준비 중입니다.", hashtags: ["#세계일주", "#자전거", "#세계일주"] }));
    const out = await generateChannelDraft(deps({ http: p.http }), okForm("instagram"));
    expect(out).toMatchObject({ status: "ok", draft: { channel: "instagram", body: "출발 준비 중입니다.\n\n#세계일주 #자전거", hashtags: ["#세계일주", "#자전거"] } });
  });
});

describe("사용량 한도", () => {
  it("한도 초과·한도 확인 오류 → quota_exceeded, 공급자 0회", async () => {
    for (const [acquireQuota, retry] of [
      [async () => ({ ok: false as const, retryAfterSeconds: 60 }), 60],
      [async () => { throw new Error("db down"); }, null],
    ] as const) {
      const p = provider(completion({ body: "x" }));
      expect(await generateChannelDraft(deps({ http: p.http, acquireQuota }), okForm())).toEqual({ status: "quota_exceeded", retryAfterSeconds: retry });
      expect(p.calls).toHaveLength(0);
    }
  });
  it("한도는 원문 검사를 통과한 뒤 호출 직전에 1회만 차감(actor·채널·모델 전달)", async () => {
    const seen: unknown[] = [];
    const p = provider(completion({ body: "x" }));
    await generateChannelDraft(deps({ http: p.http, s: source({ approval: "none" }), acquireQuota: async (i) => (seen.push(i), { ok: true }) }), okForm());
    expect(seen).toHaveLength(0);
    await generateChannelDraft(deps({ http: p.http, acquireQuota: async (i) => (seen.push(i), { ok: true }) }), okForm("blog"));
    expect(seen).toEqual([{ actorId: ADMIN, channel: "blog", model: "gpt-4o-mini" }]);
  });
  it("읽기 소스 생성 실패 → source_unavailable", async () => {
    expect(await generateChannelDraft(deps({ getReadSource: async () => { throw new Error("cookie"); } }), okForm())).toEqual({ status: "source_unavailable" });
  });
});

describe("공급자 실패 — 재시도 없음", () => {
  const cases: Array<[Reply, string, number | null]> = [
    ["hang", "timeout", null],
    ["throw", "network", null],
    [{ status: 401, body: { error: { message: "bad key" } } }, "auth", 401],
    [{ status: 429, body: {} }, "rate_limited", 429],
    [{ status: 500 }, "http_5xx", 500],
    [{ status: 400, body: { error: { message: "x" } } }, "rejected", 400],
    [{ status: 200, body: { choices: [] } }, "bad_response", 200],
  ];
  for (const [reply, code, httpStatus] of cases) {
    it(`${code} → provider_error, 호출 1회`, async () => {
      const p = provider(reply);
      const out = await generateChannelDraft(deps({ http: p.http }), okForm());
      expect(out).toEqual({ status: "provider_error", code, httpStatus });
      expect(p.calls).toHaveLength(1);
      noKey(out);
    });
  }
});

describe("출력 검사(저장 후보로 내지 않음)", () => {
  it("Threads 500자 초과·JSON 아님·body 없음·빈 값·제어문자·길이 중단 → output_invalid", async () => {
    const cases: Array<[unknown, string, string[]]> = [
      [{ body: "가".repeat(CHANNEL_LIMITS.threads.maxChars + 1) }, "stop", ["too_long"]],
      ["설명 없이 본문만", "stop", ["not_json"]],
      [{ text: "x" }, "stop", ["missing_body"]],
      [{ body: "   " }, "stop", ["empty"]],
      [{ body: "a\u0007b" }, "stop", ["control_chars"]],
      [{ body: "ok" }, "length", ["finish_length"]],
    ];
    for (const [content, finish, reasons] of cases) {
      const out = await generateChannelDraft(deps({ http: provider(completion(content, finish)).http }), okForm("threads"));
      expect(out).toEqual({ status: "output_invalid", reasons });
    }
  });
  it("Instagram 해시태그 형식 오류 → bad_hashtags, 30개 초과는 잘라내고 경고", () => {
    expect(parseGeneratedOutput("instagram", JSON.stringify({ body: "x", hashtags: ["태그"] }), { finishReason: "stop", sourceBody: "" })).toEqual({ ok: false, reasons: ["bad_hashtags"] });
    const many = Array.from({ length: 35 }, (_, i) => `#t${i}`);
    const r = parseGeneratedOutput("instagram", JSON.stringify({ body: "x", hashtags: many }), { finishReason: "stop", sourceBody: "" });
    expect(r).toMatchObject({ ok: true, warnings: ["hashtags_trimmed"] });
    expect(r.ok && r.hashtags).toHaveLength(30);
  });
  it("Instagram 캡션+해시태그 2,200자 초과 → too_long", () => {
    const r = parseGeneratedOutput("instagram", JSON.stringify({ body: "가".repeat(2190), hashtags: ["#abcdefghij"] }), { finishReason: "stop", sourceBody: "" });
    expect(r).toEqual({ ok: false, reasons: ["too_long"] });
  });
});

describe("지시문·경계(소스)", () => {
  it("채널마다 다른 규칙, 원문은 system이 아니라 user 메시지에만", () => {
    const src = { title: "제목 SECRET_MARK", body: "본문 SECRET_MARK" };
    for (const ch of ["blog", "threads", "instagram"] as const) {
      const m = buildMessages(ch, src);
      expect(m.map((x) => x.role)).toEqual(["system", "user"]);
      expect(m[0]!.content).not.toContain("SECRET_MARK");
      expect(m[1]!.content).toContain("SECRET_MARK");
    }
    expect(buildMessages("threads", src)[0]!.content).toContain("500자");
    expect(buildMessages("instagram", src)[0]!.content).toContain("hashtags");
  });
  it("생성 모듈은 기본 fetch·process.env·저장/승인/작업 RPC·키트 경로를 쓰지 않는다", () => {
    const dir = "src/server/distribution/generation";
    for (const f of readdirSync(dir).filter((x) => x !== "runtime.ts")) {
      const code = readFileSync(`${dir}/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, f).not.toMatch(/globalThis\.fetch|[^.]\bfetch\(|process\.env/);
      expect(code, f).not.toMatch(/appendDraftRevision|decideApproval|distribution_create_job|distribution_decide_approval/);
      // RPC는 quota.ts의 예약 RPC 1종만(저장·승인·작업 RPC 없음)
      if (f === "quota.ts") expect(code.match(/\.rpc\(/g), f).toHaveLength(1);
      else expect(code, f).not.toMatch(/\.rpc\(/);
      expect(code, f).not.toMatch(/Posting_Kit|insta_auto_poster|ai-auto-blog|handoff\//);
    }
  });
});
