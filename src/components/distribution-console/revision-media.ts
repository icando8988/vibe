/**
 * Instagram 초안 단일 이미지 선택 — 순수 판정(FE-REVISION-MEDIA-038 / CC-FRONT-01). 시험 대상.
 * 입력: 미디어 목록 조회 결과(MediaAssetDto, 서버 listAssets — 최신 100건)와 현재 리비전 첨부.
 * 출력 형식은 현재 서버가 받는 preserveMedia 배열 모양({asset_id, variant_id, alt_text}[])을 그대로 쓴다.
 * 실제 입력 이름·조회 실패 의미는 Backend037 REVISION_MEDIA_CONTRACT 확정 후 페이지에서 연결한다(여기서 invent하지 않음).
 *
 * 원칙
 * - 후보는 ready·미보관·변형 있는 본인 자산만(서버가 최종 검증). 권리 미승인 ready도 첨부 가능 — 게시 전 권리 확인 경고만.
 * - 변형 고정: 선택 시점의 variant.id를 함께 보낸다.
 * - 현재 첨부가 목록(최근 100건)에 없으면 "없음"으로 단정하지 않고 그대로 유지한다.
 * - 목록 조회 실패·미준비·권한 없음이면 선택을 바꾸지 않는다(유지만). 첨부 조회 실패면 직렬화 자체를 하지 않는다.
 * - URL·토큰·Storage 경로는 다루지 않는다(DTO에도 없음).
 */
import type { MediaAssetDto } from "@/server/distribution/media/service";
import { rightsUsableNow } from "./media-labels";

export type RevisionMediaItem = { asset_id: string; variant_id: string | null; alt_text: string | null };

/** 현재 리비전 첨부 상태. `read_error`는 첨부를 읽지 못함(빈 첨부와 다름). */
export type CurrentAttachment = { state: "ok"; items: RevisionMediaItem[] } | { state: "read_error" };

/** 목록 조회 상태(load.ts의 MediaListView와 같은 축). */
export type CandidateSource =
  | { state: "ok"; assets: MediaAssetDto[] }
  | { state: "not_ready" }
  | { state: "denied" }
  | { state: "error" };

/** 클라이언트로 넘기는 후보 — 화면에 필요한 사실만(서버 DTO 전체를 넘기지 않음). */
export type MediaCandidate = {
  assetId: string;
  variantId: string;
  width: number;
  height: number;
  byteSize: number;
  rightsApprovedNow: boolean;
  rightsState: MediaAssetDto["rightsState"];
  /** Instagram 기준 권리 판정(표시용). 서버가 게시 전 다시 검증한다. */
  rights: RightsNote;
};

/**
 * Instagram 기준 권리 표시. approved라도 "게시 가능"을 뜻하지 않는다(게시 전 서버 재검증·live gate 별도).
 * - approved_instagram: 승인·유효·Instagram 허용
 * - expired: 승인됐지만 유효기한 지남
 * - channel_excluded: 승인됐지만 허용 채널에 Instagram 없음
 * - unreviewed / rejected / revoked: 승인 아님
 */
export type RightsNote = "approved_instagram" | "expired" | "channel_excluded" | "unreviewed" | "rejected" | "revoked";

export function instagramRightsNote(a: Pick<MediaAssetDto, "rightsState" | "rightsValidUntil" | "allowedChannels">, now: number): RightsNote {
  if (a.rightsState !== "approved") return a.rightsState;
  if (!rightsUsableNow(a, now)) return "expired";
  if (!(a.allowedChannels ?? []).includes("instagram")) return "channel_excluded";
  return "approved_instagram";
}

export const RIGHTS_NOTE_TEXT: Record<RightsNote, string> = {
  approved_instagram: "권리 승인(Instagram 허용) · 게시 전 서버가 다시 확인",
  expired: "권리 유효기한 지남 · 게시 전 권리 재확인 필요",
  channel_excluded: "권리 승인 채널에 Instagram 없음 · 게시 전 권리 확인 필요",
  unreviewed: "권리 미검토 · 게시 전 권리 확인 필요",
  rejected: "권리 반려 · 게시 전 권리 확인 필요",
  revoked: "권리 철회 · 게시 전 권리 확인 필요",
};

export const ALT_TEXT_MAX = 1000;

export function toCandidates(assets: readonly MediaAssetDto[], now: number): MediaCandidate[] {
  return assets
    .filter((a) => a.status === "ready" && !a.archivedAt && a.variant)
    .map((a) => ({
      assetId: a.id,
      variantId: a.variant!.id,
      width: a.variant!.width,
      height: a.variant!.height,
      byteSize: a.variant!.byteSize,
      rightsApprovedNow: rightsUsableNow(a, now),
      rightsState: a.rightsState,
      rights: instagramRightsNote(a, now),
    }));
}

/** 선택 UI 모드. */
export type SelectorModel =
  | { mode: "attachment_unknown" } // 첨부 조회 실패 — 아무것도 바꾸지 않고 저장도 막아야 함(페이지가 판단)
  | { mode: "locked"; reason: "not_ready" | "denied" | "error"; current: RevisionMediaItem[] } // 목록 못 읽음 — 현재 첨부 유지만
  | { mode: "select"; candidates: MediaCandidate[]; current: RevisionMediaItem[]; currentInList: boolean | null };

export function selectorModel(current: CurrentAttachment, source: CandidateSource, now: number): SelectorModel {
  if (current.state === "read_error") return { mode: "attachment_unknown" };
  if (source.state !== "ok") return { mode: "locked", reason: source.state, current: current.items };
  const candidates = toCandidates(source.assets, now);
  const first = current.items[0];
  const currentInList = first ? candidates.some((c) => c.assetId === first.asset_id) : null;
  return { mode: "select", candidates, current: current.items, currentInList };
}

/** 사용자의 선택. keep = 현재 첨부 그대로(본문만 수정 등), none = 명시 해제, asset = 새 선택. */
export type Choice = { kind: "keep" } | { kind: "none" } | { kind: "asset"; assetId: string };

/**
 * 선택 → 서버로 보낼 배열. keep은 현재 첨부를 순서·변형·대체텍스트까지 그대로 돌려준다.
 * 새 선택은 후보의 변형 ID로 고정한다. 알 수 없는 자산 ID면 null(보내지 않음 — 가짜 첨부 금지).
 */
export function serializeChoice(choice: Choice, model: Extract<SelectorModel, { mode: "select" | "locked" }>, altText: string): RevisionMediaItem[] | null {
  if (choice.kind === "keep" || model.mode === "locked") return model.current.map((m) => ({ ...m }));
  if (choice.kind === "none") return [];
  const c = model.candidates.find((x) => x.assetId === choice.assetId);
  if (!c) return null;
  const alt = altText.trim();
  return [{ asset_id: c.assetId, variant_id: c.variantId, alt_text: alt === "" ? null : alt }];
}

/** 대체텍스트 검사(서버 parsePreserved 상한 1000과 일치). 문제 없으면 null. */
export function altTextError(v: string): "too_long" | null {
  return v.length > ALT_TEXT_MAX ? "too_long" : null; // 서버 parsePreserved와 같은 UTF-16 길이 기준
}
