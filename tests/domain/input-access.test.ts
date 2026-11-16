import { describe, expect, it } from "vitest";
import { decideAccess, type Viewer } from "@/lib/auth/viewer";
import { isValidIdempotencyKey, safeReturnTo } from "@/lib/domain/input";
import { INITIAL_ORDER_STATE } from "@/lib/domain/order-states";
import { progressLabel } from "@/lib/domain/progress-label";

describe("로그인 복귀 경로(오픈 리디렉션 방지)", () => {
  it.each([
    ["/me", "/me"],
    ["/books/abc?qty=2#top", "/books/abc?qty=2#top"],
    ["/a/../b", "/b"],
  ])("허용: %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/%2Fevil.example",
    "/%5Cevil.example",
    "javascript:alert(1)",
    "/\tevil",
    "me",
    "",
    "/" + "a".repeat(600),
  ])("거부: %s", (input) => {
    expect(safeReturnTo(input)).toBe("/");
  });

  it("문자열이 아니면 fallback", () => {
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo(["/me"], "/books")).toBe("/books");
  });
});

describe("멱등키", () => {
  it("형식 검증", () => {
    expect(isValidIdempotencyKey("a1b2c3d4e5f6g7h8")).toBe(true);
    expect(isValidIdempotencyKey("short")).toBe(false);
    expect(isValidIdempotencyKey("has space in it 1234")).toBe(false);
    expect(isValidIdempotencyKey(123)).toBe(false);
  });
});

describe("접근 판정", () => {
  const anon: Viewer = { kind: "anonymous", reason: "auth_not_configured" };
  const pending: Viewer = { kind: "member", userId: "u1", approval: "pending", roles: ["member"] };
  const approved: Viewer = { kind: "member", userId: "u2", approval: "approved", roles: ["member"] };
  const admin: Viewer = { kind: "member", userId: "u3", approval: "approved", roles: ["member", "admin"] };

  it("인증 미연결 익명은 me/admin 모두 거절", () => {
    expect(decideAccess(anon, "approved_member")).toEqual({ allowed: false, reason: "auth_not_configured" });
    expect(decideAccess(anon, "admin")).toEqual({ allowed: false, reason: "auth_not_configured" });
  });
  it("승인 대기 회원은 신청 영역 거절, 일반 회원은 관리자 거절", () => {
    expect(decideAccess(pending, "approved_member")).toEqual({ allowed: false, reason: "pending_approval" });
    expect(decideAccess(approved, "admin")).toEqual({ allowed: false, reason: "forbidden" });
    expect(decideAccess(approved, "approved_member").allowed).toBe(true);
    expect(decideAccess(admin, "admin").allowed).toBe(true);
  });
});

describe("진행 문구", () => {
  it("입금 확인 요청은 입금 완료처럼 보이지 않는다", () => {
    const label = progressLabel({ ...INITIAL_ORDER_STATE, payment: "reported" }, "print");
    expect(label.text).toContain("확인 중");
    expect(label.tone).not.toBe("success");
  });
  it("환불 처리 중은 완료로 표시하지 않는다", () => {
    const label = progressLabel(
      { order: "cancellation_requested", payment: "verified", fulfillment: "not_ready", refund: "processing" },
      "print",
    );
    expect(label.text).toBe("환불 처리 중");
  });
});
