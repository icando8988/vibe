/**
 * 현재 요청의 사용자(viewer) 판별. DEV-004에서 Supabase 세션 확인으로 교체한다.
 * 지금은 인증이 연결되지 않았으므로 항상 익명이며, 어떤 개인·운영 데이터도 돌려주지 않는다.
 */
import { getIntegrationStatus } from "@/lib/env";

export type Role = "member" | "admin" | "seller";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "suspended";

export type Viewer =
  | { kind: "anonymous"; reason: "auth_not_configured" | "not_signed_in" }
  | { kind: "member"; userId: string; approval: ApprovalStatus; roles: readonly Role[] };

export async function getViewer(): Promise<Viewer> {
  const status = getIntegrationStatus();
  if (!status.authConnected) {
    return { kind: "anonymous", reason: "auth_not_configured" };
  }
  // DEV-004: 서버에서 세션 쿠키 → Supabase Auth 확인 → profiles/role_assignments 조회.
  return { kind: "anonymous", reason: "not_signed_in" };
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
