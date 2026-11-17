/**
 * QA-MKT-001 경계값·오염 입력 회귀 시험. 각 시험은 수정 전 실제로 재현된 결함(D1~D6)이다.
 */
import { describe, expect, it } from "vitest";
import {
  applyResult,
  buildTrackedUrl,
  cancelJob,
  createJob,
  isDue,
  parseZonedTime,
  reconcileUnknown,
  retryFailed,
  startDispatch,
  type ChannelDraft,
  type ContentItem,
  type PublishJob,
  type PublishResult,
} from "@/lib/distribution";

/** live 결과 반영: 현재 시도 번호를 함께 넘긴다(DEC-DISTRIBUTION-002 #1) */
const applyLive = (j: PublishJob, r: PublishResult) => applyResult(j, r, { attempt: j.attempts });

const NOW = "2026-11-16T03:00:00.000Z";
const content = (version: number): ContentItem => ({ id: "c1", version, title: "t", body: "b", targetPath: "/about", mediaRefs: [], updatedAt: NOW });
// REGRESSION-004: 이 파일의 시험은 live 작업 경계값을 본다. M2 CHANNEL_MODES상 blog는 live 불가라
// 기본 채널을 live 가능한 threads로 둔다(이전에는 모든 시험이 MODE_MISMATCH에서 먼저 끝나 경계값이 검사되지 않았다).
const draft = (version: number, channel: ChannelDraft["channel"] = "threads"): ChannelDraft => ({
  contentId: "c1", contentVersion: version, channel, text: "x", mediaRefs: [], link: null, reviewStatus: "approved",
});
function must<T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? "OK" : r.error?.code);
const job = (over: Partial<Parameters<typeof createJob>[0]> = {}) =>
  must(createJob({ id: "j1", content: content(1), draft: draft(1), mode: "live", scheduledAt: null, now: NOW, existing: [], ...over }));

describe("D1 현재 시각 검증", () => {
  it.each(["not-a-date", "", "2026-11-16", "2026-11-16T03:00:00", "2026/11/16 03:00Z"])("잘못된 now %j → 생성 거절", (now) => {
    expect(code(createJob({ id: "j", content: content(1), draft: draft(1), mode: "live", scheduledAt: null, now, existing: [] }))).toBe("INVALID_INPUT");
  });

  it("실행 시점의 잘못된 now는 거절하고, 정상 now는 UTC로 기록", () => {
    expect(code(startDispatch(job(), "also-bad"))).toBe("INVALID_INPUT");
    expect(isDue(job(), "also-bad")).toBe(false);
    expect(must(startDispatch(job(), "2026-11-16T12:00:00+09:00")).lastAttemptAt).toBe("2026-11-16T03:00:00.000Z");
  });
});

describe("D2 없는 날짜·잘못된 시간대", () => {
  it.each([
    "2027-02-30T00:00:00Z", // 다음 달로 넘어가던 날짜
    "2027-02-29T00:00:00Z", // 평년
    "2027-13-01T00:00:00Z",
    "2027-01-01T24:00:00Z",
    "2027-01-01T00:00:00+15:00",
    "2027-01-01T00:00:00+09:60",
  ])("%s 거절", (scheduledAt) => {
    expect(code(createJob({ id: "j", content: content(1), draft: draft(1), mode: "live", scheduledAt, now: NOW, existing: [] }))).toBe("INVALID_INPUT");
  });

  it("윤년 2월 29일과 +14:00은 허용", () => {
    expect(parseZonedTime("2028-02-29T00:00:00Z")).not.toBeNull();
    expect(job({ scheduledAt: "2027-01-01T00:00:00+14:00" }).scheduledAt).toBe("2026-12-31T10:00:00.000Z");
  });
});

describe("D3 같은 콘텐츠·채널의 다른 버전 동시 게시 방지", () => {
  it.each(["scheduled", "dispatching", "unknown", "failed"] as const)("v1이 %s이면 v2 live 생성 거절(allowRepublish로도)", (status) => {
    const v1: PublishJob = { ...job(), status };
    const r = createJob({ id: "j2", content: content(2), draft: draft(2), mode: "live", scheduledAt: null, now: NOW, existing: [v1], allowRepublish: true });
    expect(code(r)).toBe("DUPLICATE");
  });

  it("v1을 취소하면 v2 생성 가능, 다른 채널·dry-run은 영향 없음", () => {
    const v1 = job();
    expect(code(createJob({ id: "j2", content: content(2), draft: draft(2), mode: "live", scheduledAt: null, now: NOW, existing: [must(cancelJob(v1))] }))).toBe("OK");
    expect(code(createJob({ id: "j3", content: content(2), draft: draft(2, "instagram"), mode: "live", scheduledAt: null, now: NOW, existing: [v1] }))).toBe("OK");
    expect(code(createJob({ id: "j4", content: content(2), draft: draft(2), mode: "dry_run", scheduledAt: null, now: NOW, existing: [v1] }))).toBe("OK");
  });
});

