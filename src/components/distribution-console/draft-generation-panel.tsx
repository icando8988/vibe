"use client";

/**
 * 채널 텍스트 초안 AI 제안(DRAFT-GEN-001 계약 · FE task_b2f8b2d176d4).
 * - 승인된 현재 원문 버전만 입력으로 쓴다. 사람이 외부 생성 확인란을 선택하고 버튼을 눌렀을 때만 서버 액션을 1회 호출한다(자동 재시도 없음).
 * - 결과는 **저장되지 않은 제안**이다. "편집란에 넣기"는 기존 리비전 편집란(textarea) 값만 바꾸며,
 *   저장은 사람이 기존 "초안 저장"(appendDraftRevision — 기대 리비전 번호·원문 버전 검사)으로만 한다. 승인·게시는 하지 않는다.
 * - 편집란에 저장하지 않은 수정이 있으면 덮어쓰기 전에 화면 안에서 확인을 받는다(조용히 덮어쓰지 않음).
 * - 키·공급자 응답 원문·오류 세부는 표시하지 않는다(서버가 주는 상태 코드만 사용).
 */
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { generateChannelDraftAction } from "@/app/admin/distribution/generation-actions";
import type { GenerateDraftOutcome, GenerationChannel } from "@/server/distribution/generation/types";

type Outcome = GenerateDraftOutcome | { status: "request_failed" };
type Copy = { tone: "info" | "warning" | "error"; title: string; body?: string };

