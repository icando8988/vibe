/**
 * POST /api/distribution/extension/task — 확장 작업기가 승인본 인계 1건을 선점한다(AUTOPOST-BLOG-HANDOFF-007).
 * no-store, CORS 헤더 없음. 토큰·해시·본문을 로그에 남기지 않는다.
 */
import { handleClaimTask, toResponse } from "@/server/distribution/blog/handoff";
import { getServiceRpcClient } from "@/server/distribution/blog/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return toResponse(await handleClaimTask(request.headers.get("authorization"), getServiceRpcClient));
}
