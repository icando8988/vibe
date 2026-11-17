/**
 * 배포 작업 생성·상태 전이·결과 반영·대사 (순수 함수).
 * 핵심 규칙 (M2 SQL 계약과 정합 — AUTOPOST-M2-APP-001)
 *  - published는 live(외부 식별자) 또는 manual(증거)일 때만. dry-run은 dry_run_succeeded.
 *  - blog는 manual/dry_run만, manual은 blog만(CHANNEL_MODES).
 *  - unknown은 대사 전 재시도 불가. confirmed_absent는 failed(operator_only)가 될 뿐 자동 재시도 허가가 아니다(D2).
 *  - 자동 재시도(retryFailed)는 retryPolicy='auto' — 게시 요청 전 실패 — 이고 횟수 한도 안일 때만.
 *  - operator_only 실패의 재실행은 approveRerun(운영자 명시 승인)만.
 */
import { checkDuplicate, makeIdempotencyKey, type IdempotencyIdFormat } from "./idempotency";
import { dFail, dOk, type DResult } from "./result";
import { MANUAL_METHOD_NOTE_MAX, isDbShapedEvidenceUrl, isValidExternalId, manualEvidenceHostAllowed } from "./evidence-rules";
import { CONFIRMED_ABSENT_CODE, classifyFailure, effectiveRetryPolicy } from "./retry-policy";
import { CHANNEL_MODES } from "./types";
import type { ChannelDraft, ContentItem, JobStatus, PublishJob, PublishMode, PublishResult } from "./types";

export { CONFIRMED_ABSENT_CODE, classifyFailure, effectiveRetryPolicy, type ClassifiedFailure } from "./retry-policy";
export {
  MANUAL_EVIDENCE_HOSTS,
  MANUAL_METHOD_NOTE_MAX,
  isDbShapedEvidenceUrl,
  isValidExternalId,
  manualEvidenceHostAllowed,
} from "./evidence-rules";

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
  /** 멱등키 콘텐츠 ID 형식. 생략은 기존 로컬 형식(SQL 비호환 가능). DB와 맞물리는 경로는 "db". */
  idFormat?: IdempotencyIdFormat;
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
 * M2 external_url check(소문자 'https://', authority에 @·공백 없음, 공백 없음, 2048자 이하)도 함께 요구한다.
 * 채널별 수동 호스트 제한은 manualEvidenceHostAllowed(evidence-rules.ts).
 */
