/**
 * 늦게 도착한 게시 근거 보존 (DEC-DISTRIBUTION-002 #2).
 *
 * applyResult가 거절하는 published 결과(작업이 취소·실패·결과 불명·재예약 상태이거나 이전 시도의 결과)를
 * 버리지 않고 별도 기록으로 만든다. 작업 상태는 바꾸지 않는다(자동 상태 변경 금지).
 *
 * 저장 계층 계약(현재 저장 계층 없음 → 아래는 보장이 아니라 계약이다):
 *  - 이 기록을 감사 로그와 함께 영구 저장한다.
 *  - requiresReconciliation=true인 기록이 있는 작업은 재시도·재게시를 막고 운영자 대사를 기다린다.
 *  - 기존 published 근거와 다른 식별자(conflict=true)는 둘 다 보존하고 수동 대사한다.
 */
import { isValidEvidenceUrl } from "./jobs";
import { dFail, dOk, type DResult } from "./result";
import type { JobStatus, PublishJob } from "./types";

export interface IncomingEvidence {
  externalId: string;
  externalUrl: string | null;
  confirmedAt: string;
  /** 이 근거를 만든 시도 번호(알 수 없으면 null) */
  attempt: number | null;
}

export type LateEvidenceReason =
  | "job_not_dispatching" // 취소·실패·결과 불명·재예약 등
  | "older_attempt" // 실행 중이지만 이전 시도의 결과
  | "attempt_unknown" // 실행 중인데 시도 번호 없음
  | "already_published"; // 이미 게시 근거가 있음

export interface LateEvidenceRecord {
  jobId: string;
  idempotencyKey: string;
  channel: PublishJob["channel"];
  contentId: string;
  contentVersion: number;
  jobStatusAtArrival: JobStatus;
  jobAttemptAtArrival: number;
  evidenceAttempt: number | null;
  externalId: string;
  externalUrl: string | null;
  confirmedAt: string;
  reason: LateEvidenceReason;
  /** 이미 게시된 작업의 식별자와 다름 → 중복 게시 가능성 */
  conflict: boolean;
  /** 이미 게시된 작업과 같은 식별자 → 같은 게시물의 중복 통지(정보) */
  duplicateOfConfirmed: boolean;
  /** 저장 계층이 재시도를 막고 운영자 대사를 요구해야 함. 같은 식별자 중복 통지만 false */
  requiresReconciliation: boolean;
}

/**
 * applyResult로 반영할 수 없는 published 근거를 판정·정규화한다.
 * 현재 시도의 정상 결과(실행 중 + 시도 번호 일치)는 applyResult를 쓰라고 거절한다.
 */
export function preserveLateEvidence(job: PublishJob, evidence: IncomingEvidence): DResult<LateEvidenceRecord> {
  if (job.mode !== "live") return dFail("MODE_MISMATCH", "모의 실행 작업에는 게시 근거가 있을 수 없습니다.");
  const externalId = typeof evidence.externalId === "string" ? evidence.externalId.trim() : "";
  if (externalId === "") return dFail("NO_EVIDENCE", "외부 게시 식별자가 필요합니다.");
  if (!isValidEvidenceUrl(evidence.externalUrl)) return dFail("NO_EVIDENCE", "게시 주소는 계정 정보 없는 https URL이어야 합니다.");
  if (typeof evidence.confirmedAt !== "string" || Number.isNaN(Date.parse(evidence.confirmedAt))) {
    return dFail("INVALID_INPUT", "확인 시각이 올바르지 않습니다.");
  }
  const attempt = evidence.attempt;
  if (attempt !== null && (!Number.isSafeInteger(attempt) || attempt < 1)) {
    return dFail("INVALID_INPUT", "시도 번호가 올바르지 않습니다.");
  }

  let reason: LateEvidenceReason;
  if (job.status === "published") reason = "already_published";
  else if (job.status !== "dispatching") reason = "job_not_dispatching";
  else if (attempt === null) reason = "attempt_unknown";
  else if (attempt !== job.attempts) reason = "older_attempt";
  else return dFail("INVALID_TRANSITION", "현재 시도의 정상 결과입니다. applyResult로 반영하세요.");

  const duplicateOfConfirmed = job.status === "published" && job.externalId === externalId;
  const conflict = job.status === "published" && job.externalId !== externalId;

  return dOk({
    jobId: job.id,
    idempotencyKey: job.idempotencyKey,
    channel: job.channel,
    contentId: job.contentId,
    contentVersion: job.contentVersion,
    jobStatusAtArrival: job.status,
    jobAttemptAtArrival: job.attempts,
    evidenceAttempt: attempt,
    externalId,
    externalUrl: evidence.externalUrl,
    confirmedAt: evidence.confirmedAt,
    reason,
    conflict,
    duplicateOfConfirmed,
    requiresReconciliation: !duplicateOfConfirmed,
  });
}
