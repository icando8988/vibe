/**
 * 작업·증거·대사 DTO와 화면 행동 판정 — 순수 함수(테스트 대상). AUTOPOST-BLOG-FLOW-015.
 * 행동 판정은 M2 SQL 전이 규칙을 화면에 옮긴 것이다(서버 RPC가 최종 판단):
 *   cancel_job: scheduled·failed·manual_ready / mark_manual_posted: manual_ready → awaiting_evidence
 *   record_manual_evidence: awaiting_evidence(수락 시 published) / abandon: manual_ready·awaiting_evidence
 *   mark_manual_uncertain: awaiting_evidence → unknown / record_reconciliation(admin): unknown
 * 우회 금지: unknown·reconciliation_required(늦은·충돌 증거)에서는 수동 게시 표시·확장 인계·재게시 행동을 내지 않는다.
 * 알 수 없는 상태 문자열(예: 향후 워커의 `recovery_failed:<SQLSTATE>` 같은 값)은 정상 상태로 매핑하지 않고 행동 0개.
 */
import type { HandoffStatus } from "./blog/handoff-status";

export const KNOWN_JOB_STATUSES = [
  "scheduled",
  "dispatching",
  "published",
  "dry_run_succeeded",
  "failed",
  "unknown",
  "cancelled",
  "manual_ready",
  "awaiting_evidence",
  "abandoned",
] as const;
export type KnownJobStatus = (typeof KNOWN_JOB_STATUSES)[number];

