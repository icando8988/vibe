/**
 * QA-MKT-002: DEC-DISTRIBUTION-002 기술 결정 회귀 시험.
 */
import { describe, expect, it } from "vitest";
import {
  applyResult,
  cancelJob,
  createJob,
  isValidEvidenceUrl,
  isValidJobId,
  preserveLateEvidence,
  retryFailed,
  startDispatch,
  summarizeBatch,
  summarizeContentVersion,
  type ChannelDraft,
  type ContentItem,
  type PublishJob,
} from "@/lib/distribution";

const NOW = "2026-11-16T03:00:00.000Z";
const content = (version: number): ContentItem => ({ id: "c1", version, title: "t", body: "b", targetPath: "/about", mediaRefs: [], updatedAt: NOW });
const draft = (version: number, channel: ChannelDraft["channel"] = "blog"): ChannelDraft => ({
  contentId: "c1", contentVersion: version, channel, text: "x", mediaRefs: [], link: null, reviewStatus: "approved",
});
function must<T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? "OK" : r.error?.code);
const newJob = (mode: PublishJob["mode"] = "live", id = "j1") =>
  must(createJob({ id, content: content(1), draft: draft(1), mode, scheduledAt: null, now: NOW, existing: [] }));
const published = { kind: "published" as const, externalId: "ext-1", externalUrl: null, confirmedAt: NOW };

describe("#1 live 결과에는 유효한 시도 번호 필수, dry_run은 생략 호환", () => {
  it.each([
    ["누락", undefined],
    ["0", 0],
    ["음수", -1],
    ["소수", 1.5],
    ["NaN", Number.NaN],
    ["과거 시도", 0],
  ])("live: %s → STALE_RESULT, 상태 변화 없음", (_l, attempt) => {
    const running = must(startDispatch(newJob(), NOW));
    const r = applyResult(running, published, attempt === undefined ? {} : { attempt });
    expect(code(r)).toBe("STALE_RESULT");
    expect(running.status).toBe("dispatching");
  });

  it("live: 현재 시도 번호면 반영", () => {
    const running = must(startDispatch(newJob(), NOW));
    expect(must(applyResult(running, published, { attempt: 1 })).status).toBe("published");
  });

  it("dry_run: 시도 번호 없이도 반영(기존 UI 호출 방식), 주면 검사", () => {
    const dry = must(startDispatch(newJob("dry_run"), NOW));
    const preview = { kind: "dry_run_ok" as const, preview: { channel: "blog" as const, text: "x", mediaCount: 0, link: null } };
    expect(must(applyResult(dry, preview)).status).toBe("dry_run_succeeded");
    expect(code(applyResult(dry, preview, { attempt: 2 }))).toBe("STALE_RESULT");
  });
});

describe("#2 늦은 게시 근거 보존 — 작업 상태는 그대로, 대사 필요", () => {
  const evidence = (over: Partial<Parameters<typeof preserveLateEvidence>[1]> = {}) => ({
    externalId: "ext-late", externalUrl: "https://example.invalid/p/1", confirmedAt: NOW, attempt: 1, ...over,
  });

  it("취소된 작업에 도착한 근거 → 기록 + requiresReconciliation", () => {
    const cancelled = must(cancelJob(newJob()));
    const rec = must(preserveLateEvidence(cancelled, evidence()));
    expect(rec).toMatchObject({ reason: "job_not_dispatching", jobStatusAtArrival: "cancelled", requiresReconciliation: true, conflict: false });
    expect(cancelled.status).toBe("cancelled");
  });

  it("실패 후 재예약된 작업 / 실행 중 이전 시도 / 시도 번호 없음", () => {
    const first = must(startDispatch(newJob(), NOW));
    const failed = must(applyResult(first, { kind: "failed", error: { code: "T", message: "", retryable: true } }, { attempt: 1 }));
    expect(must(preserveLateEvidence(failed, evidence())).reason).toBe("job_not_dispatching");
    const second = must(startDispatch(must(retryFailed(failed)), NOW));
    expect(must(preserveLateEvidence(second, evidence({ attempt: 1 }))).reason).toBe("older_attempt");
    expect(must(preserveLateEvidence(second, evidence({ attempt: null }))).reason).toBe("attempt_unknown");
  });

  it("이미 게시된 작업: 다른 식별자는 충돌(대사), 같은 식별자는 중복 통지", () => {
    const done = must(applyResult(must(startDispatch(newJob(), NOW)), published, { attempt: 1 }));
    expect(must(preserveLateEvidence(done, evidence({ externalId: "ext-other" })))).toMatchObject({
      reason: "already_published", conflict: true, requiresReconciliation: true,
    });
    expect(must(preserveLateEvidence(done, evidence({ externalId: " ext-1 " })))).toMatchObject({
      conflict: false, duplicateOfConfirmed: true, requiresReconciliation: false,
    });
    expect(done.externalId).toBe("ext-1");
  });

  it("현재 시도의 정상 결과는 applyResult로 보내고, 잘못된 근거·모의 작업은 거절", () => {
    const running = must(startDispatch(newJob(), NOW));
    expect(code(preserveLateEvidence(running, evidence({ attempt: 1 })))).toBe("INVALID_TRANSITION");
    expect(code(preserveLateEvidence(running, evidence({ attempt: 0 })))).toBe("INVALID_INPUT");
    expect(code(preserveLateEvidence(running, evidence({ externalId: "  " })))).toBe("NO_EVIDENCE");
    expect(code(preserveLateEvidence(running, evidence({ externalUrl: "http://example.invalid" })))).toBe("NO_EVIDENCE");
    expect(code(preserveLateEvidence(running, evidence({ confirmedAt: "bad" })))).toBe("INVALID_INPUT");
    expect(code(preserveLateEvidence(must(cancelJob(newJob("dry_run"))), evidence()))).toBe("MODE_MISMATCH");
  });
});

