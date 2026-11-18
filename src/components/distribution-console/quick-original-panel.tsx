"use client";

/**
 * 주제로 바로 만들기(BE-SNS-QUICK-129 계약 · FE task_81ebb056ec4c).
 * 흐름: ① 주제 입력 + 외부 AI 호출 확인 → ② 제목·본문 제안 미리보기(저장 전) → ③ 편집란에서 검토·수정 → ④ 기존 createContentAction으로 원문 저장.
 * - 사람이 확인란을 선택하고 버튼을 눌렀을 때만 generateOriginalAction을 1회 호출한다(자동 호출·재시도 없음).
 * - 제안은 저장되지 않는다. "편집란에 넣기"를 눌러야 편집란이 채워지고, 저장은 "원문 저장" 버튼으로만 한다.
 *   저장에 성공하면 기존 원문 상세(?notice=saved)로 이동해 채널 초안·승인 흐름을 그대로 탄다. 승인·게시는 하지 않는다.
 * - 편집란에 사람이 고친 내용이 있으면 새 제안으로 바꾸기 전에 화면 안에서 확인을 받는다(조용히 덮어쓰지 않음).
 * - 키·공급자 응답 원문·HTTP 상태 수치는 표시하지 않는다.
 */
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { generateOriginalAction } from "@/app/admin/distribution/original-generation-action";
import { createContentAction } from "@/app/admin/distribution/contents/actions";
import type { GenerateOriginalOutcome } from "@/server/distribution/generation/original";
import { ActionForm } from "./action-form";

/** 서버 ORIGINAL_TOPIC_MAX(500 코드포인트)와 같은 값. 서버 모듈을 클라이언트로 끌어오지 않으려고 값만 둔다. */
export const QUICK_TOPIC_MAX = 500;

/**
 * 주제 길이 판정 — 서버 generateOriginal과 같은 규칙(QA R2).
 * 앞뒤 공백을 trim한 뒤 코드포인트로 센다. 서버의 UTF-16 상한(MAX*2)도 같이 본다.
 * 공백만 있으면 empty(서버는 required로 거절).
 */
export function topicStatus(raw: string): { length: number; empty: boolean; tooLong: boolean } {
  const trimmed = raw.trim();
  const length = [...trimmed].length;
  return { length, empty: length === 0, tooLong: trimmed.length > QUICK_TOPIC_MAX * 2 || length > QUICK_TOPIC_MAX };
}

type Outcome = GenerateOriginalOutcome | { status: "request_failed" };
type Copy = { tone: "warning" | "error"; title: string; body: string };
type Prefill = { title: string; body: string };

const DENY: Record<string, string> = {
  auth_not_configured: "관리자 인증이 아직 연결되지 않았습니다.",
  unauthenticated: "로그인한 관리자만 이용할 수 있습니다. 다시 로그인해 주세요.",
  forbidden: "관리자 권한이 필요합니다.",
  not_approved: "승인된 관리자만 이용할 수 있습니다. 계정 승인 상태를 확인해 주세요.",
};
export const QUICK_MISSING_LABEL: Record<string, string> = {
  enabled_flag: "생성 기능 켜기 설정",
  api_key: "생성 서비스 키",
  model: "모델 설정",
  http: "서버 연결",
  rate_limit: "사용량 한도 장치",
};
const PROVIDER: Record<string, string> = {
  timeout: "응답 시간이 초과됐습니다.",
  network: "생성 서비스에 연결하지 못했습니다.",
  rate_limited: "요청이 너무 많아 거절됐습니다.",
  auth: "생성 서비스 인증에 실패했습니다(운영 설정 확인 필요).",
  rejected: "생성 서비스가 요청을 거절했습니다.",
  http_5xx: "생성 서비스에 일시적인 오류가 있습니다.",
  bad_response: "생성 서비스 응답을 해석하지 못했습니다.",
};
const TOPIC_RULE: Record<string, string> = {
  required: "주제를 입력해 주세요.",
  max_length: `주제는 ${QUICK_TOPIC_MAX}자 이하로 줄여 주세요.`,
  control_chars: "주제에 쓸 수 없는 문자가 들어 있습니다.",
};

