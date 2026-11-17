"use client";

/**
 * OAuth 연결 시작 폼(FE-CONNECTIONS-START-LOCK-060). 기존 `<form method="post" action>` 그대로 브라우저 기본 제출(303 → 공급자 인증 창)을 쓰고,
 * 첫 제출 뒤 같은 폼의 연타 제출만 막는다(서버 state 슬롯 소모 방지). 필드·라벨·버튼·경로는 children 그대로.
 * JS가 없거나 하이드레이션 전이면 기존과 같은 일반 폼으로 동작한다(잠금만 없음).
 */
import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { createStartGate, type StartGate } from "./oauth-start-gate";

export function OAuthStartForm({ action, children }: { action: string; children: ReactNode }) {
  const gate = useRef<StartGate | null>(null);
  if (gate.current === null) gate.current = createStartGate();

  useEffect(() => {
    // 뒤로가기로 캐시된 페이지가 되살아나면 잠금을 풀어 다시 시작할 수 있게 한다.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) gate.current?.reset();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (!gate.current!.tryStart(Date.now())) e.preventDefault();
  };

  return (
    <form method="post" action={action} onSubmit={onSubmit}>
      {children}
    </form>
  );
}
