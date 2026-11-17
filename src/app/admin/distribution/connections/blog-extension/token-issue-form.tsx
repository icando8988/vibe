"use client";

/**
 * 토큰 발급 패널(클라이언트) — UX-FIX-008 BC-01/02/03/05/07.
 *
 * 표시 세션(BC-01): 발급 폼과 결과는 IssueSession 하나의 수명 안에 있다. "값 표시 종료"를 누르면 부모가
 * 세션 컴포넌트를 언마운트한다 → useActionState가 가진 결과(원문 포함)와 복사 상태가 React 트리에서 함께 사라진다.
 * CSS로 숨기지 않는다. 부모에는 원문 없이 메타데이터(이름·발급·만료)만 남긴다.
 * React가 보장하는 범위는 "이 컴포넌트가 더 이상 참조하지 않음"까지이며, 메모리 즉시 소거나
 * 이미 복사된 클립보드·확장에 저장된 값의 삭제를 뜻하지 않는다.
 * 원문은 URL·localStorage·sessionStorage·쿠키에 넣지 않는다.
 */
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { issueExtensionTokenAction, type IssueField, type IssueState } from "./actions";
import { DISPLAY_TZ_LABEL, formatKst } from "./format";

const INITIAL: IssueState = { status: "idle" };

const REJECT_TEXT: Record<string, string> = {
  denied: "승인된 관리자만 발급할 수 있습니다. 로그인 상태와 승인 상태를 확인해 주세요.",
  invalid: "입력값을 확인해 주세요.",
  not_ready: "서버 연결 준비 전이라 발급할 수 없습니다.",
  token_limit: "유효한 토큰이 10개입니다. 목록에서 쓰지 않는 토큰을 철회한 뒤 다시 발급해 주세요.",
  failed: "서버가 발급을 거절했습니다. 아무 토큰도 만들어지지 않았습니다.",
};
const FIELD_TEXT: Record<IssueField, string> = {
  label: "이름은 1~60자로, 줄바꿈 같은 제어문자 없이 적어 주세요.",
  ttlDays: "유효 기간은 30일·90일·180일 중에서 고르세요.",
};

type ClosedMeta = { label: string; createdAt: string; expiresAt: string };

export function TokenIssuePanel() {
  // 세션 번호를 key로 써서 새 세션마다 상태를 처음부터 시작한다(이전 결과·복사 상태 재사용 없음).
  const [session, setSession] = useState(1);
  const [closed, setClosed] = useState<ClosedMeta | null>(null);
  const closedHeading = useRef<HTMLHeadingElement>(null);

  // 표시 종료 전이에서만 요약 제목으로 초점을 옮긴다(렌더마다 끌지 않음).
  useEffect(() => {
    if (closed) closedHeading.current?.focus();
  }, [closed]);

  if (closed) {
    return (
      <div className="dc-block">
        <h3 tabIndex={-1} ref={closedHeading}>
          값 표시를 종료했습니다
        </h3>
        <p>
          이름: {closed.label} · 발급: {formatKst(closed.createdAt)} · 만료: {formatKst(closed.expiresAt)}
        </p>
        <p className="ds-muted">
          토큰 값은 이 화면에서 다시 볼 수 없습니다. 종료는 철회가 아니며 토큰은 그대로 유효합니다. 이미 복사했거나 확장에 저장한 값은 이
          화면이 지우지 않습니다. 값을 잃어버렸다면 목록에서 이 토큰을 철회하고 새로 발급하세요.
        </p>
        <div className="ds-actions">
          <button
            type="button"
            className="ds-button ds-button--secondary"
            onClick={() => {
              setClosed(null);
              setSession((n) => n + 1);
            }}
          >
            다른 토큰 발급
          </button>
        </div>
      </div>
    );
  }

  return (
    <IssueSession
      key={session}
      onClose={(meta) => {
        setClosed(meta);
      }}
      onRestart={() => setSession((n) => n + 1)}
    />
  );
}

type CopyState = "idle" | "pending" | "succeeded" | "failed";

