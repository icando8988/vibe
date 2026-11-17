import type { ReactNode } from "react";
import type { FormState } from "@/server/distribution/write-notice";
import type { MediaAssetDto } from "@/server/distribution/media/service";
import { ActionForm } from "./action-form";
import { CHANNEL_LABEL, MEDIA_CHANNELS, MEDIA_REASON_FIELD_LABELS, rightsDecisionOptions, type RightsDecision } from "./media-labels";
import styles from "./media.module.css";

/**
 * 권리 결정·보관 폼(FE-MEDIA-024, Design 검토 M025-01·05 반영).
 * action이 없으면 실제 제출 경로 없이 비활성 fieldset + 이유만(가짜 성공·임시 deps 없음). 이유 문단은 fieldset의 aria-describedby로 연결.
 * action이 있으면 공용 ActionForm(처리 중 잠금·입력 유지·결과 불명 새로고침) + 실패 필드에 aria-invalid·오류 요약 연결(markInvalidFields).
 * expectedVersion은 화면에 렌더된 rowVersion을 그대로 보낸다. 유효기한 datetime-local은 KST로 안내하고 서버 액션이 KST→UTC로 명시 변환한다.
 */
export type MediaFormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

function FormFrame({
  id,
  action,
  disabledReason,
  fieldLabels,
  children,
}: {
  id: string;
  action: MediaFormAction | null;
  disabledReason: string | null;
  fieldLabels: Record<string, string>;
  children: ReactNode;
}) {
  const formClass = `ds-editor-fields ${styles.mediaForm}`;
  if (action && !disabledReason) {
    return (
      <ActionForm action={action} fieldLabels={fieldLabels} className={formClass} errorSummaryId={`${id}-errors`} markInvalidFields>
        {children}
      </ActionForm>
    );
  }
  const reasonId = `${id}-disabled-reason`;
  return (
    <div className={formClass} aria-disabled="true">
      <fieldset disabled aria-describedby={reasonId}>
        {children}
      </fieldset>
      <p id={reasonId} className="ds-muted dc-reason">
        사용할 수 없음: {disabledReason ?? "저장 경로가 연결되지 않았습니다."}
      </p>
    </div>
  );
}

const DECISION_LABEL: Record<RightsDecision, string> = {
  approved: "권리 승인(사용 허용)",
  rejected: "권리 반려(사용 불가)",
  revoked: "승인 철회",
};

export function MediaRightsForm({ asset, action, disabledReason }: { asset: MediaAssetDto; action: MediaFormAction | null; disabledReason: string | null }) {
  const options = rightsDecisionOptions(asset);
  if (options.length === 0) return <p className="ds-muted">보관된 자산이라 권리 결정을 기록할 수 없습니다.</p>;
  const id = `mr-${asset.id}`;
  return (
    <FormFrame
      id={id}
      action={action}
      disabledReason={disabledReason}
      fieldLabels={{ ...MEDIA_REASON_FIELD_LABELS, assetId: "자산", expectedVersion: "자산 버전", decision: "결정", allowedChannels: "허용 채널(승인 시 1개 이상)", validUntil: "유효기한(KST)", note: "사유·근거" }}
    >
      <input type="hidden" name="assetId" value={asset.id} />
      <input type="hidden" name="expectedVersion" value={String(asset.rowVersion)} />
      <fieldset className={styles.choiceGroup}>
        <legend>결정</legend>
        {options.map((d, i) => (
          <label key={d} className={styles.choice}>
            <input type="radio" name="decision" value={d} defaultChecked={i === 0} required /> {DECISION_LABEL[d]}
          </label>
        ))}
      </fieldset>
      {asset.status !== "ready" && asset.rightsState !== "approved" ? (
        <p className={`ds-muted ${styles.formHint}`}>처리 완료(ready) 전에는 승인할 수 없습니다. 반려만 기록할 수 있습니다.</p>
      ) : null}
      {options.includes("approved") ? (
        <>
          <fieldset className={styles.choiceGroup}>
            <legend>허용 채널(승인일 때 1개 이상)</legend>
            {MEDIA_CHANNELS.map((c) => (
              <label key={c} className={styles.choice}>
                <input type="checkbox" name="allowedChannels" value={c} /> {CHANNEL_LABEL[c]}
              </label>
            ))}
          </fieldset>
          <label htmlFor={`${id}-until`}>유효기한(KST 기준 입력, 비우면 기한 없음 — 승인일 때만)</label>
          <input id={`${id}-until`} name="validUntil" type="datetime-local" aria-describedby={`${id}-until-hint`} />
          <p id={`${id}-until-hint`} className={`ds-muted ${styles.formHint}`}>
            입력한 시각은 한국 시간(KST)으로 저장됩니다.
          </p>
        </>
      ) : null}
      <label htmlFor={`${id}-note`}>사유·근거(최대 1000자, 반려·철회 때 권장)</label>
      <textarea id={`${id}-note`} name="note" rows={3} maxLength={1000} />
      <p className={`ds-muted ${styles.formHint}`}>권리 결정은 고칠 수 없는 이력으로 남습니다. 승인 후 바꾸려면 철회한 뒤 다시 승인합니다.</p>
      <button type="submit" className="ds-button ds-button--primary">
        권리 결정 기록
      </button>
    </FormFrame>
  );
}

