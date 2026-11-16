/**
 * 세션 쿠키 갱신 전용 proxy. 인가 판단은 하지 않는다(페이지·API가 getViewer로 서버에서 판정).
 * Supabase 설정이 없으면 아무것도 하지 않는다.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigFromEnv } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  const config = supabaseConfigFromEnv();
  if (!config) return NextResponse.next({ request });

  // 세션 쿠키가 없으면 갱신할 것도 없다(공개 페이지의 불필요한 인증 호출 방지).
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // 만료된 액세스 토큰을 갱신한다. 결과로 인가하지 않는다.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