export function isValidEvidenceUrl(url: unknown): boolean {
  if (url === null) return true;
  if (typeof url !== "string" || url.trim() === "") return false;
  if (!isDbShapedEvidenceUrl(url)) return false;
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
  const allowedModes: readonly string[] = CHANNEL_MODES[draft.channel] ?? [];
  if (!allowedModes.includes(mode)) {
    return dFail("MODE_MISMATCH", `${draft.channel} 채널은 ${mode} 모드를 쓸 수 없습니다(허용: ${allowedModes.join(", ")}).`);
  }
  if (mode === "manual" && input.scheduledAt !== null) {
    return dFail("INVALID_INPUT", "수동 게시 작업은 예약하지 않습니다.");
  }
  const schedule = validateSchedule(input.scheduledAt, now);
  if (!schedule.ok) return schedule;

  const key = makeIdempotencyKey(
    { contentId: content.id, contentVersion: content.version, channel: draft.channel, mode },
    { idFormat: input.idFormat },
  );
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
    status: mode === "manual" ? "manual_ready" : "scheduled",
    scheduledAt: schedule.value,
    attempts: 0,
    maxAttempts,
    lastAttemptAt: null,
    externalId: null,
    externalUrl: null,
    lastError: null,
    retryPolicy: null,
    lastReconciliationId: null,
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
  /**
   * 이 시도에서 공급자 게시 요청(publish request)을 보냈는가(M2 attempts.publish_requested_at 기록 여부).
   * - false: 게시 요청 전 → published/unknown 결과 거절(요청 전 불확실성은 failed로 기록), retryable 실패는 auto.
   * - true 또는 생략(모름): retryable 실패도 operator_only(자동 재시도 금지). 생략은 기존 호출 호환용.
   * live 워커 연결 시 항상 명시해야 한다. dry_run은 무관.
   */
  publishRequested?: boolean;
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
  const { publishRequested } = options;
  if (publishRequested !== undefined && typeof publishRequested !== "boolean") {
    return dFail("INVALID_INPUT", "게시 요청 여부 값이 올바르지 않습니다.");
  }

  switch (result.kind) {
    case "published": {
      if (job.mode !== "live") return dFail("MODE_MISMATCH", "모의 실행 작업은 게시됨이 될 수 없습니다.");
      if (publishRequested === false) {
        return dFail("INVALID_TRANSITION", "게시 요청 기록 전에는 게시됨 결과를 반영할 수 없습니다.");
      }
      const externalId = typeof result.externalId === "string" ? result.externalId.trim() : "";
      if (externalId.length === 0) return dFail("NO_EVIDENCE", "외부 게시 식별자 없이 게시됨으로 기록할 수 없습니다.");
      if (!isValidExternalId(externalId)) return dFail("NO_EVIDENCE", "외부 게시 식별자는 공백·제어문자 없는 1~200자여야 합니다.");
      if (!isValidEvidenceUrl(result.externalUrl)) return dFail("NO_EVIDENCE", "게시 주소는 계정 정보 없는 https URL이어야 합니다.");
      return dOk({ ...job, status: "published", externalId, externalUrl: result.externalUrl, lastError: null, retryPolicy: null });
    }
    case "dry_run_ok": {
      if (job.mode !== "dry_run") return dFail("MODE_MISMATCH", "실제 게시 작업에 모의 결과를 반영할 수 없습니다.");
      return dOk({ ...job, status: "dry_run_succeeded", lastError: null, retryPolicy: null });
    }
    case "rejected":
      // 사전 거절(미연결·미지원 등)은 외부에 아무것도 보내지 않은 것이므로 재시도 대상이 아니다.
      return dOk({
        ...job,
        status: "failed",
        lastError: { ...result.error, retryable: false, autoRetry: false },
        retryPolicy: "never",
      });
    case "failed": {
      const classified = classifyFailure(job.mode, result.error, publishRequested);
      return dOk({ ...job, status: "failed", lastError: classified.error, retryPolicy: classified.policy });
    }
    case "unknown":
      // M2: unknown은 live에서 게시 요청 이후에만. 요청 전 불확실성은 failed로 기록한다(재게시 unknown 아님).
      if (job.mode !== "live") return dFail("MODE_MISMATCH", "실제 게시 작업만 결과 불명이 될 수 있습니다.");
      if (publishRequested === false) {
        return dFail("INVALID_TRANSITION", "게시 요청 전 불확실성은 unknown이 아니라 failed로 기록합니다.");
      }
      return dOk({
        ...job,
        status: "unknown",
        lastError: { code: "UNKNOWN_OUTCOME", message: result.reason, retryable: false, autoRetry: false },
        retryPolicy: null,
      });
  }
}

/** 자동 재시도 판정 결과. 운영자 재실행(approveRerun)과는 별개 경로다. */
export type AutoRetryEligibility =
  | { eligible: true }
  | {
      eligible: false;
      reason:
        | "reconcile_required" // unknown: 대사 먼저
        | "not_failed" // failed가 아님
        | "operator_approval_required" // operator_only(게시 요청 이후 실패·confirmed_absent 등)
        | "not_retryable" // never
        | "invalid_attempts"
        | "attempts_exhausted";
    };

/** 워커 자동 재시도 가능 여부(M2 distribution_requeue_auto_retry와 같은 조건). */
export function autoRetryEligibility(job: PublishJob): AutoRetryEligibility {
  if (job.status === "unknown") return { eligible: false, reason: "reconcile_required" };
  if (job.status !== "failed") return { eligible: false, reason: "not_failed" };
  const policy = effectiveRetryPolicy(job);
  if (policy === "operator_only") return { eligible: false, reason: "operator_approval_required" };
  if (policy !== "auto") return { eligible: false, reason: "not_retryable" };
  if (!attemptsValid(job)) return { eligible: false, reason: "invalid_attempts" };
  if (job.attempts >= job.maxAttempts) return { eligible: false, reason: "attempts_exhausted" };
  return { eligible: true };
}

/**
 * 자동 재시도: retryPolicy='auto'(게시 요청 전 실패)이고 횟수 한도 안일 때만 scheduled로.
 * operator_only(confirmed_absent 포함)는 RETRY_NOT_ALLOWED — approveRerun을 써야 한다.
 */
