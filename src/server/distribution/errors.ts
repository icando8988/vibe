/**
 * DB(PostgREST) 오류 → 콘솔 오류 코드 (docs/AUTOPOST_SERVER_BRIDGE_PLAN.md §5).
 * 순서: 메시지 앞 토큰(`TOKEN:` 또는 `LIVE_GATE_CLOSED`) → SQLSTATE → unexpected.
 * 원문 메시지(내부 ID·해시 포함)는 화면·로그로 내보내지 않는다. 결과에는 코드와 토큰·SQLSTATE만 남긴다.
 */

export type ConsoleErrorCode =
  | "forbidden"
  | "conflict_version"
  | "conflict_revision"
  | "stale_content"
  | "not_latest"
  | "subject_changed"
  | "integrity_error"
  | "already_decided"
  | "already_revoked"
  | "checklist_incomplete"
  | "archived"
  | "no_content_version"
  | "duplicate"
  | "not_approved"
  | "republish_confirmation"
  | "live_gate_closed"
  | "invalid_transition"
  | "evidence_conflict"
  | "worker_error"
  | "not_found"
  | "invalid_input"
  | "unavailable"
  | "unexpected";

const TOKEN_MAP: Readonly<Record<string, ConsoleErrorCode>> = {
  VERSION_CONFLICT: "conflict_version",
  REVISION_CONFLICT: "conflict_revision",
  STALE_CONTENT_VERSION: "stale_content",
  NOT_LATEST: "not_latest",
  SUBJECT_CHANGED: "subject_changed",
  HASH_INTEGRITY: "integrity_error",
  ALREADY_APPROVED: "already_decided",
  DECISION_IN_SAME_TRANSACTION: "already_decided",
  ALREADY_REVOKED: "already_revoked",
  CHECKLIST_INCOMPLETE: "checklist_incomplete",
  ARCHIVED: "archived",
  ALREADY_ARCHIVED: "archived",
  NO_CONTENT_VERSION: "no_content_version",
  DUPLICATE: "duplicate",
  NOT_APPROVED: "not_approved",
  REPUBLISH_CONFIRMATION_REQUIRED: "republish_confirmation",
  LIVE_GATE_CLOSED: "live_gate_closed",
  INVALID_TRANSITION: "invalid_transition",
  MODE_MISMATCH: "invalid_transition",
  NO_EVIDENCE: "invalid_transition",
  CANCEL_REQUESTED: "invalid_transition",
  ATTEMPTS_EXHAUSTED: "invalid_transition",
  RETRY_NOT_ALLOWED: "invalid_transition",
  EVIDENCE_CONFLICT: "evidence_conflict",
  LEASE_NOT_HELD: "worker_error",
  CONTAINER_NOT_READY: "worker_error",
  CONTAINER_FAILED: "worker_error",
  PUBLISH_NOT_REQUESTED: "worker_error",
};

const SQLSTATE_MAP: Readonly<Record<string, ConsoleErrorCode>> = {
  "42501": "forbidden", // insufficient_privilege (distribution_assert_admin_actor)
  P0002: "not_found", // no_data_found
  "22023": "invalid_input", // invalid_parameter_value
  "23514": "invalid_input", // check_violation (토큰 없음)
  "23503": "not_found", // foreign_key_violation
  "23505": "duplicate", // unique_violation (토큰 없음)
  XX001: "integrity_error", // data_corrupted
  "55P03": "worker_error", // lock_not_available
  "0A000": "live_gate_closed", // feature_not_supported
};

export type MappedDbError = {
  code: ConsoleErrorCode;
  /** 메시지 앞 토큰(있으면). 원문 메시지는 담지 않는다. */
  token: string | null;
  sqlstate: string | null;
};

const TOKEN_RE = /^([A-Z][A-Z_]{2,}):/;

export function extractToken(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const m = TOKEN_RE.exec(message);
  if (m) return m[1] ?? null;
  return message.trim() === "LIVE_GATE_CLOSED" ? "LIVE_GATE_CLOSED" : null;
}

/** PostgrestError 비슷한 값 `{ code?, message? }`을 받는다. */
export function mapDistributionDbError(error: unknown): MappedDbError {
  const e = (error && typeof error === "object" ? error : {}) as { code?: unknown; message?: unknown };
  const token = extractToken(e.message);
  const sqlstate = typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : null;
  if (token && TOKEN_MAP[token]) return { code: TOKEN_MAP[token], token, sqlstate };
  if (sqlstate && SQLSTATE_MAP[sqlstate]) return { code: SQLSTATE_MAP[sqlstate], token, sqlstate };
  return { code: "unexpected", token, sqlstate };
}

/**
 * 네트워크·타임아웃 등 응답을 받지 못한 경우. 쓰기는 결과 불명이므로 자동 재전송하지 않는다.
 */
export function unavailableError(): MappedDbError {
  return { code: "unavailable", token: null, sqlstate: null };
}
