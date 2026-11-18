'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';

/**
 * DESIGN-LOGIN-PHOTO-SPLIT: 비밀번호 입력칸 + 보기/숨기기 버튼(표현 전용).
 * 서버 action·검증 규칙은 바꾸지 않는다. name·autoComplete·minLength 등은 부모가 그대로 넘긴다.
 * 자바스크립트가 없을 때도 일반 password 입력칸으로 동작한다(버튼만 무반응).
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & {
  id: string;
  label: string;
  help?: string;
};

export function PasswordField({ id, label, help, 'aria-describedby': describedBy, ...input }: Props) {
  const [visible, setVisible] = useState(false);
  const helpId = useId();
  // L1: 부모가 넘긴 aria-describedby와 도움말 id를 합친다.
  const describedByIds = [describedBy, help ? helpId : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <div className="ds-auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="ds-auth-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
          <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
        </svg>
        <input {...input} id={id} type={visible ? 'text' : 'password'} aria-describedby={describedByIds} />
        <button
          type="button"
          className="ds-auth-eye"
          // M1: 라벨은 고정하고 상태는 aria-pressed로만 전달한다(이중 상태 낭독 방지).
          aria-label={`${label} 보기`}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l18 18M10.6 6a8.9 8.9 0 0 1 1.4-.1C18 5.9 21.5 12 21.5 12a16 16 0 0 1-3 3.6M6.5 7.6A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5a8.6 8.6 0 0 0 4-.9" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
              <circle cx="12" cy="12" r="2.8" />
            </svg>
          )}
        </button>
      </div>
      {help ? <p className="ds-auth-help" id={helpId}>{help}</p> : null}
    </div>
  );
}
