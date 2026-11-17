/**
 * 미디어 직접 업로드 취소(POST JSON 전용). BE-UPLOAD-025 — docs/contracts/MEDIA_UPLOAD_CONTRACT.md §3.3
 * 발급된 Storage 서명 업로드 토큰은 무효화되지 않는다(공식 문서: 개별 철회 불가).
 */
import { cancelResponse, invalidRequest, jsonResponse, readJsonBody } from "@/server/distribution/media/upload-http";
import { getMediaUploadDeps } from "@/server/distribution/media/session";
import { cancelUpload } from "@/server/distribution/media/upload";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return invalidRequest();
    const b = parsed.body;
    return cancelResponse(await cancelUpload(getMediaUploadDeps(), { grantId: b.grantId, nonce: b.nonce }));
  } catch {
    return jsonResponse({ status: "uncertain" });
  }
}
