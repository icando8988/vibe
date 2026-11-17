"use server";

/**
 * 미디어 권리 결정·보관 server action(FE-MEDIA-024 → FE-MEDIA-RESUME-027, 얇은 연결). 계약: docs/contracts/MEDIA_FRONT_CONTRACT.md §0-A(확정).
 * 매 요청 getMediaMetadataDeps()를 새로 부르고 service 함수만 호출한다(세션 actor·D1·RPC는 서버 모듈 몫 — 여기서 복사하지 않음).
 * 성공: 서버 응답 확인 뒤 redirect(+notice=saved). 실패: 폼 상태만(입력은 클라이언트 폼에 남음). 실패 판정은 action-state.ts(순수, 시험 대상).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { archiveAsset, decideRights } from "@/server/distribution/media/service";
import { getMediaMetadataDeps } from "@/server/distribution/media/session";
import type { FormState } from "@/server/distribution/write-notice";
import { intOf, kstToIso, mediaFailState, noteFieldError } from "./action-state";

const BASE = "/admin/distribution/media";

export async function decideMediaRightsAction(prev: FormState, fd: FormData): Promise<FormState> {
  const assetId = fd.get("assetId");
  const decision = fd.get("decision");
  // 유효기한은 승인일 때만 쓰므로 승인일 때만 검사한다(반려·철회 때 남은 값으로 막지 않음).
  const validUntil = decision === "approved" ? kstToIso(fd.get("validUntil")) : null;
  if (validUntil === undefined) return mediaFailState({ status: "invalid", field: "validUntil" }, prev);
  const noteField = noteFieldError(fd.get("note"));
  if (noteField) return mediaFailState({ status: "invalid", field: noteField }, prev);
  const out = await decideRights(getMediaMetadataDeps(), {
    assetId,
    expectedVersion: intOf(fd.get("expectedVersion")),
    decision,
    allowedChannels: decision === "approved" ? fd.getAll("allowedChannels").filter((c): c is string => typeof c === "string") : undefined,
    validUntil: decision === "approved" ? validUntil : undefined,
    note: fd.get("note"),
  });
  if (out.status === "ok") {
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${out.asset.id}`);
    redirect(`${BASE}/${out.asset.id}?notice=saved`);
  }
  return mediaFailState(out, prev);
}

export async function archiveMediaAssetAction(prev: FormState, fd: FormData): Promise<FormState> {
  if (fd.get("confirmArchive") !== "on") return mediaFailState({ status: "invalid", field: "confirmArchive" }, prev);
  const out = await archiveAsset(getMediaMetadataDeps(), { assetId: fd.get("assetId"), expectedVersion: intOf(fd.get("expectedVersion")) });
  if (out.status === "ok") {
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${out.asset.id}`);
    redirect(`${BASE}/${out.asset.id}?notice=saved`);
  }
  return mediaFailState(out, prev);
}
