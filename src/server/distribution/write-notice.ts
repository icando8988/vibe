/**
 * 쓰기 결과 → 화면 안내 코드(허용 목록). AUTOPOST-CONTENT-CONNECT-014. 순수 함수(테스트 대상).
 * - 성공은 RPC 응답을 파싱한 뒤에만(status ok) 성공 코드가 된다.
 * - 응답 유실·형식 오류·식별 못 한 DB 오류는 "uncertain"(저장 여부 확인 필요). 자동 재전송하지 않는다(R010-03A와 같은 원칙).
 */
import type { WriteOutcome } from "./write-runner";

export const WRITE_NOTICES = [
  "saved",
  "denied",
  "invalid",
  "not_ready",
  "uncertain",
  "conflict_version",
  "conflict_revision",
  "stale_content",
  "not_latest",
  "subject_changed",
  "integrity_error",
  "already_decided",
  "already_revoked",
  "checklist_incomplete",
  "archived",
  "no_content_version",
  "duplicate",
  "not_found",
  "invalid_transition",
  "evidence_conflict",
  "not_approved",
  "republish_confirmation",
  "live_gate_closed",
] as const;
export type WriteNotice = (typeof WRITE_NOTICES)[number];

const KNOWN: Partial<Record<string, WriteNotice>> = {
  conflict_version: "conflict_version",
  conflict_revision: "conflict_revision",
  stale_content: "stale_content",
  not_latest: "not_latest",
  subject_changed: "subject_changed",
  integrity_error: "integrity_error",
  already_decided: "already_decided",
  already_revoked: "already_revoked",
  checklist_incomplete: "checklist_incomplete",
  archived: "archived",
  no_content_version: "no_content_version",
  duplicate: "duplicate",
  not_found: "not_found",
  invalid_transition: "invalid_transition",
  evidence_conflict: "evidence_conflict",
  not_approved: "not_approved",
  republish_confirmation: "republish_confirmation",
  live_gate_closed: "live_gate_closed",
  forbidden: "denied",
  invalid_input: "invalid",
};

export function writeNoticeOf(outcome: WriteOutcome<unknown>): WriteNotice {
  switch (outcome.status) {
    case "ok":
      return "saved";
    case "denied":
      return "denied";
    case "invalid":
      return "invalid";
    case "not_ready":
      return "not_ready";
    case "bad_response":
      return "uncertain";
    case "db_error":
      return KNOWN[outcome.error.code] ?? "uncertain";
  }
}

/**
 * 화면 폼 상태(useActionState). 실패 시에만 돌려준다(성공은 서버 액션이 redirect).
 * 입력 원문·비밀은 담지 않는다 — 입력 보존은 클라이언트 폼이 제출 후에도 필드를 비우지 않는 방식으로 한다.
 */
export type FormState = { notice: WriteNotice | null; fields: string[]; seq: number };
export const INITIAL_FORM_STATE: FormState = { notice: null, fields: [], seq: 0 };

export function failureState(outcome: WriteOutcome<unknown>, prev: FormState): FormState {
  return {
    notice: writeNoticeOf(outcome),
    fields: outcome.status === "invalid" ? [...new Set(outcome.errors.map((e) => e.field))] : [],
    seq: prev.seq + 1,
  };
}

export function parseWriteNotice(v: unknown): WriteNotice | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && (WRITE_NOTICES as readonly string[]).includes(s) ? (s as WriteNotice) : null;
}
