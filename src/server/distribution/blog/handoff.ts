/**
 * 확장 승인본 인계 — task / heartbeat / input-result 처리(의존성 주입 순수 함수, 테스트 대상). AUTOPOST-BLOG-HANDOFF-007.
 * 원본 계약(Blog_Posting_Kit_v1.07 app/api/extension/*)의 응답 형식을 유지하되, 판정은 080000 RPC가 한다:
 *   - 매 요청 토큰 해시 → 060000 인증(철회·만료·소유자 D1). 실패 = 401.
 *   - task: 토큰 소유자가 요청한 manual_ready blog 작업 1건을 SKIP LOCKED로 선점(최신성·승인·보관 재검사).
 *     내용 = 승인 원문 버전 title + 승인 리비전 body. 응답에 토큰·해시·사용자 ID 없음.
 *   - heartbeat: 같은 토큰·run만 연장. 만료·근거 변경은 409(superseded) → 확장이 입력을 멈춘다.
 *   - input-result: 상태 기록만. M2 작업은 바뀌지 않는다(published·awaiting_evidence 자동 전이 없음).
 * 로그·응답에 토큰, 해시, 본문, DB 오류 원문을 넣지 않는다.
 */
import { extractToken } from "../errors";
import { isUuid } from "../validation";
import type { RpcClient } from "../write-runner";
import { buildBlogExtensionTask } from "../blog-task";
import { hashExtensionToken, parseBearerToken } from "./token";

export const HANDOFF_RPC = Object.freeze({
  request: "distribution_request_extension_handoff",
  claim: "distribution_claim_extension_handoff",
  heartbeat: "distribution_heartbeat_extension_handoff",
  input: "distribution_record_extension_input",
} as const);

export const INPUT_STATUSES = ["in_progress", "completed", "publish_ready", "failed"] as const;
export type InputStatus = (typeof INPUT_STATUSES)[number];

export type HttpResult = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown>): HttpResult => ({ status: 200, body });
const err = (status: number, error: string, extra: Record<string, unknown> = {}): HttpResult => ({ status, body: { ok: false, error, ...extra } });

/** RPC 오류 → HTTP. 원문 메시지는 버린다. */
function fromDbError(e: unknown): HttpResult {
  const o = (e && typeof e === "object" ? e : {}) as { code?: unknown; message?: unknown };
  const token = extractToken(o.message);
  const code = typeof o.code === "string" ? o.code : "";
  if (token === "UNAUTHENTICATED" || code === "28000") return err(401, "unauthorized");
  if (token === "SUPERSEDED") return err(409, "superseded", { superseded: true });
  if (code === "P0002") return err(404, "not_found");
  if (code === "22023") return err(400, "invalid_input");
  return err(503, "unavailable");
}

type Prepared = { ok: true; hash: string; client: RpcClient } | { ok: false; result: HttpResult };

function prepare(authorization: string | null, getClient: () => RpcClient | null): Prepared {
  const token = parseBearerToken(authorization);
  if (!token) return { ok: false, result: err(401, "unauthorized") }; // 형식 불일치: 조회 없음
  const client = getClient();
  if (!client) return { ok: false, result: err(503, "not_ready") };
  return { ok: true, hash: hashExtensionToken(token), client };
}

