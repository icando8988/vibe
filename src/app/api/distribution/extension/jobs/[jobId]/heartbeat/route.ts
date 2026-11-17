/**
 * POST /api/distribution/extension/jobs/{jobId}/heartbeat — 같은 토큰·run의 인계 리스만 연장(AUTOPOST-BLOG-HANDOFF-007).
 * 409 = superseded(만료·근거 변경·다른 run) → 확장은 입력을 멈춘다.
 */
import { handleHeartbeat, readSmallJson, toResponse } from "@/server/distribution/blog/handoff";
import { getServiceRpcClient } from "@/server/distribution/blog/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }): Promise<Response> {
  const { jobId } = await context.params;
  const body = await readSmallJson(request);
  return toResponse(await handleHeartbeat(request.headers.get("authorization"), jobId, body, getServiceRpcClient));
}