export function MediaArchiveForm({ asset, action, disabledReason }: { asset: MediaAssetDto; action: MediaFormAction | null; disabledReason: string | null }) {
  if (asset.archivedAt) return <p className="ds-muted">이미 보관된 자산입니다.</p>;
  return (
    <FormFrame id={`ma-${asset.id}`} action={action} disabledReason={disabledReason} fieldLabels={{ ...MEDIA_REASON_FIELD_LABELS, assetId: "자산", expectedVersion: "자산 버전", confirmArchive: "보관 확인" }}>
      <input type="hidden" name="assetId" value={asset.id} />
      <input type="hidden" name="expectedVersion" value={String(asset.rowVersion)} />
      <label className={styles.choice}>
        <input type="checkbox" name="confirmArchive" required /> 이 자산을 보관합니다. 되돌릴 수 없고, 보관 후에는 새 초안·게시에 쓸 수 없습니다.
      </label>
      <p className={`ds-muted ${styles.formHint}`}>채널 초안이 쓰고 있는 자산은 서버가 보관을 거부합니다. 파일 행은 지우지 않습니다.</p>
      <button type="submit" className="ds-button ds-button--secondary">
        자산 보관
      </button>
    </FormFrame>
  );
}

/** 업로드: 원본 업로드 계약이 확정·연결될 때까지 비활성(현재 20MB 서버 정책을 브라우저 업로드 허용으로 보지 않는다). */
export function MediaUploadPanel({ reason }: { reason: string }) {
  return (
    <section aria-labelledby="md-upload-h" className="dc-panel">
      <h2 id="md-upload-h">이미지 올리기</h2>
      <p className="ds-muted">
        받는 형식: JPEG·PNG·WEBP 정지 이미지. 서버 처리 규칙: 원본 ≤20MB·4천만 픽셀 이하, 폭 320px 이상(1440px 초과는 축소), 비율 0.8~1.91(자동 자르기 없음),
        움직이는 이미지·손상 파일 거부, 사진 방향 적용·위치 등 metadata 제거 후 sRGB JPEG로 변환. 원본 파일은 저장하지 않습니다.
      </p>
      <div className="dc-disabled-action">
        <button type="button" className="ds-button ds-button--secondary" disabled aria-describedby="md-upload-reason">
          이미지 올리기
        </button>
        <p id="md-upload-reason" className="ds-muted dc-reason">
          사용할 수 없음: {reason}
        </p>
      </div>
    </section>
  );
}
