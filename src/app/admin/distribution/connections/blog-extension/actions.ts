"use server";

/**
 * Blog 확장 연결 토큰 발급·철회 서버 액션(AUTOPOST-BLOG-TOKEN-005, UX-FIX-008).
 * actor는 검증된 세션에서만(requireDistributionActor), D1 거부 시 RPC 0회, 키 없으면 not_ready.
 * 발급 원문은 이 응답에만 1회 담긴다(URL·쿠키·DB에 넣지 않음). 화면은 표시 세션을 끝낼 때 상태 참조를 버린다.
 * 응답 유실·형식 오류는 "확인 필요(uncertain)" — 실패로 단정하거나 자동 재발급하지 않는다.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDistributionActor } from "@/server/distribution/actor";
import { getServiceRpcClient } from "@/server/distribution/blog/service";
import { issueExtensionToken, revokeExtensionToken, tokenNoticeOf, type TokenNotice } from "@/server/distribution/blog/token-service";

const PAGE = "/admin/distribution/connections/blog-extension";

export type IssueField = "label" | "ttlDays";

export type IssueState =
  | { status: "idle" }
  | { status: "issued"; token: string; label: string; createdAt: string; expiresAt: string }
  /** 확정 실패: 아무것도 발급되지 않았다(권한·입력·준비 전·상한·DB 거절). */
  | { status: "rejected"; notice: Exclude<TokenNotice, "issued" | "revoked" | "uncertain">; fields: IssueField[] }
  /** 발급 여부 불명: 요청 시각과 목록을 비교해 확인해야 한다. */
  | { status: "uncertain"; requestedAt: string };

export async function issueExtensionTokenAction(_prev: IssueState, formData: FormData): Promise<IssueState> {
  const requestedAt = new Date().toISOString();
  const outcome = await issueExtensionToken(
    { resolveActor: requireDistributionActor, getClient: getServiceRpcClient },
    { label: formData.get("label"), ttlDays: formData.get("ttlDays") },
  );
  if (outcome.status === "ok") {
    revalidatePath(PAGE);
    const { token, label, createdAt, expiresAt } = outcome.data;
    return { status: "issued", token, label, createdAt, expiresAt };
  }
  const notice = tokenNoticeOf(outcome, "issued");
  if (notice === "uncertain") {
    revalidatePath(PAGE);
    return { status: "uncertain", requestedAt };
  }
  const fields: IssueField[] =
    outcome.status === "invalid"
      ? outcome.errors.map((e) => e.field).filter((f): f is IssueField => f === "label" || f === "ttlDays")
      : [];
  return { status: "rejected", notice: notice === "issued" || notice === "revoked" ? "failed" : notice, fields };
}

export async function revokeExtensionTokenAction(formData: FormData): Promise<void> {
  const outcome = await revokeExtensionToken(
    { resolveActor: requireDistributionActor, getClient: getServiceRpcClient },
    { tokenId: formData.get("tokenId") },
  );
  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=${tokenNoticeOf(outcome, "revoked")}`);
}
