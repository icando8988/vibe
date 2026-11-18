/**
 * 채널 텍스트 초안 생성 — 프론트·서버 계약(타입). DRAFT-GEN-001.
 *
 * 경계
 *   - 생성 결과는 **저장되지 않은 제안**이다. 저장은 사람이 기존 appendDraftRevision(리비전 저장)으로,
 *     승인은 기존 decideApproval(사람 체크리스트)로만 한다. 이 모듈은 저장·승인·작업 생성·게시를 하지 않는다.
 *   - 입력은 공용 원문의 **승인된 현재 버전**만 쓴다(렌더된 expectedContentVersionId와 일치해야 함).
 *   - 키트(BUYLIFE) 생성 코드·프롬프트는 가져오지 않았다(권리 결정 미결 — 클린룸 구현). 공급자 종류만 키트와 같다.
 */
import type { ActorResult } from "../actor-core";

type DistributionDenyReason = Extract<ActorResult, { ok: false }>["reason"];
import type { FieldError } from "../validation";

export const GENERATION_CHANNELS = ["blog", "threads", "instagram"] as const;
export type GenerationChannel = (typeof GENERATION_CHANNELS)[number];

/** 생성 공급자. 키트들이 공통으로 지원하는 OpenAI chat completions 하나만 연결한다. */
export const GENERATION_PROVIDERS = ["openai"] as const;
export type GenerationProvider = (typeof GENERATION_PROVIDERS)[number];

/** 프롬프트·출력 규칙 버전(결과에 기록 — 다른 규칙으로 만든 제안을 구분). */
export const GENERATION_PROMPT_VERSION = "vibe-draft-gen-v1";

/** 서버 액션 입력(form 필드 이름). */
export type GenerateDraftForm = {
  contentId: string; // uuid
  channel: GenerationChannel;
  expectedContentVersionId: string; // 화면에 렌더된 현재 원문 버전 id(uuid)
  confirmGenerate: "on"; // 유료 호출 확인(사람이 누른 경우만)
};

/** 채널 공통 제안. body는 그대로 리비전 body 입력란에 넣을 수 있는 텍스트다. */
export type GeneratedDraft = {
  channel: GenerationChannel;
  /** 리비전 body 후보(Instagram은 캡션 + 해시태그 줄을 합친 값) */
  body: string;
  /** Instagram만: 해시태그(‘#’ 포함, 중복 없음). 다른 채널은 빈 배열 */
  hashtags: string[];
  /** 글자 수(코드포인트) */
  length: number;
  /** 사람 검토 시 볼 경고 코드(예: 원문에 링크가 있었으나 채널 초안에서 빠짐) */
  warnings: GenerationWarning[];
  provider: GenerationProvider;
  model: string;
  promptVersion: typeof GENERATION_PROMPT_VERSION;
  /** 생성에 쓴 원문 버전(리비전 저장 시 expectedContentVersionId로 그대로 전달) */
  sourceContentVersionId: string;
  sourceContentHash: string;
  generatedAt: string; // ISO
  /** 항상 true — 저장·승인은 사람이 기존 경계에서 한다 */
  requiresHumanReview: true;
};

export type GenerationWarning = "link_removed" | "hashtags_trimmed";

/** appendDraftRevision에 그대로 넘길 수 있는 필드(초안 id·기대 번호·보존 값은 화면이 기존 상세에서 채운다). */
export type DraftRevisionPrefill = {
  body: string;
  expectedContentVersionId: string;
};

export type ProviderErrorCode = "timeout" | "network" | "rate_limited" | "auth" | "rejected" | "http_5xx" | "bad_response";

export type GenerateDraftOutcome =
  | { status: "ok"; draft: GeneratedDraft; prefill: DraftRevisionPrefill }
  /** 세션 actor·D1 실패(승인된 admin 아님 등) — 공급자·DB 호출 0 */
  | { status: "denied"; reason: DistributionDenyReason }
  | { status: "invalid"; errors: FieldError[] }
  /** 생성 설정 없음(스위치 꺼짐·키 없음·HTTP 미등록) — 공급자 호출 0 */
  | { status: "not_configured"; missing: GenerationConfigMissing[] }
  /** 원문 조회 불가(서비스 연결 없음 포함) */
  | { status: "source_unavailable" }
  | { status: "not_found" }
  /** 원문 보관됨 / 현재 버전 미승인 / 렌더된 버전이 최신이 아님 */
  | { status: "source_not_ready"; reason: "archived" | "not_approved" | "stale" | "empty" }
  /** 공급자 호출 실패. 재시도하지 않는다(timeout도 과금됐을 수 있음) */
  | { status: "provider_error"; code: ProviderErrorCode; httpStatus: number | null }
  /** 사용량 한도(호출 빈도·일일 예산) 초과 — 공급자 호출 0 */
  | { status: "quota_exceeded"; retryAfterSeconds: number | null }
  /** 응답은 받았으나 채널 규칙에 맞지 않음(저장 후보로 쓰지 않음) */
  | { status: "output_invalid"; reasons: OutputInvalidReason[] };

/** rate_limit: 사용량 한도 장치(acquireQuota)가 등록되지 않음 — 등록 전에는 켜지지 않는다 */
export type GenerationConfigMissing = "enabled_flag" | "api_key" | "model" | "http" | "rate_limit";

/** 사용량 한도 확인·차감(공급자 호출 직전 1회). 저장소(DB 등)는 런타임이 정한다. */
export type GenerationQuotaResult = { ok: true } | { ok: false; retryAfterSeconds: number | null };
export type AcquireGenerationQuota = (input: { actorId: string; channel: GenerationChannel; model: string }) => Promise<GenerationQuotaResult>;
export type OutputInvalidReason = "not_json" | "missing_body" | "empty" | "too_long" | "control_chars" | "bad_hashtags" | "finish_length";
