"use client";

/**
 * 서버 액션 폼(AUTOPOST-BLOG-FLOW-015, CONTENT-014 입력 유실 보완).
 * - 제출은 onSubmit에서 FormData를 만들어 useActionState 액션으로 보낸다(`<form action>`의 자동 초기화를 쓰지 않음)
 *   → 실패해도 사용자가 입력한 값이 필드에 그대로 남는다. 입력값을 URL·localStorage·쿠키에 싣지 않는다.
 * - 처리 중에는 fieldset 전체를 잠가 중복 제출을 막는다(누른 버튼의 name/value는 submitter로 전달).
 * - 서버는 매 제출마다 세션 actor·D1·DB를 다시 검증한다. 성공은 서버 액션의 redirect로만 표시된다.
 * - 결과 불명(uncertain)이면 자동 재전송 없이 "최신 상태 다시 불러오기"를 제공한다.
 */
import { startTransition, useActionState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { INITIAL_FORM_STATE, type FormState } from "@/server/distribution/write-notice";
import { WriteNoticeView } from "./write-notice-view";

export function ActionForm({
  action,
  disabled = false,
  legend,
  fieldLabels = {},
  className = "ds-editor-fields",
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  disabled?: boolean;
  legend?: ReactNode;
  fieldLabels?: Record<string, string>;
  className?: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const router = useRouter();

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
        <p role="alert" className="dc-reason">
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
      <form onSubmit={onSubmit} className={className} aria-busy={pending || undefined}>
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
