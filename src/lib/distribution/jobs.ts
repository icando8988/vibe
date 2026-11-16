/**
 * 배포 작업 생성·상태 전이·결과 반영·대사 (순수 함수).
 * 핵심 규칙
 *  - published는 live 모드 + 외부 식별자가 있을 때만. dry-run은 dry_run_succeeded.
 *  - unknown(응답 유실)은 대사 결과 confirmed_absent일 때만 재시도 가능.
 *  - failed 재시도는 어댑터가 retryable=true로 표시하고 횟수 한도 안일 때만.
 */
import { checkDuplicate, makeIdempotencyKey } from "./idempotency";
import { dFail, dOk, type DResult } from "./result";
import type { ChannelDraft, ContentItem, JobStatus, PublishJob, PublishMode, PublishResult } from "./types";

export const DEFAULT_MAX_ATTEMPTS = 3;

export interface CreateJobInput {
  id: string;
  content: ContentItem;
  draft: ChannelDraft;
  mode: PublishMode;
  scheduledAt: string | null;
  now: string;
  existing: readonly PublishJob[];
  allowRepublish?: boolean;
  maxAttempts?: number;
}

const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * 시간대가 있는 ISO-8601 시각만 엄격하게 해석한다.
 * Date.parse는 2월 30일 같은 없는 날짜를 다음 달로 넘기고 형식도 느슨하게 받아서 직접 범위를 확인한다.
 */
export function parseZonedTime(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const m = ISO_WITH_ZONE.exec(iso);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number) as [
    number, number, number, number, number, number,
  ];
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  if (m[7] !== "Z" && (Number(m[9]) > 14 || Number(m[10]) > 59)) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** 예약 시각 검증: 시간대 있는 ISO, 현재 이후, UTC로 정규화. null은 즉시 실행. */
export function validateSchedule(scheduledAt: string | null, now: string): DResult<string | null> {
  const n = parseZonedTime(now);
  if (n === null) return dFail("INVALID_INPUT", "현재 시각이 올바르지 않습니다(시간대가 있는 ISO 형식).");
  if (scheduledAt === null) return dOk(null);
  if (typeof scheduledAt === "string" && !/(Z|[+-]\d{2}:\d{2})$/.test(scheduledAt)) {
    return dFail("INVALID_INPUT", "예약 시각에는 시간대(Z 또는 +09:00 등)가 있어야 합니다.");
  }
  const s = parseZonedTime(scheduledAt);
  if (s === null) return dFail("INVALID_INPUT", "예약 시각 형식이 올바르지 않거나 없는 날짜입니다.");
  if (s <= n) return dFail("INVALID_INPUT", "예약 시각은 현재 이후여야 합니다.");
  return dOk(new Date(s).toISOString());
}

/** 저장소 등에서 들어온 작업의 시도 횟수 값이 정상인지(오염 시 실행·재시도 차단) */
function attemptsValid(job: PublishJob): boolean {
  return (
    Number.isSafeInteger(job.attempts) &&
    Number.isSafeInteger(job.maxAttempts) &&
    job.attempts >= 0 &&
    job.maxAttempts >= 1 &&
    job.attempts <= job.maxAttempts
  );
}

/**
 * 게시 근거 URL: null 또는 계정 정보 없는 https만(DEC-DISTRIBUTION-002 #3).
 * http·javascript·data·빈 문자열은 거절. 외부 식별자만 있어도 근거로 허용하며, 공급자 조회 검증은 이후 단계.
 */
export function isValidEvidenceUrl(url: unknown): boolean {
  if (url === null) return true;
  if (typeof url !== "string" || url.trim() === "") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname !== "";
  } catch {
    return false;
  }
}

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/** 작업 ID: 비어 있지 않은 1~128자 안전 ASCII(DEC-DISTRIBUTION-002 #4). 예: local-job-1 */
export function isValidJobId(id: unknown): id is string {
  return typeof id === "string" && JOB_ID.test(id);
}

