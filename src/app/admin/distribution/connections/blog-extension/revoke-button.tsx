"use client";

/**
 * 토큰 철회 — 확인 단계 포함(UX-FIX-008 BC-04, R010-04).
 * - 대상(이름·만료·최근 사용)과 영향(다음 확장 인증부터 거부, 이미 입력·게시된 내용은 취소·삭제되지 않음)을 보여 준 뒤에만 제출한다.
 * - 초점: 열 때만 확인 제목으로, 닫을 때(취소) 같은 철회 버튼으로 돌아간다(열림/닫힘 전이에서만 이동, 렌더마다 끌지 않음).
 * - 제출 중에는 확인·닫기를 모두 잠근다. 이미 보낸 철회 요청은 되돌릴 수 없으므로 "닫기"는 확인창만 닫는다는 뜻이다.
 * - 결과는 목록 상단 안내(redirect)로 돌아온다.
 */
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { revokeExtensionTokenAction } from "./actions";

function ConfirmActions({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <>
      <div className="ds-actions">
        <button type="submit" className="ds-button ds-button--primary" disabled={pending}>
          {pending ? "철회 요청 중…" : "철회 확인"}
        </button>
        <button type="button" className="ds-button ds-button--secondary" onClick={onCancel} disabled={pending}>
          확인창 닫기
        </button>
      </div>
      {pending ? (
        <p role="status" className="ds-muted">
          철회 요청을 보냈습니다. 결과를 기다리는 중이며, 보낸 요청은 이 화면에서 취소할 수 없습니다.
        </p>
      ) : null}
    </>
  );
}

export function RevokeTokenButton({
  tokenId,
  label,
  expiresText,
  lastUsedText,
}: {
  tokenId: string;
  label: string;
  expiresText: string;
  lastUsedText: string;
}) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const transition = useRef<"none" | "opened" | "closed">("none");
  const panelId = `revoke-${tokenId}`;

  useEffect(() => {
    if (transition.current === "opened") titleRef.current?.focus();
    if (transition.current === "closed") openerRef.current?.focus();
    transition.current = "none";
  }, [open]);

  if (!open) {
    return (
      <button
        ref={openerRef}
        type="button"
        className="ds-button ds-button--secondary"
        aria-expanded={false}
        aria-controls={panelId}
        aria-label={`${label} 토큰 철회`}
        onClick={() => {
          transition.current = "opened";
          setOpen(true);
        }}
      >
        철회…
      </button>
    );
  }

  return (
    <div id={panelId} role="group" aria-labelledby={`${panelId}-title`}>
      <p id={`${panelId}-title`} tabIndex={-1} ref={titleRef}>
        <strong>&lsquo;{label}&rsquo; 토큰을 철회할까요?</strong>
      </p>
      <p className="ds-muted">
        만료: {expiresText} · 최근 사용: {lastUsedText}. 철회하면 이 토큰을 쓰는 확장의 다음 인증부터 거부됩니다. 이미 네이버에 입력됐거나
        사람이 게시한 글, 기록한 게시 증거는 취소·삭제되지 않습니다.
      </p>
      <form action={revokeExtensionTokenAction}>
        <input type="hidden" name="tokenId" value={tokenId} />
        <ConfirmActions
          onCancel={() => {
            transition.current = "closed";
            setOpen(false);
          }}
        />
      </form>
    </div>
  );
}
