/**
 * POST /auth/signout — 세션 종료. GET은 허용하지 않는다(링크 프리페치·CSRF로 로그아웃되지 않게).
 */
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // 같은 출처 폼 제출만 받는다.
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse(null, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login?notice=signed_out", request.nextUrl.origin), { status: 303 });
}
