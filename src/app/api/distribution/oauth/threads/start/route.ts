/**
 * Threads 연결 시작(POST 전용 — GET은 405). AUTOPOST-THREADS-OAUTH-019.
 * 세션 actor + D1 + 서버 설정 준비 + 같은 사이트 Origin일 때만 state를 등록하고 공급자 인증 창으로 보낸다.
 * 재연결이면 폼의 connectionId·expectedVersion(화면에 렌더된 값)을 함께 묶는다.
 */
import { startThreadsConnect } from "@/server/distribution/threads/oauth/flow";
import { authorizeResponse, resultResponse, sameSiteOrigin } from "@/server/distribution/threads/oauth/http";
import { getThreadsOAuthDeps } from "@/server/distribution/threads/oauth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const deps = getThreadsOAuthDeps();
    const cfg = deps.getConfig();
    if (cfg.status === "ok" && !sameSiteOrigin(request.headers.get("origin"), cfg.config.siteOrigin)) return resultResponse("invalid_request");
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return resultResponse("invalid_request");
    }
    const out = await startThreadsConnect(deps, {
      connectionId: form.get("connectionId") ?? undefined,
      expectedVersion: form.get("expectedVersion") ?? undefined,
    });
    if (out.kind === "result") return resultResponse(out.result);
    return authorizeResponse(out.url, out.cookieValue, out.maxAgeSeconds);
  } catch {
    return resultResponse("unexpected");
  }
}
