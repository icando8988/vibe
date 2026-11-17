/**
 * FE-CONNECTIONS-START-LOCK-060 — OAuth 시작 폼 중복 제출 차단(순수 판정 + 서버 렌더 문자열). DOM·브라우저 실측 아님.
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { createStartGate, START_RELOCK_MS } = await import("@/components/distribution-console/oauth-start-gate");
const { OAuthStartForm } = await import("@/components/distribution-console/oauth-start-form");

describe("시작 잠금 판정", () => {
  it("첫 제출만 허용하고 연타는 막는다(같은 폼)", () => {
    const g = createStartGate();
    expect(g.tryStart(1000)).toBe(true);
    expect(g.tryStart(1001)).toBe(false);
    expect(g.tryStart(1000 + START_RELOCK_MS - 1)).toBe(false);
    expect(g.isLocked(1500)).toBe(true);
  });

  it("잠금 시간이 지나면 다시 시작 허용(이동이 멈춘 경우), 자동 재전송은 없음", () => {
    const g = createStartGate(100);
    expect(g.tryStart(0)).toBe(true);
    expect(g.tryStart(100)).toBe(true);
  });

  it("reset(bfcache 복원)이면 바로 다시 시작 허용", () => {
    const g = createStartGate();
    g.tryStart(0);
    g.reset();
    expect(g.isLocked(1)).toBe(false);
    expect(g.tryStart(1)).toBe(true);
  });

  it("폼마다 독립(새 연결 잠금이 재연결 폼을 막지 않음)", () => {
    const a = createStartGate();
    const b = createStartGate();
    expect(a.tryStart(0)).toBe(true);
    expect(b.tryStart(1)).toBe(true);
  });
});

describe("OAuthStartForm 렌더·제출 핸들러", () => {
  const children = [
    createElement("input", { key: "c", type: "hidden", name: "connectionId", value: "x" }),
    createElement("button", { key: "b", type: "submit", className: "ds-button ds-button--secondary", disabled: false }, "같은 계정 재연결"),
  ];

  it("서버 렌더 결과는 기존 일반 폼과 같다(method=post·action·hidden·버튼 그대로, 추가 속성 없음)", () => {
    const out = renderToStaticMarkup(createElement(OAuthStartForm, { action: "/api/distribution/oauth/threads/start" } as unknown as ComponentProps<typeof OAuthStartForm>, children));
    // 교체 전 페이지가 쓰던 일반 form과 같은 마크업(속성 순서는 React 출력 그대로)
    const plain = renderToStaticMarkup(createElement("form", { method: "post", action: "/api/distribution/oauth/threads/start" }, children));
    expect(out).toBe(plain);
    expect(out).toContain('method="post"');
    expect(out).toContain('<input type="hidden" name="connectionId" value="x"/>');
    expect(out).toContain('class="ds-button ds-button--secondary">같은 계정 재연결</button>');
  });

  it("onSubmit: 첫 제출은 기본 제출 유지(preventDefault 안 함), 연타는 preventDefault", async () => {
    // hooks를 최소 대역으로 바꾼 새 모듈 인스턴스에서 컴포넌트를 함수로 호출해 form 요소의 onSubmit을 얻는다
    vi.resetModules();
    const ref = { current: null as unknown };
    vi.doMock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), useRef: () => ref, useEffect: () => undefined }));
    const mod = await import("@/components/distribution-console/oauth-start-form");
    type El = { type: string; props: { onSubmit: (e: { preventDefault: () => void }) => void; method: string; action: string } };
    const el = (mod.OAuthStartForm as unknown as (p: { action: string; children: unknown }) => El)({ action: "/x", children: null });
    vi.doUnmock("react");
    expect(el.type).toBe("form");
    expect(el.props.method).toBe("post");
    expect(el.props.action).toBe("/x");
    const e1 = { preventDefault: vi.fn() };
    const e2 = { preventDefault: vi.fn() };
    el.props.onSubmit(e1);
    el.props.onSubmit(e2);
    expect(e1.preventDefault).not.toHaveBeenCalled();
    expect(e2.preventDefault).toHaveBeenCalledTimes(1);
  });
});
