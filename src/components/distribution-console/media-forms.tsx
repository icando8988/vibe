import type { ReactNode } from "react";
import type { FormState } from "@/server/distribution/write-notice";
import type { MediaAssetDto } from "@/server/distribution/media/service";
import { ActionForm } from "./action-form";
import type { WriteNoticeOverrides } from "./write-notice-view";
import { StatusNotice } from "../status-notice";
import { CHANNEL_LABEL, MEDIA_CHANNELS, MEDIA_REASON_FIELD_LABELS, rightsDecisionOptions, type RightsDecision } from "./media-labels";
import styles from "./media.module.css";

/**
 * 권리 결정·보관 폼(FE-MEDIA-024, Design 검토 M025-01·05 반영).
 * action이 없으면 실제 제출 경로 없이 비활성 fieldset + 이유만(가짜 성공·임시 deps 없음). 이유 문단은 fieldset의 aria-describedby로 연결.
 * action이 있으면 공용 ActionForm(처리 중 잠금·입력 유지·결과 불명 새로고침) + 실패 필드에 aria-invalid·오류 요약 연결(markInvalidFields).
 * expectedVersion은 화면에 렌더된 rowVersion을 그대로 보낸다. 유효기한 datetime-local은 KST로 안내하고 서버 액션이 KST→UTC로 명시 변환한다.
 */
export type MediaFormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * 미디어 문맥 안내(D028-02/03). 공용 안내의 원문·초안·체크리스트 문장을 자산 기준으로 바꾼다.
 * 충돌: 입력은 실패 직후 이 화면에 남지만 새로고침하면 사라질 수 있음을 밝히고, 최신 상태는 새 탭에서 확인하게 한다
 * (이 화면의 expectedVersion은 바꾸지 않음 — 자동 덮어쓰기·자동 재제출 없음).
 */
export function mediaNoticeOverrides(assetId: string, invalidBody: string): WriteNoticeOverrides {
  const latest = (
    <p>
      <a className="ds-text-link" href={`/admin/distribution/media/${assetId}`} target="_blank" rel="noopener noreferrer">
        이 자산의 최신 상태를 새 탭에서 보기
      </a>
    </p>
  );
  return {
    invalid: { title: "입력값을 확인해 주세요", body: invalidBody },
    conflict_version: {
      title: "이 자산이 다른 곳에서 먼저 바뀌었습니다",
      body: "저장하지 않았습니다. 입력은 지금 이 화면에 남아 있지만, 이 화면을 새로 고치면 사라질 수 있습니다. 필요한 입력(사유 등)을 먼저 복사해 두고, 새 탭에서 최신 상태를 확인한 뒤 이 화면을 새로 불러와 다시 결정하세요. 자동으로 다시 저장하지 않았습니다.",
      extra: latest,
    },
    archived: { title: "이미 보관된 자산입니다", body: "보관된 자산에는 권리 결정·보관을 기록할 수 없습니다. 저장하지 않았습니다.", extra: latest },
    invalid_transition: {
      title: "자산의 지금 상태에서는 기록할 수 없습니다",
      body: "처리 상태나 권리 상태가 이미 바뀌었을 수 있습니다. 저장하지 않았습니다. 입력을 복사해 둔 뒤 최신 상태를 확인하세요.",
      extra: latest,
    },
    not_found: { title: "자산을 찾지 못했습니다", body: "없거나 다른 관리자의 자산입니다. 미디어 목록에서 다시 선택하세요." },
  };
}

export const RIGHTS_INVALID_BODY = "표시된 항목을 확인하세요. 권리 승인에는 허용 채널이 1개 이상 필요합니다. 유효기한은 비워 두거나 날짜·시각을 모두 입력합니다. 사유는 선택이며 최대 1000자, 줄바꿈·탭 없이 한 줄로 입력합니다.";
export const ARCHIVE_INVALID_BODY = "보관하지 않았습니다. 아래 '확인할 항목'에 표시된 항목이나 거절 사유를 확인하세요.";
/** 보관 폼 필드·사유 라벨(R031-02): 체크 누락은 confirmArchive, 사용 중 자산 거절은 reason:asset_referenced로 따로 안내한다. */
export const ARCHIVE_FIELD_LABELS: Record<string, string> = { ...MEDIA_REASON_FIELD_LABELS, assetId: "자산", expectedVersion: "자산 버전", confirmArchive: "보관 확인('되돌릴 수 없음' 체크 필요)" };

