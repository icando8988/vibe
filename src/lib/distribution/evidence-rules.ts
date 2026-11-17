/**
 * 게시 증거 값 규칙 (순수 함수, AUTOPOST-M2-APP-001 보완).
 * M2 SQL(20261116040000_distribution_jobs.sql)의 check 제약·helper를 그대로 옮기거나 더 엄격하게 둔다.
 * 목표: DB가 거부할 값을 앱 도메인이 성공으로 처리하지 않는다(앱이 더 엄격한 것은 허용).
 *
 * DB 근거
 *  - external_url: char_length <= 2048 AND ~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' (jobs·evidence 공통)
 *  - external_post_id / external_account_id: ~ '^[^[:space:][:cntrl:]]{1,200}$' (함수가 btrim 후 저장)
 *  - manual URL 호스트: public.distribution_manual_evidence_host_allowed(channel, host)
 *      = channel='blog' AND host IN ('blog.naver.com','m.blog.naver.com'),
 *      host = lower(substring(url from '^https://([^/?#:@]+)'))  (D7 미결정 기본값)
 *  - evidence manual_id_note: operator_manual 증거가 URL 없이 외부 ID만 있으면 method_note(1~1000자) 필수
 */
import type { Channel } from "./types";

/** DB external_url check와 같은 형태(scheme 소문자 고정, authority에 @·공백 불가, 전체 공백 불가). */
const DB_EVIDENCE_URL = /^https:\/\/[^/?#@\s]+([/?#]\S*)?$/;
const DB_URL_MAX = 2048;

/**
 * DB external_post_id/external_account_id check보다 같거나 엄격한 형태(공백·C0/DEL/C1 제어문자 없음).
 * u 플래그 없이(tsconfig target ES2017) UTF-16 단위로 200자 제한 → 보조 평면 문자는 2로 세어 DB보다 엄격.
 */
const DB_EXTERNAL_ID = /^[^\s\x00-\x1f\x7f-\x9f]{1,200}$/;

export const MANUAL_METHOD_NOTE_MAX = 1000;

/** 수동 증거 URL 허용 호스트(DB 기본값과 동일). D7 최종 결정 시 DB 함수와 함께 바꾼다. */
export const MANUAL_EVIDENCE_HOSTS: { readonly [C in Channel]: readonly string[] } = {
  blog: ["blog.naver.com", "m.blog.naver.com"],
  threads: [],
  instagram: [],
};

/** URL 문자열이 DB external_url check를 통과하는 형태인가(추가 파싱 검사는 호출자). */
export function isDbShapedEvidenceUrl(url: string): boolean {
  // UTF-16 길이 ≥ 코드포인트 길이(char_length) → DB보다 같거나 엄격
  return url.length <= DB_URL_MAX && DB_EVIDENCE_URL.test(url);
}

/** 외부 게시/계정 식별자가 DB check를 통과하는가. 앞뒤 공백 제거는 호출자가 먼저 한다. */
export function isValidExternalId(id: unknown): id is string {
  return typeof id === "string" && DB_EXTERNAL_ID.test(id);
}

/**
 * 수동 증거 URL 호스트 허용 여부. DB보다 엄격하다:
 *  - DB는 host를 ':' 앞에서 자르므로 'blog.naver.com:8443'도 통과하지만, 앱은 port가 있으면 거부한다.
 *  - 대소문자는 DB처럼 소문자로 비교한다(BLOG.NAVER.COM 허용). scheme은 DB 정규식처럼 'https://' 소문자만.
 *  - 계정 정보(@)·공백·끝 점(blog.naver.com.)·하위 도메인 변형은 거부. path/query/fragment는 DB처럼 제한 없음.
 */
export function manualEvidenceHostAllowed(channel: Channel, url: string): boolean {
  if (!isDbShapedEvidenceUrl(url)) return false;
  const rest = url.slice("https://".length);
  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  if (authority.includes(":") || authority.includes("@")) return false;
  const allowed = MANUAL_EVIDENCE_HOSTS[channel] ?? [];
  return allowed.includes(authority.toLowerCase());
}