export function retryFailed(job: PublishJob): DResult<PublishJob> {
  const e = autoRetryEligibility(job);
  if (!e.eligible) {
    switch (e.reason) {
      case "reconcile_required":
        return dFail("RECONCILE_REQUIRED", "게시 여부를 먼저 확인(대사)해야 합니다.");
      case "not_failed":
        return dFail("INVALID_TRANSITION", `${job.status} 상태는 재시도 대상이 아닙니다.`);
      case "operator_approval_required":
        return dFail("RETRY_NOT_ALLOWED", "자동 재시도할 수 없는 실패입니다. 운영자 재실행 승인이 필요합니다.");
      case "not_retryable":
        return dFail("RETRY_NOT_ALLOWED", "다시 보내면 중복 게시될 수 있는 실패입니다.");
      case "invalid_attempts":
        return dFail("INVALID_INPUT", "작업의 시도 횟수 값이 올바르지 않습니다.");
      case "attempts_exhausted":
        return dFail("RETRY_NOT_ALLOWED", "최대 시도 횟수에 도달했습니다.");
    }
  }
  return dOk({ ...job, status: "scheduled", scheduledAt: null, retryPolicy: null });
}

/**
 * 운영자 재실행 승인(M2 distribution_approve_rerun, D2). failed(operator_only)만 대상.
 * 순수 함수는 승인·권리·연결·중지 상태와 actor 권한을 확인할 수 없다 → 호출자가 서버에서 재확인하고
 * basisRechecked: true로 선언해야 한다. 승인 기록(이벤트 reason 'operator_rerun_approved')은 저장 계층 책임.
 */
export interface RerunApproval {
  /** 승인한 배포 admin ID(권한 확인은 서버/DB) */
  actorId: string;
  reason: string;
  /** 승인·권리·연결·중지 상태를 방금 다시 확인했다는 호출자 선언 */
  basisRechecked: true;
  /** CONFIRMED_ABSENT 실패는 그 대사 기록 ID(= job.lastReconciliationId)를 인용해야 한다 */
  reconciliationId?: string | null;
  /** live/dry_run만. null/생략은 즉시. manual은 null이어야 한다 */
  scheduledAt?: string | null;
  now: string;
}

export function approveRerun(job: PublishJob, approval: RerunApproval): DResult<PublishJob> {
  if (job.status === "unknown") return dFail("RECONCILE_REQUIRED", "게시 여부를 먼저 확인(대사)해야 합니다.");
  if (job.status !== "failed") return dFail("INVALID_TRANSITION", `${job.status} 상태는 재실행 승인 대상이 아닙니다.`);
  const policy = effectiveRetryPolicy(job);
  if (policy === "auto") return dFail("INVALID_TRANSITION", "자동 재시도 대상 실패입니다. retryFailed를 쓰세요.");
  if (policy !== "operator_only") return dFail("RETRY_NOT_ALLOWED", "재실행할 수 없는 실패입니다. 취소 후 새 작업을 만드세요.");
  if (typeof approval?.actorId !== "string" || approval.actorId.trim() === "") {
    return dFail("INVALID_INPUT", "승인자 ID가 필요합니다.");
  }
  if (typeof approval.reason !== "string" || approval.reason.trim() === "") {
    return dFail("INVALID_INPUT", "재실행 승인 사유가 필요합니다.");
  }
  if (approval.basisRechecked !== true) {
    return dFail("NOT_APPROVED", "승인·권리·연결·중지 상태를 다시 확인한 뒤 승인해야 합니다.");
  }
  if (job.lastError?.code === CONFIRMED_ABSENT_CODE) {
    const cited = approval.reconciliationId;
    if (typeof cited !== "string" || cited.trim() === "" || !job.lastReconciliationId || cited !== job.lastReconciliationId) {
      return dFail("RECONCILE_REQUIRED", "부재 확인 후 재실행은 해당 대사 기록을 인용해야 합니다.");
    }
  }
  if (job.mode === "manual") {
    if (approval.scheduledAt !== undefined && approval.scheduledAt !== null) {
      return dFail("INVALID_INPUT", "수동 게시 작업은 예약하지 않습니다.");
    }
    if (parseZonedTime(approval.now) === null) {
      return dFail("INVALID_INPUT", "현재 시각이 올바르지 않습니다(시간대가 있는 ISO 형식).");
    }
    return dOk({ ...job, status: "manual_ready", scheduledAt: null, retryPolicy: null });
  }
  if (!attemptsValid(job)) return dFail("INVALID_INPUT", "작업의 시도 횟수 값이 올바르지 않습니다.");
  if (job.attempts >= job.maxAttempts) return dFail("RETRY_NOT_ALLOWED", "최대 시도 횟수에 도달했습니다. 취소 후 새 작업을 만드세요.");
  const schedule = validateSchedule(approval.scheduledAt ?? null, approval.now);
  if (!schedule.ok) return schedule;
  return dOk({ ...job, status: "scheduled", scheduledAt: schedule.value, retryPolicy: null });
}

