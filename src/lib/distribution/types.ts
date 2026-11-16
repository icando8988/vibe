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

export type PublishMode = "live" | "dry_run";

/**
 * 배포 작업 상태.
 * - scheduled: 예약됨(또는 즉시 실행 대기)
 * - dispatching: 어댑터 호출 중
 * - published: 외부 게시 식별자로 확인됨(live만)
 * - dry_run_succeeded: 모의 실행 성공(외부 게시 아님, published와 구별)
 * - failed: 실패(재시도 가능 여부는 lastError.retryable)
 * - unknown: 응답 유실 등으로 게시 여부를 모름 → 대사 전 재시도 금지
 * - cancelled: 취소
 */
export const JOB_STATUSES = [
  "scheduled",
  "dispatching",
  "published",
  "dry_run_succeeded",
  "failed",
  "unknown",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface PublishError {
  code: string;
  message: string;
  /** 같은 요청을 다시 보내도 중복 게시 위험이 없다고 어댑터가 판단한 경우만 true */
  retryable: boolean;
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