async function call(client: RpcClient, fn: string, params: Record<string, unknown>): Promise<{ data: unknown } | { failure: HttpResult }> {
  try {
    const res = await client.rpc(fn, params);
    if (res.error) return { failure: fromDbError(res.error) };
    return { data: res.data };
  } catch {
    return { failure: err(503, "unavailable") };
  }
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// ---------------------------------------------------------------- task
export const LEASE_SECONDS = 180;

export async function handleClaimTask(authorization: string | null, getClient: () => RpcClient | null): Promise<HttpResult> {
  const p = prepare(authorization, getClient);
  if (!p.ok) return p.result;
  const r = await call(p.client, HANDOFF_RPC.claim, { p_token_hash: p.hash });
  if ("failure" in r) return r.failure;
  if (r.data === null || r.data === undefined) return ok({ task: null });
  const d = obj(r.data);
  if (!d || !isUuid(d.job_id) || !isUuid(d.run_id) || typeof d.title !== "string" || typeof d.body !== "string") {
    return err(503, "unavailable");
  }
  // SQL이 manual_ready·blog·승인·최신성을 방금 확인했다. 확장 블록 형식으로만 바꾼다.
  const built = buildBlogExtensionTask({
    jobId: d.job_id,
    runId: d.run_id,
    jobMode: "manual",
    jobStatus: "manual_ready",
    channel: "blog",
    contentVersion: { title: d.title, approved: true },
    revision: { body: d.body, approved: true, channel: "blog" },
  });
  if (!built.ok) {
    // 이미 선점됐으므로 실패로 기록해 둔다(재인계·자동 재입력 없음).
    await call(p.client, HANDOFF_RPC.input, {
      p_token_hash: p.hash,
      p_job_id: d.job_id,
      p_run_id: d.run_id,
      p_status: "failed",
      p_code: built.problem.toUpperCase(),
    });
    return ok({ task: null });
  }
  return ok({
    task: {
      ...built.task,
      leaseSeconds: typeof d.lease_seconds === "number" ? d.lease_seconds : LEASE_SECONDS,
      category: null,
    },
  });
}

// ---------------------------------------------------------------- heartbeat
export async function handleHeartbeat(
  authorization: string | null,
  jobId: string,
  body: unknown,
  getClient: () => RpcClient | null,
): Promise<HttpResult> {
  const p = prepare(authorization, getClient);
  if (!p.ok) return p.result;
  const runId = obj(body)?.runId;
  if (!isUuid(jobId) || !isUuid(runId)) return err(400, "invalid_input");
  const r = await call(p.client, HANDOFF_RPC.heartbeat, { p_token_hash: p.hash, p_job_id: jobId, p_run_id: runId });
  if ("failure" in r) return r.failure;
  const d = obj(r.data);
  if (d?.ok === true) return ok({ ok: true, leaseSeconds: typeof d.lease_seconds === "number" ? d.lease_seconds : LEASE_SECONDS });
  if (d?.superseded === true) return err(409, "superseded", { superseded: true });
  return err(503, "unavailable");
}

// ---------------------------------------------------------------- input-result
/** 확장 오류 문장에서 `[CODE]` 접두어만 뽑는다. 문장 자체는 저장·전송하지 않는다. */
export function extractErrorCode(error: unknown): string | null {
  if (typeof error !== "string") return null;
  const m = /^\[([A-Z][A-Z0-9_]{0,39})\]/.exec(error.trim());
  return m ? (m[1] ?? null) : null;
}

export async function handleInputResult(
  authorization: string | null,
  jobId: string,
  body: unknown,
  getClient: () => RpcClient | null,
): Promise<HttpResult> {
  const p = prepare(authorization, getClient);
  if (!p.ok) return p.result;
  const b = obj(body);
  const status = b?.status;
  const runId = b?.runId;
  if (!isUuid(jobId) || !isUuid(runId) || typeof status !== "string" || !(INPUT_STATUSES as readonly string[]).includes(status)) {
    return err(400, "invalid_input");
  }
  const r = await call(p.client, HANDOFF_RPC.input, {
    p_token_hash: p.hash,
    p_job_id: jobId,
    p_run_id: runId,
    p_status: status,
    p_code: status === "failed" ? extractErrorCode(b?.error) : null,
  });
  if ("failure" in r) return r.failure;
  const d = obj(r.data);
  if (d?.success === true && d.persisted === true && d.status === status) {
    return ok({ success: true, persisted: true, status, unchanged: d.unchanged === true });
  }
  if (d?.superseded === true) return err(409, "superseded", { superseded: true });
  return err(503, "unavailable");
}

/** 요청 본문: 4KB 이하 JSON만. 그 밖에는 null. */
export async function readSmallJson(request: Request): Promise<unknown> {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > 4096) return null;
  try {
    const text = await request.text();
    if (text.length > 4096) return null;
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** HTTP 응답: no-store, CORS 헤더 없음. */
export function toResponse(r: HttpResult): Response {
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      Vary: "Authorization",
      ...(r.status === 401 ? { "WWW-Authenticate": 'Bearer realm="distribution-extension"' } : {}),
    },
  });
}