const label = (m: Record<string, string>, k: string, fallback: string) => (Object.hasOwn(m, k) ? (m[k] as string) : fallback);

export function missingText(missing: readonly string[]): string {
  return missing.map((m) => label(QUICK_MISSING_LABEL, m, "기타 설정")).join(", ") || "확인 필요";
}

function retryText(sec: number): string {
  if (sec < 60) return `${Math.ceil(sec)}초`;
  const min = Math.ceil(sec / 60);
  return min < 60 ? `${min}분` : `${Math.ceil(min / 60)}시간`;
}

/** ok 이외 결과의 안내. 공급자 오류·요청 실패는 비용이 발생했을 수 있음을 알리고, 호출 전 거절은 보내지 않았음을 알린다. */
export function quickOutcomeCopy(o: Exclude<Outcome, { status: "ok" }>): Copy {
  switch (o.status) {
    case "denied":
      return { tone: "error", title: "제안을 만들 수 없습니다", body: label(DENY, o.reason, "접근 권한을 확인해 주세요.") };
    case "invalid": {
      if (o.errors.some((e) => e.field === "confirmGenerate") && !o.errors.some((e) => e.field === "topic")) {
        return { tone: "error", title: "외부 AI 호출 확인이 필요합니다", body: "확인란을 선택한 뒤 다시 눌러 주세요. 생성 요청은 보내지 않았습니다." };
      }
      const topicErr = o.errors.find((e) => e.field === "topic");
      return {
        tone: "error",
        title: "주제를 확인해 주세요",
        body: `${topicErr ? label(TOPIC_RULE, topicErr.rule, "주제 값이 올바르지 않습니다.") : "요청 값이 올바르지 않습니다."} 생성 요청은 보내지 않았습니다.`,
      };
    }
    case "not_configured":
      return {
        tone: "warning",
        title: "AI 원고 제안이 아직 준비되지 않았습니다",
        body: `운영 설정이 끝나야 쓸 수 있습니다. 준비되지 않은 항목: ${missingText(o.missing)}. 생성 요청은 보내지 않았습니다.`,
      };
    case "quota_exceeded":
      return {
        tone: "warning",
        title: "사용량 한도에 도달했습니다",
        body: `${o.retryAfterSeconds !== null && o.retryAfterSeconds > 0 ? `약 ${retryText(o.retryAfterSeconds)} 뒤에 다시 시도할 수 있습니다.` : "잠시 뒤 다시 시도해 주세요."} 이번 요청은 생성 서비스로 보내지 않았습니다.`,
      };
    case "provider_error":
      return {
        tone: "error",
        title: "제안을 받지 못했습니다",
        body: `${label(PROVIDER, o.code, "생성 서비스 오류입니다.")} 자동으로 다시 시도하지 않습니다. 요청이 이미 처리돼 비용이 발생했을 수 있으니, 다시 요청할지 판단한 뒤 누르세요.`,
      };
    case "output_invalid":
      return {
        tone: "error",
        title: "받은 제안이 원고 형식에 맞지 않아 쓰지 않습니다",
        body: "제목·본문 형식이나 길이가 기준에 맞지 않았습니다. 요청이 처리돼 비용이 발생했을 수 있습니다. 편집란은 바뀌지 않았습니다.",
      };
    case "request_failed":
      return {
        tone: "error",
        title: "요청 결과를 확인하지 못했습니다",
        body: "연결이 끊겼거나 서버 응답을 받지 못했습니다. 요청이 처리돼 비용이 발생했을 수 있습니다. 편집란은 바뀌지 않았습니다.",
      };
  }
}

const TONE_CLASS = { warning: "ds-notice ds-notice--warning", error: "ds-notice ds-notice--error" } as const;
const SAVE_FIELD_LABELS = { title: "제목", body: "본문", targetPath: "연결할 사이트 경로", changeSummary: "변경 메모" };