/**
 * unknown 대사. 사람이 채널에서 확인했거나 어댑터 조회 기능으로 확인한 결과를 반영한다.
 * - found_published: 외부 식별자와 함께 published로(live/manual)
 * - confirmed_absent: 게시되지 않음이 확인됨 → failed(operator_only). 자동 재시도 불가, approveRerun만(D2).
 *   M2는 admin 판정자·방법·확인 범위·관찰 시각을 대사 행에 필수로 남긴다(저장 계층 책임).
 * - still_unknown: 그대로 둔다(재시도 금지)
 */
export type ReconcileFinding =
  | {
      kind: "found_published";
      externalId: string;
      externalUrl: string | null;
      /**
       * 확인 위치·방법 메모(M2 reconciliation observation / evidence method_note, 1~1000자).
       * manual 작업에서 URL 없이 외부 ID만 있으면 필수(evidence manual_id_note).
       */
      methodNote?: string | null;
    }
  | {
      kind: "confirmed_absent";
      /** 저장된 대사 기록 ID. 없으면 이후 approveRerun이 인용할 대상이 없어 재실행이 막힌다. */
      reconciliationId?: string | null;
    }
  | { kind: "still_unknown" };

export function reconcileUnknown(job: PublishJob, finding: ReconcileFinding): DResult<PublishJob> {
  if (job.status !== "unknown") return dFail("INVALID_TRANSITION", "unknown 작업만 대사합니다.");
  switch (finding.kind) {
    case "found_published": {
      if (job.mode === "dry_run") return dFail("MODE_MISMATCH", "모의 실행 작업은 게시됨이 될 수 없습니다.");
      // 외부 ID 필수는 기존 앱 계약 유지(DB는 manual URL만도 허용하지만 앱은 더 엄격하게 둔다).
      if (typeof finding.externalId !== "string" || finding.externalId.trim().length === 0) {
        return dFail("NO_EVIDENCE", "외부 게시 식별자가 필요합니다.");
      }
      const externalId = finding.externalId.trim();
      if (!isValidExternalId(externalId)) return dFail("NO_EVIDENCE", "외부 게시 식별자는 공백·제어문자 없는 1~200자여야 합니다.");
      if (!isValidEvidenceUrl(finding.externalUrl)) return dFail("NO_EVIDENCE", "게시 주소는 계정 정보 없는 https URL이어야 합니다.");
      if (job.mode === "manual") {
        const url = finding.externalUrl;
        if (url !== null && !manualEvidenceHostAllowed(job.channel, url)) {
          return dFail("NO_EVIDENCE", "수동 게시 주소는 허용된 호스트(blog.naver.com, m.blog.naver.com)의 port 없는 https URL이어야 합니다.");
        }
        if (url === null) {
          const note = typeof finding.methodNote === "string" ? finding.methodNote.trim() : "";
          if (note.length === 0 || note.length > MANUAL_METHOD_NOTE_MAX) {
            return dFail("NO_EVIDENCE", "주소 없이 외부 ID만으로 수동 게시를 확인하려면 확인 위치·방법 메모(1~1000자)가 필요합니다.");
          }
        }
      }
      return dOk({
        ...job,
        status: "published",
        externalId,
        externalUrl: finding.externalUrl,
        lastError: null,
        retryPolicy: null,
      });
    }
    case "confirmed_absent": {
      const rid = typeof finding.reconciliationId === "string" && finding.reconciliationId.trim() !== ""
        ? finding.reconciliationId
        : null;
      return dOk({
        ...job,
        status: "failed",
        lastError: { code: CONFIRMED_ABSENT_CODE, message: "게시되지 않은 것을 확인했습니다.", retryable: true, autoRetry: false },
        retryPolicy: "operator_only",
        lastReconciliationId: rid,
      });
    }
    case "still_unknown":
      return dOk(job);
  }
}

