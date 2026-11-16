/**
 * 공개 콘텐츠(이야기) 모델 (MKT-004).
 * 유입 목적지에서 읽는 원문이다. 배포 모듈(lib/distribution)의 ContentItem과는 별개 타입이며
 * `distributionContentId`로 느슨하게 연결한다(관계는 docs/CONTENT_WORKFLOW.md).
 * 본문은 일반 텍스트이며 HTML/마크다운을 해석하지 않는다.
 */

export const STORY_STATUSES = ["draft", "reviewed", "published"] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

export type SourceKind = "document" | "interview" | "record" | "other";

/** 출처. verified는 사실 확인 담당이 원본과 대조했을 때만 true. */
export interface SourceRef {
  label: string;
  kind: SourceKind;
  verified: boolean;
}

export interface StoryReview {
  /** 검토자 표시명(내부). 공개 응답에 포함하지 않는다. */
  reviewerLabel: string | null;
  reviewedAt: string | null; // ISO-8601 UTC
}

/** 저장소 원본 레코드(내부용) */
export interface StoryRecord {
  slug: string;
  title: string;
  summary: string;
  /** 일반 텍스트. 빈 줄로 단락 구분 */
  body: string;
  sourceRefs: readonly SourceRef[];
  status: StoryStatus;
  /** 운영자의 공개 허용(콘텐츠·권리·동의 확인 완료) */
  publicationApproved: boolean;
  review: StoryReview;
  publishedAt: string | null; // ISO-8601 UTC
  authorLabel: string;
  /** 배포 모듈 ContentItem.id (선택). 채널 초안의 원문 추적용 */
  distributionContentId: string | null;
  updatedAt: string;
}

/** 공개 목록 항목: 내부 검토 정보·출처 검증 상태 제외 */
export interface PublicStorySummary {
  slug: string;
  title: string;
  summary: string;
  publishedAt: string;
  authorLabel: string;
}

/** 공개 상세 */
export interface PublicStory extends PublicStorySummary {
  paragraphs: readonly string[];
  sourceLabels: readonly string[];
  updatedAt: string;
}
