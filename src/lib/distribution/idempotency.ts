/**
 * 멱등키와 중복 요청 판정. 키 = 콘텐츠 + 버전 + 채널 + 모드.
 * 같은 키의 재시도는 새 작업이 아니라 같은 작업의 attempts로 처리한다.
 */
import { dFail, dOk, type DResult } from "./result";
import { CHANNELS, type Channel, type PublishJob, type PublishMode } from "./types";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function makeIdempotencyKey(params: {
  contentId: string;
  contentVersion: number;
  channel: Channel;
  mode: PublishMode;
}): DResult<string> {
  const { contentId, contentVersion, channel, mode } = params;
  if (!ID_PATTERN.test(contentId)) return dFail("INVALID_INPUT", "콘텐츠 ID 형식이 올바르지 않습니다.");
  if (!Number.isSafeInteger(contentVersion) || contentVersion < 1) {
    return dFail("INVALID_INPUT", "콘텐츠 버전은 1 이상의 정수여야 합니다.");
  }
  if (!(CHANNELS as readonly string[]).includes(channel)) return dFail("INVALID_INPUT", "지원하지 않는 채널입니다.");
  if (mode !== "live" && mode !== "dry_run") return dFail("INVALID_INPUT", "모드가 올바르지 않습니다.");
  // dry-run과 live는 키를 분리해 모의 실행이 실제 게시 중복 판정을 막지 않게 한다.
  return dOk(`pub:${contentId}:v${contentVersion}:${channel}:${mode}`);
}

/**
 * 새 작업 생성 전 중복 판정.
 * - 같은 키의 작업이 cancelled가 아니면 중복(진행 중·게시됨·실패·unknown 모두 기존 작업에서 처리)
 * - 같은 콘텐츠·채널에 끝나지 않은 live 작업(다른 버전)이 있으면 중복(동시 게시 방지)
 * - 같은 콘텐츠·채널에 이미 live published가 있으면 새 버전이라도 '재게시'는 명시 확인 필요
 */
export function checkDuplicate(
  existing: readonly PublishJob[],
  candidate: { idempotencyKey: string; contentId: string; channel: Channel; mode: PublishMode },
  options: { allowRepublish: boolean } = { allowRepublish: false },
): DResult<true> {
  const sameKey = existing.find((j) => j.idempotencyKey === candidate.idempotencyKey && j.status !== "cancelled");
  if (sameKey) {
    return dFail("DUPLICATE", `같은 콘텐츠·버전·채널 작업이 이미 있습니다(상태: ${sameKey.status}).`);
  }
  if (candidate.mode === "live") {
    // 같은 콘텐츠·채널의 다른 버전 live 작업이 아직 끝나지 않았으면(예약·실행 중·결과 불명·재시도 가능한 실패)
    // 두 버전이 모두 게시될 수 있다. 이전 작업을 취소하거나 대사한 뒤 만든다. allowRepublish로도 우회하지 않는다.
    const open = existing.find(
      (j) =>
        j.contentId === candidate.contentId &&
        j.channel === candidate.channel &&
        j.mode === "live" &&
        (j.status === "scheduled" || j.status === "dispatching" || j.status === "unknown" || j.status === "failed"),
    );
    if (open) {
      return dFail("DUPLICATE", `이 채널에 끝나지 않은 이전 버전 작업이 있습니다(v${open.contentVersion}, ${open.status}). 취소·대사 후 만드세요.`);
    }
  }
  if (candidate.mode === "live" && !options.allowRepublish) {
    const published = existing.find(
      (j) => j.contentId === candidate.contentId && j.channel === candidate.channel && j.mode === "live" && j.status === "published",
    );
    if (published) {
      return dFail("DUPLICATE", "이 채널에 이미 게시된 이전 버전이 있습니다. 재게시는 명시적으로 확인해야 합니다.");
    }
  }
  return dOk(true);
}
