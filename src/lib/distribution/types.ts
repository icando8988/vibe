/**
 * 콘텐츠 배포 공통 타입 (MKT-003, docs/MARKETING_DELIVERY_PLAN.md 공통 구조).
 * 콘텐츠 원문(ContentItem) → 채널별 변형(ChannelDraft) → 배포 작업(PublishJob) → 어댑터 → 결과(PublishResult).
 * 판매 주문·입금 도메인과 섞지 않는다. 자동포스팅 프로그램은 아직 받지 않았으므로
 * 플랫폼 기능·글자 수·미디어 규격을 여기서 확정하지 않는다.
 */

export const CHANNELS = ["blog", "threads", "instagram"] as const;
export type Channel = (typeof CHANNELS)[number];

/** 원문. version은 내용이 바뀔 때마다 1씩 오른다(멱등키·초안 최신성 판단 기준). */
export interface ContentItem {
  id: string;
  version: number;
  title: string;
  body: string;
  /** 사이트 내부 목적 경로(예: /about). 공개 도메인 확정 전에는 절대 URL을 만들지 않는다. */
  targetPath: string | null;
  /** 미디어 참조 ID. 권리·공개 동의 검토는 별도(자산대장). */
  mediaRefs: readonly string[];
  updatedAt: string; // ISO-8601 UTC
}

export const DRAFT_REVIEW_STATUSES = ["draft", "needs_review", "approved"] as const;
export type DraftReviewStatus = (typeof DRAFT_REVIEW_STATUSES)[number];

/** 채널별 변형. 어떤 원문 버전에서 만들었는지 기록해 원문이 바뀐 뒤 옛 초안이 나가는 것을 막는다. */
export interface ChannelDraft {
  contentId: string;
  contentVersion: number;
  channel: Channel;
  text: string;
  mediaRefs: readonly string[];
  /** 추적 링크(utm.ts로 생성). 목적 URL 미확정이면 null */
  link: string | null;
  reviewStatus: DraftReviewStatus;
}

/**
 * 배포 모드 (M2 distribution_jobs.mode와 동일).
 * - live: 공급자 API 자동 게시(blog 불가 — distribution_jobs_blog_modes)
 * - dry_run: 모의 실행(외부 게시 없음)
 * - manual: 운영자가 직접 게시하고 증거를 기록(blog 전용 — distribution_jobs_manual_blog)
 */
export const PUBLISH_MODES = ["live", "dry_run", "manual"] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

/** 채널별 허용 모드 (M2: blog는 manual/dry_run만, manual은 blog만). */
export const CHANNEL_MODES: { readonly [C in Channel]: readonly PublishMode[] } = {
  blog: ["manual", "dry_run"],
  threads: ["live", "dry_run"],
  instagram: ["live", "dry_run"],
};

/**
 * 배포 작업 상태 (M2 distribution_jobs.status와 동일, 모드별 허용 집합은 distribution_jobs_mode_status).
 * - scheduled: 예약됨(또는 즉시 실행 대기) — live/dry_run
 * - dispatching: 어댑터 호출 중 — live/dry_run
 * - published: 외부 게시 근거로 확인됨 — live/manual
 * - dry_run_succeeded: 모의 실행 성공(외부 게시 아님, published와 구별) — dry_run
 * - failed: 실패. 다시 실행할 수 있는지는 retryPolicy(auto / operator_only / never)로 판단
 * - unknown: 게시 여부를 모름 → 대사 전 재시도 금지 — live/manual
 * - cancelled: 취소
 * - manual_ready: 수동 게시 대기 — manual
 * - awaiting_evidence: 운영자가 게시했다고 표시, 증거 대기 — manual
 * - abandoned: 수동 작업 중단(외부에 남았을 수 있음 → 같은 키를 계속 점유) — manual
 */
