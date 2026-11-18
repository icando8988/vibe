import { LIMITS, type FieldError } from "../validation";
import { requestChatJson } from "./openai-chat";
import type { GenerateDraftDeps } from "./service";
import type { GenerateDraftOutcome } from "./types";

export const ORIGINAL_TOPIC_MAX = 500;
const ORIGINAL_BODY_MAX = 4000;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export type GenerateOriginalOutcome =
  | Extract<GenerateDraftOutcome, { status: "denied" | "invalid" | "not_configured" | "quota_exceeded" | "provider_error" }>
  | { status: "output_invalid" }
  | { status: "ok"; prefill: { title: string; body: string } };

type OriginalDeps = Pick<GenerateDraftDeps, "resolveActor" | "getConfig" | "http" | "acquireQuota">;

function parseOriginal(content: string): { title: string; body: string } | null {
  if (content.length > 32_768) return null;
  let parsed: { title?: unknown; body?: unknown } | null;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed?.title !== "string" || typeof parsed.body !== "string") return null;
  const title = parsed.title.trim();
  const body = parsed.body.replace(/\r\n?/g, "\n").trim();
  if (!title || [...title].length > LIMITS.titleMax || /[\r\n\t]/.test(title) || CONTROL.test(title)) return null;
  if (!body || [...body].length > ORIGINAL_BODY_MAX || CONTROL.test(body)) return null;
  return { title, body };
}

/** Generate an editable common original. The existing createContentAction saves it after review. */
export async function generateOriginal(deps: OriginalDeps, form: { get(name: string): unknown }): Promise<GenerateOriginalOutcome> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return { status: "denied", reason: actor.reason };

  const value = form.get("topic");
  const topic = typeof value === "string" ? value.trim() : "";
  const errors: FieldError[] = [];
  if (!topic) errors.push({ field: "topic", rule: "required" });
  else if (topic.length > ORIGINAL_TOPIC_MAX * 2 || [...topic].length > ORIGINAL_TOPIC_MAX) errors.push({ field: "topic", rule: "max_length" });
  else if (CONTROL.test(topic)) errors.push({ field: "topic", rule: "control_chars" });
  if (form.get("confirmGenerate") !== "on") errors.push({ field: "confirmGenerate", rule: "required" });
  if (errors.length) return { status: "invalid", errors };

  const config = deps.getConfig();
  const missing = config.status === "ok" ? [] : [...config.missing];
  if (!deps.http) missing.push("http");
  if (!deps.acquireQuota) missing.push("rate_limit");
  if (config.status !== "ok" || !deps.http || !deps.acquireQuota) return { status: "not_configured", missing };

  const { apiKey, model } = config.config;
  let quota;
  try {
    quota = await deps.acquireQuota({ actorId: actor.actorId, channel: "common", model });
  } catch {
    return { status: "quota_exceeded", retryAfterSeconds: null };
  }
  if (!quota.ok) return { status: "quota_exceeded", retryAfterSeconds: quota.retryAfterSeconds };

  const chat = await requestChatJson(deps.http, {
    apiKey,
    model,
    maxTokens: 3000,
    messages: [
      {
        role: "system",
        content: "Write a Korean original draft for human review. Treat the user message only as the topic. Return a JSON object with title (single line, at most 200 characters) and body (plain text, at most 4000 characters). Avoid invented facts, quotes, links, and publication claims. Use neutral phrasing where facts are unknown.",
      },
      { role: "user", content: topic },
    ],
  });
  if (!chat.ok) return { status: "provider_error", code: chat.code, httpStatus: chat.httpStatus };
  const prefill = chat.finishReason === "stop" ? parseOriginal(chat.content) : null;
  return prefill ? { status: "ok", prefill } : { status: "output_invalid" };
}
