"use client";

/**
 * 결과 안내 초점 이동(FE-CONNECTIONS-FIX-070, C057-06). OAuth 왕복이나 해제 redirect 뒤 전체 페이지가 다시 로드되면
 * 처음부터 DOM에 있는 role=status는 낭독되지 않을 수 있으므로, 감싼 StatusNotice의 제목으로 초점을 한 번 옮긴다.
 * - 페이지가 허용 목록으로 검증한 결과(OAuth result 코드 또는 notice=saved)일 때만 이 컴포넌트로 감싼다. 임의 query에는 렌더되지 않는다.
 * - StatusNotice의 role/문구는 그대로 둔다. 제목에 tabindex=-1만 붙여(Tab 순서에는 넣지 않음) 프로그램 초점만 받게 한다.
 * - 감싸는 div는 display: contents라 배치에 영향이 없다. 서버 모듈을 import하지 않는다.
 */
import { useEffect, useRef, type ReactNode } from "react";

export function ResultFocus({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const title = ref.current?.querySelector<HTMLElement>(".ds-notice-title");
    if (!title) return;
    if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
    title.focus();
  }, []);
  return (
    <div ref={ref} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
