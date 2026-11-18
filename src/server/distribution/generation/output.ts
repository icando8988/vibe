/**
 * 생성 응답 → 채널 규칙 검사(네트워크 없음). DRAFT-GEN-001.
 * 규칙에 맞지 않으면 저장 후보로 내지 않는다(잘라내기·자동 수정 없음 — 사람이 다시 생성하거나 직접 쓴다).
 */
import { CHANNEL_LIMITS } from "./prompts";
import type { GenerationChannel, GenerationWarning, OutputInvalidReason } from "./types";

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HASHTAG_RE = /^#[^\s#]{1,100}$/u;
const URL_RE = /https?:\/\/\S+/i;

export type ParsedOutput =
  | { ok: true; body: string; hashtags: string[]; warnings: GenerationWarning[] }
  | { ok: false; reasons: OutputInvalidReason[] };

export function parseGeneratedOutput(
  channel: GenerationChannel,
  raw: string,
  ctx: { finishReason: string | null; sourceBody: string },
): ParsedOutput {
  if (ctx.finishReason === "length") return { ok: false, reasons: ["finish_length"] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reasons: ["not_json"] };
  }
  const o = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (!o || typeof o.body !== "string") return { ok: false, reasons: ["missing_body"] };
  const caption = o.body.replace(/\r\n/g, "\n").trim();
  const reasons: OutputInvalidReason[] = [];
  const warnings: GenerationWarning[] = [];
  if (caption.length === 0) reasons.push("empty");
  if (CONTROL_RE.test(caption)) reasons.push("control_chars");

  let hashtags: string[] = [];
  if (channel === "instagram") {
    const list = o.hashtags === undefined ? [] : o.hashtags;
    if (!Array.isArray(list) || !list.every((t) => typeof t === "string" && HASHTAG_RE.test(t.trim()))) {
      reasons.push("bad_hashtags");
    } else {
      const uniq = [...new Set(list.map((t) => (t as string).trim()))];
      if (uniq.length > CHANNEL_LIMITS.instagram.hashtags) warnings.push("hashtags_trimmed");
      hashtags = uniq.slice(0, CHANNEL_LIMITS.instagram.hashtags);
    }
  }
  const body = hashtags.length ? `${caption}\n\n${hashtags.join(" ")}` : caption;
  if ([...body].length > CHANNEL_LIMITS[channel].maxChars) reasons.push("too_long");
  if (reasons.length) return { ok: false, reasons };
  if (URL_RE.test(ctx.sourceBody) && !URL_RE.test(body)) warnings.push("link_removed");
  return { ok: true, body, hashtags, warnings };
}
