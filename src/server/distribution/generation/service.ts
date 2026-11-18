/**
 * 공용 원문 → 선택 채널 텍스트 초안 생성(서버, 의존성 주입). DRAFT-GEN-001.
 *
 * 순서(앞 단계에서 막히면 뒤 단계 호출 0):
 *   1) 세션 actor + D1(승인된 admin) — 기존 resolveActor
 *   2) 입력 검증(contentId·channel·렌더된 expectedContentVersionId·confirmGenerate)
 *   3) 생성 설정(스위치·키·모델)과 HTTP 의존성 — 없으면 not_configured
 *   4) 원문 조회(기존 getContentDetail, 세션 RLS) — 보관·현재 버전 미승인·렌더 버전 불일치면 source_not_ready
 *   5) 사용량 한도 차감(없으면 3단계에서 not_configured, 초과·오류면 quota_exceeded) → 공급자 1회 호출(재시도 없음) → 채널 규칙 검사
 *   6) 저장하지 않은 제안 + appendDraftRevision 입력 후보 반환
 * 저장·승인·작업 생성·게시는 하지 않는다. 키는 결과·오류에 싣지 않는다.
 */
import type { ActorResult } from "../actor-core";
import { getContentDetail, type ReadSource } from "../read";
import { isUuid, type FieldError } from "../validation";
import type { GenerationConfigResult } from "./config";
import { requestChatJson, type GenerationHttpDeps } from "./openai-chat";
import { parseGeneratedOutput } from "./output";
import { buildMessages, CHANNEL_LIMITS } from "./prompts";
import { GENERATION_CHANNELS, GENERATION_PROMPT_VERSION, type AcquireGenerationQuota, type GenerateDraftOutcome, type GenerationChannel } from "./types";

export type GenerateDraftDeps = {
  resolveActor: () => Promise<ActorResult>;
  /** 세션(RLS) 읽기. 설정 확인을 통과한 뒤에만 부른다 */
  getReadSource: () => ReadSource | null | Promise<ReadSource | null>;
  getConfig: () => GenerationConfigResult;
  /** 실제 fetch 등록은 이 작업 범위 밖 — null이면 not_configured("http") */
  http: GenerationHttpDeps | null;
  /** 사용량 한도. null이면 not_configured("rate_limit") — 한도 없이 유료 호출을 켜지 않는다 */
  acquireQuota: AcquireGenerationQuota | null;
  now?: () => Date;
};

type Form = { get(name: string): unknown };

/** 원문 길이 상한(생성 입력). 리비전 body 상한보다 작게 — 과금·지연 상한. */
export const GENERATION_SOURCE_MAX = 30_000;

function maxTokensFor(channel: GenerationChannel): number {
  // 한국어 1자 ≈ 1~2 토큰 가정의 넉넉한 상한(JSON 포장 포함). 출력 길이는 output 검사로 다시 막는다.
  return Math.min(16_000, CHANNEL_LIMITS[channel].maxChars * 2 + 256);
}

export async function generateChannelDraft(deps: GenerateDraftDeps, form: Form): Promise<GenerateDraftOutcome> {
  // 1) actor
  const actor = await deps.resolveActor();
  if (!actor.ok) return { status: "denied", reason: actor.reason };

  // 2) 입력
  const contentId = form.get("contentId");
  const channel = form.get("channel");
  const expectedVersion = form.get("expectedContentVersionId");
  const errors: FieldError[] = [];
  if (!isUuid(contentId)) errors.push({ field: "contentId", rule: "uuid" });
  if (typeof channel !== "string" || !(GENERATION_CHANNELS as readonly string[]).includes(channel)) errors.push({ field: "channel", rule: "channel" });
  if (!isUuid(expectedVersion)) errors.push({ field: "expectedContentVersionId", rule: "uuid" });
  if (form.get("confirmGenerate") !== "on") errors.push({ field: "confirmGenerate", rule: "required" });
  if (errors.length || !isUuid(contentId) || !isUuid(expectedVersion)) return { status: "invalid", errors };
  const ch = channel as GenerationChannel;

  // 3) 설정
  const cfg = deps.getConfig();
  const missing = cfg.status === "ok" ? [] : [...cfg.missing];
  if (!deps.http) missing.push("http");
  if (!deps.acquireQuota) missing.push("rate_limit");
  if (cfg.status !== "ok" || missing.length) return { status: "not_configured", missing };
  const http = deps.http as GenerationHttpDeps;
  const acquireQuota = deps.acquireQuota as AcquireGenerationQuota;

  // 4) 원문(승인된 현재 버전만)
  let src: ReadSource | null;
  try {
    src = await deps.getReadSource();
  } catch {
    return { status: "source_unavailable" };
  }
  const detail = await getContentDetail(src, contentId);
  if (detail.status !== "ok") return { status: "source_unavailable" };
  if (!detail.data) return { status: "not_found" };
  const d = detail.data;
  if (d.archived) return { status: "source_not_ready", reason: "archived" };
  const current = d.current;
  if (!current || current.id !== expectedVersion) return { status: "source_not_ready", reason: "stale" };
  if (d.contentApproval.state !== "approved" || d.contentApproval.subjectHash !== current.contentHash) {
    return { status: "source_not_ready", reason: "not_approved" };
  }
  if (current.body.trim().length === 0 || [...current.body].length > GENERATION_SOURCE_MAX) return { status: "source_not_ready", reason: "empty" };

  // 5) 사용량 한도(호출 직전 1회 차감) → 공급자 1회
  let quota;
  try {
    quota = await acquireQuota({ actorId: actor.actorId, channel: ch, model: cfg.config.model });
  } catch {
    quota = { ok: false as const, retryAfterSeconds: null };
  }
  if (!quota.ok) return { status: "quota_exceeded", retryAfterSeconds: quota.retryAfterSeconds };
  const chat = await requestChatJson(http, {
    apiKey: cfg.config.apiKey,
    model: cfg.config.model,
    messages: buildMessages(ch, { title: current.title, body: current.body }),
    maxTokens: maxTokensFor(ch),
  });
  if (!chat.ok) return { status: "provider_error", code: chat.code, httpStatus: chat.httpStatus };
  const parsed = parseGeneratedOutput(ch, chat.content, { finishReason: chat.finishReason, sourceBody: current.body });
  if (!parsed.ok) return { status: "output_invalid", reasons: parsed.reasons };

  // 6) 저장하지 않은 제안
  const body = parsed.body;
  return {
    status: "ok",
    draft: {
      channel: ch,
      body,
      hashtags: parsed.hashtags,
      length: [...body].length,
      warnings: parsed.warnings,
      provider: cfg.config.provider,
      model: cfg.config.model,
      promptVersion: GENERATION_PROMPT_VERSION,
      sourceContentVersionId: current.id,
      sourceContentHash: current.contentHash,
      generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
      requiresHumanReview: true,
    },
    prefill: { body, expectedContentVersionId: current.id },
  };
}
