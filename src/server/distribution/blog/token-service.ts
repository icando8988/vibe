/**
 * 확장 토큰 발급·목록·철회 — 의존성 주입 순수 함수(테스트 대상). AUTOPOST-BLOG-TOKEN-005.
 * 공통 쓰기 절차(write-runner): 검증된 세션 actor + D1 → 입력 검증 → service 클라이언트(없으면 not_ready) → RPC 1회.
 * 원문 토큰은 RPC에 보내지 않는다(해시만). 성공한 발급 결과에만 원문을 1회 담아 돌려준다.
 */
import { mapDistributionDbError, unavailableError, type MappedDbError } from "../errors";
import type { ActorResult } from "../actor-core";
import { runDistributionWrite, type RpcClient, type WriteOutcome } from "../write-runner";
import { isUuid, type FieldError } from "../validation";
import { generateExtensionToken, hashExtensionToken, parseTokenLabel, parseTokenTtl, type TokenTtlDays } from "./token";
import type { DistributionDenyReason } from "@/components/distribution-console/access";

export const TOKEN_RPC = Object.freeze({
  issue: "distribution_issue_extension_token",
  list: "distribution_list_extension_tokens",
  revoke: "distribution_revoke_extension_token",
  authenticate: "distribution_authenticate_extension_token",
} as const);

export type Deps = {
  resolveActor: () => Promise<ActorResult>;
  getClient: () => RpcClient | null;
  generate?: () => string;
};

// ---------------------------------------------------------------- 발급
export type IssuedToken = { id: string; label: string; createdAt: string; expiresAt: string; token: string };

export async function issueExtensionToken(
  deps: Deps,
  form: { label: unknown; ttlDays: unknown },
): Promise<WriteOutcome<IssuedToken>> {
  let token = "";
  const outcome = await runDistributionWrite<{ label: string; ttlDays: TokenTtlDays; hash: string }, Omit<IssuedToken, "token">>({
    resolveActor: deps.resolveActor,
    validate: () => {
      const errors: FieldError[] = [];
      const label = parseTokenLabel(form.label);
      const ttlDays = parseTokenTtl(form.ttlDays);
      if (label === null) errors.push({ field: "label", rule: "label" });
      if (ttlDays === null) errors.push({ field: "ttlDays", rule: "ttl" });
      if (errors.length || label === null || ttlDays === null) return { ok: false, errors };
      // D1 통과·입력 검증 뒤에만 만든다. RPC에는 해시만 간다.
      token = (deps.generate ?? generateExtensionToken)();
      return { ok: true, value: { label, ttlDays, hash: hashExtensionToken(token) } };
    },
    getClient: deps.getClient,
    fn: TOKEN_RPC.issue,
    params: (actorId, input) => ({ p_actor_id: actorId, p_token_hash: input.hash, p_label: input.label, p_ttl_days: input.ttlDays }),
    parse: parseIssued,
  });
  if (outcome.status !== "ok") return outcome;
  return { status: "ok", data: { ...outcome.data, token } };
}

function parseIssued(data: unknown): Omit<IssuedToken, "token"> | null {
  const d = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (!d || !isUuid(d.id) || typeof d.label !== "string" || typeof d.created_at !== "string" || typeof d.expires_at !== "string") return null;
  return { id: d.id, label: d.label, createdAt: d.created_at, expiresAt: d.expires_at };
}

// ---------------------------------------------------------------- 목록
export type TokenState = "active" | "expired" | "revoked";
export type TokenSummary = {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  state: TokenState;
};

export type ListOutcome =
  | { status: "ok"; tokens: TokenSummary[] }
  | { status: "denied"; reason: DistributionDenyReason }
  | { status: "not_ready" }
  | { status: "db_error"; error: MappedDbError }
  | { status: "bad_response" };

export async function listExtensionTokens(deps: Deps, now: Date = new Date()): Promise<ListOutcome> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return { status: "denied", reason: actor.reason };
  const client = deps.getClient();
  if (!client) return { status: "not_ready" };
  let res;
  try {
    res = await client.rpc(TOKEN_RPC.list, { p_actor_id: actor.actorId });
  } catch {
    return { status: "db_error", error: unavailableError() };
  }
  if (res.error) return { status: "db_error", error: mapDistributionDbError(res.error) };
  if (!Array.isArray(res.data)) return { status: "bad_response" };
  const tokens: TokenSummary[] = [];
  for (const row of res.data) {
    const t = parseSummary(row, now);
    if (!t) return { status: "bad_response" };
    tokens.push(t);
  }
  return { status: "ok", tokens };
}

