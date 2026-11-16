import { describe, expect, it } from "vitest";
import {
  applyResult,
  cancelJob,
  createJob,
  isDue,
  reconcileUnknown,
  retryFailed,
  startDispatch,
  summarizeBatch,
  type ChannelDraft,
  type ContentItem,
  type PublishJob,
  type PublishResult,
} from "@/lib/distribution";

/** live 결과 반영: 현재 시도 번호를 함께 넘긴다(DEC-DISTRIBUTION-002 #1) */
const applyLive = (j: PublishJob, r: PublishResult) => applyResult(j, r, { attempt: j.attempts });

const NOW = "2026-11-16T03:00:00.000Z";
const content: ContentItem = {
  id: "c-why",
  version: 2,
  title: "도전의 목적",
  body: "샘플 본문",
  targetPath: "/about",
  mediaRefs: [],
  updatedAt: NOW,
};
const draft = (over: Partial<ChannelDraft> = {}): ChannelDraft => ({
  contentId: "c-why",
  contentVersion: 2,
  channel: "threads",
  text: "샘플 초안",
  mediaRefs: [],
  link: null,
  reviewStatus: "approved",
  ...over,
});

function must<T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
function code(r: { ok: boolean; error?: { code: string } }) {
  return r.ok ? "OK" : r.error?.code;
}

function newJob(over: Partial<Parameters<typeof createJob>[0]> = {}): PublishJob {
  return must(createJob({ id: "j1", content, draft: draft(), mode: "live", scheduledAt: null, now: NOW, existing: [], ...over }));
}

describe("작업 생성", () => {
  it("승인되지 않은 초안·옛 버전 초안은 거절", () => {
    expect(code(createJob({ id: "j", content, draft: draft({ reviewStatus: "needs_review" }), mode: "live", scheduledAt: null, now: NOW, existing: [] }))).toBe("NOT_APPROVED");
    expect(code(createJob({ id: "j", content, draft: draft({ contentVersion: 1 }), mode: "live", scheduledAt: null, now: NOW, existing: [] }))).toBe("STALE_DRAFT");
  });

  it("빈 초안 거절", () => {
    expect(code(createJob({ id: "j", content, draft: draft({ text: "  " }), mode: "live", scheduledAt: null, now: NOW, existing: [] }))).toBe("INVALID_INPUT");
  });

  it("콘텐츠+버전+채널 중복 요청 거절, 취소된 작업은 다시 만들 수 있다", () => {
    const first = newJob();
    expect(code(createJob({ id: "j2", content, draft: draft(), mode: "live", scheduledAt: null, now: NOW, existing: [first] }))).toBe("DUPLICATE");
    const cancelled = must(cancelJob(first));
    expect(code(createJob({ id: "j2", content, draft: draft(), mode: "live", scheduledAt: null, now: NOW, existing: [cancelled] }))).toBe("OK");
  });

  it("다른 채널·dry-run은 별도 키", () => {
    const first = newJob();
    expect(code(createJob({ id: "j2", content, draft: draft({ channel: "blog" }), mode: "live", scheduledAt: null, now: NOW, existing: [first] }))).toBe("OK");
    expect(code(createJob({ id: "j3", content, draft: draft(), mode: "dry_run", scheduledAt: null, now: NOW, existing: [first] }))).toBe("OK");
  });

  it("이전 버전이 이미 게시된 채널에 새 버전 게시는 명시 확인 필요", () => {
    const old: PublishJob = { ...newJob(), contentVersion: 1, idempotencyKey: "pub:c-why:v1:threads:live", status: "published", externalId: "ext-1" };
    expect(code(createJob({ id: "j2", content, draft: draft(), mode: "live", scheduledAt: null, now: NOW, existing: [old] }))).toBe("DUPLICATE");
    expect(code(createJob({ id: "j2", content, draft: draft(), mode: "live", scheduledAt: null, now: NOW, existing: [old], allowRepublish: true }))).toBe("OK");
  });

  it("예약 시각: 시간대 필수·미래만·UTC로 저장", () => {
    expect(code(createJob({ id: "j", content, draft: draft(), mode: "live", scheduledAt: "2026-11-16T12:00:00", now: NOW, existing: [] }))).toBe("INVALID_INPUT");
    expect(code(createJob({ id: "j", content, draft: draft(), mode: "live", scheduledAt: "2026-11-16T03:00:00Z", now: NOW, existing: [] }))).toBe("INVALID_INPUT");
    const job = newJob({ scheduledAt: "2026-11-16T21:00:00+09:00" });
    expect(job.scheduledAt).toBe("2026-11-16T12:00:00.000Z");
  });
});

describe("예약·실행", () => {
  it("예약 시각 전에는 실행 불가, 이후 실행", () => {
    const job = newJob({ scheduledAt: "2026-11-16T12:00:00Z" });
    expect(isDue(job, "2026-11-16T11:59:59Z")).toBe(false);
    expect(code(startDispatch(job, "2026-11-16T11:59:59Z"))).toBe("NOT_DUE");
    const running = must(startDispatch(job, "2026-11-16T12:00:00Z"));
    expect(running).toMatchObject({ status: "dispatching", attempts: 1 });
  });
});

