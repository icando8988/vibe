"use client";

/**
 * 서버 액션 폼(AUTOPOST-BLOG-FLOW-015, CONTENT-014 입력 유실 보완).
 * - 제출은 onSubmit에서 FormData를 만들어 useActionState 액션으로 보낸다(`<form action>`의 자동 초기화를 쓰지 않음)
 *   → 실패해도 사용자가 입력한 값이 필드에 그대로 남는다. 입력값을 URL·localStorage·쿠키에 싣지 않는다.
 * - 처리 중에는 fieldset 전체를 잠가 중복 제출을 막는다(누른 버튼의 name/value는 submitter로 전달).
 * - 서버는 매 제출마다 세션 actor·D1·DB를 다시 검증한다. 성공은 서버 액션의 redirect로만 표시된다.
 * - 결과 불명(uncertain)이면 자동 재전송 없이 "최신 상태 다시 불러오기"를 제공한다.
 */
import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { INITIAL_FORM_STATE, type FormState } from "@/server/distribution/write-notice";
import { WriteNoticeView } from "./write-notice-view";

export function ActionForm({
  action,
  disabled = false,
  legend,
  fieldLabels = {},
  className = "ds-editor-fields",
  errorSummaryId,
  markInvalidFields = false,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  disabled?: boolean;
  legend?: ReactNode;
  fieldLabels?: Record<string, string>;
  className?: string;
  /** 선택(FE-MEDIA-024): 오류 요약 문단 id. 주지 않으면 기존과 같다. */
  errorSummaryId?: string;
  /** 선택(FE-MEDIA-024): 실패한 필드 이름과 같은 입력에 aria-invalid·요약 연결을 달고 첫 칸에 초점. 기본 false(기존 동작). */
  markInvalidFields?: boolean;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;
    if (!markInvalidFields || !form) return;
    markInvalidControls(form, state.fields, errorSummaryId)?.focus?.();
  }, [state.seq, state.fields, markInvalidFields, errorSummaryId]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || disabled) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter ?? undefined);
    startTransition(() => formAction(fd));
  };

  return (
    <div className="dc-action-form">
      {state.seq > 0 ? <WriteNoticeView key={state.seq} notice={state.notice} /> : null}
      {state.fields.length > 0 ? (
        <p role="alert" className="dc-reason" id={errorSummaryId}>
          확인할 항목: {state.fields.map((f) => fieldLabels[f] ?? f).join(", ")}
        </p>
      ) : null}
      {state.notice === "uncertain" ? (
        <p>
          <button type="button" className="ds-button ds-button--secondary" onClick={() => router.refresh()}>
            최신 상태 다시 불러오기
          </button>
        </p>
      ) : null}
      <form ref={formRef} onSubmit={onSubmit} className={className} aria-busy={pending || undefined}>
        <fieldset disabled={disabled || pending}>
          {legend ? <legend>{legend}</legend> : null}
          {children}
        </fieldset>
        {pending ? (
          <p role="status" className="ds-muted dc-reason">
            처리 중입니다. 결과를 기다리는 동안 다시 누르지 마세요.
          </p>
        ) : null}
      </form>
    </div>
  );
}

/** markInvalidFields용 최소 DOM 계약(시험에서 가짜 요소로 대체 가능). */
type MarkableEl = {
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
  type?: string;
  focus?: () => void;
};
type MarkableRoot = { querySelectorAll(selector: string): ArrayLike<MarkableEl> };

const SAFE_FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/**
 * 이전 표시를 지우고, 실패 필드 이름과 같은 입력(hidden 제외)에 aria-invalid와 오류 요약 연결을 단다. 첫 대상 요소를 돌려준다.
 * `reason:…` 같은 이름(입력 없음)이나 안전하지 않은 이름은 건너뛴다(선택자 주입 방지, CSS.escape 불필요).
 */
export function markInvalidControls(root: MarkableRoot, fields: readonly string[], summaryId?: string): MarkableEl | null {
  for (const el of Array.from(root.querySelectorAll("[data-af-invalid]"))) {
    el.removeAttribute("aria-invalid");
    el.removeAttribute("data-af-invalid");
    const kept = (el.getAttribute("aria-describedby") ?? "").split(" ").filter((t) => t && t !== summaryId);
    if (kept.length) el.setAttribute("aria-describedby", kept.join(" "));
    else el.removeAttribute("aria-describedby");
  }
  let first: MarkableEl | null = null;
  for (const name of fields) {
    if (!SAFE_FIELD_NAME.test(name)) continue;
    for (const el of Array.from(root.querySelectorAll(`[name="${name}"]`))) {
      if (el.type === "hidden") continue;
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("data-af-invalid", "");
      if (summaryId) {
        const ids = new Set((el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean));
        ids.add(summaryId);
        el.setAttribute("aria-describedby", [...ids].join(" "));
      }
      first ??= el;
    }
  }
  return first;
}
