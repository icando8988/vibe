/**
 * 글감 후보 수집 1단계 — 프론트·서버 계약(타입). TOPIC-COLLECT-131.
 * 1단계는 관리자가 직접 입력한 메모·출처 링크만 다룬다. 출처 링크는 문자열로만 저장하고 서버는 그 주소로 요청하지 않는다.
 * 원문 변환은 기존 원문 생성(1버전)까지만 — 승인·채널 초안·작업·게시는 만들지 않는다.
 */
import type { ReadOutcome } from "../read";
import type { WriteOutcome } from "../write-runner";

export const TOPIC_STATUSES = ["new", "selected", "converted", "dismissed"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];
/** 사람이 바꿀 수 있는 상태(converted는 변환 액션으로만) */
export const TOPIC_SETTABLE_STATUSES = ["new", "selected", "dismissed"] as const;
export type TopicSettableStatus = (typeof TOPIC_SETTABLE_STATUSES)[number];

export const TOPIC_LIMITS = Object.freeze({ titleMax: 200, memoMax: 5000, sourceNameMax: 100, categoryMax: 50, urlMax: 2048, listMax: 100 });

export type TopicCandidateDto = {
  id: string;
  title: string;
  memo: string;
  /** 참고 주소(저장만 — 서버가 열어 보지 않은 값). 화면은 새 탭 링크로만 보여준다 */
  sourceUrl: string | null;
  sourceName: string | null;
  category: string | null;
  /** 출처가 밝힌 날짜(YYYY-MM-DD, 관리자 입력) */
  sourceDate: string | null;
  status: TopicStatus;
  /** 변환된 원문 id(status=converted일 때만) */
  convertedContentId: string | null;
  convertedAt: string | null;
  collectedBy: string;
  /** 수집 시각(ISO) — 변환·상태 변경으로 바뀌지 않는다 */
  collectedAt: string;
  /** 낙관적 잠금 값 — 상태 변경·변환 폼의 expectedVersion으로 그대로 보낸다 */
  rowVersion: number;
  updatedAt: string;
};

// ---- 입력(form 필드 이름) ----
export type CreateTopicForm = {
  title: string; // 필수, 1~200자
  memo?: string; // 0~5000자
  sourceUrl?: string; // https만, 2048자 이하(저장만)
  sourceName?: string; // 1~100자
  category?: string; // 1~50자
  sourceDate?: string; // YYYY-MM-DD
};
export type SetTopicStatusForm = { candidateId: string; expectedVersion: string; status: TopicSettableStatus };
export type ConvertTopicForm = {
  candidateId: string;
  expectedVersion: string;
  title: string; // 원문 제목(화면이 후보 제목으로 미리 채움)
  body: string; // 원문 본문(화면이 후보 메모로 미리 채움, 사람이 다듬는다)
  targetPath?: string;
  confirmConvert: "on";
};

// ---- 결과 ----
export type TopicCreateResult =
  | { created: true; candidateId: string }
  /** 같은 글감이 이미 있음(새로 만들지 않음). 화면은 기존 후보로 안내 */
  | { created: false; duplicateOf: string; duplicateStatus: TopicStatus };
export type TopicStatusResult = { candidateId: string; status: TopicStatus; rowVersion: number };
export type TopicConvertResult = {
  candidateId: string;
  contentId: string;
  /** true: 이전에 이미 변환됨 — 새 원문을 만들지 않고 같은 원문을 돌려줌 */
  alreadyConverted: boolean;
};

/**
 * 쓰기 결과(기존 WriteOutcome 그대로):
 *   ok | denied(reason) | invalid(errors: FieldError[]) | not_ready | db_error(error.code·token) | bad_response
 * db_error에서 화면이 구분할 토큰: VERSION_CONFLICT(conflict_version) · INVALID_TRANSITION · ALREADY_CONVERTED · DUPLICATE
 */
export type TopicCreateOutcome = WriteOutcome<TopicCreateResult>;
export type TopicStatusOutcome = WriteOutcome<TopicStatusResult>;
export type TopicConvertOutcome = WriteOutcome<TopicConvertResult>;

/** 목록 조회 결과: ok(data) | not_configured | schema_missing(migration 미적용) | error — 0건과 조회 실패를 구분한다. denied는 D1 실패 */
export type TopicListOutcome = ReadOutcome<TopicCandidateDto[]> | { status: "denied"; reason: string };
