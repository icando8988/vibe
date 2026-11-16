/**
 * 추적 링크 생성. 기준 URL과 캠페인 값은 반드시 호출자가 준다.
 * 공개 도메인이 정해지기 전에는 절대 URL을 만들지 않으며, 기본 캠페인명도 두지 않는다.
 */
import { dFail, dOk, type DResult } from "./result";

export interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
  content?: string;
}

const UTM_VALUE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"];

/**
 * @param siteBaseUrl 확정된 공개 사이트 기준 URL(https). 미확정이면 null → NOT_CONNECTED 성격의 거절
 * @param targetPath 사이트 내부 경로(/로 시작)
 */
export function buildTrackedUrl(siteBaseUrl: string | null, targetPath: string, utm: UtmParams): DResult<string> {
  if (siteBaseUrl === null || siteBaseUrl.trim() === "") {
    return dFail("NOT_CONNECTED", "공개 사이트 주소가 정해지지 않아 추적 링크를 만들 수 없습니다.");
  }
  let base: URL;
  try {
    base = new URL(siteBaseUrl);
  } catch {
    return dFail("INVALID_INPUT", "사이트 기준 URL 형식이 올바르지 않습니다.");
  }
  if (base.protocol !== "https:") return dFail("INVALID_INPUT", "사이트 기준 URL은 https여야 합니다.");
  if (base.username || base.password) return dFail("INVALID_INPUT", "기준 URL에 계정 정보를 넣을 수 없습니다.");
  if (!targetPath.startsWith("/") || targetPath.startsWith("//") || targetPath.includes("\\")) {
    return dFail("INVALID_INPUT", "목적 경로는 사이트 내부 경로여야 합니다.");
  }

  const entries: [string, string | undefined][] = [
    ["utm_source", utm.source],
    ["utm_medium", utm.medium],
    ["utm_campaign", utm.campaign],
    ["utm_content", utm.content],
  ];
  for (const [k, v] of entries) {
    if (v === undefined) continue;
    if (!UTM_VALUE.test(v)) return dFail("INVALID_INPUT", `${k} 값은 소문자·숫자·._- 1~64자여야 합니다.`);
  }

  const url = new URL(targetPath, base.origin);
  if (url.origin !== base.origin) return dFail("INVALID_INPUT", "목적 경로가 다른 사이트를 가리킵니다.");
  for (const k of UTM_KEYS) {
    if (url.searchParams.has(k)) return dFail("INVALID_INPUT", "목적 경로에 이미 UTM 값이 있습니다.");
  }
  for (const [k, v] of entries) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return dOk(url.toString());
}
