/**
 * OpenAI chat completions 1회 호출(의존성 주입). DRAFT-GEN-001.
 * - fetch는 주입받는다. 이 모듈은 기본 fetch를 쓰지 않는다 → 실제(유료) 호출 경로는 등록되지 않았다.
 * - 키는 Authorization 헤더로만 보낸다(URL·본문·결과·오류에 남기지 않음). 재시도하지 않는다.
 * - timeout·응답 유실도 과금됐을 수 있으므로 자동 재요청하지 않는다.
 */
import type { SecretToken } from "../connections/crypto";
import type { ChatMessage } from "./prompts";
import type { ProviderErrorCode } from "./types";

export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;

export type GenerationHttpDeps = {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

export type ChatResult =
  | { ok: true; content: string; finishReason: string | null }
  | { ok: false; code: ProviderErrorCode; httpStatus: number | null };

export async function requestChatJson(
  http: GenerationHttpDeps,
  input: { apiKey: SecretToken; model: string; messages: ChatMessage[]; maxTokens: number },
): Promise<ChatResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), http.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await http.fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey.reveal()}` },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: input.maxTokens,
        n: 1,
      }),
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    clearTimeout(timer);
    return { ok: false, code: ctrl.signal.aborted ? "timeout" : "network", httpStatus: null };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 200 && res.status < 300) {
    const choice = (body as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> } | null)?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string") return { ok: false, code: "bad_response", httpStatus: res.status };
    return { ok: true, content, finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, code: "auth", httpStatus: res.status };
  if (res.status === 429) return { ok: false, code: "rate_limited", httpStatus: res.status };
  if (res.status >= 500) return { ok: false, code: "http_5xx", httpStatus: res.status };
  return { ok: false, code: "rejected", httpStatus: res.status }; // 공급자 오류 메시지 원문은 버린다
}
