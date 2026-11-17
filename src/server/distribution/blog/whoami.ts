/**
 * GET /api/distribution/extension/whoami 처리 — 순수 함수(테스트 대상). AUTOPOST-BLOG-TOKEN-005.
 * - 응답은 최소 상태만: 연결 확인 여부. 이메일·사용자·토큰·해시를 담지 않는다.
 * - Cache-Control no-store, CORS 헤더 없음(와일드카드 금지 — 확장은 host_permissions로 호출한다).
 */
import type { RpcClient } from "../write-runner";
import { authenticateExtensionRequest } from "./extension-auth";

const BASE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization",
} as const;

function json(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });
}

export async function handleWhoami(request: Request, getClient: () => RpcClient | null): Promise<Response> {
  const auth = await authenticateExtensionRequest(request.headers.get("authorization"), getClient);
  if (auth.ok) return json(200, { ok: true, connected: true });
  if (auth.status === 503) return json(503, { ok: false, error: "not_ready" });
  return json(401, { ok: false, error: "unauthorized" }, { "WWW-Authenticate": 'Bearer realm="distribution-extension"' });
}
