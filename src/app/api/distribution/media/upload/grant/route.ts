/**
 * 미디어 직접 업로드 grant 발급(POST JSON 전용). BE-UPLOAD-025 — docs/contracts/MEDIA_UPLOAD_CONTRACT.md §3.1
 * 바이트는 받지 않는다(메타데이터만). 서명 업로드 URL은 이 응답 본문에만 담긴다.
 */
import { readJsonBody, invalidRequest, issueResponse, jsonResponse } from "@/server/distribution/media/upload-http";
import { getMediaUploadDeps } from "@/server/distribution/media/session";
import { issueUploadGrant } from "@/server/distribution/media/upload";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return invalidRequest();
    const b = parsed.body;
    return issueResponse(await issueUploadGrant(getMediaUploadDeps(), { source: b.source, sourceNote: b.sourceNote, contentType: b.contentType, byteSize: b.byteSize }));
  } catch {
    return jsonResponse({ status: "uncertain" }); // grant가 기록됐을 수 있음 — 자동 재요청 금지
  }
}
