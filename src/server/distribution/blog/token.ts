/**
 * Blog 확장 연결 토큰 — 순수 규칙(테스트 대상). AUTOPOST-BLOG-TOKEN-005.
 * 참고: 원본 Blog_Posting_Kit_v1.07 utils/extensionAuth.ts(`pat_` + 해시 저장). 원본 코드를 옮기지 않고 다시 작성했다.
 * - 토큰 = `pat_` + CSPRNG 32바이트 hex(64자). 원문은 발급 응답에 1회만 보이고 저장하지 않는다.
 * - DB에는 sha256 hex만 간다(060000 distribution_extension_tokens.token_hash).
 */
import { createHash, randomBytes } from "node:crypto";

export const TOKEN_PREFIX = "pat_";
export const TOKEN_RE = /^pat_[0-9a-f]{64}$/;
export const TOKEN_TTL_DAYS = [30, 90, 180] as const;
export type TokenTtlDays = (typeof TOKEN_TTL_DAYS)[number];

export function generateExtensionToken(random: (size: number) => Uint8Array = randomBytes): string {
  const bytes = random(32);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error("token entropy source returned wrong size");
  return `${TOKEN_PREFIX}${Buffer.from(bytes).toString("hex")}`;
}

export function hashExtensionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** `Authorization: Bearer pat_…`만 받는다. 형식이 다르면 null(서버 조회 없이 401). */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const m = /^Bearer ([^\s]+)$/.exec(header.trim());
  if (!m) return null;
  const token = m[1] ?? "";
  return TOKEN_RE.test(token) ? token : null;
}

/** 060000 label 제약: 1~60자, 공백만 금지, 제어문자 금지. 다듬지 않고 그대로 저장. */
export function parseTokenLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const len = [...v].length;
  if (len < 1 || len > 60 || v.trim().length === 0 || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return null;
  return v;
}

export function parseTokenTtl(v: unknown): TokenTtlDays | null {
  const n = typeof v === "string" && /^\d{1,3}$/.test(v) ? Number(v) : NaN;
  return (TOKEN_TTL_DAYS as readonly number[]).includes(n) ? (n as TokenTtlDays) : null;
}
