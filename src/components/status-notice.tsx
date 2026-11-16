import type { ReactNode } from 'react';

type StatusNoticeProps = {
  title: string;
  children: ReactNode;
  tone?: 'info' | 'warning' | 'error';
  /** Enable only for a notice inserted or updated after a user action. */
  announce?: boolean;
};

export function StatusNotice({ title, children, tone = 'info', announce = false }: StatusNoticeProps) {
  return (
    <div className={`ds-notice ds-notice--${tone}`} role={announce ? 'status' : undefined}>
      <strong className="ds-notice-title">{title}</strong>
      <div>{children}</div>
    </div>
  );
}
