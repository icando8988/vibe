"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  buildEmailRedirect,
  normalizeEmail,
  resolveSiteOrigin,
  validatePassword,
  type LoginMode,
  type LoginNotice,
} from "@/lib/auth/email-login";
import { safeReturnTo } from "@/lib/domain/input";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// 비밀번호·이메일 원문은 URL·로그에 남기지 않는다. 결과는 허용 목록 notice 코드로만 전달한다.

function loginUrl(notice: LoginNotice, returnTo: string, mode: LoginMode = "login"): string {
  const q = new URLSearchParams({ notice });
  if (mode !== "login") q.set("mode", mode);
  if (returnTo !== "/me") q.set("returnTo", returnTo);
  return `/login?${q.toString()}`;
}

async function siteOrigin(): Promise<string | null> {
  const h = await headers();
  return resolveSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL, h.get("origin"));
}

function isRateLimited(error: { status?: number; code?: string }): boolean {
  return error.status === 429 || error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit";
}

/** 로그인. 계정 없음·비밀번호 틀림은 같은 안내로 처리한다. */
export async function signInWithPassword(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/me");
  const email = normalizeEmail(formData.get("email"));
  const password = formData.get("password");
  if (!email) redirect(loginUrl("invalid_email", returnTo));
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) {
    redirect(loginUrl("invalid_login", returnTo));
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(loginUrl("unavailable", returnTo));

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") redirect(loginUrl("email_not_confirmed", returnTo));
    if (isRateLimited(error)) redirect(loginUrl("rate_limited", returnTo));
    if (error.code === "invalid_credentials" || error.status === 400) redirect(loginUrl("invalid_login", returnTo));
    redirect(loginUrl("unavailable", returnTo));
  }
  redirect(returnTo);
}

/** 회원가입. 메일 인증 후 로그인된다. 이미 있는 주소인지는 응답으로 드러내지 않는다. */
export async function signUpWithPassword(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/me");
  const email = normalizeEmail(formData.get("email"));
  const password = validatePassword(formData.get("password"));
  if (!email) redirect(loginUrl("invalid_email", returnTo, "signup"));
  if (!password) redirect(loginUrl("invalid_password", returnTo, "signup"));
  if (formData.get("passwordConfirm") !== password) redirect(loginUrl("password_mismatch", returnTo, "signup"));

  const supabase = await createSupabaseServerClient();
  const origin = await siteOrigin();
  if (!supabase || !origin) redirect(loginUrl("unavailable", returnTo, "signup"));

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: buildEmailRedirect(origin, returnTo) },
  });
  if (error) {
    if (error.code === "weak_password") redirect(loginUrl("invalid_password", returnTo, "signup"));
    if (isRateLimited(error)) redirect(loginUrl("rate_limited", returnTo, "signup"));
    // user_already_exists(메일 인증을 끈 경우) 등도 구분 없이 같은 안내
    if (error.status !== 400 && error.status !== 422) redirect(loginUrl("unavailable", returnTo, "signup"));
  }
  // 메일 인증을 끈 설정이면 바로 세션이 생긴다.
  if (!error && data.session) redirect(returnTo);
  redirect(loginUrl("signup_sent", returnTo));
}

/** 비밀번호 재설정 메일. 계정 존재 여부와 관계없이 같은 안내. */
export async function requestPasswordReset(formData: FormData): Promise<void> {
  const email = normalizeEmail(formData.get("email"));
  if (!email) redirect(loginUrl("invalid_email", "/me", "reset"));

  const supabase = await createSupabaseServerClient();
  const origin = await siteOrigin();
  if (!supabase || !origin) redirect(loginUrl("unavailable", "/me", "reset"));

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: buildEmailRedirect(origin, "/login/update-password"),
  });
  if (error && isRateLimited(error)) redirect(loginUrl("rate_limited", "/me", "reset"));
  if (error && error.status !== 400 && error.status !== 422) redirect(loginUrl("unavailable", "/me", "reset"));
  redirect(loginUrl("reset_sent", "/me"));
}

/** 재설정 링크로 로그인된 상태에서 새 비밀번호 저장. */
export async function updatePassword(formData: FormData): Promise<void> {
  const password = validatePassword(formData.get("password"));
  if (!password) redirect("/login/update-password?notice=invalid_password");
  if (formData.get("passwordConfirm") !== password) redirect("/login/update-password?notice=password_mismatch");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login/update-password?notice=unavailable");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?notice=callback_failed");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "weak_password" || error.code === "same_password") {
      redirect("/login/update-password?notice=invalid_password");
    }
    redirect("/login/update-password?notice=unavailable");
  }
  redirect("/me");
}
