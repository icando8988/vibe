/**
 * 도메인 오류 코드. 계획 13절·19.3절의 코드에 초기 단계 전용 코드를 더했다.
 * UI는 code로 다음 행동을 안내하고, message는 사람이 읽는 설명이다.
 */
export const DOMAIN_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_OPEN",
  "SOLD_OUT",
  "INVALID_QUANTITY",
  "INVALID_AMOUNT",
  "INVALID_INPUT",
  "INVALID_TRANSITION",
  "CONFLICT",
  /** 서버 설정(Supabase 등)이 연결되지 않음 */
  "NOT_CONFIGURED",
  /** 사업 정책(DEC-002/003 등)이 확정되지 않아 의도적으로 거절 */
  "POLICY_PENDING",
  /** 실거래 쓰기가 비활성화된 단계 */
  "TRANSACTIONS_DISABLED",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export interface DomainError {
  code: DomainErrorCode;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(code: DomainErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

/** API 응답용 HTTP 상태 매핑 */
export function httpStatusFor(code: DomainErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_OPEN":
    case "SOLD_OUT":
    case "CONFLICT":
    case "INVALID_TRANSITION":
      return 409;
    case "INVALID_QUANTITY":
    case "INVALID_AMOUNT":
    case "INVALID_INPUT":
      return 422;
    case "NOT_CONFIGURED":
    case "POLICY_PENDING":
    case "TRANSACTIONS_DISABLED":
      return 503;
  }
}
