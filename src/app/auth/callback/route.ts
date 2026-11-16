/**
 * GET /auth/callback — 메일 링크 복귀. PKCE code 또는 token_hash를 세션으로 교환하고 내부 경로로만 보낸다.
 */
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeReturnTo } from "@/lib/domain/input";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const OTP_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery", "email_change"];

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeReturnTo(url.searchParams.get("next"), "/me");
  const fail = NextResponse.redirect(new URL("/login?notice=callback_failed", url.origin));

  const supabase = await createSupabaseServerClient();
  if (!supabase) return fail;

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }
  if (!ok) return fail;

  const res = NextResponse.redirect(new URL(next, url.origin));
  res.headers.set("Cache-Control", "private, no-store, max-age=0");
  return res;
}
