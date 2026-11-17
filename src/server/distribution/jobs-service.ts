/**
 * Blog 수동 작업 흐름 쓰기 — A8 작업 생성, A9~A12 수동 전이, A13 대사, A14 취소. AUTOPOST-BLOG-FLOW-015.
 * 모두 write-runner(검증된 세션 actor + D1 → 입력 → service 키 → RPC 1회).
 * expected_version은 **화면에 렌더된 job.version 그대로** 보낸다(서버에서 최신값으로 바꾸지 않음 → 충돌은 VERSION_CONFLICT로 안내).
 * 자동 재전송 없음. 게시 확인(published)은 A10 증거를 DB가 수락했을 때만 일어난다(입력만으로 확인 표시 안 함).
 */
import type { Form, WriteDeps } from "./content-service";
import {
  abandonManualJobParams,
  cancelJobParams,
  createBlogManualJobParams,
  createJobParams,
  markManualPostedParams,
  markManualUncertainParams,
  parseUuidResult,
  recordManualEvidenceParams,
  recordReconciliationParams,
  RPC,
} from "./rpc-params";
import { isUuid, parseExpectedInt, parseOptionalHttpsUrl, parseReason, validateBlogManualEvidence, type FieldError } from "./validation";
import { manualEvidenceHostAllowed } from "@/lib/distribution/evidence-rules";
import { runDistributionWrite, type WriteOutcome } from "./write-runner";

