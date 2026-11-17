"use client";

/**
 * Instagram 초안 단일 이미지 선택(FE-REVISION-MEDIA-038). 기존 초안 폼(ActionForm) 안에 넣는 컨트롤.
 * - 선택 결과는 `fieldName` hidden 입력 하나에 JSON 배열로 직렬화한다(형식: {asset_id, variant_id, alt_text}[]).
 *   입력 이름은 페이지가 Backend037 계약에 맞춰 넘긴다(컴포넌트가 이름을 invent하지 않음).
 * - 기본 선택은 "현재 첨부 유지" — 본문만 고쳐 저장해도 첨부·변형·대체텍스트가 그대로 간다.
 * - 목록 조회 실패·미준비·권한 없음이면 선택을 잠그고 현재 첨부만 유지한다. 첨부 조회 실패면 hidden 입력을 만들지 않는다.
 * - 미리보기·외부 URL·서명 URL 없음. 서버가 소유·준비·변형 일치를 최종 검증한다.
 */
import { useId, useState } from "react";
import { formatBytes, formatPixels } from "./media-labels";
import { ALT_TEXT_MAX, RIGHTS_NOTE_TEXT, serializeChoice, type Choice, type SelectorModel } from "./revision-media";
import styles from "./revision-media.module.css";

const LOCK_TEXT: Record<"not_ready" | "denied" | "error", string> = {
  not_ready: "미디어 저장 연결이 준비되지 않아 이미지 목록을 불러오지 않았습니다.",
  denied: "권한이 없어 이미지 목록을 불러오지 않았습니다.",
  error: "이미지 목록을 불러오지 못했습니다.",
};

const shortId = (id: string) => `${id.slice(0, 8)}…`;

export function RevisionMediaSelector({ model, fieldName, initialChoice }: { model: SelectorModel; fieldName: string; initialChoice?: Choice }) {
  const uid = useId();
  const firstCurrent = model.mode === "attachment_unknown" ? undefined : model.current[0];
  const [choice, setChoice] = useState<Choice>(initialChoice ?? { kind: "keep" });
  const [altText, setAltText] = useState<string>(firstCurrent?.alt_text ?? "");

  if (model.mode === "attachment_unknown") {
    return (
      <fieldset className={styles.selector} disabled aria-describedby={`${uid}-unknown`}>
        <legend>이미지(단일)</legend>
        <p id={`${uid}-unknown`} className="dc-reason">
          현재 초안의 첨부 이미지를 읽지 못했습니다. 첨부가 지워지지 않도록 이 화면에서는 이미지를 바꾸거나 저장하지 않습니다. 새로 불러와 다시 확인하세요.
        </p>
      </fieldset>
    );
  }

  const serialized = serializeChoice(choice, model, altText);
  const hasCurrent = model.current.length > 0;
  const selectedCandidate = model.mode === "select" && choice.kind === "asset" ? model.candidates.find((c) => c.assetId === choice.assetId) : undefined;
  const altEditable = choice.kind === "asset";

  return (
    <fieldset className={styles.selector} aria-describedby={`${uid}-help`}>
      <legend>이미지(단일)</legend>
      <p id={`${uid}-help`} className="ds-muted">
        처리 완료된 내 이미지 하나를 고릅니다. 권리 승인 전 이미지도 붙일 수 있지만 게시 전에 권리 확인이 필요합니다. 여기서 고르지 않으면 지금 첨부가 그대로 유지됩니다.
      </p>
      {serialized ? <input type="hidden" name={fieldName} value={JSON.stringify(serialized)} /> : null}

      <label className={styles.choice}>
        <input type="radio" name={`${uid}-choice`} checked={choice.kind === "keep"} onChange={() => setChoice({ kind: "keep" })} />
        {hasCurrent ? `지금 첨부 유지 (자산 ${shortId(model.current[0]!.asset_id)})` : "지금처럼 이미지 없음"}
      </label>
      {model.mode === "select" && hasCurrent && model.currentInList === false ? (
        <p className={`ds-muted ${styles.note}`}>
          지금 첨부한 자산은 내 최근 100건 목록에 없습니다. 다른 관리자가 붙였거나 오래된 이미지일 수 있어 없어진 것으로 보지 않고 그대로 유지합니다(변형까지 그대로). 바꾸려면 아래에서 내 이미지를 새로 고르세요.
        </p>
      ) : null}

      {model.mode === "locked" ? (
        <p className="dc-reason">사용할 수 없음: {LOCK_TEXT[model.reason]} 지금 첨부는 그대로 유지하고, 해제·변경은 목록을 불러온 뒤에 할 수 있습니다.</p>
      ) : (
        <>
          {hasCurrent ? (
            <label className={styles.choice}>
              <input type="radio" name={`${uid}-choice`} checked={choice.kind === "none"} onChange={() => setChoice({ kind: "none" })} />
              첨부 해제(이미지 없음)
            </label>
          ) : null}
          {model.candidates.length === 0 ? (
            <p className="ds-muted">고를 수 있는 이미지가 없습니다(처리 완료·미보관 이미지 0건, 최근 100건 기준). 이미지 업로드는 아직 열려 있지 않습니다.</p>
          ) : (
            <ul className={styles.list} aria-label="고를 수 있는 이미지">
              {model.candidates.map((c) => (
                <li key={c.assetId}>
                  <label className={styles.choice}>
                    <input
                      type="radio"
                      name={`${uid}-choice`}
                      value={c.assetId}
                      checked={choice.kind === "asset" && choice.assetId === c.assetId}
                      onChange={() => setChoice({ kind: "asset", assetId: c.assetId })}
                      aria-describedby={`${uid}-rights-${c.assetId}`}
                    />
                    <span>
                      자산 {shortId(c.assetId)} · {formatPixels(c.width, c.height)} · {formatBytes(c.byteSize)}
                      {model.current[0]?.asset_id === c.assetId ? " · 지금 첨부" : ""}
                    </span>
                  </label>
                  <span className={c.rights === "approved_instagram" ? "dc-tag dc-tag-blue" : "dc-tag dc-tag-amber"} id={`${uid}-rights-${c.assetId}`}>
                    {RIGHTS_NOTE_TEXT[c.rights]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {altEditable ? (
        <>
          <label htmlFor={`${uid}-alt`}>대체텍스트(선택, 최대 {ALT_TEXT_MAX}자)</label>
          <input id={`${uid}-alt`} type="text" aria-describedby={`${uid}-help`} maxLength={ALT_TEXT_MAX} value={altText} onChange={(e) => setAltText(e.target.value)} />
        </>
      ) : hasCurrent ? (
        <p className="ds-muted">대체텍스트: {firstCurrent?.alt_text ? firstCurrent.alt_text : "없음"} (바꾸려면 이미지를 다시 고르세요)</p>
      ) : null}
      {selectedCandidate && selectedCandidate.rights !== "approved_instagram" ? (
        <p className="dc-reason" role="note">
          {selectedCandidate.rights === "expired"
            ? "이 이미지의 권리 유효기한이 지났습니다."
            : selectedCandidate.rights === "channel_excluded"
              ? "이 이미지의 권리 승인 채널에 Instagram이 없습니다."
              : "이 이미지는 Instagram 권리 승인 전입니다."}{" "}
          초안에는 붙일 수 있지만, 게시 전에 미디어·권리 화면에서 권리를 확인해야 합니다.
        </p>
      ) : null}
    </fieldset>
  );
}
