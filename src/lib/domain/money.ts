/**
 * 금액 계산 (총괄 계획 19.3절). 금액은 원 단위 정수, 서버에서만 계산해 주문 시점에 고정한다.
 * 10% 수수료·쿠폰·혼합 장바구니는 정책 미확정이라 계산하지 않는다(POLICY-PENDING DEC-002).
 */
import { fail, ok, type Result } from "./errors";
import type { BookFormat } from "./order-states";

/** 안전 상한: 1억 원. 실수 입력·오버플로를 막기 위한 기술적 상한이며 판매 정책이 아니다. */
export const MAX_ORDER_AMOUNT_KRW = 100_000_000;

export interface AmountInput {
  format: BookFormat;
  unitPriceKrw: number;
  quantity: number;
  shippingFeeKrw: number;
  /** 승인된 할인만. 1차에는 0 고정 권고 */
  discountKrw: number;
}

export interface AmountSnapshot {
  unitPriceKrw: number;
  quantity: number;
  subtotalKrw: number;
  shippingFeeKrw: number;
  discountKrw: number;
  totalKrw: number;
}

function isNonNegativeInt(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

export function computeOrderAmount(input: AmountInput): Result<AmountSnapshot> {
  const { format, unitPriceKrw, quantity, shippingFeeKrw, discountKrw } = input;

  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return fail("INVALID_QUANTITY", "수량은 1 이상의 정수여야 합니다.");
  }
  if (!isNonNegativeInt(unitPriceKrw) || !isNonNegativeInt(shippingFeeKrw) || !isNonNegativeInt(discountKrw)) {
    return fail("INVALID_AMOUNT", "금액은 0 이상의 원 단위 정수여야 합니다.");
  }
  if (format === "ebook" && shippingFeeKrw !== 0) {
    return fail("INVALID_AMOUNT", "전자책에는 배송비가 없습니다.");
  }

  const subtotal = unitPriceKrw * quantity;
  if (!Number.isSafeInteger(subtotal) || subtotal > MAX_ORDER_AMOUNT_KRW) {
    return fail("INVALID_AMOUNT", "주문 금액이 허용 범위를 넘습니다.");
  }
  const gross = subtotal + shippingFeeKrw;
  if (discountKrw > gross) {
    return fail("INVALID_AMOUNT", "할인이 주문 금액보다 클 수 없습니다.");
  }
  const total = gross - discountKrw;
  if (total > MAX_ORDER_AMOUNT_KRW) {
    return fail("INVALID_AMOUNT", "주문 금액이 허용 범위를 넘습니다.");
  }

  return ok({
    unitPriceKrw,
    quantity,
    subtotalKrw: subtotal,
    shippingFeeKrw,
    discountKrw,
    totalKrw: total,
  });
}

/**
 * 환불 가능 금액 검증: 누적 환불은 확인된 입금액을 넘을 수 없다.
 */
export function validateRefundAmount(params: {
  verifiedPaidKrw: number;
  alreadyRefundedKrw: number;
  requestedKrw: number;
}): Result<{ remainingAfterKrw: number }> {
  const { verifiedPaidKrw, alreadyRefundedKrw, requestedKrw } = params;
  if (![verifiedPaidKrw, alreadyRefundedKrw].every(isNonNegativeInt)) {
    return fail("INVALID_AMOUNT", "입금·환불 누계가 올바르지 않습니다.");
  }
  if (!Number.isSafeInteger(requestedKrw) || requestedKrw <= 0) {
    return fail("INVALID_AMOUNT", "환불 금액은 1원 이상의 정수여야 합니다.");
  }
  const remaining = verifiedPaidKrw - alreadyRefundedKrw - requestedKrw;
  if (remaining < 0) {
    return fail("INVALID_AMOUNT", "누적 환불액이 확인된 입금액을 넘습니다.");
  }
  return ok({ remainingAfterKrw: remaining });
}

/** 입금 대사: 기대액과 실입금이 정확히 같을 때만 verified 후보. 그 외는 mismatch. */
export function classifyReceivedAmount(expectedKrw: number, receivedKrw: number): "match" | "mismatch" {
  return Number.isSafeInteger(receivedKrw) && receivedKrw === expectedKrw ? "match" : "mismatch";
}
