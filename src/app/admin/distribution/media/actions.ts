"use server";

/**
 * 미디어 권리 결정·보관 server action(FE-MEDIA-024, 얇은 연결). 계약: docs/contracts/MEDIA_FRONT_CONTRACT.md §0-A(확정).
 * 매 요청 getMediaMetadataDeps()를 새로 부르고 service 함수만 호출한다(세션 actor·D1·RPC는 서버 모듈 몫 — 여기서 복사하지 않음).
 * 성공: 서버 응답 확인 뒤 redirect(+notice=saved). 실패: 폼 상태만(입력은 클라이언트 폼에 남음).
 * 세부 거절 사유는 mediaErrorReason(e)로, 그 밖은 공용 안내 코드로. 응답 유실·형식 이상은 결과 불명(자동 재시도 없음).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mediaErrorReason } from "@/server/distribution/errors";
import { archiveAsset, decideRights, type MediaFail } from "@/server/distribution/media/service";
import { getMediaMetadataDeps } from "@/server/distribution/media/session";
import { isUuid } from "@/server/distribution/validation";
import { writeNoticeOf, type FormState, type WriteNotice } from "@/server/distribution/write-notice";

const BASE = "/admin/distribution/media";

function fail(f: MediaFail | { status: "invalid"; field: string }, prev: FormState): FormState {
  let notice: WriteNotice;
  let fields: string[] = [];
  switch (f.status) {
    case "denied":
      notice = "denied";
      break;
    case "not_ready":
      notice = "not_ready";
      break;
    case "invalid":
      notice = "invalid";
      fields = [f.field];
      break;
    case "bad_response":
      notice = "uncertain";
      break;
    case "db_error": {
      notice = writeNoticeOf({ status: "db_error", error: f.error });
      const reason = mediaErrorReason(f.error);
      if (reason) fields = [`reason:${reason}`];
      break;
    }
  }
  return { notice, fields, seq: prev.seq + 1 };
}

const intOf = (v: FormDataEntryValue | null) => (typeof v === "string" && /^[1-9][0-9]{0,8}$/.test(v) ? Number(v) : null);

/** datetime-local(KST로 안내) → 시간대 붙은 ISO. 빈 값이면 null(기한 없음). 형식이 틀리면 undefined. */
function kstToIso(v: FormDataEntryValue | null): string | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return undefined;
  const t = Date.parse(`${v}:00+09:00`);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export async function decideMediaRightsAction(prev: FormState, fd: FormData): Promise<FormState> {
  const assetId = fd.get("assetId");
  const decision = fd.get("decision");
  const validUntil = kstToIso(fd.get("validUntil"));
  if (validUntil === undefined) return fail({ status: "invalid", field: "validUntil" }, prev);
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
  return fail(out, prev);
}

export async function archiveMediaAssetAction(prev: FormState, fd: FormData): Promise<FormState> {
  if (fd.get("confirmArchive") !== "on") return fail({ status: "invalid", field: "confirmArchive" }, prev);
  const assetId = fd.get("assetId");
  const out = await archiveAsset(getMediaMetadataDeps(), { assetId, expectedVersion: intOf(fd.get("expectedVersion")) });
  if (out.status === "ok") {
    revalidatePath(BASE);
    redirect(`${BASE}/${isUuid(assetId) ? assetId : ""}?notice=saved`);
  }
  return fail(out, prev);
}