export function createJob(input: CreateJobInput): DResult<PublishJob> {
  const { content, draft, mode, now } = input;
  if (!isValidJobId(input.id)) return dFail("INVALID_INPUT", "작업 ID는 영문·숫자로 시작하는 1~128자(영문·숫자·_.:-)여야 합니다.");
  if (draft.contentId !== content.id) return dFail("INVALID_INPUT", "초안과 원문이 다릅니다.");
  if (draft.contentVersion !== content.version) {
    return dFail("STALE_DRAFT", "원문이 바뀌었습니다. 최신 원문으로 초안을 다시 검토해야 합니다.");
  }
  if (draft.reviewStatus !== "approved") return dFail("NOT_APPROVED", "검토 승인된 초안만 배포할 수 있습니다.");
  if (draft.text.trim().length === 0 && draft.mediaRefs.length === 0) {
    return dFail("INVALID_INPUT", "본문이나 미디어가 있어야 합니다.");
  }
  const schedule = validateSchedule(input.scheduledAt, now);
  if (!schedule.ok) return schedule;

  const key = makeIdempotencyKey({ contentId: content.id, contentVersion: content.version, channel: draft.channel, mode });
  if (!key.ok) return key;
  const dup = checkDuplicate(
    input.existing,
    { idempotencyKey: key.value, contentId: content.id, channel: draft.channel, mode },
    { allowRepublish: input.allowRepublish ?? false },
  );
  if (!dup.ok) return dup;

  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    return dFail("INVALID_INPUT", "최대 시도 횟수는 1~10입니다.");
  }

  return dOk({
    id: input.id,
    idempotencyKey: key.value,
    contentId: content.id,
    contentVersion: content.version,
    channel: draft.channel,
    mode,
    status: "scheduled",
    scheduledAt: schedule.value,
    attempts: 0,
    maxAttempts,
    lastAttemptAt: null,
    externalId: null,
    externalUrl: null,
    lastError: null,
  });
}

/** 실행 시각이 됐는지 */
export function isDue(job: PublishJob, now: string): boolean {
  if (job.status !== "scheduled") return false;
  const n = parseZonedTime(now);
  if (n === null) return false;
  if (job.scheduledAt === null) return true;
  const s = parseZonedTime(job.scheduledAt);
  return s !== null && n >= s;
}

/** 어댑터 호출 직전: scheduled → dispatching, attempts+1 */
export function startDispatch(job: PublishJob, now: string): DResult<PublishJob> {
  if (job.status !== "scheduled") return dFail("INVALID_TRANSITION", `${job.status} 상태에서는 실행할 수 없습니다.`);
  const n = parseZonedTime(now);
  if (n === null) return dFail("INVALID_INPUT", "현재 시각이 올바르지 않습니다(시간대가 있는 ISO 형식).");
  if (!attemptsValid(job)) return dFail("INVALID_INPUT", "작업의 시도 횟수 값이 올바르지 않습니다.");
  if (!isDue(job, now)) return dFail("NOT_DUE", "예약 시각 전입니다.");
  if (job.attempts >= job.maxAttempts) return dFail("RETRY_NOT_ALLOWED", "최대 시도 횟수에 도달했습니다.");
  return dOk({ ...job, status: "dispatching", attempts: job.attempts + 1, lastAttemptAt: new Date(n).toISOString() });
}

export interface ApplyResultOptions {
  /**
   * 이 결과를 만든 시도 번호(startDispatch 후 job.attempts).
   * live 작업은 필수이며 현재 시도와 같아야 한다(DEC-DISTRIBUTION-002 #1). 누락·오염·과거 시도는 현재 결과를 덮지 않는다.
   * dry_run은 시도가 1회라 생략 가능(기존 UI 호환). 주면 동일하게 검사한다.
   */
  attempt?: number;
}

