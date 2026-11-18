/**
 * BE-AUTH-RETURNTO-111 — 로그인 복귀 경로(safeReturnTo)와 /auth/callback 외부 이동 회귀 시험.
 * 결함: 점 세그먼트 정규화 결과가 "//host"가 되면 그대로 통과 → callback의 new URL(next, origin)이 외부 출처로 이동.
 * Supabase 서버 클라이언트는 가짜다. 실제 토큰·네트워크·메일 없음.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { safeReturnTo } from "@/lib/domain/input";
import { buildEmailRedirect } from "@/lib/auth/email-login";

const ORIGIN = "https://vibe-ten-nu.vercel.app";
const sameOrigin = (path: string) => new URL(path, ORIGIN).origin === ORIGIN;

const auth = { exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth }) }));

beforeEach(() => {
  auth.exchangeCodeForSession.mockReset().mockResolvedValue({ data: {}, error: null });
  auth.verifyOtp.mockReset().mockResolvedValue({ data: {}, error: null });
});

/** 정규화 뒤 프로토콜 상대·외부 출처가 되는 입력(모두 기본값으로 떨어져야 함). */
const ESCAPES = [
  "/..//evil.example",
  "/./..//evil.example",
  "/%2e%2e//evil.example",
  "/%2E%2E//evil.example",
  "/.%2e//evil.example",
  "/%2e.//evil.example",
  "/a/../..//evil.example",
  "/a/b/../../..//evil.example",
  "/..//evil.example/path?x=1#h",
  "/../..//evil.example",
  "/././/evil.example",
  "/..///evil.example",
  "/..//%2fevil.example",
  "/../%2f%2fevil.example",
  "/../%5cevil.example",
  "/..//evil.example:443",
  "/..//user@evil.example",
];

describe("safeReturnTo — 정규화 결과 검사", () => {
  for (const raw of ESCAPES) {
    it(`${JSON.stringify(raw)} → 기본값`, () => {
      expect(safeReturnTo(raw, "/me")).toBe("/me");
    });
  }

  it("기존 거부 규칙은 그대로다", () => {
    for (const raw of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/%2fevil", "/%5Cevil", "/a\tb", "", "  ", "x".repeat(600), 42, null]) {
      expect(safeReturnTo(raw, "/me")).toBe("/me");
    }
  });

  it("정상 내부 경로·쿼리·해시와 올바른 점 정규화는 유지한다", () => {
    const cases: Array<[string, string]> = [
      ["/me", "/me"],
      ["/projects/1?tab=story&x=%2F#comments", "/projects/1?tab=story&x=%2F#comments"],
      ["/a/./b", "/a/b"],
      ["/a/b/../c", "/a/c"],
      ["/..", "/"],
      ["/../projects", "/projects"],
      ["/%2e%2e/projects", "/projects"],
      ["/login?next=//evil.example", "/login?next=//evil.example"], // 쿼리 안의 //는 경로가 아니다
      ["/a//b", "/a//b"], // 맨 앞이 아닌 //는 같은 출처
      ["  /me  ", "/me"],
    ];
    for (const [raw, expected] of cases) {
      const out = safeReturnTo(raw, "/fallback");
      expect(out).toBe(expected);
      expect(sameOrigin(out)).toBe(true);
    }
  });

  it("허용된 결과는 모두 다시 해석해도 같은 출처·같은 값이다(고정점)", () => {
    const inputs = [...ESCAPES, "/me", "/a/./b", "/../projects?q=1#h", "/a//b", "/%2e%2e/x"];
    for (const raw of inputs) {
      const out = safeReturnTo(raw, "/me");
      expect(out.startsWith("/") && !out.startsWith("//")).toBe(true);
      expect(sameOrigin(out)).toBe(true);
      expect(safeReturnTo(out, "/other")).toBe(out);
    }
  });

  it("메일 링크 생성(buildEmailRedirect)도 외부 next를 싣지 않는다", () => {
    for (const raw of ESCAPES) {
      const link = new URL(buildEmailRedirect(ORIGIN, raw));
      expect(link.origin).toBe(ORIGIN);
      expect(link.pathname).toBe("/auth/callback");
      expect(link.searchParams.get("next")).toBe("/me");
    }
  });
});

describe("/auth/callback — 인증 성공 뒤 next 리다이렉트", () => {
  async function callback(query: Record<string, string>) {
    const { GET } = await import("@/app/auth/callback/route");
    const url = new URL("/auth/callback", ORIGIN);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return GET(new NextRequest(url));
  }

  for (const raw of ESCAPES) {
    it(`code 교환 성공 + next=${JSON.stringify(raw)} → 같은 출처 /me`, async () => {
      const res = await callback({ code: "mock-code", next: raw });
      const loc = res.headers.get("location") ?? "";
      expect(new URL(loc).origin).toBe(ORIGIN);
      expect(new URL(loc).pathname).toBe("/me");
    });
  }

  it("OTP(token_hash) 검증 성공 + 우회 next → 같은 출처 /me", async () => {
    for (const raw of ["/..//evil.example", "/%2e%2e//evil.example"]) {
      const res = await callback({ token_hash: "mock-hash", type: "signup", next: raw });
      const loc = new URL(res.headers.get("location") ?? "");
      expect(loc.origin).toBe(ORIGIN);
      expect(loc.pathname).toBe("/me");
      expect(auth.verifyOtp).toHaveBeenCalled();
    }
  });

  it("정상 내부 next는 쿼리·해시를 유지해 같은 출처로 보낸다", async () => {
    const res = await callback({ code: "mock-code", next: "/projects/1?tab=story#c" });
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname + loc.search + loc.hash).toBe("/projects/1?tab=story#c");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("인증 실패면 next와 관계없이 callback_failed", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: { message: "bad" } });
    const res = await callback({ code: "mock-code", next: "/..//evil.example" });
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname + loc.search).toBe("/login?notice=callback_failed");
  });
});
