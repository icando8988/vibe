/**
 * 미디어 목록 조회 → 화면 상태(FE-MEDIA-024). server-only(session.ts가 server-only).
 * mediaReadiness().metadata는 "설정이 있다"는 신호일 뿐 DB 성공이 아니다 → 실제 listAssets 결과로만 목록·0건·폼 가능을 판정한다.
 */
import "server-only";
import type { MediaListView } from "@/components/distribution-console/media-asset-list";
import { listAssets, type MediaAssetDto } from "@/server/distribution/media/service";
import { getMediaMetadataDeps, mediaReadiness } from "@/server/distribution/media/session";

const MISSING_TEXT: Record<string, string> = {
  service_client: "서버 저장 연결(서버 키)",
  storage_adapter: "미디어 저장소(Storage)",
};

export async function loadMediaList(): Promise<{ view: MediaListView; assets: MediaAssetDto[] | null }> {
  const ready = mediaReadiness();
  if (!ready.metadata) {
    const missing = ready.missing.map((m) => MISSING_TEXT[m] ?? m).join(", ");
    return { view: { state: "not_ready", reason: `${missing || "서버 연결"}이(가) 설정되지 않아 미디어 정보를 불러올 수 없습니다.` }, assets: null };
  }
  const out = await listAssets(getMediaMetadataDeps());
  if (out.status === "ok") return { view: { state: "ok", assets: out.assets }, assets: out.assets };
  if (out.status === "denied") return { view: { state: "denied" }, assets: null };
  if (out.status === "not_ready") return { view: { state: "not_ready", reason: "서버 저장 연결이 준비되지 않았습니다." }, assets: null };
  // 조회는 쓰기가 아니므로 결과 불명이 없다 — 응답 유실·형식 이상·DB 거절을 구분해 안내만 다르게 한다(0건으로 바꾸지 않음).
  if (out.status === "bad_response") return { view: { state: "error", kind: "bad_response" }, assets: null };
  if (out.status === "db_error" && out.error.code === "unavailable") return { view: { state: "error", kind: "unavailable" }, assets: null };
  return { view: { state: "error", kind: "db" }, assets: null };
}
