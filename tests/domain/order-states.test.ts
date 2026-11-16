import { describe, expect, it } from "vitest";
import {
  applyTransition,
  checkInvariants,
  holdsInventory,
  INITIAL_ORDER_STATE,
  type OrderState,
} from "@/lib/domain/order-states";

const print = { format: "print" as const };
const ebook = { format: "ebook" as const };

function expectOk(r: ReturnType<typeof applyTransition>): OrderState {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
}

describe("주문 네 상태축 전이", () => {
  it("정상 흐름: 신청→입금 확인 요청→관리자 확인→제작→출고→배송→완료", () => {
    let s = INITIAL_ORDER_STATE;
    s = expectOk(applyTransition(s, "payment", "reported", "member", print));
    s = expectOk(applyTransition(s, "payment", "verified", "admin", print));
    s = expectOk(applyTransition(s, "fulfillment", "preparing", "admin", print));
    s = expectOk(applyTransition(s, "fulfillment", "ready", "admin", print));
    s = expectOk(applyTransition(s, "fulfillment", "shipped", "admin", print));
    s = expectOk(applyTransition(s, "fulfillment", "delivered", "system", print));
    s = expectOk(applyTransition(s, "order", "completed", "system", print));
    expect(s).toEqual({ order: "completed", payment: "verified", fulfillment: "delivered", refund: "none" });
  });

  it("회원은 입금을 verified로 바꿀 수 없다(자기 확인 금지)", () => {
    const r = applyTransition(INITIAL_ORDER_STATE, "payment", "verified", "member", print);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("입금 확인 요청(reported)만으로 출고·배포할 수 없다", () => {
    const reported: OrderState = { ...INITIAL_ORDER_STATE, payment: "reported", fulfillment: "ready" };
    const r = applyTransition(reported, "fulfillment", "shipped", "admin", print);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFLICT");
  });

  it("미입금 주문은 본인이 바로 취소하고, 입금 확인 건은 취소 요청을 거쳐야 한다", () => {
    expectOk(applyTransition(INITIAL_ORDER_STATE, "order", "cancelled", "member", print));

    const paid: OrderState = { ...INITIAL_ORDER_STATE, payment: "verified" };
    const direct = applyTransition(paid, "order", "cancelled", "member", print);
    expect(direct.ok).toBe(false);

    let s = expectOk(applyTransition(paid, "order", "cancellation_requested", "member", print));
    s = expectOk(applyTransition(s, "refund", "requested", "member", print));
    s = expectOk(applyTransition(s, "order", "cancelled", "admin", print));
    expect(s.order).toBe("cancelled");
    expect(s.refund).toBe("requested");
  });

  it("입금 확인된 주문은 환불 절차 없이 관리자도 취소할 수 없다", () => {
    const s: OrderState = { ...INITIAL_ORDER_STATE, order: "cancellation_requested", payment: "verified" };
    const r = applyTransition(s, "order", "cancelled", "admin", print);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFLICT");
  });

  it("취소·만료 주문에 늦은 입금이 와도 verified로 부활하지 않고 mismatch로만 기록된다", () => {
    const expired = expectOk(applyTransition(INITIAL_ORDER_STATE, "order", "expired", "system", print));
    const late = applyTransition(expired, "payment", "verified", "admin", print);
    expect(late.ok).toBe(false);
    const recorded = expectOk(applyTransition(expired, "payment", "mismatch", "admin", print));
    expect(recorded.order).toBe("expired");
    // 종료 상태에서 active로 돌아가는 전이는 없다.
    const revive = applyTransition(recorded, "order", "active", "admin", print);
    expect(revive.ok).toBe(false);
  });

  it("입금 확인 요청이 있는 주문은 자동 만료되지 않는다", () => {
    const reported: OrderState = { ...INITIAL_ORDER_STATE, payment: "reported" };
    const r = applyTransition(reported, "order", "expired", "system", print);
    expect(r.ok).toBe(false);
  });

  it("만료는 system만 실행한다", () => {
    const r = applyTransition(INITIAL_ORDER_STATE, "order", "expired", "member", print);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("환불 완료는 관리자만, processing을 거쳐야 한다", () => {
    const s: OrderState = { order: "cancellation_requested", payment: "verified", fulfillment: "not_ready", refund: "requested" };
    expect(applyTransition(s, "refund", "completed", "admin", print).ok).toBe(false);
    const processing = expectOk(applyTransition(s, "refund", "processing", "admin", print));
    expect(applyTransition(processing, "refund", "completed", "member", print).ok).toBe(false);
    expectOk(applyTransition(processing, "refund", "completed", "admin", print));
  });

  it("미입금 주문에는 환불 요청을 만들 수 없다", () => {
    const s: OrderState = { ...INITIAL_ORDER_STATE };
    expect(applyTransition(s, "refund", "requested", "admin", print).ok).toBe(false);
  });

  it("전자책은 released, 종이책은 shipped만 쓴다", () => {
    const readyPaid: OrderState = { order: "active", payment: "verified", fulfillment: "ready", refund: "none" };
    expectOk(applyTransition(readyPaid, "fulfillment", "released", "system", ebook));
    expect(applyTransition(readyPaid, "fulfillment", "shipped", "admin", ebook).ok).toBe(false);
    expect(applyTransition(readyPaid, "fulfillment", "released", "system", print).ok).toBe(false);
  });

  it("같은 상태로의 전이는 거절한다(중복 처리 방지)", () => {
    const r = applyTransition(INITIAL_ORDER_STATE, "payment", "unpaid", "admin", print);
    expect(r.ok).toBe(false);
  });

  it("입력 상태 객체를 변경하지 않는다", () => {
    const before = { ...INITIAL_ORDER_STATE };
    applyTransition(INITIAL_ORDER_STATE, "payment", "reported", "member", print);
    expect(INITIAL_ORDER_STATE).toEqual(before);
  });
});

describe("상태 조합 불변식", () => {
  it("입금 확인 없이 배송 완료 조합은 거절", () => {
    const r = checkInvariants({ order: "active", payment: "unpaid", fulfillment: "delivered", refund: "none" }, print);
    expect(r.ok).toBe(false);
  });
  it("전달 전 완료 조합은 거절", () => {
    const r = checkInvariants({ order: "completed", payment: "verified", fulfillment: "preparing", refund: "none" }, print);
    expect(r.ok).toBe(false);
  });
});

describe("재고 점유", () => {
  it("취소·만료는 점유 해제, 진행·취소요청·완료는 점유", () => {
    expect(holdsInventory("active")).toBe(true);
    expect(holdsInventory("cancellation_requested")).toBe(true);
    expect(holdsInventory("completed")).toBe(true);
    expect(holdsInventory("cancelled")).toBe(false);
    expect(holdsInventory("expired")).toBe(false);
  });
});
