/**
 * 승인·반려(A5/A6)·철회(A7) — 의존성 주입(테스트 대상). AUTOPOST-CONTENT-CONNECT-014.
 * - 기대 해시는 검토 화면에 렌더된 subject_hash 그대로 보낸다(서버가 최신 해시로 바꾸지 않음 → 내용이 바뀌면 SUBJECT_CHANGED).
 * - 체크리스트는 대상별 고정 키(dto.CHECKLIST)만 받는다. 승인은 모두 true, 반려는 사유 필수(SQL과 같음).
 */
import { CHECKLIST } from "./dto";
import { decideApprovalParams, revokeApprovalParams, RPC } from "./rpc-params";
import { isSubjectHash, isUuid, parseReason, validateChecklist, type FieldError } from "./validation";
import { runDistributionWrite, type WriteOutcome } from "./write-runner";
import type { Form, WriteDeps } from "./content-service";

type SubjectType = "content_version" | "draft_revision";
export type DecisionSaved = { approvalId: string; subjectType: SubjectType; subjectId: string; decision: "approved" | "rejected"; subjectHash: string };

export function decideApproval(deps: WriteDeps, form: Form): Promise<WriteOutcome<DecisionSaved>> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const errors: FieldError[] = [];
      const subjectType = form.get("subjectType");
      const subjectId = form.get("subjectId");
      const decision = form.get("decision");
      const hash = form.get("expectedSubjectHash");
      if (subjectType !== "content_version" && subjectType !== "draft_revision") errors.push({ field: "subjectType", rule: "subject" });
      if (!isUuid(subjectId)) errors.push({ field: "subjectId", rule: "uuid" });
      if (decision !== "approved" && decision !== "rejected") errors.push({ field: "decision", rule: "decision" });
      if (!isSubjectHash(hash)) errors.push({ field: "expectedSubjectHash", rule: "hash" });
      if (errors.length || (subjectType !== "content_version" && subjectType !== "draft_revision") || (decision !== "approved" && decision !== "rejected") || !isUuid(subjectId) || !isSubjectHash(hash)) {
        return { ok: false, errors };
      }
      const items = CHECKLIST[subjectType];
      const raw = Object.fromEntries(items.map((i) => [i.key, form.get(`check_${i.key}`) === "on"]));
      const checklist = validateChecklist(raw, decision === "approved");
      const reason = parseReason(form.get("reason"), decision === "rejected");
      if (!checklist.ok) errors.push({ field: "checklist", rule: "incomplete" });
      if (!reason.ok) errors.push({ field: "reason", rule: "reason" });
      if (errors.length || !checklist.ok || !reason.ok) return { ok: false, errors };
      return {
        ok: true,
        value: {
          subjectType: subjectType as SubjectType,
          subjectId,
          decision: decision as "approved" | "rejected",
          expectedSubjectHash: hash,
          checklist: checklist.value,
          reason: reason.value,
        },
      };
    },
    fn: RPC.decideApproval,
    params: decideApprovalParams,
    parse: (data) => {
      const d = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
      if (!d || !isUuid(d.approval_id) || (d.subject_type !== "content_version" && d.subject_type !== "draft_revision") || !isUuid(d.subject_id)) return null;
      if ((d.decision !== "approved" && d.decision !== "rejected") || !isSubjectHash(d.subject_hash)) return null;
      return { approvalId: d.approval_id, subjectType: d.subject_type, subjectId: d.subject_id, decision: d.decision, subjectHash: d.subject_hash };
    },
  });
}

export type RevokeSaved = { approvalId: string; revokesApprovalId: string };

export function revokeApproval(deps: WriteDeps, form: Form): Promise<WriteOutcome<RevokeSaved>> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const approvalId = form.get("approvalId");
      const reason = parseReason(form.get("reason"), true);
      const errors: FieldError[] = [];
      if (!isUuid(approvalId)) errors.push({ field: "approvalId", rule: "uuid" });
      if (!reason.ok || !reason.value) errors.push({ field: "reason", rule: "reason" });
      if (errors.length || !isUuid(approvalId) || !reason.ok || !reason.value) return { ok: false, errors };
      return { ok: true, value: { approvalId, reason: reason.value } };
    },
    fn: RPC.revokeApproval,
    params: revokeApprovalParams,
    parse: (data) => {
      const d = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
      if (!d || !isUuid(d.approval_id) || !isUuid(d.revokes_approval_id)) return null;
      return { approvalId: d.approval_id, revokesApprovalId: d.revokes_approval_id };
    },
  });
}
