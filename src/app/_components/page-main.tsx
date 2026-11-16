import type { ReactNode } from "react";

/**
 * ProjectHome/BooksView 외 라우트의 유일한 본문 랜드마크.
 * SiteHeader의 '본문 바로가기'(#main-content)가 이 요소로 이동한다.
 */
export function PageMain({ eyebrow, title, children }: { eyebrow?: string; title: string; children: ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="ds-main">
      <div className="ds-container ds-section app-prose">
        {eyebrow ? <p className="ds-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