export const JOB_STATUSES = [
  "scheduled",
  "dispatching",
  "published",
  "dry_run_succeeded",
  "failed",
  "unknown",
  "cancelled",
  "manual_ready",
  "awaiting_evidence",
  "abandoned",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** 모드별 허용 상태 (distribution_jobs_mode_status와 동일). */
export const MODE_STATUSES: { readonly [M in PublishMode]: readonly JobStatus[] } = {
  live: ["scheduled", "dispatching", "published", "failed", "unknown", "cancelled"],
  dry_run: ["scheduled", "dispatching", "dry_run_succeeded", "failed", "cancelled"],
  manual: ["manual_ready", "awaiting_evidence", "published", "failed", "unknown", "cancelled", "abandoned"],
};

/**
 * failed 작업의 재실행 정책 (M2 distribution_jobs.retry_policy, DEC-AUTOPOST-DATA-001 D2).
 * - auto: 워커가 자동 재예약 가능. 게시 요청(publish request) 전 실패에만 허용.
 * - operator_only: 다시 보낼 수는 있지만 운영자 명시 승인(approveRerun)이 있어야 한다.
 *   confirmed_absent 대사 결과는 항상 이 정책이다(자동 재시도 허가가 아님).
 * - never: 재실행 불가(취소 후 새 작업).
 */
export const RETRY_POLICIES = ["auto", "operator_only", "never"] as const;
export type RetryPolicy = (typeof RETRY_POLICIES)[number];

export interface PublishError {
  code: string;
  message: string;
  /** 같은 요청을 다시 보내도 중복 게시 위험이 없다고 어댑터가 판단한 경우만 true */
  retryable: boolean;
  /**
   * 워커 자동 재시도 허용 여부(M2 last_error.autoRetry). retryable과 별개다.
   * 생략은 기존 호출 호환용이며 false로 해석한다(dry_run만 retryable이면 자동 허용).
   * true여도 게시 요청 이후 실패면 자동 재시도하지 않는다.
   */
  autoRetry?: boolean;
}

export interface PublishJob {
  id: string;
  idempotencyKey: string;
  contentId: string;
  contentVersion: number;
  channel: Channel;
  mode: PublishMode;
  status: JobStatus;
  /** 예약 시각(UTC ISO). null이면 즉시 실행 대상 */
  scheduledAt: string | null;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  /** published 확인 근거 */
  externalId: string | null;
  externalUrl: string | null;
  lastError: PublishError | null;
  /**
   * failed일 때만 값이 있다(M2 distribution_jobs_retry_policy_status). 생략(undefined)은 이 필드가 생기기 전
   * 작업과의 호환용이며 effectiveRetryPolicy()가 lastError에서 보수적으로 유도한다.
   */
  retryPolicy?: RetryPolicy | null;
  /** 마지막 대사 기록 ID(M2 last_reconciliation_id). confirmed_absent 이후 재실행 승인이 이 ID를 인용해야 한다. */
  lastReconciliationId?: string | null;
}

/** 어댑터가 돌려주는 결과. published는 외부 식별자가 있어야만 만들 수 있다. */
export type PublishResult =
  | { kind: "published"; externalId: string; externalUrl: string | null; confirmedAt: string }
  | { kind: "dry_run_ok"; preview: { channel: Channel; text: string; mediaCount: number; link: string | null } }
  | { kind: "rejected"; error: PublishError }
  | { kind: "failed"; error: PublishError }
  | { kind: "unknown"; reason: string };

/**
 * 채널 기능 선언. 확인 전에는 'unverified'이며 실행하지 않는다.
 * 'supported'는 공식 자료와 실제 검증(또는 제공 프로그램 분석)으로 확인된 경우만.
 */
export type CapabilityState = "supported" | "unsupported" | "unverified";

export interface AdapterCapabilities {
  channel: Channel;
  connected: boolean;
  publishText: CapabilityState;
  publishImage: CapabilityState;
  publishVideo: CapabilityState;
  publishLink: CapabilityState;
  schedule: CapabilityState;
  edit: CapabilityState;
  delete: CapabilityState;
  /** 응답 유실 시 게시 여부 조회 가능 여부 */
  lookupByIdempotencyKey: CapabilityState;
  metrics: CapabilityState;
  /** 글자 수·미디어 개수 제한. 미확인이면 null(임의 값 금지) */
  limits: { maxTextLength: number | null; maxMedia: number | null };
}
