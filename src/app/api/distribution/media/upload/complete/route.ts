/**
 * 미디어 직접 업로드 완료(POST JSON 전용). BE-UPLOAD-025 — docs/contracts/MEDIA_UPLOAD_CONTRACT.md §3.2
 * 작은 요청(grantId·nonce·expectedVersion)만 받는다. 원본은 서버가 intake에서 직접 읽는다.
 */
import { completeResponse, invalidRequest, jsonResponse, readJsonBody } from "@/server/distribution/media/upload-http";
import { getMediaUploadDeps } from "@/server/distribution/media/session";
import { completeUpload } from "@/server/distribution/media/upload";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 20MB 다운로드 + sharp 변환(10초 제한) 여유

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return invalidRequest();
    const b = parsed.body;
    return completeResponse(await completeUpload(getMediaUploadDeps(), { grantId: b.grantId, nonce: b.nonce, expectedVersion: b.expectedVersion }));
  } catch {
    return jsonResponse({ status: "uncertain" });
  }
}