export type JobDto = {
  id: string;
  contentId: string;
  contentVersionId: string;
  contentVersionNo: number;
  draftRevisionId: string;
  channel: string;
  mode: string;
  /** 알려진 값이 아니면 "unrecognized"(원문 문자열은 rawStatus) */
  status: KnownJobStatus | "unrecognized";
  rawStatus: string;
  holdReason: string | null;
  retryPolicy: string | null;
  reconciliationRequired: boolean;
  hasIssues: boolean;
  externalUrl: string | null;
  externalId: string | null;
  lastErrorCode: string | null;
  /** dry_run 실행 표시용(DRYRUN-EXEC-020) */
  phase: string | null;
  scheduledAt: string | null;
  leaseExpiresAt: string | null;
  attempts: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type EvidenceDto = {
  id: string;
  source: string;
  status: string;
  externalPostId: string | null;
  externalUrl: string | null;
  observedAt: string | null;
  methodNote: string | null;
  createdAt: string;
};

export type ReconciliationDto = { id: string; method: string; finding: string; observedAt: string | null; observation: string | null; createdAt: string };
export type EventDto = { seq: number; fromStatus: string | null; toStatus: string | null; reasonCode: string | null; createdAt: string };

const s = (v: unknown) => (typeof v === "string" ? v : null);
const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

export function toJob(r: Record<string, unknown>): JobDto | null {
  const id = s(r.id);
  const raw = s(r.status);
  const version = n(r.version);
  if (!id || !raw || version === null || !s(r.content_id) || !s(r.draft_revision_id) || !s(r.created_at) || !s(r.updated_at)) return null;
  const known = (KNOWN_JOB_STATUSES as readonly string[]).includes(raw) ? (raw as KnownJobStatus) : "unrecognized";
  const lastError = r.last_error && typeof r.last_error === "object" ? (r.last_error as Record<string, unknown>) : null;
  return {
    id,
    contentId: r.content_id as string,
    contentVersionId: s(r.content_version_id) ?? "",
    contentVersionNo: n(r.content_version_no) ?? 0,
    draftRevisionId: r.draft_revision_id as string,
    channel: s(r.channel) ?? "",
    mode: s(r.mode) ?? "",
    status: known,
    rawStatus: raw,
    holdReason: s(r.hold_reason),
    retryPolicy: s(r.retry_policy),
    reconciliationRequired: r.reconciliation_required === true,
    hasIssues: r.has_issues === true,
    externalUrl: s(r.external_url),
    externalId: s(r.external_id),
    lastErrorCode: lastError ? s(lastError.code) : null,
    phase: s(r.phase),
    scheduledAt: s(r.scheduled_at),
    leaseExpiresAt: s(r.lease_expires_at),
    attempts: n(r.attempts) ?? 0,
    version,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function toEvidence(r: Record<string, unknown>): EvidenceDto | null {
  if (!s(r.id) || !s(r.source) || !s(r.status) || !s(r.created_at)) return null;
  return {
    id: r.id as string,
    source: r.source as string,
    status: r.status as string,
    externalPostId: s(r.external_post_id),
    externalUrl: s(r.external_url),
    observedAt: s(r.observed_at),
    methodNote: s(r.method_note),
    createdAt: r.created_at as string,
  };
}

export function toReconciliation(r: Record<string, unknown>): ReconciliationDto | null {
  if (!s(r.id) || !s(r.method) || !s(r.finding) || !s(r.created_at)) return null;
  return { id: r.id as string, method: r.method as string, finding: r.finding as string, observedAt: s(r.observed_at), observation: s(r.observation), createdAt: r.created_at as string };
}

export function toEvent(r: Record<string, unknown>): EventDto | null {
  const seq = n(r.seq);
  if (seq === null || !s(r.created_at)) return null;
  return { seq, fromStatus: s(r.from_status), toStatus: s(r.to_status), reasonCode: s(r.reason_code), createdAt: r.created_at as string };
}

export const JOB_STATUS_LABEL: Record<KnownJobStatus | "unrecognized", string> = {
  scheduled: "예약됨",
  dispatching: "실행 중",
  published: "게시 확인됨",
  dry_run_succeeded: "모의 실행 완료(외부 게시 아님)",
  failed: "실패",
  unknown: "결과 불명",
  cancelled: "취소됨",
  manual_ready: "수동 게시 준비",
  awaiting_evidence: "게시 증거 대기",
  abandoned: "수동 작업 중단",
  unrecognized: "알 수 없는 상태",
};

export type JobActions = {
  markPosted: boolean;
  recordEvidence: boolean;
  abandon: boolean;
  markUncertain: boolean;
  reconcile: boolean;
  cancel: boolean;
  /** 확장으로 보내기(요청) — 서버가 최종 판단 */
  requestHandoff: boolean;
  /** 관리자 수동 모의 실행(dry_run·scheduled·보류 없음·예약 시각 도래) — 서버가 최종 판단(DRYRUN-EXEC-020) */
  runDryRun: boolean;
  /** 사람 확인이 필요한 이유(행동 대신 안내) */
  warnings: string[];
};

/**
 * 작업 상태 → 화면에 낼 행동. handoffStatus는 이 작업의 확장 인계 상태(없으면 null).
 */
export function jobActions(job: JobDto, handoffStatus: HandoffStatus | null, now = Date.now()): JobActions {
  const a: JobActions = { markPosted: false, recordEvidence: false, abandon: false, markUncertain: false, reconcile: false, cancel: false, requestHandoff: false, runDryRun: false, warnings: [] };
  if (job.status === "unrecognized") {
    a.warnings.push("알 수 없는 작업 상태입니다. 운영 확인 전에는 어떤 행동도 하지 않습니다.");
    return a;
  }
  const manual = job.mode === "manual";
  if (job.reconciliationRequired) {
    a.warnings.push("늦게 들어온 증거 또는 충돌 증거가 있어 검토가 필요합니다. 검토 전에는 수동 게시 표시·확장 인계를 하지 않습니다.");
  }
  if (job.status === "unknown") {
    a.reconcile = true;
    a.warnings.push("결과 불명: 외부에 이미 게시됐을 수 있습니다. 대사(확인 기록) 전에는 다시 게시하지 않습니다.");
    return a;
  }
  if (job.status === "manual_ready" && manual) {
    a.abandon = true;
    a.cancel = true;
    if (!job.reconciliationRequired) {
      a.markPosted = true;
      if (handoffStatus === null || handoffStatus === "requested" || handoffStatus === "rejected") a.requestHandoff = true;
    }
  }
  if (job.status === "awaiting_evidence" && manual) {
    a.abandon = true;
    a.markUncertain = true;
    if (!job.reconciliationRequired) a.recordEvidence = true;
  }
  if (job.status === "scheduled" || job.status === "failed") a.cancel = true;
  if (job.mode === "dry_run") dryRunGuidance(job, a, now);
  if (handoffStatus === "needs_check") {
    a.requestHandoff = false;
    a.warnings.push("확장 인계가 '사람 확인 필요' 상태입니다(리스 만료·토큰 철회 등). 네이버 글쓰기 화면을 직접 확인하세요. 자동으로 다시 보내지 않습니다.");
  }
  if (handoffStatus === "in_progress" || handoffStatus === "completed") {
    a.warnings.push("확장이 입력 중이거나 본문 입력을 마쳤습니다. 입력 완료는 게시가 아닙니다.");
  }
  if (handoffStatus === "publish_ready") {
    a.warnings.push("확장이 발행 직전까지 준비했습니다. 네이버에서 직접 [발행]을 누른 뒤 '외부에서 게시를 마쳤습니다'를 표시하세요. 입력 완료는 게시가 아닙니다.");
  }
  if (handoffStatus === "failed") a.warnings.push("확장 입력이 실패로 보고됐습니다. 네이버 화면을 확인하세요. 자동으로 다시 보내지 않습니다.");
  return a;
}

/** 상태 + 방식 표시(scheduled는 방식에 따라 뜻이 다르다 — THREADS-PORT-016). */
export function jobStatusText(job: Pick<JobDto, "status" | "mode"> & { holdReason?: string | null }): string {
  if (job.status === "scheduled" && job.mode === "dry_run") return job.holdReason ? "모의 실행 보류" : "모의 실행 대기(수동 실행)";
  if (job.status === "dispatching" && job.mode === "dry_run") return "모의 실행 중";
  return JOB_STATUS_LABEL[job.status];
}

/** dry_run 실행 안내(DRYRUN-EXEC-020). 자동 실행기(스케줄러)는 없고 관리자 수동 실행만 있다. 외부 호출·게시 없음. */
function dryRunGuidance(job: JobDto, a: JobActions, now: number) {
  if (job.status === "scheduled") {
    const due = !job.scheduledAt || Date.parse(job.scheduledAt) <= now;
    if (job.holdReason) {
      a.warnings.push(`보류됨(${job.holdReason}): 승인 철회·원문 변경·보관 등으로 실행하지 않습니다. 이 작업은 다시 열 수 없으니 취소하고 새로 만드세요.`);
    } else if (job.reconciliationRequired) {
      a.warnings.push("검토가 필요한 작업이라 모의 실행하지 않습니다.");
    } else if (!due) {
      a.warnings.push("예약 시각 전입니다. 시각이 되면 모의 실행할 수 있습니다(자동 실행기는 없음).");
    } else {
      a.runDryRun = true;
      a.warnings.push("모의 실행 대기: 자동 실행기(스케줄러)는 없고 관리자가 [모의 실행]을 눌러야 진행됩니다. 작업 생성은 모의 실행 성공이 아니며, 모의 실행은 외부 게시를 하지 않습니다.");
    }
  }
  if (job.status === "dispatching") {
    const expired = job.leaseExpiresAt !== null && Date.parse(job.leaseExpiresAt) <= now;
    a.warnings.push(
      expired
        ? "모의 실행이 중간에 멈췄습니다(실행 권한 시간 만료). 자동 회수 실행기가 아직 없어 이 상태로 남습니다 — 운영 회수(만료 작업 회수) 뒤 실패로 기록됩니다. 성공으로 보지 마세요."
        : "모의 실행 중입니다. 잠시 뒤 화면을 새로 불러오세요.",
    );
  }
  if (job.status === "failed") {
    const code = job.lastErrorCode ?? "";
    if (code.startsWith("LEASE_EXPIRED")) a.warnings.push(`모의 실행 도중 실행 권한 시간이 만료돼 실패로 회수됐습니다(${code}). 외부 게시는 없었습니다.`);
    else if (code === "DRY_RUN_INVALID_TEXT") a.warnings.push("모의 실행 검사에서 본문이 Threads 텍스트 조건(비어 있지 않음·500자 이하·제어문자 없음)을 통과하지 못했습니다. 초안을 고쳐 새 리비전·승인 후 새 작업을 만드세요.");
    else if (code) a.warnings.push(`모의 실행 실패(${code}). 외부 게시는 없었습니다.`);
  }
  if (job.status === "dry_run_succeeded") a.warnings.push("모의 실행 성공: 검사만 통과했습니다. 외부에 게시하지 않았고 실제 게시(live)는 닫혀 있습니다.");
}
