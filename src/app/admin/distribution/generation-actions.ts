"use server";

/**
 * 채널 텍스트 초안 생성 서버 액션(고정 계약). DRAFT-GEN-001 / task_7fa07439c742.
 *   generateChannelDraftAction(formData: FormData): Promise<GenerateDraftOutcome>
 *
 * 입력 form 필드: contentId · channel(blog|threads|instagram) · expectedContentVersionId(렌더된 현재 원문 버전) · confirmGenerate=on
 * 서버에서 매번: 세션 actor + D1(승인된 admin) → 입력 → 설정·사용량 한도 → 승인된 현재 원문 버전 정확히 일치 → 공급자 1회.
 * 결과는 **저장하지 않은 제안**이다. 저장은 기존 appendDraftRevisionAction, 승인은 기존 decideApprovalAction으로 사람이 한다.
 * revalidate·redirect 없음(아무것도 저장하지 않으므로). 반환값은 화면 표시용 필드만 담고 키·원문 오류를 담지 않는다.
 * 기본 닫힘: env 미설정이거나 사용량 한도 장치 미등록이면 not_configured(공급자 호출 0).
 */
import { createGenerationRuntimeDeps } from "@/server/distribution/generation/runtime";
import { generateChannelDraft } from "@/server/distribution/generation/service";
import type { GenerateDraftOutcome } from "@/server/distribution/generation/types";

export async function generateChannelDraftAction(formData: FormData): Promise<GenerateDraftOutcome> {
  return generateChannelDraft(createGenerationRuntimeDeps(), formData);
}
