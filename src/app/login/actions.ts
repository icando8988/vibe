"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildEmailRedirect, normalizeEmail, resolveSiteOrigin } from "@/lib/auth/email-login";
import { safeReturnTo } from "@/lib/domain/input";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function loginUrl(notice: string, returnTo: string): string {
  const q = new URLSearchParams({ notice });
  if (returnTo !== "/me") q.set("returnTo", returnTo);
  return `/login?${q.toString()}`;
}

/** 매직 링크 발송. 가입·로그인 공용. 계정 존재 여부는 응답으로 드러내지 않는다. */
export async function sendLoginLink(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/me");
  const email = normalizeEmail(formData.get("email"));
  if (!email) redirect(loginUrl("invalid_email", returnTo));

  const supabase = await createSupabaseServerClient();
  const h = await headers();
  const requestOrigin = h.get("origin");
  const origin = resolveSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL, requestOrigin);
  if (!supabase || !origin) redirect(loginUrl("unavailable", returnTo));

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: buildEmailRedirect(origin, returnTo), shouldCreateUser: true },
  });
  // 발송 제한(429) 등은 사용자 구분 없이 같은 안내로 처리한다. 오류 원문·이메일은 기록하지 않는다.
  if (error && error.status !== 429 && error.status !== 400 && error.status !== 422) {
    redirect(loginUrl("unavailable", returnTo));
  }
  redirect(loginUrl("sent", returnTo));
}
