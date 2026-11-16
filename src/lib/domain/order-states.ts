/**
 * 주문의 네 상태축 (총괄 계획 19.2절).
 * 주문/예약 · 입금 · 이행 · 환불을 한 열에 섞지 않고 각각 관리한다.
 * 이 파일은 순수 함수만 둔다. 실제 저장·잠금은 DB 함수(DEV-005)에서 같은 규칙으로 집행한다.
 *
 * 정책 미확정 표시: POLICY-PENDING 주석이 붙은 규칙은 DEC-002/003 확정 후 바뀔 수 있다.
 */
import { fail, ok, type Result } from "./errors";

export const ORDER_STATUSES = [
  "active",
  "cancellation_requested",
  "cancelled",
  "expired",
  "completed",
] as const;
export const PAYMENT_STATUSES = ["unpaid", "reported", "verified", "mismatch"] as const;
export const FULFILLMENT_STATUSES = [
  "not_ready",
  "preparing",
  "ready",
  "shipped",
  "delivered",
  /** 전자책 배포(권한 부여) */
  "released",
] as const;
export const REFUND_STATUSES = ["none", "requested", "processing", "completed", "rejected"] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export type BookFormat = "ebook" | "print";

/** 전이를 일으키는 주체. member=본인 회원, admin=관리자, system=서버 배치/만료 */
export type Actor = "member" | "admin" | "system";

export interface OrderState {
  order: OrderStatus;
  payment: PaymentStatus;
  fulfillment: FulfillmentStatus;
  refund: RefundStatus;
}

export type Axis = keyof OrderState;

type TransitionRule = { to: string; actors: readonly Actor[] };
type TransitionTable = Record<string, readonly TransitionRule[]>;

const ORDER_TRANSITIONS: TransitionTable = {
  active: [
    // 미입금 건의 본인 즉시 취소, 관리자 취소. 입금 확인 건은 아래 교차 규칙으로 요청 단계를 거친다.
    { to: "cancelled", actors: ["member", "admin"] },
    { to: "cancellation_requested", actors: ["member"] },
    // POLICY-PENDING(DEC-003): 예약 만료 시간. 만료 자체는 서버만 실행한다.
    { to: "expired", actors: ["system"] },
    { to: "completed", actors: ["admin", "system"] },
  ],
  cancellation_requested: [
    { to: "cancelled", actors: ["admin"] },
    // 취소 요청 반려(예: 이미 출고)
    { to: "active", actors: ["admin"] },
  ],
  // 종료 상태: 취소/만료 뒤 늦은 입금이 와도 자동 부활하지 않는다(M05).
  cancelled: [],
  expired: [],
  completed: [],
};

const PAYMENT_TRANSITIONS: TransitionTable = {
  // reported는 회원의 '입금했어요' 확인 요청일 뿐 입금 완료가 아니다.
  unpaid: [
    { to: "reported", actors: ["member"] },
    { to: "verified", actors: ["admin"] },
    { to: "mismatch", actors: ["admin"] },
  ],
  reported: [
    { to: "verified", actors: ["admin"] },
    { to: "mismatch", actors: ["admin"] },
    // 확인 요청 반려(입금 내역 없음)
    { to: "unpaid", actors: ["admin"] },
  ],
  // 부분·과입금은 mismatch로 두고 관리자 대사 후에만 verified.
  mismatch: [{ to: "verified", actors: ["admin"] }],
  verified: [],
};

const FULFILLMENT_TRANSITIONS: TransitionTable = {
  not_ready: [{ to: "preparing", actors: ["admin"] }],
  preparing: [
    { to: "ready", actors: ["admin"] },
    { to: "not_ready", actors: ["admin"] },
  ],
  ready: [
    { to: "shipped", actors: ["admin"] },
    { to: "released", actors: ["admin", "system"] },
  ],
  shipped: [{ to: "delivered", actors: ["admin", "system"] }],
  delivered: [],
  released: [],
};

const REFUND_TRANSITIONS: TransitionTable = {
  none: [{ to: "requested", actors: ["member", "admin"] }],
  requested: [
    { to: "processing", actors: ["admin"] },
    { to: "rejected", actors: ["admin"] },
  ],
  // completed는 실지급 확인 뒤 관리자만.
  processing: [
    { to: "completed", actors: ["admin"] },
    { to: "rejected", actors: ["admin"] },
  ],
  completed: [],
  rejected: [],
};

const TABLES: Record<Axis, TransitionTable> = {
  order: ORDER_TRANSITIONS,
  payment: PAYMENT_TRANSITIONS,
  fulfillment: FULFILLMENT_TRANSITIONS,
  refund: REFUND_TRANSITIONS,
};

export interface TransitionContext {
  format: BookFormat;
}

/**
 * 한 축의 상태를 바꾼다. 축 단위 허용표 + 주체 + 축 간 불변식을 모두 통과해야 한다.
 * 반환값은 바뀐 전체 상태. 입력 객체는 변경하지 않는다.
 */
