"use server";

/**
 * 원문·초안·승인 서버 액션(A1~A7) + Blog 수동 작업 생성(A8). AUTOPOST-CONTENT-CONNECT-014 / BLOG-FLOW-015.
 * 매 액션: 검증된 세션 actor(requireDistributionActor, D1) → 입력(렌더된 기대값 그대로) → service RPC 1회.
 * 성공: RPC 확인 뒤 redirect(+ notice=saved). 실패: 폼 상태(안내 코드·필드 이름)만 돌려준다 — 입력은 클라이언트 폼에 남는다.
 * 실행·게시는 연결하지 않는다(A8은 manual 작업 생성까지).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDistributionActor } from "@/server/distribution/actor";
import { decideApproval, revokeApproval } from "@/server/distribution/approval-service";
import { getServiceRpcClient } from "@/server/distribution/blog/service";
import { appendContentVersion, appendDraftRevision, createChannelDraft, createContent } from "@/server/distribution/content-service";
import { createBlogManualJob, createThreadsDryRunJob } from "@/server/distribution/jobs-service";
import { isUuid } from "@/server/distribution/validation";
import { mediaErrorReason } from "@/server/distribution/errors";
import { failureState, type FormState } from "@/server/distribution/write-notice";

const deps = { resolveActor: requireDistributionActor, getClient: getServiceRpcClient };
const BASE = "/admin/distribution/contents";
const CHANNELS = new Set(["blog", "threads", "instagram"]);

/** redirect 경로 조각은 형식 검사 후에만 쓴다(열린 redirect 방지). */
function contentPath(id: unknown, tail = ""): string {
  return isUuid(id) ? `${BASE}/${id}${tail}` : BASE;
}
function channelPath(id: unknown, ch: unknown, tail = ""): string {
  return isUuid(id) && typeof ch === "string" && CHANNELS.has(ch) ? `${BASE}/${id}/channels/${ch}${tail}` : contentPath(id);
}
function done(path: string): never {
  revalidatePath(path);
  redirect(`${path}?notice=saved`);
}

export async function createContentAction(prev: FormState, formData: FormData): Promise<FormState> {
  const out = await createContent(deps, formData);
  if (out.status === "ok") {
    revalidatePath(BASE);
    redirect(`${BASE}/${out.data.contentId}?notice=saved`);
  }
  return failureState(out, prev);
}

export async function appendContentVersionAction(prev: FormState, formData: FormData): Promise<FormState> {
  const out = await appendContentVersion(deps, formData);
  if (out.status === "ok") done(contentPath(formData.get("contentId")));
  return failureState(out, prev);
}

export async function createChannelDraftAction(prev: FormState, formData: FormData): Promise<FormState> {
  const out = await createChannelDraft(deps, formData);
  if (out.status === "ok") done(channelPath(formData.get("contentId"), formData.get("channel")));
  return failureState(out, prev);
}

export async function appendDraftRevisionAction(prev: FormState, formData: FormData): Promise<FormState> {
  const out = await appendDraftRevision(deps, formData);
  if (out.status === "ok") done(channelPath(formData.get("contentId"), formData.get("channel")));
  const st = failureState(out, prev);
  // FE-REVISION-MEDIA-038: 첨부 거절(MEDIA_NOT_READY·VARIANT_MISMATCH·MEDIA_NOT_OWNED·MEDIA_DUPLICATE) 세부 사유를 필드로 덧붙인다(안내 코드는 그대로).
  const reason = out.status === "db_error" ? mediaErrorReason(out.error) : null;
  return reason ? { ...st, fields: [...st.fields, `reason:${reason}`] } : st;
}

export async function decideApprovalAction(prev: FormState, formData: FormData): Promise<FormState> {
  const out = await decideApproval(deps, formData);
  if (out.status === "ok") {
    done(
      formData.get("subjectType") === "draft_revision"
        ? channelPath(formData.get("contentId"), formData.get("channel"), "/review")
        : contentPath(formData.get("contentId")),
    );
  }
  return failureState(out, prev);
}

export async function revokeApprovalAction(prev: FormState, formData: FormData): Promise<FormState> {
  const out = await revokeApproval(deps, formData);
  if (out.status === "ok") {
    const ch = formData.get("channel");
    done(typeof ch === "string" && CHANNELS.has(ch) ? channelPath(formData.get("contentId"), ch, "/review") : contentPath(formData.get("contentId")));
  }
  return failureState(out, prev);
}

// A8 Blog 수동 작업 생성 → 성공하면 수동 게시 화면으로
export async function createBlogManualJobAction(prev: FormState, formData: FormData): Promise<FormState> {
  const out = await createBlogManualJob(deps, formData);
  if (out.status === "ok") {
    revalidatePath("/admin/distribution/jobs");
    redirect(`/admin/distribution/jobs/${out.data}/manual?notice=saved`);
  }
  return failureState(out, prev);
}

// Threads 모의 실행 작업 생성(THREADS-PORT-016) → 실행 상세로. 생성 = 대기(scheduled)이지 모의 실행 성공이 아니다.
export async function createThreadsDryRunJobAction(prev: FormState, formData: FormData): Promise<FormState> {
  const out = await createThreadsDryRunJob(deps, formData);
  if (out.status === "ok") {
    revalidatePath("/admin/distribution/jobs");
    redirect(`/admin/distribution/jobs/${out.data}?notice=saved`);
  }
  return failureState(out, prev);
}