describe("D4 시도 횟수 오염", () => {
  it.each([
    { maxAttempts: Number.NaN, attempts: 99 },
    { maxAttempts: 3, attempts: Number.NaN },
    { maxAttempts: 0, attempts: 0 },
    { maxAttempts: 3, attempts: -1 },
    { maxAttempts: 3, attempts: 5 },
  ])("%o → 실행·재시도 거절", (over) => {
    expect(startDispatch({ ...job(), ...over }, NOW).ok).toBe(false);
    // REGRESSION-004: 정책상 자동 재시도 가능한(auto) 실패로 만들어, 거절 사유가 정책이 아니라 시도 횟수 오염임을 보장한다.
    const failed: PublishJob = {
      ...job(),
      ...over,
      status: "failed",
      lastError: { code: "X", message: "", retryable: true, autoRetry: true },
      retryPolicy: "auto",
    };
    const r = retryFailed(failed);
    expect(r.ok).toBe(false);
    expect(code(r)).toMatch(/^(INVALID_INPUT|RETRY_NOT_ALLOWED)$/);
  });

  it.each([0, -1, 1.5, Number.NaN, 11])("생성 시 maxAttempts %s 거절", (maxAttempts) => {
    expect(code(createJob({ id: "j", content: content(1), draft: draft(1), mode: "live", scheduledAt: null, now: NOW, existing: [], maxAttempts }))).toBe("INVALID_INPUT");
  });
});

describe("D5 이전 시도의 늦은 결과", () => {
  it("attempt를 넘기면 이전 시도의 결과는 STALE_RESULT, 현재 시도의 결과는 반영", () => {
    const first = must(startDispatch(job(), NOW));
    // REGRESSION-004: 자동 재시도는 게시 요청 전 실패만(M2) → publishRequested:false 명시.
    const failed = must(applyResult(first, { kind: "failed", error: { code: "TIMEOUT", message: "", retryable: true } }, { attempt: 1, publishRequested: false }));
    const second = must(startDispatch(must(retryFailed(failed)), NOW));
    expect(second.attempts).toBe(2);
    const late = applyResult(second, { kind: "failed", error: { code: "TIMEOUT", message: "", retryable: true } }, { attempt: 1 });
    expect(code(late)).toBe("STALE_RESULT");
    const ok = must(applyResult(second, { kind: "published", externalId: "ext-2", externalUrl: null, confirmedAt: NOW }, { attempt: 2 }));
    expect(ok.status).toBe("published");
  });

  it("실행 중이 아닌 작업(취소·게시됨)에는 결과를 반영하지 않는다", () => {
    const cancelled = must(cancelJob(job()));
    expect(code(applyLive(cancelled, { kind: "published", externalId: "x", externalUrl: null, confirmedAt: NOW }))).toBe("INVALID_TRANSITION");
    const published = must(applyLive(must(startDispatch(job(), NOW)), { kind: "published", externalId: "x", externalUrl: null, confirmedAt: NOW }));
    expect(code(applyLive(published, { kind: "failed", error: { code: "X", message: "", retryable: true } }))).toBe("INVALID_TRANSITION");
  });
});

describe("D6 게시 근거 값", () => {
  const running = () => must(startDispatch(job(), NOW));

  it.each(["javascript:alert(1)", "data:text/html,x", "not a url", "ftp://host/x"])("externalUrl %j 거절", (externalUrl) => {
    expect(code(applyLive(running(), { kind: "published", externalId: "e", externalUrl, confirmedAt: NOW }))).toBe("NO_EVIDENCE");
  });

  it("식별자 앞뒤 공백은 정리해 저장, https 주소는 허용", () => {
    const r = must(applyLive(running(), { kind: "published", externalId: "  ext-9 ", externalUrl: "https://example.invalid/p/9", confirmedAt: NOW }));
    expect(r.externalId).toBe("ext-9");
  });

  it("대사(found_published)도 같은 규칙", () => {
    const unknown = must(applyLive(running(), { kind: "unknown", reason: "timeout" }));
    expect(code(reconcileUnknown(unknown, { kind: "found_published", externalId: "e", externalUrl: "javascript:x" }))).toBe("NO_EVIDENCE");
    expect(must(reconcileUnknown(unknown, { kind: "found_published", externalId: " e ", externalUrl: null })).externalId).toBe("e");
  });
});

describe("확인 결과 정상(결함 아님) — 회귀 고정", () => {
  it("UTM: 탭·줄바꿈으로 외부 호스트를 만드는 경로는 거절", () => {
    for (const path of ["/\t/evil.invalid/x", "/\n/evil.invalid/x", "/\\evil.invalid"]) {
      expect(buildTrackedUrl("https://site.invalid", path, { source: "a", medium: "b", campaign: "c" }).ok).toBe(false);
    }
  });
});
