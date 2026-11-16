/**
 * 현재 요청의 사용자(viewer) 판별. 서버에서만 호출한다.
 * 세션은 Supabase Auth 서버 검증(getUser)으로 확인하고, 승인 상태·역할은 RLS 하의 본인 행에서 읽는다.
 * 쿠키·JWT 내용 자체를 역할 근거로 쓰지 않는다.
 */
import { getIntegrationStatus } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Role = "member" | "admin" | "seller";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "suspended";

export type Viewer =
  | { kind: "anonymous"; reason: "auth_not_configured" | "not_signed_in" }
  | { kind: "member"; userId: string; approval: ApprovalStatus; roles: readonly Role[] };

const APPROVAL: readonly ApprovalStatus[] = ["pending", "approved", "rejected", "suspended"];
const ROLES: readonly Role[] = ["member", "admin", "seller"];

/** DB 값 해석(순수). 알 수 없는 값은 가장 낮은 권한으로 본다. */
export function toApproval(v: unknown): ApprovalStatus {
  return APPROVAL.includes(v as ApprovalStatus) ? (v as ApprovalStatus) : "pending";
}
export function toRoles(rows: unknown): Role[] {
  if (!Array.isArray(rows)) return [];
  const out = new Set<Role>();
  for (const r of rows) {
    const role = (r as { role?: unknown } | null)?.role;
    if (ROLES.includes(role as Role)) out.add(role as Role);
  }
  return [...out];
}

export async function getViewer(): Promise<Viewer> {
  if (!getIntegrationStatus().authConnected) {
    return { kind: "anonymous", reason: "auth_not_configured" };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { kind: "anonymous", reason: "auth_not_configured" };

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { kind: "anonymous", reason: "not_signed_in" };
  const userId = data.user.id;

  // 열을 명시한다(내부 열은 권한상 조회 불가, select * 는 거절됨).
  const [profile, roles] = await Promise.all([
    supabase.from("profiles").select("id, approval_status").eq("id", userId).maybeSingle(),
    supabase.from("role_assignments").select("role").eq("user_id", userId),
  ]);

  return {
    kind: "member",
    userId,
    // 프로필이 없거나 조회 실패면 승인 대기로 본다(권한 상승 방지).
    approval: profile.error ? "pending" : toApproval(profile.data?.approval_status),
    roles: roles.error ? [] : toRoles(roles.data),
  };
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "auth_not_configured" | "unauthenticated" | "pending_approval" | "forbidden" };

/** 페이지/API 공통 접근 판정. 역할은 서버 조회 결과만 신뢰한다. */
export function decideAccess(viewer: Viewer, need: "approved_member" | "admin"): AccessDecision {
  if (viewer.kind === "anonymous") {
    return { allowed: false, reason: viewer.reason === "auth_not_configured" ? "auth_not_configured" : "unauthenticated" };
  }
  if (need === "admin") {
    return viewer.roles.includes("admin") ? { allowed: true } : { allowed: false, reason: "forbidden" };
  }
  if (viewer.approval !== "approved") {
    return { allowed: false, reason: viewer.approval === "pending" ? "pending_approval" : "forbidden" };
  }
  return { allowed: true };
}
