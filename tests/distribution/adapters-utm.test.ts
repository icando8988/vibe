import { describe, expect, it } from "vitest";
import {
  ALL_CHANNELS,
  applyResult,
  buildTrackedUrl,
  createJob,
  getAdapter,
  makeIdempotencyKey,
  requireCapability,
  startDispatch,
  type ChannelDraft,
  type ContentItem,
  type PublishJob,
  type PublishResult,
} from "@/lib/distribution";

/** live 결과 반영: 현재 시도 번호를 함께 넘긴다(DEC-DISTRIBUTION-002 #1) */
const applyLive = (j: PublishJob, r: PublishResult) => applyResult(j, r, { attempt: j.attempts });

const NOW = "2026-11-16T03:00:00.000Z";
const content: ContentItem = { id: "c1", version: 1, title: "t", body: "b", targetPath: "/about", mediaRefs: [], updatedAt: NOW };
const draft: ChannelDraft = { contentId: "c1", contentVersion: 1, channel: "blog", text: "샘플", mediaRefs: ["m1"], link: null, reviewStatus: "approved" };
// AUTOPOST-DOMAIN-REGRESSION-004: M2 CHANNEL_MODES(distribution_jobs_blog_modes) — blog는 manual/dry_run만.
// live 경로 시험은 live를 허용하는 채널(threads)로 한다. blog live 거절은 아래 별도 시험으로 고정한다.
const liveDraft: ChannelDraft = { ...draft, channel: "threads" };

describe("어댑터 — 미연결·모의 실행", () => {
  it("모든 채널의 기능은 unverified, 연결 false, 제한값 null", () => {
    for (const ch of ALL_CHANNELS) {
      const caps = getAdapter(ch, "live").capabilities;
      expect(caps.connected).toBe(false);
      for (const [k, v] of Object.entries(caps)) {
        if (k === "channel" || k === "connected" || k === "limits") continue;
        expect(v, `${ch}.${k}`).toBe("unverified");
      }
      expect(caps.limits).toEqual({ maxTextLength: null, maxMedia: null });
      expect(requireCapability(caps, "publishText")).toEqual({ ok: false, reason: "not_connected" });
    }
  });

  it("live 어댑터는 NOT_CONNECTED로 거절 → 작업은 재시도 불가 failed", async () => {
    const job = createJob({ id: "j", content, draft: liveDraft, mode: "live", scheduledAt: null, now: NOW, existing: [] });
    if (!job.ok) throw new Error(job.error.code);
    const running = startDispatch(job.value, NOW);
    if (!running.ok) throw new Error(running.error.code);
    const result = await getAdapter("threads", "live").publish(running.value, liveDraft);
    expect(result.kind).toBe("rejected");
    const after = applyLive(running.value, result);
    expect(after.ok && after.value.status).toBe("failed");
    expect(after.ok && after.value.lastError?.code).toBe("NOT_CONNECTED");
  });

  it("dry-run 어댑터는 미리보기만, live 작업에는 거절", async () => {
    const dry = createJob({ id: "j", content, draft, mode: "dry_run", scheduledAt: null, now: NOW, existing: [] });
    if (!dry.ok) throw new Error(dry.error.code);
    const r = await getAdapter("blog", "dry_run").publish(dry.value, draft);
    expect(r).toEqual({ kind: "dry_run_ok", preview: { channel: "blog", text: "샘플", mediaCount: 1, link: null } });

    const live = createJob({ id: "j2", content, draft: liveDraft, mode: "live", scheduledAt: null, now: NOW, existing: [] });
    if (!live.ok) throw new Error(live.error.code);
    const wrong = await getAdapter("threads", "dry_run").publish(live.value, liveDraft);
    expect(wrong.kind).toBe("rejected");
  });

  it("채널별 허용 모드(M2): blog live·비blog manual은 작업 생성 단계에서 거절", () => {
    const blogLive = createJob({ id: "j", content, draft, mode: "live", scheduledAt: null, now: NOW, existing: [] });
    expect(blogLive.ok ? "OK" : blogLive.error.code).toBe("MODE_MISMATCH");
    const threadsManual = createJob({ id: "j", content, draft: liveDraft, mode: "manual", scheduledAt: null, now: NOW, existing: [] });
    expect(threadsManual.ok ? "OK" : threadsManual.error.code).toBe("MODE_MISMATCH");
    const blogManual = createJob({ id: "j", content, draft, mode: "manual", scheduledAt: null, now: NOW, existing: [] });
    expect(blogManual.ok && blogManual.value.status).toBe("manual_ready");
  });
});

describe("멱등키", () => {
  it("콘텐츠·버전·채널·모드로 결정적", () => {
    const a = makeIdempotencyKey({ contentId: "c1", contentVersion: 3, channel: "instagram", mode: "live" });
    expect(a).toEqual({ ok: true, value: "pub:c1:v3:instagram:live" });
    expect(makeIdempotencyKey({ contentId: "c1", contentVersion: 3, channel: "instagram", mode: "dry_run" }).ok).toBe(true);
  });
  it("잘못된 입력 거절", () => {
    expect(makeIdempotencyKey({ contentId: "c 1", contentVersion: 1, channel: "blog", mode: "live" }).ok).toBe(false);
    expect(makeIdempotencyKey({ contentId: "c1", contentVersion: 0, channel: "blog", mode: "live" }).ok).toBe(false);
    expect(makeIdempotencyKey({ contentId: "c1", contentVersion: 1, channel: "x" as never, mode: "live" }).ok).toBe(false);
  });
});

describe("UTM 링크", () => {
  const utm = { source: "threads", medium: "social", campaign: "prelaunch-test" };

  it("공개 도메인 미확정이면 만들지 않는다", () => {
    const r = buildTrackedUrl(null, "/about", utm);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_CONNECTED");
  });

  it("주어진 기준 URL·경로로 생성, 기존 쿼리 보존", () => {
    const r = buildTrackedUrl("https://example.invalid", "/books?tab=all", { ...utm, content: "post-1" });
    expect(r).toEqual({
      ok: true,
      value: "https://example.invalid/books?tab=all&utm_source=threads&utm_medium=social&utm_campaign=prelaunch-test&utm_content=post-1",
    });
  });

  it.each([
    ["http 기준", "http://example.invalid", "/about", utm],
    ["계정 포함", "https://u:p@example.invalid", "/about", utm],
    ["외부 경로", "https://example.invalid", "//evil.invalid/x", utm],
    ["상대 경로", "https://example.invalid", "about", utm],
    ["기존 UTM", "https://example.invalid", "/about?utm_source=x", utm],
    ["대문자·공백 값", "https://example.invalid", "/about", { ...utm, campaign: "Pre Launch" }],
  ] as const)("거절: %s", (_label, base, path, params) => {
    expect(buildTrackedUrl(base, path, params).ok).toBe(false);
  });
});