/* ==========================================================================
 * 블로그 수동 게시 전이 (AUTOPOST-MANUAL-BLOG-APP-001, M2 §4.9~4.12 T16~T19)
 *
 * 공개 계약(모든 수동 helper 공통)
 *  - 순수 도메인 판정이다. 권한 확인·영속 이벤트 기록·낙관적 version 비교·동시성 잠금을 대신하지 않는다.
 *  - 서버는 호출 전에 actorId가 승인된 배포 admin(role_assignments.role='admin' AND
 *    profiles.approval_status='approved', DEC-AUTOPOST-DATA-001 D1)인지 현재 상태로 재확인해야 하고,
 *    이 함수가 ok여도 실제 상태 변경은 반드시 대응 SQL RPC로 한다(p_expected_version 포함):
 *      markManualPosted      → public.distribution_mark_manual_posted        (T16)
 *      recordManualEvidence  → public.distribution_record_manual_evidence    (T17)
 *      abandonManualJob      → public.distribution_abandon_manual_job        (T18)
 *      markManualUncertain   → public.distribution_mark_manual_uncertain     (T19)
 *    반환된 PublishJob은 RPC 성공 후 기대 상태의 미리보기이며, 저장 진실은 RPC 반환/재조회 값이다.
 *  - DB가 거부할 값을 성공으로 판정하지 않도록 DB 검사와 같거나 더 엄격하게 둔다.
 *    다른 작업과의 증거 충돌(distribution_evidence_conflicts)·admin 존재·version은 데이터가 필요해 판정하지 못한다.
 * ======================================================================== */

/** DB p_actor_id uuid. 형식만 검사(권한은 서버/DB distribution_assert_admin_actor). */
const ACTOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 중단·불확실 사유 최대 길이(코드포인트). DB 이벤트 summary가 left(…, 500)으로 잘리므로 잘림 없이 보존되는 범위만 허용. */
export const MANUAL_REASON_MAX = 500;
/** DB observed_at 미래 허용 오차(distribution_publication_evidence 트리거: now() + 5분) */
const OBSERVED_AT_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const MANUAL_OUTCOME_UNCERTAIN_CODE = "MANUAL_OUTCOME_UNCERTAIN";

function codePointLength(s: string): number {
  return Array.from(s).length;
}

/** 채널이 수동 게시(mode=manual)를 허용하는가(CHANNEL_MODES, M2 distribution_jobs_manual_blog: blog만). */
export function channelAllowsManual(channel: unknown): boolean {
  if (typeof channel !== "string" || !Object.prototype.hasOwnProperty.call(CHANNEL_MODES, channel)) return false;
  const modes: readonly string[] = CHANNEL_MODES[channel as keyof typeof CHANNEL_MODES];
  return modes.includes("manual");
}

/** 모든 수동 전이 공통 사전 검사: 작업 ID·모드·채널·manual 모양(M2 distribution_jobs_manual_shape)·actor·현재 시각 */
function checkManualCommon(job: PublishJob, actorId: unknown, now: unknown): DResult<null> {
  if (!job || !isValidJobId(job.id)) return dFail("INVALID_INPUT", "작업 ID가 올바르지 않습니다.");
  if (job.mode !== "manual") return dFail("MODE_MISMATCH", "수동 게시 작업에만 사용할 수 있습니다.");
  if (!channelAllowsManual(job.channel)) {
    return dFail("MODE_MISMATCH", `${job.channel} 채널은 수동 게시를 쓸 수 없습니다.`);
  }
  if (job.attempts !== 0 || job.scheduledAt !== null) {
    return dFail("INVALID_INPUT", "수동 게시 작업은 시도 횟수 0, 예약 없음이어야 합니다.");
  }
  if (typeof actorId !== "string" || !ACTOR_UUID.test(actorId)) {
    return dFail("INVALID_INPUT", "처리자 ID(배포 admin 사용자 UUID)가 필요합니다.");
  }
  if (parseZonedTime(now) === null) return dFail("INVALID_INPUT", "현재 시각이 올바르지 않습니다(시간대가 있는 ISO 형식).");
  return dOk(null);
}