describe("결과 반영 — published 근거와 dry-run 구별", () => {
  it("live + 외부 식별자일 때만 published", () => {
    const running = must(startDispatch(newJob(), NOW));
    expect(code(applyLive(running, { kind: "published", externalId: " ", externalUrl: null, confirmedAt: NOW }))).toBe("NO_EVIDENCE");
    const done = must(applyLive(running, { kind: "published", externalId: "ext-123", externalUrl: null, confirmedAt: NOW }));
    expect(done.status).toBe("published");
  });

  it("dry-run 작업은 published가 될 수 없고 dry_run_succeeded로 끝난다", () => {
    const dry = must(startDispatch(newJob({ mode: "dry_run" }), NOW));
    expect(code(applyResult(dry, { kind: "published", externalId: "x", externalUrl: null, confirmedAt: NOW }))).toBe("MODE_MISMATCH");
    const ok = must(applyResult(dry, { kind: "dry_run_ok", preview: { channel: "threads", text: "t", mediaCount: 0, link: null } }));
    expect(ok.status).toBe("dry_run_succeeded");
    expect(ok.externalId).toBeNull();
  });

  it("실제 작업에 모의 결과를 반영할 수 없다", () => {
    const running = must(startDispatch(newJob(), NOW));
    expect(code(applyLive(running, { kind: "dry_run_ok", preview: { channel: "threads", text: "t", mediaCount: 0, link: null } }))).toBe("MODE_MISMATCH");
  });
});

describe("응답 유실(unknown)과 재시도", () => {
  const unknownJob = () => must(applyLive(must(startDispatch(newJob(), NOW)), { kind: "unknown", reason: "timeout" }));

  it("unknown은 바로 재시도할 수 없다", () => {
    expect(code(retryFailed(unknownJob()))).toBe("RECONCILE_REQUIRED");
    expect(code(cancelJob(unknownJob()))).toBe("INVALID_TRANSITION");
  });

  it("대사: 게시 확인 → published, 부재 확인 → 재시도 가능, 여전히 모름 → 그대로", () => {
    expect(must(reconcileUnknown(unknownJob(), { kind: "found_published", externalId: "ext-9", externalUrl: null })).status).toBe("published");
    const absent = must(reconcileUnknown(unknownJob(), { kind: "confirmed_absent" }));
    expect(absent.status).toBe("failed");
    expect(must(retryFailed(absent)).status).toBe("scheduled");
    expect(must(reconcileUnknown(unknownJob(), { kind: "still_unknown" })).status).toBe("unknown");
  });

  it("retryable=false 실패·사전 거절은 재시도 불가", () => {
    const running = must(startDispatch(newJob(), NOW));
    const failed = must(applyLive(running, { kind: "failed", error: { code: "X", message: "m", retryable: false } }));
    expect(code(retryFailed(failed))).toBe("RETRY_NOT_ALLOWED");
    const rejected = must(applyLive(running, { kind: "rejected", error: { code: "NOT_CONNECTED", message: "m", retryable: true } }));
    expect(rejected.lastError?.retryable).toBe(false);
    expect(code(retryFailed(rejected))).toBe("RETRY_NOT_ALLOWED");
  });

  it("retryable 실패는 최대 시도 횟수까지만", () => {
    let job = newJob({ maxAttempts: 2 });
    for (let i = 0; i < 2; i++) {
      job = must(startDispatch(job, NOW));
      job = must(applyLive(job, { kind: "failed", error: { code: "RATE", message: "m", retryable: true } }));
      if (i === 0) job = must(retryFailed(job));
    }
    expect(job.attempts).toBe(2);
    expect(code(retryFailed(job))).toBe("RETRY_NOT_ALLOWED");
  });
});

describe("부분 성공 요약", () => {
  const base = newJob();
  const j = (channel: PublishJob["channel"], status: PublishJob["status"], mode: PublishJob["mode"] = "live"): PublishJob => ({ ...base, channel, status, mode });

  it("일부만 게시 → partial, unknown 하나라도 있으면 needs_reconcile", () => {
    expect(summarizeBatch([j("blog", "published"), j("threads", "failed"), j("instagram", "published")]).overall).toBe("partial");
    expect(summarizeBatch([j("blog", "published"), j("threads", "unknown")]).overall).toBe("needs_reconcile");
    expect(summarizeBatch([j("blog", "published"), j("threads", "published")]).overall).toBe("all_published");
    expect(summarizeBatch([j("blog", "failed")]).overall).toBe("none_published");
    expect(summarizeBatch([j("blog", "published"), j("threads", "scheduled")]).overall).toBe("pending");
  });

  it("dry-run 성공은 게시 수에 포함하지 않는다", () => {
    const s = summarizeBatch([j("blog", "dry_run_succeeded", "dry_run")]);
    expect(s.overall).toBe("dry_run_only");
    expect(s.published).toEqual([]);
  });
});
