/**
 * 미디어 server action의 순수 판정(FE-MEDIA-RESUME-027). "use server" 파일은 async 함수만 export할 수 있어 시험 가능한 부분을 분리했다.
 * 계약: docs/contracts/MEDIA_FRONT_CONTRACT.md §0-A·§4. 세부 거절 사유는 mediaErrorReason(e) 우선, 그 밖은 공용 안내 코드.
 * 응답 유실(unavailable)·형식 이상(bad_response)은 결과 불명(uncertain) — 자동 재시도 없음.
 */
import { mediaErrorReason, type MappedDbError } from "@/server/distribution/errors";
import { writeNoticeOf, type FormState, type WriteNotice } from "@/server/distribution/write-notice";

export type MediaActionFail =
  | { status: "denied" }
  | { status: "not_ready" }
  | { status: "invalid"; field: string }
  | { status: "db_error"; error: MappedDbError }
  | { status: "bad_response" };

/**
 * 실패 → 폼 상태. 입력은 클라이언트 폼에 남고, expectedVersion은 여기서 바꾸지 않는다(충돌 시 사용자가 새로 불러와 다시 결정).
 * 충돌·보관·전이 불가·없음의 미디어 문맥 안내는 폼의 noticeOverrides가 맡는다(FE-MEDIA-FIX-029 D028-02 — fields 보충은 중복이라 제거).
 */
export function mediaFailState(f: MediaActionFail, prev: FormState): FormState {
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

/** 권리 결정 사유 상한(120000 SQL `char_length(note) <= 1000`, 코드 포인트 기준). */
export const MEDIA_NOTE_MAX = 1000;
/**
 * SQL `note !~ '[[:cntrl:]]'`가 거절하는 제어 문자(줄바꿈·탭·CR 등 C0, DEL)와 C1 영역을 미리 검출한다(D028-04).
 * 고치지 않고 note 필드 오류로 돌려 사용자가 직접 수정하게 한다(무단 제거·필수화 없음).
 */
const NOTE_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** 사유 검사: 문제가 없으면 null, 있으면 "note"(폼 필드 이름). 빈 값·미입력은 허용(사유는 선택). */
export function noteFieldError(v: FormDataEntryValue | null): "note" | null {
  if (v === null || v === "") return null;
  if (typeof v !== "string") return "note";
  if ([...v].length > MEDIA_NOTE_MAX || NOTE_CONTROL.test(v)) return "note";
  return null;
}

/** expectedVersion: 양의 정수 문자열만. 그 밖은 null(서버 service가 invalid로 거절). */
export const intOf = (v: FormDataEntryValue | null) => (typeof v === "string" && /^[1-9][0-9]{0,8}$/.test(v) ? Number(v) : null);

/** datetime-local(KST로 안내) → 시간대 붙은 ISO. 빈 값이면 null(기한 없음). 형식이 틀리면 undefined. */
export function kstToIso(v: FormDataEntryValue | null): string | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return undefined;
  const t = Date.parse(`${v}:00+09:00`);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}