function normalizeReason(reason: unknown, label: string): DResult<string> {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r === "") return dFail("INVALID_INPUT", `${label} 사유가 필요합니다.`);
  if (codePointLength(r) > MANUAL_REASON_MAX) return dFail("INVALID_INPUT", `${label} 사유는 ${MANUAL_REASON_MAX}자 이하여야 합니다.`);
  return dOk(r);
}

/** T16 입력. 서버는 호출 전 actorId의 승인된 배포 admin 여부를 확인하고, 이후 distribution_mark_manual_posted RPC를 쓴다. */
export interface ManualPostedDeclaration {
  actorId: string;
  now: string;
}

/**
 * T16 manual_ready → awaiting_evidence: 운영자가 외부 사이트에 "게시 완료"를 선언.
 * 복사·내보내기·다운로드는 게시가 아니므로 이 선언을 대신하지 않는다. 증거는 이후 recordManualEvidence.
 * 권한 확인·이벤트(manual_posted_declared) 기록은 하지 않는다 — distribution_mark_manual_posted RPC 책임.
 */
export function markManualPosted(job: PublishJob, decl: ManualPostedDeclaration): DResult<PublishJob> {
  const common = checkManualCommon(job, decl?.actorId, decl?.now);
  if (!common.ok) return common;
  if (job.status !== "manual_ready") return dFail("INVALID_TRANSITION", `${job.status} 상태에서는 게시 완료를 선언할 수 없습니다.`);
  return dOk({ ...job, status: "awaiting_evidence" });
}

/**
 * T17 입력(distribution_record_manual_evidence 인자와 대응). 외부 게시 ID 또는 허용 호스트 URL 중 하나 이상.
 * URL 없이 ID만이면 methodNote(확인 위치·방법) 필수(evidence manual_id_note).
 */
export interface ManualEvidenceInput {
  actorId: string;
  externalId: string | null;
  externalUrl: string | null;
  externalAccountId?: string | null;
  /** 운영자가 게시를 확인한 시각(시간대 있는 ISO). now + 5분을 넘으면 거부(DB 트리거) */
  observedAt: string;
  methodNote?: string | null;
  now: string;
}

/** RPC에 그대로 넘길 정규화된 증거 값(앞뒤 공백 제거·빈 값 null). */
export interface NormalizedManualEvidence {
  externalId: string | null;
  externalUrl: string | null;
  externalAccountId: string | null;
  observedAt: string;
  methodNote: string | null;
}

/**
 * 수동 증거 값 검증(상태 무관). DB 검사(identifier·external_post_id/account_id 형태·external_url 형태·
 * 수동 호스트 allowlist·manual_id_note·method_note 길이·observed_at 미래 제한)와 같거나 더 엄격하다.
 * 다른 작업과의 충돌 여부는 판정하지 못한다(DB distribution_evidence_conflicts).
 */
