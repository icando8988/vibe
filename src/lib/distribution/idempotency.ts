/**
 * 멱등키와 중복 요청 판정. 키 = 콘텐츠 + 버전 + 채널 + 모드.
 * 같은 키의 재시도는 새 작업이 아니라 같은 작업의 attempts로 처리한다.
 * M2 DB(distribution_jobs_idempotency_open_unique · distribution_jobs_open_per_channel_unique ·
 * distribution_create_job의 재게시 사전 검사)와 같은 규칙이다(AUTOPOST-M2-APP-001).
 * DB가 최종 보장(경합 포함)이며 이 함수는 친절한 사전 판정이다 — existing이 완전한 목록일 때만 정확하다.
 */
import { dFail, dOk, type DResult } from "./result";
import { CHANNELS, PUBLISH_MODES, type Channel, type JobStatus, type PublishJob, type PublishMode } from "./types";

/**
 * 로컬 ID 형식(기존). 미리보기('local-preview')·로컬 테스트('c1', 'c-why') 같은 일반 문자열을 허용한다.
 * 이 형식으로 만든 키는 M2 DB 키 정규식과 호환되지 않을 수 있다(SQL 호환을 보장하지 않는다. DB 행과 비교·저장하는 경로는 idFormat: "db"를 쓴다).
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** M2 distribution_contents.id(uuid)를 PostgreSQL uuid::text로 출력한 형태(소문자 8-4-4-4-12). */
const DB_CONTENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** M2 distribution_jobs.idempotency_key check 정규식과 동일. */
export const DB_IDEMPOTENCY_KEY_PATTERN =
  /^pub:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:v[1-9][0-9]*:(blog|threads|instagram):(live|dry_run|manual)$/;

/** PostgreSQL integer 상한(content_version_no integer). */
const PG_INT_MAX = 2147483647;

/**
 * 키를 만들 때 콘텐츠 ID 형식.
 * - local(기본): 기존 로컬 형식. DB에 저장되지 않는 미리보기·테스트 전용.
 * - db: M2 DB 키와 같아야 하는 경로(서버·DB 매퍼). 소문자 uuid와 integer 범위 버전만 허용하고,
 *   결과가 DB check 정규식을 통과하지 않으면 실패한다. 대문자 uuid는 정규화하지 않고 거부한다
 *   (DB가 돌려준 uuid::text를 그대로 넘겨야 한다).
 */
export type IdempotencyIdFormat = "local" | "db";

/** 키 문자열이 M2 DB idempotency_key check를 통과하는가. */
export function isDbIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && DB_IDEMPOTENCY_KEY_PATTERN.test(key);
}

export function makeIdempotencyKey(
  params: {
    contentId: string;
    contentVersion: number;
    channel: Channel;
    mode: PublishMode;
  },
  options: { idFormat?: IdempotencyIdFormat } = {},
): DResult<string> {
  const { contentId, contentVersion, channel, mode } = params;
  const idFormat = options.idFormat ?? "local";
  if (idFormat !== "local" && idFormat !== "db") return dFail("INVALID_INPUT", "ID 형식 옵션이 올바르지 않습니다.");
  if (typeof contentId !== "string") return dFail("INVALID_INPUT", "콘텐츠 ID 형식이 올바르지 않습니다.");
  if (idFormat === "db" ? !DB_CONTENT_UUID.test(contentId) : !ID_PATTERN.test(contentId)) {
    return dFail(
      "INVALID_INPUT",
      idFormat === "db" ? "DB 콘텐츠 ID는 소문자 uuid여야 합니다." : "콘텐츠 ID 형식이 올바르지 않습니다.",
    );
  }
  if (!Number.isSafeInteger(contentVersion) || contentVersion < 1 || (idFormat === "db" && contentVersion > PG_INT_MAX)) {
    return dFail("INVALID_INPUT", "콘텐츠 버전은 1 이상의 정수여야 합니다.");
  }
  if (!(CHANNELS as readonly string[]).includes(channel)) return dFail("INVALID_INPUT", "지원하지 않는 채널입니다.");
  if (!(PUBLISH_MODES as readonly string[]).includes(mode)) return dFail("INVALID_INPUT", "모드가 올바르지 않습니다.");
  // 모드별로 키를 분리해 모의 실행이 실제 게시 중복 판정을 막지 않게 한다(형식은 M2 키와 같다).
  const key = `pub:${contentId}:v${contentVersion}:${channel}:${mode}`;
  if (idFormat === "db" && !isDbIdempotencyKey(key)) {
    return dFail("INVALID_INPUT", "DB 멱등키 형식과 맞지 않습니다.");
  }
  return dOk(key);
}

/** 실제 게시 모드(외부에 게시물이 생길 수 있음). dry_run은 열린 작업·재게시 판정 대상이 아니다. */
const PUBLISHING_MODES: readonly PublishMode[] = ["live", "manual"];

/** 같은 콘텐츠·채널에서 동시에 하나만 허용하는 열린 상태(distribution_jobs_open_per_channel_unique와 동일). */
export const OPEN_PUBLISHING_STATUSES: readonly JobStatus[] = [
  "scheduled",
  "dispatching",
  "unknown",
  "failed",
  "manual_ready",
  "awaiting_evidence",
];

/**
 * 새 작업 생성 전 중복 판정.
 * - 같은 키의 작업이 cancelled가 아니면 중복(진행 중·게시됨·실패·unknown·abandoned 모두 기존 작업에서 처리)
 * - 같은 콘텐츠·채널에 열린 live/manual 작업(다른 버전 포함)이 있으면 중복(동시 게시 방지)
 * - 같은 콘텐츠·채널에 이미 live/manual published가 있으면 새 버전이라도 '재게시'는 명시 확인 필요
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
  if (!PUBLISHING_MODES.includes(candidate.mode)) return dOk(true);

  // 같은 콘텐츠·채널의 열린 live/manual 작업이 있으면(예약·실행 중·결과 불명·실패·수동 대기·증거 대기)
  // 두 버전이 모두 게시될 수 있다. 이전 작업을 취소하거나 대사한 뒤 만든다. allowRepublish로도 우회하지 않는다.
  const open = existing.find(
    (j) =>
      j.contentId === candidate.contentId &&
      j.channel === candidate.channel &&
      PUBLISHING_MODES.includes(j.mode) &&
      OPEN_PUBLISHING_STATUSES.includes(j.status),
  );
  if (open) {
    return dFail("DUPLICATE", `이 채널에 끝나지 않은 이전 작업이 있습니다(v${open.contentVersion}, ${open.status}). 취소·대사 후 만드세요.`);
  }
  if (!options.allowRepublish) {
    const published = existing.find(
      (j) =>
        j.contentId === candidate.contentId &&
        j.channel === candidate.channel &&
        PUBLISHING_MODES.includes(j.mode) &&
        j.status === "published",
    );
    if (published) {
      return dFail("DUPLICATE", "이 채널에 이미 게시된 이전 버전이 있습니다. 재게시는 명시적으로 확인해야 합니다.");
    }
  }
  return dOk(true);
}
