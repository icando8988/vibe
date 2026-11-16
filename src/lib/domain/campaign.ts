/**
 * 캠페인 모집·재고·목표 계산 (계획 11절, 19.1절).
 * 검토 상태 / 모집 상태 / 목표 달성 / 재고는 서로 다른 값이다.
 */
import { fail, ok, type Result } from "./errors";

export const CAMPAIGN_REVIEW_STATUSES = ["draft", "pending_review", "approved", "rejected"] as const;
export const CAMPAIGN_RECRUITMENT_STATUSES = ["scheduled", "open", "closed", "cancelled"] as const;
export type CampaignReviewStatus = (typeof CAMPAIGN_REVIEW_STATUSES)[number];
export type CampaignRecruitmentStatus = (typeof CAMPAIGN_RECRUITMENT_STATUSES)[number];

export type CampaignChannel = "direct" | "external";

/**
 * 목표 집계 기준. DEC-003 확정 전에는 기본값을 두지 않는다.
 * verified = 입금 확인 수량(추천안 A), applied = 유효 신청 수량(원문 시나리오 B)
 */
export type GoalBasis = "verified" | "applied";

export interface CampaignWindow {
  reviewStatus: CampaignReviewStatus;
  recruitmentStatus: CampaignRecruitmentStatus;
  channel: CampaignChannel;
  opensAt: Date;
  closesAt: Date;
}

/**
 * 신청 가능 여부. 서버 시간 기준 opensAt <= now < closesAt.
 * 배치가 recruitmentStatus를 늦게 바꿔도 시간 판단이 우선한다.
 */
export function checkOpenForApplication(c: CampaignWindow, now: Date): Result<true> {
  if (c.channel !== "direct") {
    return fail("NOT_OPEN", "외부 펀딩 캠페인은 이 사이트에서 신청하지 않습니다.");
  }
  if (c.reviewStatus !== "approved") {
    return fail("NOT_OPEN", "승인되지 않은 캠페인입니다.");
  }
  if (c.recruitmentStatus === "cancelled" || c.recruitmentStatus === "closed") {
    return fail("NOT_OPEN", "모집이 끝난 캠페인입니다.");
  }
  const t = now.getTime();
  if (Number.isNaN(t) || Number.isNaN(c.opensAt.getTime()) || Number.isNaN(c.closesAt.getTime())) {
    return fail("INVALID_INPUT", "캠페인 일정이 올바르지 않습니다.");
  }
  if (t < c.opensAt.getTime()) {
    return fail("NOT_OPEN", "아직 신청 기간이 아닙니다.");
  }
  if (t >= c.closesAt.getTime()) {
    return fail("NOT_OPEN", "신청 기간이 끝났습니다.");
  }
  return ok(true);
}

/**
 * 남은 수량. maxQty가 null(무제한)이면 null을 돌려주며 화면은 '남은 수량'을 꾸며 보여주지 않는다.
 */
export function remainingQuantity(maxQty: number | null, activeReservedQty: number): number | null {
  if (maxQty === null) return null;
  return Math.max(0, maxQty - activeReservedQty);
}

export interface ReservationCheckInput {
  requestedQty: number;
  maxQty: number | null;
  activeReservedQty: number;
  /** 1인 상한. POLICY-PENDING(DEC-003): null이면 상한 없음 */
  perUserLimit: number | null;
  userActiveQty: number;
}

/** 재고·1인 상한 사전 판정. 최종 판정은 DB 트랜잭션(DEV-005)에서 잠금과 함께 다시 한다. */
export function checkReservation(input: ReservationCheckInput): Result<true> {
  const { requestedQty, maxQty, activeReservedQty, perUserLimit, userActiveQty } = input;
  if (!Number.isSafeInteger(requestedQty) || requestedQty <= 0) {
    return fail("INVALID_QUANTITY", "수량은 1 이상의 정수여야 합니다.");
  }
  if (perUserLimit !== null && userActiveQty + requestedQty > perUserLimit) {
    return fail("INVALID_QUANTITY", `1인 최대 ${perUserLimit}개까지 신청할 수 있습니다.`);
  }
  const remaining = remainingQuantity(maxQty, activeReservedQty);
  if (remaining !== null && requestedQty > remaining) {
    return fail("SOLD_OUT", remaining === 0 ? "남은 수량이 없습니다." : `남은 수량은 ${remaining}개입니다.`);
  }
  return ok(true);
}

export interface GoalCounts {
  /** 유효 신청(취소·만료 제외) 수량 */
  appliedQty: number;
  /** 입금 확인 수량 */
  verifiedQty: number;
}

export interface GoalProgress {
  basis: GoalBasis;
  countedQty: number;
  minGoalQty: number;
  remainingToGoal: number;
  reached: boolean;
}

/**
 * 목표 진행. basis는 반드시 명시해야 한다(정책 미확정 값을 몰래 고르지 않기 위함).
 */
export function goalProgress(minGoalQty: number, counts: GoalCounts, basis: GoalBasis): GoalProgress {
  const counted = basis === "verified" ? counts.verifiedQty : counts.appliedQty;
  const remaining = Math.max(0, minGoalQty - counted);
  return { basis, countedQty: counted, minGoalQty, remainingToGoal: remaining, reached: remaining === 0 };
}
