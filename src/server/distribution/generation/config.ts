/**
 * 초안 생성 설정(서버 전용 env 이름). DRAFT-GEN-001.
 * 값을 읽는 곳은 호출자(서버 런타임)다. 이 함수는 넘겨받은 레코드만 판정하고 키를 SecretToken으로 감싼다.
 * 기본 닫힘: 스위치가 정확히 "true"가 아니거나 키가 없으면 not_configured(공급자 호출 0).
 *
 * env 이름(문서화된 서버 전용 — NEXT_PUBLIC_ 아님):
 *   DISTRIBUTION_AI_GENERATION_ENABLED = "true"   유료 호출 허용 스위치
 *   DISTRIBUTION_OPENAI_API_KEY        = <키>      OpenAI 키(운영자 1개. 키트의 회원별 BYOK 저장은 쓰지 않음)
 *   DISTRIBUTION_AI_MODEL              = 모델명    선택. 기본 gpt-4o-mini(Threads·Instagram 키트 기본값과 같음)
 */
import { SecretToken } from "../connections/crypto";
import type { GenerationConfigMissing } from "./types";

export const GENERATION_ENV = Object.freeze({
  enabled: "DISTRIBUTION_AI_GENERATION_ENABLED",
  apiKey: "DISTRIBUTION_OPENAI_API_KEY",
  model: "DISTRIBUTION_AI_MODEL",
} as const);

export const DEFAULT_GENERATION_MODEL = "gpt-4o-mini";
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const KEY_RE = /^[\x21-\x7e]{20,512}$/;

export type GenerationConfig = { provider: "openai"; model: string; apiKey: SecretToken };
export type GenerationConfigResult = { status: "ok"; config: GenerationConfig } | { status: "not_configured"; missing: GenerationConfigMissing[] };

export function loadGenerationConfig(env: Readonly<Record<string, string | undefined>>): GenerationConfigResult {
  const missing: GenerationConfigMissing[] = [];
  if (env[GENERATION_ENV.enabled] !== "true") missing.push("enabled_flag");
  const key = env[GENERATION_ENV.apiKey];
  if (typeof key !== "string" || !KEY_RE.test(key)) missing.push("api_key");
  const rawModel = env[GENERATION_ENV.model];
  const model = rawModel === undefined || rawModel === "" ? DEFAULT_GENERATION_MODEL : rawModel;
  if (!MODEL_RE.test(model)) missing.push("model");
  if (missing.length) return { status: "not_configured", missing };
  return { status: "ok", config: { provider: "openai", model, apiKey: new SecretToken(key as string) } };
}
