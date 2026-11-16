import { describe, expect, it } from "vitest";
import { parseSupabaseConfig } from "@/lib/supabase/config";
import { buildEmailRedirect, normalizeEmail, parseLoginNotice, resolveSiteOrigin } from "@/lib/auth/email-login";
import { decideAccess, toApproval, toRoles } from "@/lib/auth/viewer";

describe("parseSupabaseConfig", () => {
  it("https URL과 공개 키만 허용, origin으로 정규화", () => {
    expect(parseSupabaseConfig("https://abc.supabase.co/", "sb_publishable_x")).toEqual({
      url: "https://abc.supabase.co",
      publishableKey: "sb_publishable_x",
    });
  });
  it.each([
    ["http://abc.supabase.co", "k"],
    ["https://user:pw@abc.supabase.co", "k"],
    ["not a url", "k"],
    ["", "k"],
    ["https://abc.supabase.co", ""],
    [undefined, "k"],
  ])("거절: %s", (u, k) => {
    expect(parseSupabaseConfig(u, k)).toBeNull();
  });
  it("secret 키를 공개 변수에 넣으면 사용하지 않는다", () => {
    expect(parseSupabaseConfig("https://abc.supabase.co", "sb_secret_abc")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("소문자·공백 제거", () => {
    expect(normalizeEmail("  Name@Example.COM ")).toBe("name@example.com");
  });
  it.each(["", "a@b", "no-at.example.com", "a b@c.com", "x".repeat(250) + "@a.co", 42, null])("거절: %s", (v) => {
    expect(normalizeEmail(v)).toBeNull();
  });
});

describe("resolveSiteOrigin", () => {
  it("https 환경변수 우선", () => {
    expect(resolveSiteOrigin("https://site.example/x", "https://other.example")).toBe("https://site.example");
  });
  it("환경변수 없으면 요청 origin", () => {
    expect(resolveSiteOrigin(undefined, "https://vibe.vercel.app")).toBe("https://vibe.vercel.app");
  });
  it("http는 localhost만", () => {
    expect(resolveSiteOrigin(undefined, "http://localhost:3000")).toBe("http://localhost:3000");
    expect(resolveSiteOrigin(undefined, "http://evil.example")).toBeNull();
  });
  it("자격 정보 포함·형식 오류 거절", () => {
    expect(resolveSiteOrigin("https://u:p@site.example", null)).toBeNull();
    expect(resolveSiteOrigin("::", "")).toBeNull();
  });
});

describe("buildEmailRedirect", () => {
  it("내부 경로만 next로 전달", () => {
    expect(buildEmailRedirect("https://s.example", "/books?x=1")).toBe(
      "https://s.example/auth/callback?next=%2Fbooks%3Fx%3D1",
    );
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil", undefined])("외부/잘못된 복귀 경로는 /me: %s", (v) => {
    expect(buildEmailRedirect("https://s.example", v)).toBe("https://s.example/auth/callback?next=%2Fme");
  });
});

describe("parseLoginNotice", () => {
  it("허용 목록만", () => {
    expect(parseLoginNotice("sent")).toBe("sent");
    expect(parseLoginNotice(["callback_failed"])).toBe("callback_failed");
    expect(parseLoginNotice("<script>")).toBeNull();
  });
});

describe("viewer 해석", () => {
  it("알 수 없는 승인 값은 pending", () => {
    expect(toApproval("approved")).toBe("approved");
    expect(toApproval("superuser")).toBe("pending");
    expect(toApproval(undefined)).toBe("pending");
  });
  it("역할은 알려진 값만, 중복 제거", () => {
    expect(toRoles([{ role: "admin" }, { role: "admin" }, { role: "root" }, null])).toEqual(["admin"]);
    expect(toRoles("admin")).toEqual([]);
  });
  it("승인 대기 회원은 참여 불가, 관리자 판정은 역할만", () => {
    const pending = { kind: "member", userId: "u", approval: "pending", roles: [] } as const;
    expect(decideAccess(pending, "approved_member")).toEqual({ allowed: false, reason: "pending_approval" });
    expect(decideAccess({ ...pending, roles: ["admin"] }, "admin")).toEqual({ allowed: true });
    expect(decideAccess({ kind: "anonymous", reason: "not_signed_in" }, "approved_member")).toEqual({
      allowed: false,
      reason: "unauthenticated",
    });
  });
});
