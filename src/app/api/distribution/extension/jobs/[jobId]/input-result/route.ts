/**
 * POST /api/distribution/extension/jobs/{jobId}/input-result — 확장 입력 단계 기록(AUTOPOST-BLOG-HANDOFF-007).
 * 인계 상태만 기록한다. M2 작업은 바뀌지 않는다(게시 표시·증거는 관리자가 기존 manual 흐름으로).
 */
import { handleInputResult, readSmallJson, toResponse } from "@/server/distribution/blog/handoff";
import { getServiceRpcClient } from "@/server/distribution/blog/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }): Promise<Response> {
  const { jobId } = await context.params;
  const body = await readSmallJson(request);
  return toResponse(await handleInputResult(request.headers.get("authorization"), jobId, body, getServiceRpcClient));
}