function IssueSession({ onClose, onRestart }: { onClose: (meta: ClosedMeta) => void; onRestart: () => void }) {
  const [state, action, pending] = useActionState(issueExtensionTokenAction, INITIAL);
  const [copy, setCopy] = useState<CopyState>("idle");
  const router = useRouter();
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const errorHeading = useRef<HTMLHeadingElement>(null);

  // 새 결과의 제목으로 초점을 옮긴다(값 영역이 아니라 제목·메타데이터부터).
  useEffect(() => {
    if (state.status === "issued") resultHeading.current?.focus();
    else if (state.status === "rejected" || state.status === "uncertain") errorHeading.current?.focus();
  }, [state]);

  if (state.status === "issued") {
    const copyValue = () => {
      if (!navigator.clipboard?.writeText) {
        setCopy("failed");
        return;
      }
      setCopy("pending");
      navigator.clipboard.writeText(state.token).then(
        () => setCopy("succeeded"),
        () => setCopy("failed"),
      );
    };
    return (
      <div className="dc-block">
        <h3 ref={resultHeading} tabIndex={-1}>
          발급한 토큰 — 지금 복사하세요
        </h3>
        {/* 짧은 비밀 없는 알림만 live로 둔다(값 자체는 자동 낭독 대상이 아님). */}
        <p role="status">발급 결과가 준비되었습니다.</p>
        <p>
          이름: {state.label} · 발급: {formatKst(state.createdAt)} · 만료: {formatKst(state.expiresAt)}
        </p>
        <label htmlFor="issued-token-value">토큰 값(한 번만 표시)</label>
        <input
          id="issued-token-value"
          type="text"
          readOnly
          value={state.token}
          autoComplete="off"
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          aria-describedby="issued-token-help"
        />
        <p id="issued-token-help" className="ds-muted dc-reason">
          확장 사이드패널의 &lsquo;연결 코드 직접 입력&rsquo;에 붙여 넣으세요. 복사 버튼이 안 되면 칸을 선택해 직접 복사하세요.
        </p>
        <div className="ds-actions">
          <button type="button" className="ds-button ds-button--secondary" onClick={copyValue} disabled={copy === "pending"}>
            {copy === "pending" ? "복사 중…" : "복사"}
          </button>
          <button
            type="button"
            className="ds-button ds-button--primary"
            onClick={() => onClose({ label: state.label, createdAt: state.createdAt, expiresAt: state.expiresAt })}
          >
            값 표시 종료
          </button>
        </div>
        {copy === "succeeded" ? <p role="status">복사했습니다.</p> : null}
        {copy === "failed" ? (
          <p role="alert">복사하지 못했습니다. 위의 토큰 값 칸을 선택해 직접 복사하세요. 새로 발급할 필요는 없습니다.</p>
        ) : null}
        <p className="ds-muted">값 표시를 종료하거나 이 화면을 벗어나면 다시 볼 수 없습니다. 종료는 철회가 아닙니다.</p>
      </div>
    );
  }

  // R010-03B: 결과가 불확실하면 발급 폼을 내리고, 목록 확인 → (필요하면 철회) → 명시적 새 발급 시작 순서만 제공한다.
  // 자동 재요청은 없다. "새 발급 시작"은 새 표시 세션을 여는 것일 뿐 이전 요청의 성공·실패를 정하지 않는다.
  if (state.status === "uncertain") {
    return (
      <div className="dc-block">
        <div className="ds-notice ds-notice--warning" role="alert">
          <h3 ref={errorHeading} tabIndex={-1} className="ds-notice-title">
            발급 여부를 확인해야 합니다
          </h3>
          <p>
            요청({formatKst(state.requestedAt)})은 서버에 전달됐을 수 있지만 결과를 확인하지 못했습니다. 토큰이 만들어졌는지는 아직 모릅니다.
            값은 다시 받을 수 없습니다.
          </p>
          <ol>
            <li>&lsquo;목록 다시 불러오기&rsquo;로 아래 내 토큰 목록을 확인하세요. 목록을 불러오지 못하면 아직 확인되지 않은 상태입니다.</li>
            <li>요청 시각 무렵 발급된 토큰이 있고 그 값을 받지 못했다면, 발급 시각까지 확인한 뒤 그 토큰을 철회하세요(이름만으로 단정하지 마세요).</li>
            <li>확인을 마친 뒤에만 &lsquo;새 발급 시작&rsquo;을 누르세요.</li>
          </ol>
          <div className="ds-actions">
            <button type="button" className="ds-button ds-button--secondary" onClick={() => router.refresh()}>
              목록 다시 불러오기
            </button>
            <button type="button" className="ds-button ds-button--secondary" onClick={onRestart}>
              목록을 확인했습니다 — 새 발급 시작
            </button>
          </div>
        </div>
      </div>
    );
  }

  const invalidFields = state.status === "rejected" ? state.fields : [];
  const fieldError = (f: IssueField) => invalidFields.includes(f);

  return (
    <div className="dc-block">
      {state.status === "rejected" ? (
        <div className="ds-notice ds-notice--error" role="alert">
          <h3 ref={errorHeading} tabIndex={-1} className="ds-notice-title">
            발급하지 못했습니다
          </h3>
          <p>{REJECT_TEXT[state.notice] ?? REJECT_TEXT.failed}</p>
          {state.notice === "denied" ? (
            <p>
              <Link className="ds-text-link" href="/login">
                로그인 화면으로
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <form action={action} className="ds-editor-fields" aria-describedby="token-issue-help">
        <label htmlFor="token-label">토큰 이름(어느 컴퓨터·브라우저용인지)</label>
        <input
          id="token-label"
          name="label"
          type="text"
          required
          maxLength={60}
          autoComplete="off"
          aria-invalid={fieldError("label") || undefined}
          aria-describedby={fieldError("label") ? "token-label-error" : undefined}
        />
        {fieldError("label") ? (
          <p id="token-label-error" className="dc-reason">
            {FIELD_TEXT.label}
          </p>
        ) : null}
        <label htmlFor="token-ttl">유효 기간</label>
        <select
          id="token-ttl"
          name="ttlDays"
          defaultValue="90"
          aria-invalid={fieldError("ttlDays") || undefined}
          aria-describedby={fieldError("ttlDays") ? "token-ttl-error" : undefined}
        >
          <option value="30">30일</option>
          <option value="90">90일</option>
          <option value="180">180일</option>
        </select>
        {fieldError("ttlDays") ? (
          <p id="token-ttl-error" className="dc-reason">
            {FIELD_TEXT.ttlDays}
          </p>
        ) : null}
        <div className="ds-actions">
          <button type="submit" className="ds-button ds-button--primary" disabled={pending}>
            {pending ? "발급 중…" : "연결 토큰 발급"}
          </button>
        </div>
        <p id="token-issue-help" className="ds-muted dc-reason">
          발급한 토큰은 이 화면에 한 번만 보입니다. 표시 시각 기준: {DISPLAY_TZ_LABEL}.
        </p>
      </form>
    </div>
  );
}