function FormFrame({
  id,
  action,
  disabledReason,
  fieldLabels,
  noticeOverrides,
  children,
}: {
  id: string;
  action: MediaFormAction | null;
  disabledReason: string | null;
  fieldLabels: Record<string, string>;
  noticeOverrides: WriteNoticeOverrides;
  children: ReactNode;
}) {
  const formClass = `ds-editor-fields ${styles.mediaForm}`;
  if (action && !disabledReason) {
    return (
      <ActionForm action={action} fieldLabels={fieldLabels} className={formClass} errorSummaryId={`${id}-errors`} markInvalidFields noticeOverrides={noticeOverrides}>
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
      fieldLabels={{ ...MEDIA_REASON_FIELD_LABELS, assetId: "자산", expectedVersion: "자산 버전", decision: "결정", allowedChannels: "허용 채널(승인 시 1개 이상)", validUntil: "유효기한(KST, 날짜·시각 모두)", note: "사유·근거(최대 1000자, 줄바꿈·탭 없이 한 줄)" }}
      noticeOverrides={mediaNoticeOverrides(asset.id, RIGHTS_INVALID_BODY)}
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
      <label htmlFor={`${id}-note`}>사유·근거(선택, 최대 1000자, 반려·철회 때 권장)</label>
      <textarea id={`${id}-note`} name="note" rows={3} maxLength={1000} aria-describedby={`${id}-note-hint`} />
      <p id={`${id}-note-hint`} className={`ds-muted ${styles.formHint}`}>
        줄바꿈·탭은 저장할 수 없습니다. 한 줄로 이어서 입력하세요(붙여 넣은 글의 줄바꿈도 해당).
      </p>
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
    <FormFrame
      id={`ma-${asset.id}`}
      action={action}
      disabledReason={disabledReason}
      fieldLabels={ARCHIVE_FIELD_LABELS}
      noticeOverrides={mediaNoticeOverrides(asset.id, ARCHIVE_INVALID_BODY)}
    >
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

/**
 * 미디어 화면 상단 기능 상태(D028-01). 공용 ConsoleShell 기본 안내("입력·버튼 비동작")를 바꾸지 않고 이 화면 gateNotice로만 쓴다.
 * 조회 성공일 때만 "서버에 저장"을 말하고, 준비 전·오류에는 저장을 약속하지 않는다. 업로드 비활성·실제 게시 gate 닫힘은 항상 밝힌다.
 */
export function MediaGateNotice({ listState }: { listState: "ok" | "not_ready" | "denied" | "error" | "not_loaded" }) {
  const metadata =
    listState === "not_loaded"
      ? "잘못된 주소라 자산을 조회하지 않았습니다. 미디어 목록에서 자산을 선택하세요."
      : listState === "ok"
      ? "자산 조회·권리 결정·보관은 실제 서버에 저장됩니다(저장 결과는 제출 후 서버 응답으로 안내)."
      : listState === "not_ready"
        ? "미디어 저장 연결이 준비되지 않아 자산 조회·권리 결정·보관을 할 수 없습니다."
        : listState === "denied"
          ? "권한이 없어 자산 조회·권리 결정·보관을 할 수 없습니다."
          : "자산 목록을 불러오지 못해 지금은 권리 결정·보관을 할 수 없습니다.";
  return (
    <StatusNotice tone={listState === "ok" ? "info" : "warning"} title="미디어 기능 상태 · 업로드 비활성 · 실제 게시 gate 닫힘">
      <p>{metadata}</p>
      <p>이미지 업로드는 최종 계약 인수와 저장소 연결 검증 전이라 비활성입니다. 권리를 승인해도 실제 게시는 별도 gate로 닫혀 있습니다.</p>
    </StatusNotice>
  );
}

/** 업로드: 원본 업로드 계약이 확정·연결될 때까지 비활성(현재 20MB 서버 정책을 브라우저 업로드 허용으로 보지 않는다). */
export function MediaUploadPanel({ reason }: { reason: string }) {
  return (
    <section aria-labelledby="md-upload-h" className="dc-panel">
      <h2 id="md-upload-h">이미지 올리기</h2>
      <p className="ds-muted">
        받는 형식: JPEG·PNG·WEBP 정지 이미지. 서버 처리 규칙: 원본 ≤20MB·4천만 픽셀 이하, 폭 320px 이상(1440px 초과는 축소), 비율 0.8~1.91(자동 자르기 없음),
        움직이는 이미지·손상 파일 거부, 사진 방향 적용·위치 등 metadata 제거 후 sRGB JPEG로 변환.
      </p>
      <p className="ds-muted">
        업로드가 열리면 원본은 비공개 임시 저장소에 보관해 처리한 뒤 삭제를 시도합니다. 삭제 실패·만료·취소로 남은 원본을 정리하는 작업은 아직 없습니다.
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

/** 페이지 수준 saved 안내(R031-01): 주소의 표시만으로 저장을 단정하지 않고, 아래 다시 불러온 자산 상태로 확인하게 한다. 자산 링크는 만들지 않는다. */
export const MEDIA_PAGE_NOTICE_OVERRIDES: WriteNoticeOverrides = {
  saved: { title: "요청을 마치고 화면을 다시 불러왔습니다", body: "결과는 아래에 서버에서 다시 불러온 자산 상태로 확인하세요." },
};
