/**
 * 쓰기 RPC 인자·반환 매핑 — 순수 함수(테스트 대상). 시그니처는 SQL과 1:1(명세 §4.1 A1~A14).
 * - p_actor_id는 항상 첫 인자(actorId)에서만 채운다.
 * - 수동 대사의 p_actor_kind는 서버 상수 'admin'.
 * SQL은 아직 어떤 DB에도 적용·실행 검증되지 않았다(B1). 함수 이름·인자 이름은 migration 파일 기준이다.
 */
import type { ContentInput, ManualEvidenceInput } from "./validation";

export const RPC = Object.freeze({
  createContent: "distribution_create_content",
  appendContentVersion: "distribution_append_content_version",
  createChannelDraft: "distribution_create_channel_draft",
  appendDraftRevision: "distribution_append_draft_revision",
  decideApproval: "distribution_decide_approval",
  revokeApproval: "distribution_revoke_approval",
  createJob: "distribution_create_job",
  markManualPosted: "distribution_mark_manual_posted",
  recordManualEvidence: "distribution_record_manual_evidence",
  abandonManualJob: "distribution_abandon_manual_job",
  markManualUncertain: "distribution_mark_manual_uncertain",
  recordReconciliation: "distribution_record_reconciliation",
  cancelJob: "distribution_cancel_job",
} as const);

// ---- A1 / A2 원문 ----
export function createContentParams(actorId: string, input: ContentInput) {
  return {
    p_actor_id: actorId,
    p_title: input.title,
    p_body: input.body,
    p_story_slug: null,
    p_target_path: input.targetPath,
    p_source_refs: [],
    p_media_asset_ids: [],
    p_change_summary: input.changeSummary,
  };
}

export function appendContentVersionParams(actorId: string, input: ContentInput & { contentId: string; expectedVersionNo: number }) {
  return {
    p_actor_id: actorId,
    p_content_id: input.contentId,
    p_expected_version_no: input.expectedVersionNo,
    p_title: input.title,
    p_body: input.body,
    p_target_path: input.targetPath,
    p_source_refs: [],
    p_media_asset_ids: [],
    p_change_summary: input.changeSummary,
  };
}

export type ContentVersionResult = { contentId: string; versionId: string; versionNo: number; contentHash: string };

export function parseContentVersionResult(data: unknown): ContentVersionResult | null {
  const d = obj(data);
  if (!d || !uuid(d.content_id) || !uuid(d.version_id) || !posInt(d.version_no) || !hash(d.content_hash)) return null;
  return { contentId: d.content_id, versionId: d.version_id, versionNo: d.version_no, contentHash: d.content_hash };
}

// ---- A3 / A4 채널 초안 ----
export function createChannelDraftParams(actorId: string, input: { contentId: string; channel: "blog" | "threads" | "instagram" }) {
  return { p_actor_id: actorId, p_content_id: input.contentId, p_channel: input.channel };
}

export function appendDraftRevisionParams(
  actorId: string,
  input: {
    draftId: string;
    expectedRevisionNo: number;
    expectedContentVersionId: string;
    body: string;
    linkUrl: string | null;
    utm: Record<string, string>;
    /** BLOG-FLOW-015: 화면이 편집하지 않는 값은 직전 리비전 값을 그대로 보존해 보낸다(빈 값으로 소실 방지). */
    targetConnectionId?: string | null;
    targetExternalAccountId?: string | null;
    media?: ReadonlyArray<{ asset_id: string; variant_id: string | null; alt_text: string | null }>;
  },
) {
  return {
    p_actor_id: actorId,
    p_draft_id: input.draftId,
    p_expected_revision_no: input.expectedRevisionNo,
    p_expected_content_version_id: input.expectedContentVersionId,
    p_body: input.body,
    p_link_url: input.linkUrl,
    p_utm: input.utm,
    p_target_connection_id: input.targetConnectionId ?? null,
    p_target_external_account_id: input.targetExternalAccountId ?? null,
    p_validation: {},
    p_media: input.media ?? [],
  };
}

// ---- A5~A7 승인 ----
export function decideApprovalParams(
  actorId: string,
  input: {
    subjectType: "content_version" | "draft_revision";
    subjectId: string;
    decision: "approved" | "rejected";
    expectedSubjectHash: string;
    checklist: Record<string, boolean>;
    reason: string | null;
  },
) {
  return {
    p_actor_id: actorId,
    p_subject_type: input.subjectType,
    p_subject_id: input.subjectId,
    p_decision: input.decision,
    p_expected_subject_hash: input.expectedSubjectHash,
    p_checklist: input.checklist,
    p_reason: input.reason,
  };
}

