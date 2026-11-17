import type { MediaAssetDto } from "@/server/distribution/media/service";
import { CHANNEL_LABEL, failureText, formatBytes, formatKst, formatPixels, MEDIA_STATUS_LABEL, RIGHTS_LABEL, rightsUsableNow, SOURCE_LABEL } from "./media-labels";
import styles from "./media.module.css";

/**
 * 자산 상세 사실(FE-MEDIA-024). 값은 서버 DTO 그대로이며 텍스트로만 렌더한다.
 * 미리보기는 없다: 원본은 저장하지 않고, 변환본도 서명 URL이 필요해 화면에서 보여 주지 않는다(계약 §2).
 */
export function MediaAssetFacts({ asset, now }: { asset: MediaAssetDto; now: number }) {
  const usable = rightsUsableNow(asset, now);
  return (
    <>
      <div className={styles.axisPair} aria-label="처리 상태와 권리 상태">
        <span className={asset.status === "ready" ? "dc-tag dc-tag-blue" : "dc-tag"}>처리: {MEDIA_STATUS_LABEL[asset.status]}</span>
        <span className={usable ? "dc-tag dc-tag-blue" : "dc-tag"}>권리: {RIGHTS_LABEL[asset.rightsState]}</span>
        {asset.archivedAt ? <span className="dc-tag">보관됨</span> : null}
      </div>
      <p className="ds-muted">{usageNote(asset, usable)}</p>
      <dl className="dc-facts">
        <dt>출처</dt>
        <dd>
          {SOURCE_LABEL[asset.source] ?? asset.source}
          {asset.sourceNote ? ` · ${asset.sourceNote}` : ""}
        </dd>
        <dt>원본</dt>
        <dd className={styles.spec}>
          {asset.originalFormat ? `${asset.originalFormat.toUpperCase()} · ${formatPixels(asset.originalWidth, asset.originalHeight)} · ${formatBytes(asset.originalByteSize)}` : "검사 전"}
          <span className="ds-muted"> (원본 파일은 저장하지 않음)</span>
        </dd>
        <dt>변환본</dt>
        <dd className={styles.spec}>
          {asset.variant ? `sRGB JPEG · ${formatPixels(asset.variant.width, asset.variant.height)} · ${formatBytes(asset.variant.byteSize)}` : "없음"}
        </dd>
        {asset.variant ? (
          <>
            <dt>변환본 확인값</dt>
            <dd className={styles.spec}>sha256 {asset.variant.sha256.slice(0, 12)}…</dd>
          </>
        ) : null}
        {asset.status === "failed" ? (
          <>
            <dt>실패 이유</dt>
            <dd>{failureText(asset.failureCode)} 같은 자산은 다시 처리하지 않습니다. 업로드가 준비되면 고친 파일로 새 자산을 만드세요.</dd>
          </>
        ) : null}
        <dt>권리 허용 채널</dt>
        <dd>{asset.allowedChannels?.length ? asset.allowedChannels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ") : "없음"}</dd>
        <dt>권리 유효기한</dt>
        <dd>{asset.rightsState === "approved" ? (asset.rightsValidUntil ? formatKst(asset.rightsValidUntil) : "기한 없음") : "—"}</dd>
        {asset.archivedAt ? (
          <>
            <dt>보관</dt>
            <dd>{formatKst(asset.archivedAt)} — 되돌릴 수 없음</dd>
          </>
        ) : null}
        <dt>버전</dt>
        <dd>{asset.rowVersion}</dd>
      </dl>
    </>
  );
}

/** 상태 설명 — 보관을 가장 먼저(M025-02). 권리 승인은 게시 가능의 종합 판정이 아니다(게시 직전 서버가 처리·변환본·채널·유효기한을 다시 확인). */
function usageNote(asset: MediaAssetDto, rightsUsable: boolean): string {
  if (asset.archivedAt) return "보관된 자산이라 새 초안·게시용으로 선택할 수 없습니다.";
  if (asset.status !== "ready") return "처리가 끝나지 않아 게시에 쓸 수 없습니다. 처리 완료와 권리 승인이 모두 필요합니다.";
  if (asset.rightsState === "approved" && !rightsUsable) return "권리 유효기한이 지나 게시에 쓸 수 없습니다.";
  if (!rightsUsable) return "처리는 끝났지만 권리가 승인되지 않아 게시에 쓸 수 없습니다.";
  return "권리가 승인된 채널에서만 쓸 수 있습니다. 실제 게시 가능 여부는 게시 직전에 서버가 다시 확인합니다.";
}