export function validateManualEvidence(job: PublishJob, input: ManualEvidenceInput): DResult<NormalizedManualEvidence> {
  const common = checkManualCommon(job, input?.actorId, input?.now);
  if (!common.ok) return common;

  if (input.externalId !== null && typeof input.externalId !== "string") {
    return dFail("INVALID_INPUT", "외부 게시 식별자 값이 올바르지 않습니다.");
  }
  const externalId = typeof input.externalId === "string" && input.externalId.trim() !== "" ? input.externalId.trim() : null;
  if (externalId !== null && !isValidExternalId(externalId)) {
    return dFail("NO_EVIDENCE", "외부 게시 식별자는 공백·제어문자 없는 1~200자여야 합니다.");
  }

  const rawAccount = input.externalAccountId ?? null;
  if (rawAccount !== null && typeof rawAccount !== "string") return dFail("INVALID_INPUT", "외부 계정 식별자 값이 올바르지 않습니다.");
  const externalAccountId = typeof rawAccount === "string" && rawAccount.trim() !== "" ? rawAccount.trim() : null;
  if (externalAccountId !== null && !isValidExternalId(externalAccountId)) {
    return dFail("INVALID_INPUT", "외부 계정 식별자는 공백·제어문자 없는 1~200자여야 합니다.");
  }

  // URL은 공백을 정규화하지 않고 그대로 검사한다(DB 형태 정규식이 공백을 허용하지 않으므로 앞뒤 공백도 거부 → DB보다 엄격).
  const externalUrl = input.externalUrl;
  if (externalUrl !== null) {
    if (!isValidEvidenceUrl(externalUrl)) return dFail("NO_EVIDENCE", "게시 주소는 계정 정보 없는 https URL이어야 합니다.");
    if (!manualEvidenceHostAllowed(job.channel, externalUrl as string)) {
      return dFail("NO_EVIDENCE", "수동 게시 주소는 허용된 호스트(blog.naver.com, m.blog.naver.com)의 port 없는 https URL이어야 합니다.");
    }
  }
  if (externalId === null && externalUrl === null) {
    return dFail("NO_EVIDENCE", "외부 게시 ID 또는 게시 주소 중 하나는 있어야 합니다.");
  }

  const rawNote = input.methodNote ?? null;
  if (rawNote !== null && typeof rawNote !== "string") return dFail("INVALID_INPUT", "확인 방법 메모 값이 올바르지 않습니다.");
  const methodNote = typeof rawNote === "string" && rawNote.trim() !== "" ? rawNote.trim() : null;
  // DB char_length는 코드포인트 기준. UTF-16 length ≥ 코드포인트 수이므로 length로 세면 DB보다 같거나 엄격.
  if (methodNote !== null && methodNote.length > MANUAL_METHOD_NOTE_MAX) {
    return dFail("INVALID_INPUT", `확인 방법 메모는 ${MANUAL_METHOD_NOTE_MAX}자 이하여야 합니다.`);
  }
  if (externalUrl === null && methodNote === null) {
    return dFail("NO_EVIDENCE", "주소 없이 외부 ID만으로 게시를 확인하려면 확인 위치·방법 메모(1~1000자)가 필요합니다.");
  }

  const observed = parseZonedTime(input.observedAt);
  if (observed === null) return dFail("INVALID_INPUT", "게시 확인 시각이 올바르지 않습니다(시간대가 있는 ISO 형식).");
  const n = parseZonedTime(input.now) as number;
  if (observed > n + OBSERVED_AT_FUTURE_SKEW_MS) return dFail("INVALID_INPUT", "게시 확인 시각이 미래입니다.");

  return dOk({ externalId, externalUrl, externalAccountId, observedAt: new Date(observed).toISOString(), methodNote });
}

export interface ManualEvidenceOutcome {
  /** RPC 성공 시 기대되는 작업 상태(published). 저장 진실은 RPC 결과 */
  job: PublishJob;
  /** distribution_record_manual_evidence에 넘길 정규화 값 */
  evidence: NormalizedManualEvidence;
}

/**
 * T17 awaiting_evidence → published: 운영자 증거(외부 게시 ID 또는 허용 호스트 URL + 필요 시 방법 메모)로 확정.
 * 서버 크롤링·외부 확인 없음. 권한 확인·증거 행(operator_manual, recorded_by=actor) 저장·이벤트
 * (manual_evidence_accepted)·다른 작업 충돌 검사는 distribution_record_manual_evidence RPC 책임.
 */
export function recordManualEvidence(job: PublishJob, input: ManualEvidenceInput): DResult<ManualEvidenceOutcome> {
  const common = checkManualCommon(job, input?.actorId, input?.now);
  if (!common.ok) return common;
  if (job.status !== "awaiting_evidence") {
    return dFail("INVALID_TRANSITION", `${job.status} 상태에서는 수동 게시 증거를 확정할 수 없습니다(증거 대기 상태만).`);
  }
  const ev = validateManualEvidence(job, input);
  if (!ev.ok) return ev;
  return dOk({
    job: {
      ...job,
      status: "published",
      externalId: ev.value.externalId,
      externalUrl: ev.value.externalUrl,
      lastError: null,
      retryPolicy: null,
    },
    evidence: ev.value,
  });
}

/** T18 입력. acknowledgeMayRemainExternal은 "외부 사이트에 글이 남아 있을 수 있음"을 운영자가 확인했다는 뜻(true만 허용). */
export interface ManualAbandonment {
  actorId: string;
  reason: string;
  acknowledgeMayRemainExternal: true;
  now: string;
}

