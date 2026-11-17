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
 *
 * mode=manual(블로그 수동 게시, AUTOPOST-MANUAL-BLOG-APP-001) — M2 distribution_record_late_evidence(T21) 대응
 *  - dry_run만 거부한다(live·manual 수용). manual은 수동 게시 채널(blog)만.
 *  - manual 작업은 시도가 없다(manual_shape: attempts=0, attempt 행 없음) → evidence attempt는 null이어야 한다.
 *    값이 있으면 DB evidence attempt FK가 거부하므로 INVALID_INPUT.
 *  - 외부 게시 ID 또는 URL 중 하나 이상(evidence identifier). ID는 M2 external_post_id 형태, URL은 M2 external_url 형태 +
 *    수동 호스트 allowlist(수락 시 distribution_resolve_evidence가 다시 검사).
 *  - awaiting_evidence 작업의 운영자 증거는 늦은 증거가 아니라 recordManualEvidence(T17, admin actor·방법 메모)로 보낸다.
 *    늦은 증거는 recorded_by 없이 pending_review로만 저장되므로 actor 정책을 대신할 수 없다.
 *  - 그 밖의 상태(manual_ready·failed·unknown·cancelled·abandoned)는 reason 'job_not_dispatching'(실행/수락 경로 밖)으로,
 *    published는 'already_published'로 보존한다. 'older_attempt'·'attempt_unknown'은 manual에서 생기지 않는다.
 *  - 이 함수는 저장·권한·이벤트·충돌 검사를 하지 않는다. 기록은 서버가 distribution_record_late_evidence RPC로 하고,
 *    published 확정은 승인된 admin이 distribution_resolve_evidence(accept)로만 한다. ok는 "보존 대상"이지 게시 확정이 아니다.
 *  - 참고: DB는 같은 식별자 중복 통지도 pending_review 행 + reconciliation_required=true로 남긴다.
 *    requiresReconciliation=false(duplicateOfConfirmed)는 앱 표시용 판정일 뿐 DB 플래그 해제를 뜻하지 않는다.
 */
import { isValidExternalId, manualEvidenceHostAllowed } from "./evidence-rules";
import { channelAllowsManual, isValidEvidenceUrl, parseZonedTime } from "./jobs";
import { dFail, dOk, type DResult } from "./result";
import type { JobStatus, PublishJob } from "./types";

export interface IncomingEvidence {
  /** live는 필수. manual은 URL이 있으면 null/빈 값 허용(URL만 있는 수동 증거) */
  externalId: string | null;
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
  /** live는 항상 문자열. manual은 URL만 있는 증거면 null */
  externalId: string | null;
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
  if (job.mode === "manual") return preserveManualLateEvidence(job, evidence);
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

/**
 * manual 작업의 늦은 증거(머리말 mode=manual 규칙). live 경로와 같은 LateEvidenceRecord를 만든다.
 * 서버는 호출 경로의 권한을 확인한 뒤 distribution_record_late_evidence RPC로 저장해야 하며 이 함수가 대신하지 않는다.
 */
function preserveManualLateEvidence(job: PublishJob, evidence: IncomingEvidence): DResult<LateEvidenceRecord> {
  if (!channelAllowsManual(job.channel)) {
    return dFail("MODE_MISMATCH", `${job.channel} 채널은 수동 게시 증거를 받을 수 없습니다.`);
  }
  if (evidence.externalId !== null && typeof evidence.externalId !== "string") {
    return dFail("NO_EVIDENCE", "외부 게시 식별자 값이 올바르지 않습니다.");
  }
  const externalId =
    typeof evidence.externalId === "string" && evidence.externalId.trim() !== "" ? evidence.externalId.trim() : null;
  if (externalId !== null && !isValidExternalId(externalId)) {
    return dFail("NO_EVIDENCE", "외부 게시 식별자는 공백·제어문자 없는 1~200자여야 합니다.");
  }
  const externalUrl = evidence.externalUrl;
  if (!isValidEvidenceUrl(externalUrl)) return dFail("NO_EVIDENCE", "게시 주소는 계정 정보 없는 https URL이어야 합니다.");
  if (externalUrl !== null && !manualEvidenceHostAllowed(job.channel, externalUrl)) {
    return dFail("NO_EVIDENCE", "수동 게시 주소는 허용된 호스트(blog.naver.com, m.blog.naver.com)의 port 없는 https URL이어야 합니다.");
  }
  if (externalId === null && externalUrl === null) {
    return dFail("NO_EVIDENCE", "외부 게시 ID 또는 게시 주소 중 하나는 있어야 합니다.");
  }
  if (parseZonedTime(evidence.confirmedAt) === null) return dFail("INVALID_INPUT", "확인 시각이 올바르지 않습니다.");
  if (evidence.attempt !== null) {
    return dFail("INVALID_INPUT", "수동 게시 작업에는 시도가 없습니다. 시도 번호는 비워야 합니다.");
  }

  let reason: LateEvidenceReason;
  if (job.status === "published") reason = "already_published";
  else if (job.status === "awaiting_evidence") {
    return dFail("INVALID_TRANSITION", "증거 대기 중인 수동 작업입니다. 운영자 증거는 recordManualEvidence로 확정하세요.");
  } else reason = "job_not_dispatching";

  // 이미 게시된 작업: 들어온 식별자(ID·URL) 중 값이 있는 것이 모두 확정 근거와 같을 때만 중복 통지, 하나라도 다르면 충돌.
  let duplicateOfConfirmed = false;
  if (job.status === "published") {
    const idSame = externalId === null || job.externalId === externalId;
    const urlSame = externalUrl === null || job.externalUrl === externalUrl;
    duplicateOfConfirmed = idSame && urlSame;
  }
  const conflict = job.status === "published" && !duplicateOfConfirmed;

  return dOk({
    jobId: job.id,
    idempotencyKey: job.idempotencyKey,
    channel: job.channel,
    contentId: job.contentId,
    contentVersion: job.contentVersion,
    jobStatusAtArrival: job.status,
    jobAttemptAtArrival: job.attempts,
    evidenceAttempt: null,
    externalId,
    externalUrl,
    confirmedAt: evidence.confirmedAt,
    reason,
    conflict,
    duplicateOfConfirmed,
    requiresReconciliation: !duplicateOfConfirmed,
  });
}