/** 어댑터 결과 반영: dispatching → published / dry_run_succeeded / failed / unknown */
export function applyResult(job: PublishJob, result: PublishResult, options: ApplyResultOptions = {}): DResult<PublishJob> {
  if (job.status !== "dispatching") return dFail("INVALID_TRANSITION", "실행 중인 작업에만 결과를 반영합니다.");
  const { attempt } = options;
  if (job.mode === "live" && attempt === undefined) {
    return dFail("STALE_RESULT", "실제 게시 결과에는 시도 번호가 필요합니다.");
  }
  if (attempt !== undefined && (!Number.isSafeInteger(attempt) || attempt < 1)) {
    return dFail("STALE_RESULT", "시도 번호가 올바르지 않습니다.");
  }
  if (attempt !== undefined && attempt !== job.attempts) {
    return dFail("STALE_RESULT", `이전 시도(${attempt}회차)의 결과입니다. 현재는 ${job.attempts}회차입니다.`);
  }

  switch (result.kind) {
    case "published": {
      if (job.mode !== "live") return dFail("MODE_MISMATCH", "모의 실행 작업은 게시됨이 될 수 없습니다.");
      const externalId = typeof result.externalId === "string" ? result.externalId.trim() : "";
      if (externalId.length === 0) return dFail("NO_EVIDENCE", "외부 게시 식별자 없이 게시됨으로 기록할 수 없습니다.");
      if (!isValidEvidenceUrl(result.externalUrl)) return dFail("NO_EVIDENCE", "게시 주소는 계정 정보 없는 https URL이어야 합니다.");
      return dOk({ ...job, status: "published", externalId, externalUrl: result.externalUrl, lastError: null });
    }
    case "dry_run_ok": {
      if (job.mode !== "dry_run") return dFail("MODE_MISMATCH", "실제 게시 작업에 모의 결과를 반영할 수 없습니다.");
      return dOk({ ...job, status: "dry_run_succeeded", lastError: null });
    }
    case "rejected":
      // 사전 거절(미연결·미지원 등)은 외부에 아무것도 보내지 않은 것이므로 재시도 대상이 아니다.
      return dOk({ ...job, status: "failed", lastError: { ...result.error, retryable: false } });
    case "failed":
      return dOk({ ...job, status: "failed", lastError: result.error });
    case "unknown":
      return dOk({
        ...job,
        status: "unknown",
        lastError: { code: "UNKNOWN_OUTCOME", message: result.reason, retryable: false },
      });
  }
}

/** 실패 작업 재시도: 어댑터가 retryable로 표시하고 횟수 한도 안일 때만 scheduled로 */
export function retryFailed(job: PublishJob): DResult<PublishJob> {
  if (job.status === "unknown") return dFail("RECONCILE_REQUIRED", "게시 여부를 먼저 확인(대사)해야 합니다.");
  if (job.status !== "failed") return dFail("INVALID_TRANSITION", `${job.status} 상태는 재시도 대상이 아닙니다.`);
  if (!job.lastError?.retryable) return dFail("RETRY_NOT_ALLOWED", "다시 보내면 중복 게시될 수 있는 실패입니다.");
  if (!attemptsValid(job)) return dFail("INVALID_INPUT", "작업의 시도 횟수 값이 올바르지 않습니다.");
  if (job.attempts >= job.maxAttempts) return dFail("RETRY_NOT_ALLOWED", "최대 시도 횟수에 도달했습니다.");
  return dOk({ ...job, status: "scheduled", scheduledAt: null });
}

/**
 * unknown 대사. 사람이 채널에서 확인했거나 어댑터 조회 기능으로 확인한 결과를 반영한다.
 * - found_published: 외부 식별자와 함께 published로
 * - confirmed_absent: 게시되지 않음이 확인됨 → 재시도 가능한 failed로
 * - still_unknown: 그대로 둔다(재시도 금지)
 */
export type ReconcileFinding =
  | { kind: "found_published"; externalId: string; externalUrl: string | null }
  | { kind: "confirmed_absent" }
  | { kind: "still_unknown" };