/**
 * T18 manual_ready/awaiting_evidence → abandoned. 사유와 외부 잔존 가능성 확인 필수.
 * abandoned는 같은 멱등키를 계속 점유한다(외부에 남았을 수 있음). 권한 확인·이벤트(manual_abandoned) 기록은
 * distribution_abandon_manual_job RPC 책임.
 */
export function abandonManualJob(job: PublishJob, input: ManualAbandonment): DResult<PublishJob> {
  const common = checkManualCommon(job, input?.actorId, input?.now);
  if (!common.ok) return common;
  if (job.status !== "manual_ready" && job.status !== "awaiting_evidence") {
    return dFail("INVALID_TRANSITION", `${job.status} 상태는 수동 작업 중단 대상이 아닙니다.`);
  }
  const reason = normalizeReason(input.reason, "중단");
  if (!reason.ok) return reason;
  if (input.acknowledgeMayRemainExternal !== true) {
    return dFail("NOT_APPROVED", "외부 사이트에 게시물이 남아 있을 수 있음을 확인해야 중단할 수 있습니다.");
  }
  return dOk({ ...job, status: "abandoned", retryPolicy: null });
}

/** T19 입력 */
export interface ManualUncertainty {
  actorId: string;
  reason: string;
  now: string;
}

/**
 * T19 awaiting_evidence → unknown: 게시 여부가 불확실함. 이후 reconcileUnknown(대사)으로만 진행하고 재게시 금지.
 * lastError는 DB와 같은 모양(MANUAL_OUTCOME_UNCERTAIN, retryable/autoRetry false). 권한 확인·이벤트
 * (manual_outcome_uncertain) 기록은 distribution_mark_manual_uncertain RPC 책임.
 */
export function markManualUncertain(job: PublishJob, input: ManualUncertainty): DResult<PublishJob> {
  const common = checkManualCommon(job, input?.actorId, input?.now);
  if (!common.ok) return common;
  if (job.status !== "awaiting_evidence") {
    return dFail("INVALID_TRANSITION", `${job.status} 상태에서는 게시 여부 불확실을 기록할 수 없습니다(증거 대기 상태만).`);
  }
  const reason = normalizeReason(input.reason, "불확실");
  if (!reason.ok) return reason;
  return dOk({
    ...job,
    status: "unknown",
    lastError: { code: MANUAL_OUTCOME_UNCERTAIN_CODE, message: reason.value, retryable: false, autoRetry: false },
    retryPolicy: null,
  });
}

const CANCELLABLE: readonly JobStatus[] = ["scheduled", "failed", "manual_ready"];

/** 취소: 실행 중·unknown·게시됨·증거 대기·종료 상태는 취소로 덮지 않는다(외부 상태와 어긋남 방지). */
export function cancelJob(job: PublishJob): DResult<PublishJob> {
  if (!CANCELLABLE.includes(job.status)) {
    return dFail("INVALID_TRANSITION", `${job.status} 상태는 취소할 수 없습니다.`);
  }
  return dOk({ ...job, status: "cancelled", retryPolicy: null });
}

/** 한 콘텐츠를 여러 채널에 보낸 묶음의 결과 요약(부분 성공 표시용). dry-run은 게시 수에 넣지 않고 manual은 넣는다. */
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
  // 실제 게시 대상 = live + manual(blog 수동 게시). abandoned는 게시 확인 없이 끝난 것이라 failed 쪽에 센다.
  const live = jobs.filter((j) => (j.mode === "live" || j.mode === "manual") && j.status !== "cancelled");
  const published = live.filter((j) => j.status === "published").map((j) => j.channel);
  const failed = live.filter((j) => j.status === "failed" || j.status === "abandoned").map((j) => j.channel);
  const unknown = live.filter((j) => j.status === "unknown").map((j) => j.channel);
  const pending = live
    .filter((j) => j.status === "scheduled" || j.status === "dispatching" || j.status === "manual_ready" || j.status === "awaiting_evidence")
    .map((j) => j.channel);

  let overall: BatchSummary["overall"];
  if (live.length === 0) overall = jobs.some((j) => j.status === "dry_run_succeeded") ? "dry_run_only" : "pending";
  else if (unknown.length > 0) overall = "needs_reconcile";
  else if (pending.length > 0) overall = "pending";
  else if (published.length === live.length) overall = "all_published";
  else if (published.length > 0) overall = "partial";
  else overall = "none_published";

  return { overall, published, failed, unknown, pending };
}
