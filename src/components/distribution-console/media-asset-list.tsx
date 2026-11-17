import Link from "next/link";
import { StatusNotice } from "../status-notice";
import type { MediaAssetDto } from "@/server/distribution/media/service";
import { formatBytes, formatKst, formatPixels, MEDIA_STATUS_LABEL, RIGHTS_LABEL, rightsUsableNow, SOURCE_LABEL } from "./media-labels";
import styles from "./media.module.css";

/**
 * 미디어 목록 표시(FE-MEDIA-024). 조회 결과 상태를 그대로 나눈다:
 * 준비 전(배선·저장소 미설정) / 권한 없음 / 조회 오류 / 조회 성공 0건 / 목록. 준비 전·오류를 '0건'으로 바꾸지 않는다.
 * 처리 상태와 권리 상태는 다른 열로 보여 준다(처리 완료 ≠ 사용 가능).
 */
export type MediaListView =
  | { state: "not_ready"; reason: string }
  | { state: "denied" }
  | { state: "error"; kind?: MediaListErrorKind }
  | { state: "ok"; assets: MediaAssetDto[] };

/** 조회 오류 종류: 응답 유실(unavailable) · 응답 형식 이상(bad_response) · DB 거절(db). */
export type MediaListErrorKind = "unavailable" | "bad_response" | "db";

const LIST_ERROR_TEXT: Record<MediaListErrorKind, string> = {
  unavailable: "서버 응답을 받지 못했습니다(연결 끊김·시간 초과).",
  bad_response: "서버 응답 형식이 예상과 달라 표시하지 않았습니다.",
  db: "저장소가 조회를 거절했습니다.",
};

export function MediaAssetList({ view, now, selectedId = null }: { view: MediaListView; now: number; selectedId?: string | null }) {
  if (view.state === "not_ready") {
    return (
      <StatusNotice tone="warning" title="미디어 저장 준비 전">
        <p>{view.reason}</p>
        <p>그래서 자산 목록을 불러오지 않았습니다. 실제로 자산이 없다는 뜻이 아닙니다.</p>
      </StatusNotice>
    );
  }
  if (view.state === "denied") {
    return (
      <StatusNotice tone="error" title="권한이 없습니다">
        <p>승인된 관리자만 미디어 자산을 볼 수 있습니다.</p>
      </StatusNotice>
    );
  }
  if (view.state === "error") {
    return (
      <StatusNotice tone="error" title="자산 목록을 불러오지 못했습니다">
        {view.kind ? <p>{LIST_ERROR_TEXT[view.kind]}</p> : null}
        <p>잠시 뒤 다시 불러오세요. 조회 실패는 자산이 없다는 뜻이 아닙니다.</p>
      </StatusNotice>
    );
  }
  if (view.assets.length === 0) {
    return <p className="ds-muted">아직 올린 자산이 없습니다(조회 성공 · 0건).</p>;
  }
  return (
    <div className={`dc-table-wrap ${styles.tableRegion}`} role="region" aria-label="미디어 자산 표(가로 스크롤 가능)" tabIndex={0}>
      <table className="dc-table">
        <caption>내 미디어 자산(최신순, 최대 100건 — 페이지 나눔 없음)</caption>
        <thead>
          <tr>
            <th scope="col">자산</th>
            <th scope="col">처리 상태</th>
            <th scope="col">권리</th>
            <th scope="col">변환본</th>
            <th scope="col">출처</th>
          </tr>
        </thead>
        <tbody>
          {view.assets.map((a) => {
            const selected = a.id === selectedId;
            const expired = a.rightsState === "approved" && !rightsUsableNow(a, now);
            return (
              <tr key={a.id} className={selected ? styles.selectedRow : undefined} aria-current={selected ? "true" : undefined}>
                <th scope="row">
                  <Link className="dc-action" href={`/admin/distribution/media/${a.id}`} aria-label={`자산 ${a.id} 상세 보기`}>
                    {a.id.slice(0, 8)}…
                  </Link>
                  {a.archivedAt ? <span className="dc-tag"> 보관됨</span> : null}
                </th>
                <td>
                  <span className={a.status === "ready" ? "dc-tag dc-tag-blue" : a.status === "failed" ? "dc-tag dc-tag-amber" : "dc-tag"}>{MEDIA_STATUS_LABEL[a.status]}</span>
                </td>
                <td>
                  <span className={a.rightsState === "approved" && !expired ? "dc-tag dc-tag-blue" : "dc-tag"}>{RIGHTS_LABEL[a.rightsState]}</span>
                  {expired ? <span className="ds-muted"> · 유효기한 지남({formatKst(a.rightsValidUntil)})</span> : null}
                </td>
                <td className={styles.spec}>{a.variant ? `${formatPixels(a.variant.width, a.variant.height)} · ${formatBytes(a.variant.byteSize)}` : "없음"}</td>
                <td>{SOURCE_LABEL[a.source] ?? a.source}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