const DENY: Record<string, string> = {
  auth_not_configured: "관리자 인증이 아직 연결되지 않았습니다.",
  unauthenticated: "로그인한 관리자만 이용할 수 있습니다. 다시 로그인해 주세요.",
  forbidden: "관리자 권한이 필요합니다.",
  not_approved: "승인된 관리자만 이용할 수 있습니다. 계정 승인 상태를 확인해 주세요.",
};
const MISSING: Record<string, string> = {
  enabled_flag: "생성 기능 켜기 설정",
  api_key: "생성 서비스 키",
  model: "모델 설정",
  http: "서버 연결",
  rate_limit: "사용량 한도 장치",
};
const SOURCE: Record<string, string> = {
  archived: "보관된 원문이라 만들 수 없습니다.",
  not_approved: "원문 현재 버전이 승인되지 않았습니다. 원문 화면에서 승인한 뒤 다시 시도하세요.",
  stale: "원문이 그 사이 새 버전으로 바뀌었습니다. 화면을 새로 불러온 뒤 다시 시도하세요.",
  empty: "원문 본문이 비어 있어 만들 수 없습니다.",
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
const OUTPUT: Record<string, string> = {
  not_json: "형식이 맞지 않음",
  missing_body: "본문 없음",
  empty: "빈 본문",
  too_long: "채널 글자 수 한도 초과",
  control_chars: "허용되지 않는 문자 포함",
  bad_hashtags: "해시태그 형식 오류",
  finish_length: "응답이 길이 제한으로 잘림",
};
const WARN: Record<string, string> = {
  link_removed: "원문에 있던 링크가 제안에서 빠졌습니다. 필요하면 직접 넣어 주세요.",
  hashtags_trimmed: "해시태그가 30개를 넘어 앞의 30개만 남겼습니다.",
};

const label = (m: Record<string, string>, k: string, fallback: string) => (Object.hasOwn(m, k) ? (m[k] as string) : fallback);

/** ok 이외 결과의 안내. 요청 실패·시간 초과는 과금됐을 수 있음을 알린다. */
export function outcomeCopy(o: Exclude<Outcome, { status: "ok" }>): Copy {
  switch (o.status) {
    case "denied":
      return { tone: "error", title: "제안을 만들 수 없습니다", body: label(DENY, o.reason, "접근 권한을 확인해 주세요.") };
    case "invalid":
      return o.errors.some((e) => e.field === "confirmGenerate")
        ? { tone: "error", title: "외부 생성 확인이 필요합니다", body: "확인란을 선택한 뒤 다시 눌러 주세요." }
        : { tone: "error", title: "요청 값이 올바르지 않습니다", body: "화면을 새로 불러온 뒤 다시 시도하세요." };
    case "not_configured":
      return {
        tone: "warning",
        title: "AI 초안 생성이 아직 준비되지 않았습니다",
        body: `운영 설정이 끝나야 쓸 수 있습니다. 준비되지 않은 항목: ${o.missing.map((m) => label(MISSING, m, "기타 설정")).join(", ") || "확인 필요"}. 생성 요청은 보내지 않았습니다.`,
      };
    case "source_unavailable":
      return { tone: "error", title: "원문을 불러오지 못했습니다", body: "생성 요청은 보내지 않았습니다. 잠시 뒤 화면을 새로 불러와 주세요." };
    case "not_found":
      return { tone: "error", title: "원문을 찾지 못했습니다", body: "없거나 볼 권한이 없는 원문입니다." };
    case "source_not_ready":
      return { tone: "warning", title: "이 원문으로는 지금 만들 수 없습니다", body: `${label(SOURCE, o.reason, "원문 상태를 확인해 주세요.")} 생성 요청은 보내지 않았습니다.` };
    case "provider_error":
      return {
        tone: "error",
        title: "제안을 받지 못했습니다",
        body: `${label(PROVIDER, o.code, "생성 서비스 오류입니다.")} 자동으로 다시 시도하지 않습니다. 요청이 이미 처리돼 비용이 발생했을 수 있으니, 다시 요청할지 판단한 뒤 누르세요.`,
      };
    case "output_invalid":
      return {
        tone: "error",
        title: "받은 제안이 채널 규칙에 맞지 않아 쓰지 않습니다",
        body: `사유: ${o.reasons.map((r) => label(OUTPUT, r, "기타")).join(", ") || "확인 필요"}. 편집란은 바뀌지 않았습니다.`,
      };
    case "request_failed":
      return {
        tone: "error",
        title: "요청 결과를 확인하지 못했습니다",
        body: "연결이 끊겼거나 서버 응답을 받지 못했습니다. 요청이 처리돼 비용이 발생했을 수 있습니다. 편집란은 바뀌지 않았습니다.",
      };
    case "quota_exceeded":
      return {
        tone: "warning",
        title: "사용량 한도에 도달했습니다",
        body: `${o.retryAfterSeconds !== null && o.retryAfterSeconds > 0 ? `약 ${retryText(o.retryAfterSeconds)} 뒤에 다시 시도할 수 있습니다.` : "잠시 뒤 다시 시도해 주세요."} 이번 요청은 생성 서비스로 보내지 않았습니다. 편집란은 바뀌지 않았습니다.`,
      };
  }
}

function retryText(sec: number): string {
  if (sec < 60) return `${Math.ceil(sec)}초`;
  const min = Math.ceil(sec / 60);
  return min < 60 ? `${min}분` : `${Math.ceil(min / 60)}시간`;
}

const TONE_CLASS = { info: "ds-notice", warning: "ds-notice ds-notice--warning", error: "ds-notice ds-notice--error" } as const;

export function DraftGenerationPanel({
  contentId,
  channel,
  channelLabel,
  sourceVersionId,
  sourceVersionNo,
  sourceApproved,
  disabledReason,
  editorId,
}: {
  contentId: string;
  channel: GenerationChannel;
  channelLabel: string;
  /** 화면에 렌더된 현재 원문 버전 id(리비전 폼의 expectedContentVersionId와 같은 값) */
  sourceVersionId: string;
  sourceVersionNo: number;
  /** 화면 기준 현재 원문 버전 승인 여부(참고용 — 서버가 다시 판정) */
  sourceApproved: boolean;
  /** 보관 등으로 생성 버튼을 잠글 사유(없으면 null) */
  disabledReason: string | null;
  /** 제안을 넣을 리비전 편집란 id. 초안이 아직 없으면 null */
  editorId: string | null;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [copied, setCopied] = useState<"none" | "done" | "stale" | "no_editor">("none");
  const resultRef = useRef<HTMLDivElement>(null);
  const lastInserted = useRef<string | null>(null);
  const seq = useRef(0);
  const [shownSeq, setShownSeq] = useState(0);

  useEffect(() => {
    if (shownSeq > 0) resultRef.current?.focus();
  }, [shownSeq]);

  const locked = !sourceApproved || disabledReason !== null;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || locked) return;
    const fd = new FormData(e.currentTarget);
    fd.set("contentId", contentId);
    fd.set("channel", channel);
    fd.set("expectedContentVersionId", sourceVersionId);
    setConfirmReplace(false);
    setCopied("none");
    startTransition(async () => {
      let next: Outcome;
      try {
        next = await generateChannelDraftAction(fd);
      } catch {
        next = { status: "request_failed" };
      }
      setOutcome(next);
      seq.current += 1;
      setShownSeq(seq.current);
    });
  };

  const editor = (): HTMLTextAreaElement | null => {
    if (!editorId) return null;
    const el = document.getElementById(editorId);
    return el instanceof HTMLTextAreaElement ? el : null;
  };

  const insert = (body: string, prefillVersionId: string, force: boolean) => {
    if (prefillVersionId !== sourceVersionId) {
      setCopied("stale");
      return;
    }
    const el = editor();
    if (!el) {
      setCopied("no_editor");
      return;
    }
    const dirty = el.value !== el.defaultValue && el.value !== lastInserted.current && el.value !== body;
    if (dirty && !force) {
      setConfirmReplace(true);
      return;
    }
    el.value = body;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    lastInserted.current = body;
    setConfirmReplace(false);
    setCopied("done");
    el.focus();
  };

  const ok = outcome?.status === "ok" ? outcome : null;
  const fail = outcome && outcome.status !== "ok" ? outcomeCopy(outcome) : null;

  return (
    <section aria-labelledby="gen-title" className="dc-block">
      <h3 id="gen-title">AI 초안 제안(저장 전)</h3>
      <p className="ds-muted">
        승인된 원문 v{sourceVersionNo}을 외부 AI 서비스(OpenAI)로 보내 {channelLabel} 초안 제안을 받습니다. 요청할 때마다 비용이 발생할 수 있습니다. 제안은 자동 저장·승인·게시되지 않으며, 편집란에 넣은
        뒤 검토하고 &lsquo;초안 저장&rsquo;을 눌러야 저장됩니다.
      </p>

      {!sourceApproved ? (
        <p className="ds-muted dc-reason">원문 현재 버전(v{sourceVersionNo})이 승인돼야 제안을 받을 수 있습니다. 원문 화면에서 먼저 승인해 주세요.</p>
      ) : disabledReason ? (
        <p className="ds-muted dc-reason">{disabledReason}</p>
      ) : null}

      <form onSubmit={onSubmit} aria-busy={pending} className="ds-editor-fields">
        {/* contentId·channel·expectedContentVersionId는 hidden 입력 대신 제출 시 렌더 값으로 붙인다(같은 화면 리비전 폼의 hidden 이름과 중복 방지). */}
        <fieldset disabled={locked || pending}>
          <legend className="ds-visually-hidden">AI 초안 제안 요청</legend>
          <p>
            <input id="gen-confirm" type="checkbox" name="confirmGenerate" value="on" required />{" "}
            <label htmlFor="gen-confirm">원문을 외부 AI 서비스로 보내 제안을 받는 데 동의합니다(비용 발생 가능)</label>
          </p>
          <div className="ds-actions">
            <button type="submit" className="ds-button ds-button--secondary">
              {pending ? "제안을 만드는 중…" : `${channelLabel} 초안 제안 받기`}
            </button>
          </div>
        </fieldset>
      </form>

      <div aria-live="polite">
        {pending ? <p className="ds-muted">제안을 만드는 중입니다. 창을 닫거나 다시 누르지 마세요.</p> : null}
      </div>

      {outcome && !pending ? (
        <div ref={resultRef} tabIndex={-1} key={shownSeq}>
          {fail ? (
            <div className={TONE_CLASS[fail.tone]} role={fail.tone === "error" ? "alert" : "status"}>
              <p id="gen-result-title">
                <strong>{fail.title}</strong>
              </p>
              {fail.body ? <p>{fail.body}</p> : null}
            </div>
          ) : ok ? (
            <div className="dc-panel">
              <h4 id="gen-result-title">저장 전 제안 — 사람 검토 필요</h4>
              <dl className="dc-facts">
                <dt>기준 원문</dt>
                <dd>v{sourceVersionNo}</dd>
                <dt>모델</dt>
                <dd>{ok.draft.model}</dd>
                <dt>생성 시각</dt>
                <dd>
                  <time dateTime={ok.draft.generatedAt}>{formatTime(ok.draft.generatedAt)}</time>
                </dd>
                <dt>글자 수</dt>
                <dd>{ok.draft.length.toLocaleString("ko-KR")}자</dd>
              </dl>
              {ok.draft.warnings.length > 0 ? (
                <ul aria-label="검토 경고">
                  {ok.draft.warnings.map((w) => (
                    <li key={w}>{label(WARN, w, "검토가 필요한 항목이 있습니다.")}</li>
                  ))}
                </ul>
              ) : null}
              <p className="ds-muted">제안 내용</p>
              <div style={{ whiteSpace: "pre-wrap" }}>
                {ok.draft.body}
              </div>

              {confirmReplace ? (
                <div className="ds-notice ds-notice--warning" role="alert">
                  <p>
                    <strong>편집란에 저장하지 않은 수정이 있습니다</strong>
                  </p>
                  <p>제안으로 바꾸면 지금 편집란에서 고친 내용이 사라집니다.</p>
                  <div className="ds-actions">
                    <button type="button" className="ds-button ds-button--danger" onClick={() => insert(ok.prefill.body, ok.prefill.expectedContentVersionId, true)}>
                      그래도 제안으로 바꾸기
                    </button>
                    <button type="button" className="ds-button ds-button--secondary" onClick={() => setConfirmReplace(false)}>
                      바꾸지 않기
                    </button>
                  </div>
                </div>
              ) : (
                <div className="ds-actions">
                  <button
                    type="button"
                    className="ds-button ds-button--primary"
                    disabled={!editorId}
                    aria-describedby={editorId ? undefined : "gen-no-editor"}
                    onClick={() => insert(ok.prefill.body, ok.prefill.expectedContentVersionId, false)}
                  >
                    편집란에 넣기
                  </button>
                </div>
              )}
              {!editorId ? (
                <p id="gen-no-editor" className="ds-muted dc-reason">
                  {channelLabel} 초안을 먼저 만들어야 편집란에 넣을 수 있습니다.
                </p>
              ) : null}
              <div aria-live="polite">
                {copied === "done" ? <p>편집란에 넣었습니다. 아직 저장되지 않았습니다 — 검토·수정한 뒤 &lsquo;초안 저장&rsquo;을 눌러 주세요.</p> : null}
                {copied === "stale" ? <p>이 제안은 지금 화면의 원문 버전과 다른 버전으로 만들어져 넣지 않았습니다. 화면을 새로 불러와 다시 요청해 주세요.</p> : null}
                {copied === "no_editor" ? <p>편집란을 찾지 못했습니다. 화면을 새로 불러와 주세요.</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "확인 필요";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(d);
}