export function revokeApprovalParams(actorId: string, input: { approvalId: string; reason: string }) {
  return { p_actor_id: actorId, p_approval_id: input.approvalId, p_reason: input.reason };
}

// ---- A8 Blog manual 작업 (예약 없음 — SQL이 manual 예약을 거절) ----
/**
 * 화면이 만들 수 있는 작업 모드(THREADS-PORT-016). live는 앱에서 만들지 않는다(live gate=false, 실행기·연결 없음).
 * 채널별 허용(manual=blog 전용 등)·승인·중복의 최종 판단은 SQL create_job.
 */
export const CREATABLE_JOB_MODES = ["manual", "dry_run"] as const;
export type CreatableJobMode = (typeof CREATABLE_JOB_MODES)[number];

export function createJobParams(actorId: string, input: { draftRevisionId: string; mode: CreatableJobMode }) {
  if (!(CREATABLE_JOB_MODES as readonly string[]).includes(input.mode)) throw new Error("mode not creatable");
  return { ...createBlogManualJobParams(actorId, input), p_mode: input.mode };
}

export function createBlogManualJobParams(actorId: string, input: { draftRevisionId: string }) {
  return {
    p_actor_id: actorId,
    p_draft_revision_id: input.draftRevisionId,
    p_mode: "manual",
    p_scheduled_at: null,
    p_schedule_tz: null,
    p_max_attempts: 3,
    p_allow_republish: false,
  };
}

export function parseUuidResult(data: unknown): string | null {
  return uuid(data) ? data : null;
}

// ---- A9~A14 작업 상태 ----
export function markManualPostedParams(actorId: string, input: { jobId: string; expectedVersion: number }) {
  return { p_actor_id: actorId, p_job_id: input.jobId, p_expected_version: input.expectedVersion };
}

export function recordManualEvidenceParams(actorId: string, input: ManualEvidenceInput & { jobId: string; expectedVersion: number }) {
  return {
    p_actor_id: actorId,
    p_job_id: input.jobId,
    p_expected_version: input.expectedVersion,
    p_external_post_id: input.externalPostId,
    p_external_url: input.externalUrl,
    p_external_account_id: input.externalAccountId,
    p_observed_at: input.observedAt,
    p_method_note: input.methodNote,
  };
}

export function abandonManualJobParams(actorId: string, input: { jobId: string; expectedVersion: number; reason: string; acknowledged: boolean }) {
  return {
    p_actor_id: actorId,
    p_job_id: input.jobId,
    p_expected_version: input.expectedVersion,
    p_reason: input.reason,
    p_acknowledge_may_remain_external: input.acknowledged,
  };
}

export function markManualUncertainParams(actorId: string, input: { jobId: string; expectedVersion: number; reason: string }) {
  return { p_actor_id: actorId, p_job_id: input.jobId, p_expected_version: input.expectedVersion, p_reason: input.reason };
}

export function recordReconciliationParams(
  actorId: string,
  input: {
    jobId: string;
    expectedVersion: number;
    method: string;
    finding: string;
    checkedScope: Record<string, unknown>;
    observedAt: string;
    observation: string | null;
    /** found_published일 때의 외부 근거(BLOG-FLOW-015) */
    externalPostId?: string | null;
    externalUrl?: string | null;
  },
) {
  return {
    p_actor_kind: "admin", // 서버 상수. 폼 값을 쓰지 않는다.
    p_actor_id: actorId,
    p_job_id: input.jobId,
    p_expected_version: input.expectedVersion,
    p_method: input.method,
    p_finding: input.finding,
    p_checked_scope: input.checkedScope,
    p_observed_at: input.observedAt,
    p_observation: input.observation,
    p_external_post_id: input.externalPostId ?? null,
    p_external_url: input.externalUrl ?? null,
  };
}

export function cancelJobParams(actorId: string, input: { jobId: string; expectedVersion: number; reason: string | null }) {
  return { p_actor_id: actorId, p_job_id: input.jobId, p_expected_version: input.expectedVersion, p_reason: input.reason };
}

// ---- 작은 타입 가드 ----
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function uuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function posInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}
function hash(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}
