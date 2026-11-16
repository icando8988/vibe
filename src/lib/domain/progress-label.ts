/**
 * 네 상태축을 사용자가 읽는 한 줄 진행 문구로 바꾼다 (총괄 계획 20절 표시 계약).
 * 'reported'를 입금 완료처럼, 'processing'을 환불 완료처럼 보이게 하지 않는다.
 */
import type { BookFormat, OrderState } from "./order-states";

export type ProgressTone = "neutral" | "waiting" | "success" | "warning";

export interface ProgressLabel {
  text: string;
  tone: ProgressTone;
}

export function progressLabel(state: OrderState, format: BookFormat): ProgressLabel {
  const { order, payment, fulfillment, refund } = state;

  if (refund === "completed") return { text: "환불 완료", tone: "neutral" };
  if (refund === "processing") return { text: "환불 처리 중", tone: "waiting" };
  if (refund === "requested") return { text: "환불 요청 접수됨 · 운영자 확인 중", tone: "waiting" };
  // refund === "rejected": 환불이 반려된 주문은 아래 일반 진행 문구로 이어진다.

  if (order === "expired") return { text: "입금 기한이 지나 신청이 만료됨", tone: "neutral" };
  if (order === "cancelled") return { text: "신청 취소됨", tone: "neutral" };
  if (order === "cancellation_requested") return { text: "취소 요청 접수됨 · 운영자 확인 중", tone: "waiting" };
  if (order === "completed") {
    return { text: format === "ebook" ? "전자책 받기 가능" : "배송 완료", tone: "success" };
  }

  // order === "active"
  if (payment === "unpaid") return { text: "입금 대기 중", tone: "waiting" };
  if (payment === "reported") return { text: "입금 확인 요청됨 · 운영자 확인 중", tone: "waiting" };
  if (payment === "mismatch") return { text: "입금 내역 확인 필요 · 운영자가 연락드립니다", tone: "warning" };

  // payment === "verified"
  switch (fulfillment) {
    case "not_ready":
      return { text: "입금 확인 완료 · 제작 준비 전", tone: "success" };
    case "preparing":
      return { text: "입금 확인 완료 · 제작 중", tone: "success" };
    case "ready":
      return { text: format === "ebook" ? "출간 준비 완료 · 곧 배포됩니다" : "출고 준비 완료", tone: "success" };
    case "shipped":
      return { text: "배송 중", tone: "success" };
    case "delivered":
      return { text: "배송 완료", tone: "success" };
    case "released":
      return { text: "전자책 받기 가능", tone: "success" };
  }
}
