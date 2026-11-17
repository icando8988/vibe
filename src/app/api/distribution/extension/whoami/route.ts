/**
 * GET /api/distribution/extension/whoami — 확장 연결 토큰 확인(AUTOPOST-BLOG-TOKEN-005).
 * 최소 상태만 응답, no-store, CORS 헤더 없음. 토큰·해시를 로그·응답에 남기지 않는다.
 * task / heartbeat / input-result는 다음 작업이다(확장 config API_READY=false 유지).
 */
import { getServiceRpcClient } from "@/server/distribution/blog/service";
import { handleWhoami } from "@/server/distribution/blog/whoami";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleWhoami(request, getServiceRpcClient);
}
