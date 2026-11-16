import { describe, expect, it } from "vitest";
import { checkOpenForApplication, checkReservation, goalProgress, remainingQuantity } from "@/lib/domain/campaign";
import { classifyReceivedAmount, computeOrderAmount, validateRefundAmount } from "@/lib/domain/money";

describe("주문 금액 계산", () => {
  it("종이책: 상품가×수량+배송비-할인", () => {
    const r = computeOrderAmount({ format: "print", unitPriceKrw: 18000, quantity: 2, shippingFeeKrw: 3000, discountKrw: 0 });
    expect(r.ok && r.value).toMatchObject({ subtotalKrw: 36000, totalKrw: 39000 });
  });

  it.each([0, -1, 1.5, Number.NaN])("수량 %s는 거절", (quantity) => {
    const r = computeOrderAmount({ format: "print", unitPriceKrw: 1000, quantity, shippingFeeKrw: 0, discountKrw: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_QUANTITY");
  });

  it("소수·음수 금액, 전자책 배송비, 과다 할인은 거절", () => {
    expect(computeOrderAmount({ format: "print", unitPriceKrw: 99.5, quantity: 1, shippingFeeKrw: 0, discountKrw: 0 }).ok).toBe(false);
    expect(computeOrderAmount({ format: "print", unitPriceKrw: -1, quantity: 1, shippingFeeKrw: 0, discountKrw: 0 }).ok).toBe(false);
    expect(computeOrderAmount({ format: "ebook", unitPriceKrw: 1000, quantity: 1, shippingFeeKrw: 3000, discountKrw: 0 }).ok).toBe(false);
    expect(computeOrderAmount({ format: "print", unitPriceKrw: 1000, quantity: 1, shippingFeeKrw: 0, discountKrw: 1001 }).ok).toBe(false);
  });

  it("상한을 넘는 금액은 거절", () => {
    const r = computeOrderAmount({ format: "print", unitPriceKrw: 50_000_001, quantity: 2, shippingFeeKrw: 0, discountKrw: 0 });
    expect(r.ok).toBe(false);
  });
});

describe("환불·대사", () => {
  it("누적 환불은 확인 입금액을 넘을 수 없다", () => {
    expect(validateRefundAmount({ verifiedPaidKrw: 39000, alreadyRefundedKrw: 0, requestedKrw: 39000 }).ok).toBe(true);
    expect(validateRefundAmount({ verifiedPaidKrw: 39000, alreadyRefundedKrw: 20000, requestedKrw: 19001 }).ok).toBe(false);
    expect(validateRefundAmount({ verifiedPaidKrw: 39000, alreadyRefundedKrw: 0, requestedKrw: 0 }).ok).toBe(false);
  });

  it("부분·과입금은 mismatch", () => {
    expect(classifyReceivedAmount(39000, 39000)).toBe("match");
    expect(classifyReceivedAmount(39000, 38999)).toBe("mismatch");
    expect(classifyReceivedAmount(39000, 40000)).toBe("mismatch");
  });
});

describe("캠페인 모집 시간", () => {
  const base = {
    reviewStatus: "approved" as const,
    recruitmentStatus: "open" as const,
    channel: "direct" as const,
    opensAt: new Date("2026-12-01T00:00:00Z"),
    closesAt: new Date("2026-12-10T15:00:00Z"),
  };

  it("마감 시각 정각부터는 신청 불가(now < closes_at)", () => {
    expect(checkOpenForApplication(base, new Date("2026-12-10T14:59:59.999Z")).ok).toBe(true);
    const atClose = checkOpenForApplication(base, new Date("2026-12-10T15:00:00Z"));
    expect(atClose.ok).toBe(false);
    if (!atClose.ok) expect(atClose.error.code).toBe("NOT_OPEN");
  });

  it("시작 전, 미승인, 외부 채널, 배치가 아직 open으로 둔 마감 후 모두 거절", () => {
    expect(checkOpenForApplication(base, new Date("2026-11-30T23:59:59Z")).ok).toBe(false);
    expect(checkOpenForApplication({ ...base, reviewStatus: "pending_review" }, new Date("2026-12-05T00:00:00Z")).ok).toBe(false);
    expect(checkOpenForApplication({ ...base, channel: "external" }, new Date("2026-12-05T00:00:00Z")).ok).toBe(false);
    expect(checkOpenForApplication(base, new Date("2026-12-11T00:00:00Z")).ok).toBe(false);
  });
});

describe("재고·목표", () => {
  it("무제한 모집은 남은 수량을 만들어 내지 않는다", () => {
    expect(remainingQuantity(null, 500)).toBeNull();
    expect(remainingQuantity(10, 12)).toBe(0);
  });

  it("남은 수량 초과·1인 상한 초과는 거절", () => {
    const sold = checkReservation({ requestedQty: 3, maxQty: 10, activeReservedQty: 8, perUserLimit: null, userActiveQty: 0 });
    expect(sold.ok).toBe(false);
    if (!sold.ok) expect(sold.error.code).toBe("SOLD_OUT");
    const limit = checkReservation({ requestedQty: 2, maxQty: null, activeReservedQty: 0, perUserLimit: 3, userActiveQty: 2 });
    expect(limit.ok).toBe(false);
    if (!limit.ok) expect(limit.error.code).toBe("INVALID_QUANTITY");
    expect(checkReservation({ requestedQty: 2, maxQty: 10, activeReservedQty: 8, perUserLimit: null, userActiveQty: 0 }).ok).toBe(true);
  });

  it("목표 기준은 명시한 basis로만 계산(신청 수량 달성 ≠ 입금 기준 달성)", () => {
    const counts = { appliedQty: 30, verifiedQty: 12 };
    expect(goalProgress(30, counts, "applied").reached).toBe(true);
    const verified = goalProgress(30, counts, "verified");
    expect(verified.reached).toBe(false);
    expect(verified.remainingToGoal).toBe(18);
  });
});
