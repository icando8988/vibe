/**
 * Threads OAuth callback(GET, 공급자가 돌려보냄). AUTOPOST-THREADS-OAUTH-019.
 * 세션 actor + D1 → 쿠키 state = 쿼리 state → DB state 1회 소비 → code 1회 교환 → 장기 토큰 → M3 암호화 저장.
 * 결과는 허용 목록 코드로만 연결 화면에 돌려보내고, state 쿠키는 항상 지운다. 자동 재요청 없음.
 */
import type { NextRequest } from "next/server";
import { handleThreadsCallback } from "@/server/distribution/threads/oauth/flow";
import { resultResponse } from "@/server/distribution/threads/oauth/http";
import { getThreadsOAuthDeps } from "@/server/distribution/threads/oauth/session";
import { OAUTH_STATE_COOKIE } from "@/server/distribution/threads/oauth/state";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const q = request.nextUrl.searchParams;
    const result = await handleThreadsCallback(getThreadsOAuthDeps(), {
      state: q.get("state"),
      code: q.get("code"),
      error: q.get("error"),
      cookieState: request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null,
    });
    return resultResponse(result, { clearCookie: true });
  } catch {
    return resultResponse("unexpected", { clearCookie: true });
  }
}
