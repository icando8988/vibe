/**
 * 실패 분류와 재실행 정책 (순수 함수, AUTOPOST-M2-APP-001).
 * M2 SQL(20261116040000_distribution_jobs.sql)의 retry_policy / last_error.autoRetry 규칙을 앱 도메인에 옮긴다.
 *  - 자동 재시도(auto)는 게시 요청 전 실패에만. 게시 요청 이후이거나 요청 여부를 모르면 자동 재시도 불가.
 *  - confirmed_absent(CONFIRMED_ABSENT)는 항상 operator_only — 운영자 명시 승인 없이는 다시 보내지 않는다(D2).
 *  - unknown은 정책 대상이 아니다(대사가 먼저).
 */
import type { PublishError, PublishJob, PublishMode, RetryPolicy } from "./types";

export const CONFIRMED_ABSENT_CODE = "CONFIRMED_ABSENT";

export interface ClassifiedFailure {
  policy: RetryPolicy;
  /** retryable/autoRetry가 정책과 맞게 정규화된 오류(M2 distribution_jobs_retry_policy_error와 같은 조합) */
  error: PublishError;
}

/**
 * 어댑터 실패를 재실행 정책으로 분류한다.
 * @param publishRequested 이 시도에서 공급자 게시 요청을 보냈는가. undefined(모름)는 보낸 것으로 간주한다.
 *   dry_run은 외부 게시가 없으므로 이 값과 무관하게 retryable이면 auto.
 */
export function classifyFailure(
  mode: PublishMode,
  error: PublishError,
  publishRequested: boolean | undefined,
): ClassifiedFailure {
  if (error.retryable !== true || error.code === CONFIRMED_ABSENT_CODE) {
    if (error.retryable === true) {
      // CONFIRMED_ABSENT 코드를 어댑터 실패로 위장해도 자동 재시도로 만들지 않는다.
      return { policy: "operator_only", error: { ...error, retryable: true, autoRetry: false } };
    }
    return { policy: "never", error: { ...error, retryable: false, autoRetry: false } };
  }
  const beforePublishRequest = mode === "dry_run" || publishRequested === false;
  if (beforePublishRequest && error.autoRetry !== false) {
    return { policy: "auto", error: { ...error, retryable: true, autoRetry: true } };
  }
  return { policy: "operator_only", error: { ...error, retryable: true, autoRetry: false } };
}

/**
 * 저장된 작업의 실제 재실행 정책. failed가 아니면 null.
 * 저장 값이 오류 내용과 어긋나면 더 보수적인 쪽으로 낮춘다(auto → operator_only → never).
 * retryPolicy가 없는(필드 도입 전) 작업은 lastError에서 유도한다: autoRetry=true만 auto,
 * autoRetry 생략은 dry_run만 auto, live/manual은 operator_only.
 */
export function effectiveRetryPolicy(job: PublishJob): RetryPolicy | null {
  if (job.status !== "failed") return null;
  const err = job.lastError;
  if (!err || err.retryable !== true) return "never";
  const confirmedAbsent = err.code === CONFIRMED_ABSENT_CODE;
  const stored = job.retryPolicy;
  if (stored === "never") return "never";
  if (stored === "operator_only") return "operator_only";
  if (stored === "auto") {
    return !confirmedAbsent && err.autoRetry === true ? "auto" : "operator_only";
  }
  if (stored !== null && stored !== undefined) return "never"; // 오염된 값은 fail closed
  // stored가 null/undefined(필드 도입 전 작업)
  if (confirmedAbsent) return "operator_only";
  if (err.autoRetry === true) return "auto";
  if (err.autoRetry === undefined && job.mode === "dry_run") return "auto";
  return "operator_only";
}