export function reconcileUnknown(job: PublishJob, finding: ReconcileFinding): DResult<PublishJob> {
  if (job.status !== "unknown") return dFail("INVALID_TRANSITION", "unknown 작업만 대사합니다.");
  switch (finding.kind) {
    case "found_published":
      if (job.mode !== "live") return dFail("MODE_MISMATCH", "모의 실행 작업은 게시됨이 될 수 없습니다.");
      if (typeof finding.externalId !== "string" || finding.externalId.trim().length === 0) {
        return dFail("NO_EVIDENCE", "외부 게시 식별자가 필요합니다.");
      }
      if (!isValidEvidenceUrl(finding.externalUrl)) return dFail("NO_EVIDENCE", "게시 주소는 계정 정보 없는 https URL이어야 합니다.");
      return dOk({ ...job, status: "published", externalId: finding.externalId.trim(), externalUrl: finding.externalUrl, lastError: null });
    case "confirmed_absent":
      return dOk({
        ...job,
        status: "failed",
        lastError: { code: "CONFIRMED_ABSENT", message: "게시되지 않은 것을 확인했습니다.", retryable: true },
      });
    case "still_unknown":
      return dOk(job);
  }
}

const CANCELLABLE: readonly JobStatus[] = ["scheduled", "failed"];

/** 취소: 실행 중·unknown·게시됨은 취소로 덮지 않는다(외부 상태와 어긋남 방지). */
export function cancelJob(job: PublishJob): DResult<PublishJob> {
  if (!CANCELLABLE.includes(job.status)) {
    return dFail("INVALID_TRANSITION", `${job.status} 상태는 취소할 수 없습니다.`);
  }
  return dOk({ ...job, status: "cancelled" });
}

/** 한 콘텐츠를 여러 채널에 보낸 묶음의 결과 요약(부분 성공 표시용). dry-run은 게시 수에 넣지 않는다. */
export interface BatchSummary {
  overall: "pending" | "all_published" | "partial" | "none_published" | "needs_reconcile" | "dry_run_only";
  published: readonly PublishJob["channel"][];
  failed: readonly PublishJob["channel"][];
  unknown: readonly PublishJob["channel"][];
  pending: readonly PublishJob["channel"][];
}

/**
 * 전체 이력 요약: 넘겨받은 작업 전부를 센다(콘텐츠·버전 구분 없음). 기존 의미 그대로.
 * 여러 콘텐츠·버전이 섞여 있으면 mixedScope=true — 현재 배포 성과처럼 표시하지 말 것.
 * 특정 콘텐츠·버전의 채널별 현황은 summarizeContentVersion을 쓴다(DEC-DISTRIBUTION-002 #5).
 */
export function summarizeBatch(jobs: readonly PublishJob[]): BatchSummary & { mixedScope: boolean } {
  const scopes = new Set(jobs.map((j) => `${j.contentId}\u0000${j.contentVersion}`));
  return { ...summarize(jobs), mixedScope: scopes.size > 1 };
}

/** 특정 콘텐츠·버전의 채널별 요약. 다른 콘텐츠·버전 작업은 제외한다. */
export function summarizeContentVersion(
  jobs: readonly PublishJob[],
  scope: { contentId: string; contentVersion: number },
): BatchSummary & { contentId: string; contentVersion: number } {
  const scoped = jobs.filter((j) => j.contentId === scope.contentId && j.contentVersion === scope.contentVersion);
  return { ...summarize(scoped), contentId: scope.contentId, contentVersion: scope.contentVersion };
}

function summarize(jobs: readonly PublishJob[]): BatchSummary {
  const live = jobs.filter((j) => j.mode === "live" && j.status !== "cancelled");
  const published = live.filter((j) => j.status === "published").map((j) => j.channel);
  const failed = live.filter((j) => j.status === "failed").map((j) => j.channel);
  const unknown = live.filter((j) => j.status === "unknown").map((j) => j.channel);
  const pending = live.filter((j) => j.status === "scheduled" || j.status === "dispatching").map((j) => j.channel);

  let overall: BatchSummary["overall"];
  if (live.length === 0) overall = jobs.some((j) => j.status === "dry_run_succeeded") ? "dry_run_only" : "pending";
  else if (unknown.length > 0) overall = "needs_reconcile";
  else if (pending.length > 0) overall = "pending";
  else if (published.length === live.length) overall = "all_published";
  else if (published.length > 0) overall = "partial";
  else overall = "none_published";

  return { overall, published, failed, unknown, pending };
}