export function applyTransition<A extends Axis>(
  state: OrderState,
  axis: A,
  to: OrderState[A],
  actor: Actor,
  ctx: TransitionContext,
): Result<OrderState> {
  const from = state[axis];
  if (from === to) {
    return fail("INVALID_TRANSITION", `${axis} 상태가 이미 ${String(to)}입니다.`);
  }
  const rule = TABLES[axis][from]?.find((r) => r.to === to);
  if (!rule) {
    return fail("INVALID_TRANSITION", `${axis}: ${from} → ${String(to)} 전이는 허용되지 않습니다.`);
  }
  if (!rule.actors.includes(actor)) {
    return fail("FORBIDDEN", `${axis}: ${from} → ${String(to)} 전이는 ${actor} 권한으로 할 수 없습니다.`);
  }

  const guard = crossAxisGuard(state, axis, to, actor);
  if (!guard.ok) return guard;

  const next: OrderState = { ...state, [axis]: to };
  const invariant = checkInvariants(next, ctx);
  if (!invariant.ok) return invariant;
  return ok(next);
}

/** 전이 시점에만 의미가 있는 규칙(상태 조합이 아니라 '어떻게 도달했는가') */
function crossAxisGuard(
  state: OrderState,
  axis: Axis,
  to: string,
  actor: Actor,
): Result<true> {
  const orderOpen = state.order === "active" || state.order === "cancellation_requested";

  if (axis === "order") {
    // 입금 확인(또는 대사 중) 건은 회원이 바로 취소할 수 없고 취소 요청→환불 절차로 간다.
    if (to === "cancelled" && actor === "member" && state.payment !== "unpaid") {
      return fail("CONFLICT", "입금 확인 요청 이후에는 취소 요청으로 진행해야 합니다.");
    }
    if (to === "cancellation_requested" && state.payment === "unpaid") {
      return fail("CONFLICT", "미입금 주문은 취소 요청 없이 바로 취소합니다.");
    }
    if (to === "expired" && state.payment !== "unpaid") {
      return fail("CONFLICT", "입금 확인 요청이나 입금이 있는 주문은 자동 만료하지 않습니다.");
    }
    if (to === "completed" && !(state.fulfillment === "delivered" || state.fulfillment === "released")) {
      return fail("CONFLICT", "전달이 끝나기 전에는 주문을 완료할 수 없습니다.");
    }
  }

  if (axis === "payment") {
    // 취소/만료 주문에 늦은 입금: 자동 verified 금지, 예외 대사(mismatch)로만 기록.
    if (!orderOpen && to !== "mismatch") {
      return fail("CONFLICT", "종료된 주문의 늦은 입금은 예외 대사로만 기록합니다.");
    }
    if (to === "reported" && state.order !== "active") {
      return fail("CONFLICT", "진행 중인 주문에서만 입금 확인을 요청할 수 있습니다.");
    }
  }

  if (axis === "fulfillment") {
    if (state.order !== "active") {
      return fail("CONFLICT", "진행 중인 주문만 제작·전달 상태를 바꿀 수 있습니다.");
    }
  }

  if (axis === "refund" && to === "requested" && actor === "member" && state.order !== "cancellation_requested") {
    return fail("CONFLICT", "환불 요청은 취소 요청과 함께 접수됩니다.");
  }

  return ok(true);
}

/**
 * 상태 조합의 불변식. DB check 제약(supabase/migrations)과 같은 규칙이다.
 * 어떤 경로로든 이 조합이 저장되면 안 된다.
 */
export function checkInvariants(state: OrderState, ctx: TransitionContext): Result<true> {
  const { order, payment, fulfillment, refund } = state;

  // 출고·배포는 입금 확인 뒤에만.
  if ((fulfillment === "shipped" || fulfillment === "delivered" || fulfillment === "released") && payment !== "verified") {
    return fail("CONFLICT", "입금 확인 전에는 출고하거나 전자책을 배포할 수 없습니다.");
  }
  // 형식별 이행 상태.
  if (ctx.format === "ebook" && (fulfillment === "shipped" || fulfillment === "delivered")) {
    return fail("CONFLICT", "전자책은 배송 상태를 쓰지 않습니다.");
  }
  if (ctx.format === "print" && fulfillment === "released") {
    return fail("CONFLICT", "종이책은 전자책 배포 상태를 쓰지 않습니다.");
  }
  // 환불은 받은 돈이 있을 때만.
  if (refund !== "none" && !(payment === "verified" || payment === "mismatch")) {
    return fail("CONFLICT", "확인된 입금이 없으면 환불을 진행할 수 없습니다.");
  }
  // 입금 확인된 주문을 취소로 닫으려면 환불 절차가 시작돼 있어야 한다.
  if (order === "cancelled" && payment === "verified" && refund === "none") {
    return fail("CONFLICT", "입금 확인된 주문은 환불 절차 없이 취소할 수 없습니다.");
  }
  // 만료는 미입금 건에만.
  if (order === "expired" && payment === "verified") {
    return fail("CONFLICT", "입금 확인된 주문은 만료 상태가 될 수 없습니다.");
  }
  // 완료 주문은 전달이 끝난 상태.
  if (order === "completed" && !(fulfillment === "delivered" || fulfillment === "released")) {
    return fail("CONFLICT", "전달 전 주문은 완료 상태가 될 수 없습니다.");
  }
  return ok(true);
}

export const INITIAL_ORDER_STATE: OrderState = Object.freeze({
  order: "active",
  payment: "unpaid",
  fulfillment: "not_ready",
  refund: "none",
});

/** 재고 점유 여부. 취소/만료는 점유 해제 대상, 완료는 소진. */
export function holdsInventory(order: OrderStatus): boolean {
  return order === "active" || order === "cancellation_requested" || order === "completed";
}