function parseSummary(row: unknown, now: Date): TokenSummary | null {
  const r = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
  if (!r || !isUuid(r.id) || typeof r.label !== "string" || typeof r.created_at !== "string" || typeof r.expires_at !== "string") return null;
  const lastUsedAt = typeof r.last_used_at === "string" ? r.last_used_at : null;
  const revokedAt = typeof r.revoked_at === "string" ? r.revoked_at : null;
  // 해시 등 예상 밖 열이 오면 거부(목록에 해시가 섞이지 않게)
  const allowed = new Set(["id", "label", "created_at", "expires_at", "last_used_at", "revoked_at"]);
  if (Object.keys(r).some((k) => !allowed.has(k))) return null;
  const state: TokenState = revokedAt ? "revoked" : Date.parse(r.expires_at) <= now.getTime() ? "expired" : "active";
  return { id: r.id, label: r.label, createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt, revokedAt, state };
}

// ---------------------------------------------------------------- 철회
export async function revokeExtensionToken(deps: Deps, form: { tokenId: unknown }): Promise<WriteOutcome<{ id: string }>> {
  return runDistributionWrite<string, { id: string }>({
    resolveActor: deps.resolveActor,
    validate: () => (isUuid(form.tokenId) ? { ok: true, value: form.tokenId } : { ok: false, errors: [{ field: "tokenId", rule: "uuid" }] }),
    getClient: deps.getClient,
    fn: TOKEN_RPC.revoke,
    params: (actorId, tokenId) => ({ p_actor_id: actorId, p_token_id: tokenId }),
    parse: (data) => {
      const d = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
      return d && isUuid(d.id) ? { id: d.id } : null;
    },
  });
}

/** 발급·철회 실패를 화면 안내 코드로. TOKEN_LIMIT는 공통 매핑에 없어 여기서 먼저 본다. */
export type TokenNotice =
  | "issued"
  | "revoked"
  | "denied"
  | "invalid"
  | "not_ready"
  | "token_limit"
  | "already_revoked"
  | "not_found"
  | "uncertain"
  | "failed";

/**
 * 결과 → 안내 코드. UX-FIX-008(BC-03):
 * - RPC를 보낸 뒤 응답을 못 받았거나(unavailable) 성공 응답 형식이 틀리면(bad_response) DB에서 처리됐는지 알 수 없다
 *   → "uncertain"(확인 필요). 실패로 단정하거나 자동 재시도하지 않는다.
 * - DB가 오류로 응답한 경우(RPC 트랜잭션 롤백)와 RPC 전 거절(권한·입력·준비 전)은 확정 실패.
 */
export function tokenNoticeOf(outcome: WriteOutcome<unknown>, success: "issued" | "revoked"): TokenNotice {
  switch (outcome.status) {
    case "ok":
      return success;
    case "denied":
      return "denied";
    case "invalid":
      return "invalid";
    case "not_ready":
      return "not_ready";
    case "bad_response":
      return "uncertain";
    case "db_error": {
      // R010-03A: 처리되지 않았음을 확정할 수 있는 DB 거절만 whitelist로 분류한다(함수가 예외로 끝나 트랜잭션이 롤백된 알려진 경로).
      // 식별하지 못한 오류·응답 유실은 처리 여부를 단정하지 않고 uncertain.
      const e = outcome.error;
      if (e.token === "TOKEN_LIMIT") return "token_limit";
      if (e.token === "DUPLICATE" && e.sqlstate === "23505") return "failed"; // 해시 중복: 행이 만들어지지 않음
      if (e.code === "already_revoked") return "already_revoked";
      if (e.code === "not_found" && e.sqlstate === "P0002") return "not_found";
      if (e.code === "forbidden" && e.sqlstate === "42501") return "denied";
      if (e.code === "invalid_input" && e.sqlstate === "22023") return "invalid";
      return "uncertain";
    }
  }
}

/** 확정 실패(다시 시도해도 같은 결과이거나 아무것도 기록되지 않음)인가. uncertain은 아니다. */
export function isDefiniteFailure(notice: TokenNotice): boolean {
  return notice !== "issued" && notice !== "revoked" && notice !== "uncertain";
}