export function QuickOriginalPanel({
  generationMissing,
  saveDisabledReason,
}: {
  /** 서버가 판정한 생성 설정 누락 항목(값·키 없이 항목 이름만). 비어 있으면 요청 가능. */
  generationMissing: readonly string[];
  /** 원문 저장을 할 수 없는 이유. null이면 저장 가능. 저장할 수 없으면 비용이 드는 생성도 잠근다. */
  saveDisabledReason: string | null;
}) {
  const [topic, setTopic] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();
  const [editor, setEditor] = useState<Prefill | null>(null);
  const [lastInserted, setLastInserted] = useState<Prefill | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const editorTitleRef = useRef<HTMLInputElement>(null);

  const { length: topicLength, empty: topicEmpty, tooLong: topicTooLong } = topicStatus(topic);
  const inactiveReason = saveDisabledReason
    ?? (generationMissing.length ? `AI 원고 제안이 아직 준비되지 않았습니다. 준비되지 않은 항목: ${missingText(generationMissing)}.` : null);
  const locked = inactiveReason !== null;

  useEffect(() => {
    if (outcome) resultRef.current?.focus();
  }, [outcome]);

  const onGenerate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || locked || topicTooLong || topicEmpty) return;
    const fd = new FormData(e.currentTarget);
    setConfirmReplace(false);
    startTransition(async () => {
      try {
        setOutcome(await generateOriginalAction(fd));
      } catch {
        setOutcome({ status: "request_failed" });
      }
    });
  };

  const suggestion = outcome?.status === "ok" ? outcome.prefill : null;
  const editorDirty = editor !== null && (lastInserted === null || editor.title !== lastInserted.title || editor.body !== lastInserted.body);

  const insert = (force: boolean) => {
    if (!suggestion) return;
    const same = editor !== null && editor.title === suggestion.title && editor.body === suggestion.body;
    if (!force && editorDirty && !same) {
      setConfirmReplace(true);
      return;
    }
    setEditor({ ...suggestion });
    setLastInserted({ ...suggestion });
    setConfirmReplace(false);
    requestAnimationFrame(() => editorTitleRef.current?.focus());
  };

  return (
    <>
      <section aria-labelledby="quick-topic" className="dc-panel">
        <h2 id="quick-topic">1. 주제 입력</h2>
        <p className="ds-muted">주제만 적으면 AI가 공통 원문의 제목과 본문을 제안합니다. 제안은 저장되지 않으며, 검토·수정한 뒤 직접 저장해야 원문이 됩니다.</p>
        {inactiveReason ? (
          <p role="status" className="ds-notice ds-notice--warning">
            {inactiveReason} 지금은 요청할 수 없습니다.
          </p>
        ) : null}
        <form onSubmit={onGenerate} className="ds-editor-fields" aria-busy={pending || undefined}>
          <fieldset disabled={locked || pending}>
            <label htmlFor="quick-topic-input">주제(최대 {QUICK_TOPIC_MAX}자)</label>
            <textarea
              id="quick-topic-input"
              name="topic"
              rows={3}
              required
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              aria-describedby="quick-topic-count"
              aria-invalid={topicTooLong || undefined}
              placeholder="예: 동네 책방이 주말 독서 모임을 시작합니다"
            />
            <p id="quick-topic-count" className={topicTooLong ? "dc-reason" : "ds-muted"}>
              {topicLength} / {QUICK_TOPIC_MAX}자(앞뒤 공백 제외){topicTooLong ? " — 글자 수를 줄여야 요청할 수 있습니다." : ""}
            </p>
            <label>
              <input type="checkbox" name="confirmGenerate" value="on" required /> 주제를 외부 AI 서비스로 보내 제안을 받는 데 동의합니다(비용 발생 가능)
            </label>
            <div className="ds-actions">
              <button type="submit" className="ds-button ds-button--primary" disabled={topicTooLong || topicEmpty}>
                {pending ? "제안을 만드는 중…" : "제목·본문 제안 받기"}
              </button>
            </div>
          </fieldset>
          {pending ? (
            <p role="status" className="ds-muted dc-reason">
              제안을 만드는 중입니다. 창을 닫거나 다시 누르지 마세요.
            </p>
          ) : null}
        </form>
      </section>

      <div ref={resultRef} tabIndex={-1} aria-live="polite">
        {outcome && outcome.status !== "ok" ? (() => {
          const c = quickOutcomeCopy(outcome);
          return (
            <div role={c.tone === "error" ? "alert" : "status"} className={TONE_CLASS[c.tone]}>
              <p><strong>{c.title}</strong></p>
              <p>{c.body}</p>
            </div>
          );
        })() : null}
        {suggestion ? (
          <section aria-labelledby="quick-preview" className="dc-panel dc-block">
            <h2 id="quick-preview">2. 저장 전 제안 — 사람 검토 필요</h2>
            <p className="ds-muted">AI가 만든 문장입니다. 사실·숫자·고유명사를 확인한 뒤 쓰세요. 아직 아무것도 저장되지 않았습니다.</p>
            <dl className="dc-facts">
              <dt>제목</dt>
              <dd>{suggestion.title}</dd>
              <dt>본문 글자 수</dt>
              <dd>{[...suggestion.body].length}자</dd>
            </dl>
            <p style={{ whiteSpace: "pre-wrap" }}>{suggestion.body}</p>
            {confirmReplace ? (
              <div role="alert" className="ds-notice ds-notice--warning">
                <p>편집란에 직접 고친 내용이 있습니다. 새 제안으로 바꾸면 고친 내용이 사라집니다.</p>
                <div className="ds-actions">
                  <button type="button" className="ds-button ds-button--danger" onClick={() => insert(true)}>
                    그래도 제안으로 바꾸기
                  </button>
                  <button type="button" className="ds-button ds-button--secondary" onClick={() => setConfirmReplace(false)}>
                    바꾸지 않기
                  </button>
                </div>
              </div>
            ) : (
              <div className="ds-actions">
                <button type="button" className="ds-button ds-button--secondary" onClick={() => insert(false)} disabled={saveDisabledReason !== null}>
                  편집란에 넣기
                </button>
              </div>
            )}
          </section>
        ) : null}
      </div>

      {editor ? (
        <section aria-labelledby="quick-edit" className="dc-panel dc-block">
          <h2 id="quick-edit">3. 검토·수정 후 원문 저장</h2>
          <p className="ds-muted">
            &quot;원문 저장&quot;을 누르면 버전 1이 생기고 원문 화면으로 이동합니다. 그 다음 채널 초안·승인은 기존 화면에서 진행합니다. 저장만으로 승인·게시되지 않습니다.
          </p>
          <ActionForm action={createContentAction} disabled={saveDisabledReason !== null} legend="원문" className="ds-editor-fields" fieldLabels={SAVE_FIELD_LABELS}>
            <label htmlFor="quick-title">제목(1~200자)</label>
            <input
              ref={editorTitleRef}
              id="quick-title"
              name="title"
              type="text"
              required
              maxLength={200}
              value={editor.title}
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
            />
            <label htmlFor="quick-body">본문</label>
            <textarea id="quick-body" name="body" rows={14} required value={editor.body} onChange={(e) => setEditor({ ...editor, body: e.target.value })} />
            <label htmlFor="quick-path">연결할 사이트 경로(선택, 예: /about)</label>
            <input id="quick-path" name="targetPath" type="text" maxLength={512} />
            <label htmlFor="quick-summary">변경 메모(선택)</label>
            <input id="quick-summary" name="changeSummary" type="text" maxLength={500} defaultValue="주제로 바로 만들기 제안을 검토해 작성" />
            <div className="ds-actions">
              <button type="submit" className="ds-button ds-button--primary">
                원문 저장
              </button>
            </div>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