/** 화면의 datetime-local(KST로 안내) → 시간대 붙은 ISO. 이미 시간대가 있으면 그대로. */
export function kstLocalToZoned(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return `${v}:00+09:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return v;
  return null;
}

function jobTarget(form: Form): { ok: true; jobId: string; expectedVersion: number } | { ok: false; errors: FieldError[] } {
  const jobId = form.get("jobId");
  const expectedVersion = parseExpectedInt(form.get("expectedVersion"));
  const errors: FieldError[] = [];
  if (!isUuid(jobId)) errors.push({ field: "jobId", rule: "uuid" });
  if (expectedVersion === null) errors.push({ field: "expectedVersion", rule: "expected" });
  if (errors.length || !isUuid(jobId) || expectedVersion === null) return { ok: false, errors };
  return { ok: true, jobId, expectedVersion };
}

const voidOk = () => ({ done: true as const });

// A8 Blog 수동 작업 생성(승인된 현재 리비전). 승인·최신성 최종 판단은 create_job.
export function createBlogManualJob(deps: WriteDeps, form: Form): Promise<WriteOutcome<string>> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const id = form.get("draftRevisionId");
      return isUuid(id) ? { ok: true, value: { draftRevisionId: id } } : { ok: false, errors: [{ field: "draftRevisionId", rule: "uuid" }] };
    },
    fn: RPC.createJob,
    params: createBlogManualJobParams,
    parse: parseUuidResult,
  });
}

// Threads 모의 실행 작업 생성(THREADS-PORT-016). 즉시 실행(예약 시각 없음) 대기 = scheduled.
// 생성은 모의 실행 성공이 아니다 — 실행기(워커·스케줄러)가 아직 없어 대기 상태로 남는다. 외부 호출 없음.
export function createThreadsDryRunJob(deps: WriteDeps, form: Form): Promise<WriteOutcome<string>> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const id = form.get("draftRevisionId");
      if (form.get("channel") !== "threads") return { ok: false, errors: [{ field: "channel", rule: "threads_only" }] };
      return isUuid(id) ? { ok: true, value: { draftRevisionId: id, mode: "dry_run" as const } } : { ok: false, errors: [{ field: "draftRevisionId", rule: "uuid" }] };
    },
    fn: RPC.createJob,
    params: createJobParams,
    parse: parseUuidResult,
  });
}

// A9 사람이 외부에서 발행했다고 선언 → awaiting_evidence(게시 확인 아님)
export function markManualPosted(deps: WriteDeps, form: Form): Promise<WriteOutcome<{ done: true }>> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const t = jobTarget(form);
      if (!t.ok) return t;
      if (form.get("confirmPosted") !== "on") return { ok: false, errors: [{ field: "confirmPosted", rule: "required" }] };
      return { ok: true, value: { jobId: t.jobId, expectedVersion: t.expectedVersion } };
    },
    fn: RPC.markManualPosted,
    params: markManualPostedParams,
    parse: voidOk,
  });
}

// A10 게시 증거(blog.naver.com URL 또는 ID+방법, 확인 시각 KST). DB가 수락해야 published.
export function recordManualEvidence(deps: WriteDeps, form: Form): Promise<WriteOutcome<string>> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const t = jobTarget(form);
      const ev = validateBlogManualEvidence({
        externalUrl: form.get("externalUrl"),
        externalPostId: form.get("externalPostId"),
        externalAccountId: form.get("externalAccountId"),
        observedAt: kstLocalToZoned(form.get("observedAt")),
        methodNote: form.get("methodNote"),
      });
      const errors = [...(t.ok ? [] : t.errors), ...(ev.ok ? [] : ev.errors)];
      if (errors.length || !t.ok || !ev.ok) return { ok: false, errors };
      return { ok: true, value: { ...ev.value, jobId: t.jobId, expectedVersion: t.expectedVersion } };
    },
    fn: RPC.recordManualEvidence,
    params: recordManualEvidenceParams,
    parse: parseUuidResult,
  });
}

// A11 수동 작업 중단(사유 + "외부에 남을 수 있음" 확인). 같은 키는 계속 점유된다.
export function abandonManualJob(deps: WriteDeps, form: Form): Promise<WriteOutcome<{ done: true }>> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const t = jobTarget(form);
      const reason = parseReason(form.get("reason"), true);
      const errors = [...(t.ok ? [] : t.errors)];
      if (!reason.ok || !reason.value) errors.push({ field: "reason", rule: "reason" });
      if (form.get("acknowledged") !== "on") errors.push({ field: "acknowledged", rule: "required" });
      if (errors.length || !t.ok || !reason.ok || !reason.value) return { ok: false, errors };
      return { ok: true, value: { jobId: t.jobId, expectedVersion: t.expectedVersion, reason: reason.value, acknowledged: true } };
    },
    fn: RPC.abandonManualJob,
    params: abandonManualJobParams,
    parse: voidOk,
  });
}

// A12 게시 여부 모름 → unknown(이후 대사만)
export function markManualUncertain(deps: WriteDeps, form: Form): Promise<WriteOutcome<{ done: true }>> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const t = jobTarget(form);
      const reason = parseReason(form.get("reason"), true);
      const errors = [...(t.ok ? [] : t.errors)];
      if (!reason.ok || !reason.value) errors.push({ field: "reason", rule: "reason" });
      if (errors.length || !t.ok || !reason.ok || !reason.value) return { ok: false, errors };
      return { ok: true, value: { jobId: t.jobId, expectedVersion: t.expectedVersion, reason: reason.value } };
    },
    fn: RPC.markManualUncertain,
    params: markManualUncertainParams,
    parse: voidOk,
  });
}

// A13 대사(관리자 수동 확인). confirmed_absent는 재게시 허가가 아니다(재실행은 별도 운영자 승인).
export const ADMIN_FINDINGS = ["found_published", "confirmed_absent", "still_unknown"] as const;
export function recordReconciliation(deps: WriteDeps, form: Form): Promise<WriteOutcome<string>> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const t = jobTarget(form);
      const errors = [...(t.ok ? [] : t.errors)];
      const finding = form.get("finding");
      const observedAt = kstLocalToZoned(form.get("observedAt"));
      const scope = typeof form.get("checkedScope") === "string" ? (form.get("checkedScope") as string) : "";
      const observation = parseReason(form.get("observation"), false);
      const url = parseOptionalHttpsUrl(form.get("externalUrl"));
      const pid = typeof form.get("externalPostId") === "string" && (form.get("externalPostId") as string).trim() ? (form.get("externalPostId") as string).trim() : null;
      if (typeof finding !== "string" || !(ADMIN_FINDINGS as readonly string[]).includes(finding)) errors.push({ field: "finding", rule: "finding" });
      if (!observedAt || Number.isNaN(Date.parse(observedAt))) errors.push({ field: "observedAt", rule: "zoned_datetime" });
      if (scope.trim().length === 0 || [...scope].length > 1000) errors.push({ field: "checkedScope", rule: "required" });
      if (!observation.ok) errors.push({ field: "observation", rule: "max_length" });
      if (!url.ok) errors.push({ field: "externalUrl", rule: "https_url" });
      if (url.ok && url.value && !manualEvidenceHostAllowed("blog", url.value)) errors.push({ field: "externalUrl", rule: "host_not_allowed" });
      if (finding === "found_published" && !(url.ok && url.value) && !pid) errors.push({ field: "externalUrl", rule: "url_or_id_required" });
      // DB 불변조건 6: 부재 확인은 확인 계정·기간(checked_scope.account/period)과 근거 메모가 필수
      const account = typeof form.get("checkedAccount") === "string" ? (form.get("checkedAccount") as string).trim() : "";
      const period = typeof form.get("checkedPeriod") === "string" ? (form.get("checkedPeriod") as string).trim() : "";
      if (account.length > 200) errors.push({ field: "checkedAccount", rule: "max_length" });
      if (period.length > 200) errors.push({ field: "checkedPeriod", rule: "max_length" });
      if (finding === "confirmed_absent") {
        if (!account) errors.push({ field: "checkedAccount", rule: "required" });
        if (!period) errors.push({ field: "checkedPeriod", rule: "required" });
        if (observation.ok && !observation.value) errors.push({ field: "observation", rule: "required" });
      }
      if (errors.length || !t.ok || !observedAt || !observation.ok || !url.ok) return { ok: false, errors };
      return {
        ok: true,
        value: {
          jobId: t.jobId,
          expectedVersion: t.expectedVersion,
          method: "operator_manual",
          finding: finding as string,
          checkedScope: { note: scope, ...(account ? { account } : {}), ...(period ? { period } : {}) },
          observedAt: new Date(observedAt).toISOString(),
          observation: observation.value,
          externalPostId: finding === "found_published" ? pid : null,
          externalUrl: finding === "found_published" ? url.value : null,
        },
      };
    },
    fn: RPC.recordReconciliation,
    params: recordReconciliationParams,
    parse: parseUuidResult,
  });
}

// A14 취소(scheduled·failed·manual_ready). dispatching이면 SQL이 취소 요청으로 처리한다.
export function cancelJob(deps: WriteDeps, form: Form): Promise<WriteOutcome<string>> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const t = jobTarget(form);
      const reason = parseReason(form.get("reason"), false);
      const errors = [...(t.ok ? [] : t.errors)];
      if (form.get("confirmCancel") !== "on") errors.push({ field: "confirmCancel", rule: "required" });
      if (!reason.ok) errors.push({ field: "reason", rule: "max_length" });
      if (errors.length || !t.ok || !reason.ok) return { ok: false, errors };
      return { ok: true, value: { jobId: t.jobId, expectedVersion: t.expectedVersion, reason: reason.value } };
    },
    fn: RPC.cancelJob,
    params: cancelJobParams,
    parse: (d) => (d === "cancelled" || d === "cancel_requested" ? d : null),
  });
}
