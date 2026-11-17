/**
 * 직접 업로드 라우트 요청·응답 조립 — 순수 함수(시험 대상). BE-UPLOAD-025.
 * - POST + application/json + 같은 origin(Origin 헤더 = 요청 origin)만. 본문 4KB 이하(바이트는 이 라우트로 받지 않는다).
 * - 응답: 허용 목록 status + 필요한 필드만, Cache-Control no-store, Referrer-Policy no-referrer(전역 next.config가 덮을 수 있음 — 계약 문서 참고).
 * - 서명 URL은 issued 응답에서만 reveal한다. 다른 응답·로그에는 없다.
 */
import type { CancelResult, CompleteResult, IssueResult } from "./upload";

export const UPLOAD_BODY_MAX_BYTES = 4096;

export async function readJsonBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
  if (request.method !== "POST") return { ok: false };
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(type)) return { ok: false };
  const origin = request.headers.get("origin");
  let selfOrigin: string;
  try {
    selfOrigin = new URL(request.url).origin;
  } catch {
    return { ok: false };
  }
  if (!origin || origin !== selfOrigin) return { ok: false };
  const len = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > UPLOAD_BODY_MAX_BYTES) return { ok: false };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false };
  }
  if (Buffer.byteLength(text, "utf8") > UPLOAD_BODY_MAX_BYTES) return { ok: false };
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, body: v as Record<string, unknown> } : { ok: false };
  } catch {
    return { ok: false };
  }
}

const HTTP: Record<string, number> = {
  issued: 200, ready: 200, cancelled: 200,
  failed: 422, invalid: 400, invalid_request: 400, denied: 401,
  limit: 409, not_uploaded: 409, grant_used: 409, conflict_version: 409,
  grant_expired: 410, grant_cancelled: 410, grant_invalid: 404,
  signing_failed: 502, storage_error: 502,
  not_ready: 503, uncertain: 503, unavailable: 503, error: 500,
};

export function jsonResponse(payload: { status: string } & Record<string, unknown>): Response {
  const h = new Headers();
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  h.set("Referrer-Policy", "no-referrer");
  h.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(payload), { status: HTTP[payload.status] ?? 500, headers: h });
}

export const invalidRequest = () => jsonResponse({ status: "invalid_request" });

export function issueResponse(r: IssueResult): Response {
  switch (r.status) {
    case "issued": {
      const g = r.grant;
      return jsonResponse({
        status: "issued",
        grant: {
          grantId: g.grantId, assetId: g.assetId, rowVersion: g.rowVersion, nonce: g.nonce, grantExpiresAt: g.grantExpiresAt,
          upload: { url: g.upload.url.reveal(), method: g.upload.method, headers: g.upload.headers, storageTokenDocumentedTtlSeconds: g.upload.storageTokenDocumentedTtlSeconds },
        },
      });
    }
    case "limit":
      return jsonResponse({ status: "limit", reason: r.reason });
    case "invalid":
      return jsonResponse({ status: "invalid", field: r.field });
    default:
      return jsonResponse({ status: r.status });
  }
}

export function completeResponse(r: CompleteResult): Response {
  switch (r.status) {
    case "ready":
      return jsonResponse({ status: "ready", asset: r.asset });
    case "failed":
      return jsonResponse({ status: "failed", code: r.code, asset: r.asset });
    case "invalid":
      return jsonResponse({ status: "invalid", field: r.field });
    default:
      return jsonResponse({ status: r.status });
  }
}

export function cancelResponse(r: CancelResult): Response {
  switch (r.status) {
    case "cancelled":
      return jsonResponse({ status: "cancelled", asset: r.asset });
    case "invalid":
      return jsonResponse({ status: "invalid", field: r.field });
    default:
      return jsonResponse({ status: r.status });
  }
}
