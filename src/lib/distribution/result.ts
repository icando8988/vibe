/** 배포 모듈 공용 Result. 판매 도메인(errors.ts)과 코드 체계를 섞지 않는다. */
export type DistributionErrorCode =
  | "INVALID_INPUT"
  | "NOT_APPROVED"
  | "STALE_DRAFT"
  | "DUPLICATE"
  | "INVALID_TRANSITION"
  | "NOT_DUE"
  | "RETRY_NOT_ALLOWED"
  | "RECONCILE_REQUIRED"
  | "NOT_CONNECTED"
  | "CAPABILITY_UNVERIFIED"
  | "MODE_MISMATCH"
  | "NO_EVIDENCE"
  /** 현재 시도가 아닌 이전 시도의 결과(늦게 도착한 응답) */
  | "STALE_RESULT";

export type DResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: DistributionErrorCode; message: string } };

export const dOk = <T>(value: T): DResult<T> => ({ ok: true, value });
export const dFail = <T = never>(code: DistributionErrorCode, message: string): DResult<T> => ({
  ok: false,
  error: { code, message },
});