describe("#3 게시 근거 URL: null 또는 계정 정보 없는 https", () => {
  it.each([null, "https://example.invalid/p/1", "https://example.invalid"])("허용 %j", (u) => {
    expect(isValidEvidenceUrl(u)).toBe(true);
  });
  it.each(["", "   ", "http://example.invalid/p", "https://user:pw@example.invalid/p", "https://user@example.invalid", "javascript:alert(1)", "data:text/html,x", "not a url", 42])(
    "거절 %j",
    (u) => {
      expect(isValidEvidenceUrl(u)).toBe(false);
    },
  );
  it("applyResult도 같은 규칙(http 거절), 식별자만 있어도 허용", () => {
    const running = () => must(startDispatch(newJob(), NOW));
    expect(code(applyResult(running(), { ...published, externalUrl: "http://example.invalid" }, { attempt: 1 }))).toBe("NO_EVIDENCE");
    expect(code(applyResult(running(), { ...published, externalUrl: null }, { attempt: 1 }))).toBe("OK");
  });
});

describe("#4 작업 ID", () => {
  it.each(["j1", "local-job-1", "job_2026.11:x", "A".repeat(128)])("허용 %j", (id) => expect(isValidJobId(id)).toBe(true));
  it.each(["", " j1", "-j1", "작업1", "a b", "a/b", "A".repeat(129), 7])("거절 %j", (id) => {
    expect(isValidJobId(id)).toBe(false);
    expect(code(createJob({ id: id as string, content: content(1), draft: draft(1), mode: "live", scheduledAt: null, now: NOW, existing: [] }))).toBe("INVALID_INPUT");
  });
});

describe("#5 전체 이력 요약과 콘텐츠·버전 요약 분리", () => {
  const j = (contentVersion: number, channel: PublishJob["channel"], status: PublishJob["status"]): PublishJob => ({
    ...newJob(), id: `j-${contentVersion}-${channel}`, contentVersion, channel, status,
    idempotencyKey: `pub:c1:v${contentVersion}:${channel}:live`,
  });
  const history = [j(1, "blog", "published"), j(2, "blog", "failed"), j(2, "threads", "published")];

  it("전체 이력은 기존처럼 모두 세고 mixedScope로 섞임을 알린다", () => {
    const s = summarizeBatch(history);
    expect(s.published).toEqual(["blog", "threads"]);
    expect(s.mixedScope).toBe(true);
    expect(summarizeBatch([j(2, "blog", "failed")]).mixedScope).toBe(false);
  });

  it("콘텐츠·버전 요약은 해당 버전만", () => {
    const v2 = summarizeContentVersion(history, { contentId: "c1", contentVersion: 2 });
    expect(v2).toMatchObject({ contentId: "c1", contentVersion: 2, overall: "partial", published: ["threads"], failed: ["blog"] });
    const v1 = summarizeContentVersion(history, { contentId: "c1", contentVersion: 1 });
    expect(v1.overall).toBe("all_published");
    expect(summarizeContentVersion(history, { contentId: "other", contentVersion: 1 }).overall).toBe("pending");
  });
});
