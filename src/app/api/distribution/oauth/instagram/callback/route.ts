/**
 * Instagram OAuth callback(GET, Meta가 돌려보냄). BE-INSTAGRAM-OAUTH-043 — handoff/workspace/docs/contracts/INSTAGRAM_OAUTH_CONTRACT.md
 * 세션 actor + D1 → 쿠키 state = 쿼리 state → DB state 1회 소비 → code 1회 교환 → 부여 권한 확인 → 장기 토큰 → M3 암호화 저장.
 * 결과는 허용 목록 코드로만 연결 화면에 돌려보내고, state 쿠키는 항상 지운다. 자동 재요청 없음.
 */
import type { NextRequest } from "next/server";
import { handleInstagramCallback } from "@/server/distribution/instagram/oauth/flow";
import { resultResponse } from "@/server/distribution/instagram/oauth/http";
import { getInstagramOAuthDeps } from "@/server/distribution/instagram/oauth/session";
import { INSTAGRAM_STATE_COOKIE } from "@/server/distribution/instagram/oauth/state";

export const dynamic = "force-dynamic";
// BE-OAUTH-DURATION-050: 공급자 요청 15초 × 최대 2회(순차) + state·저장 RPC 뒤에도 결과 redirect·쿠키 삭제를 끝낼 여유.
// 프로젝트 대시보드 기본값이 낮게 바뀌어도 이 route만은 60초로 고정한다(Vercel 문서: App Router는 named maxDuration export).
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const q = request.nextUrl.searchParams;
    const result = await handleInstagramCallback(getInstagramOAuthDeps(), {
      state: q.get("state"),
      code: q.get("code"),
      error: q.get("error"),
      cookieState: request.cookies.get(INSTAGRAM_STATE_COOKIE)?.value ?? null,
    });
    return resultResponse(result, { clearCookie: true });
  } catch {
    return resultResponse("unexpected", { clearCookie: true });
  }
}
