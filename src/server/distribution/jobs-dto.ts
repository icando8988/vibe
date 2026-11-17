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
  dry_run_succeeded: "모의 실행 완료",
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
  /** 사람 확인이 필요한 이유(행동 대신 안내) */
  warnings: string[];
};

/**
 * 작업 상태 → 화면에 낼 행동. handoffStatus는 이 작업의 확장 인계 상태(없으면 null).
 */
export function jobActions(job: JobDto, handoffStatus: HandoffStatus | null): JobActions {
  const a: JobActions = { markPosted: false, recordEvidence: false, abandon: false, markUncertain: false, reconcile: false, cancel: false, requestHandoff: false, warnings: [] };
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
  if (job.status === "scheduled" && job.mode === "dry_run") {
    a.warnings.push("모의 실행 대기: 실행기(워커·스케줄러)가 아직 연결되지 않아 이 작업은 실행되지 않고 대기합니다. 작업 생성은 모의 실행 성공이 아니며 외부 게시도 하지 않습니다.");
  }
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
export function jobStatusText(job: Pick<JobDto, "status" | "mode">): string {
  if (job.status === "scheduled" && job.mode === "dry_run") return "모의 실행 대기(실행기 없음)";
  return JOB_STATUS_LABEL[job.status];
}
