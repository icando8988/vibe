/**
 * Instagram OAuth 서버 설정 판정 — 순수 함수(시험 대상). BE-INSTAGRAM-OAUTH-043.
 * 필요한 서버 env(이름만): INSTAGRAM_APP_ID(대시보드의 Instagram app ID — Facebook 앱 ID 아님), INSTAGRAM_APP_SECRET,
 *   DISTRIBUTION_TOKEN_KEY, NEXT_PUBLIC_SITE_URL(https origin). 하나라도 없거나 형식이 틀리면 not_ready(이름만 보고).
 * process.env를 직접 읽지 않는다(호출자가 source를 넘긴다). app secret은 DB·응답·로그에 넣지 않는다.
 */
import { loadKeyring, SecretToken, TOKEN_KEY_ENV, type Keyring } from "../../connections/crypto";
import { INSTAGRAM_CALLBACK_PATH } from "./endpoints";

export const INSTAGRAM_OAUTH_ENV = ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", TOKEN_KEY_ENV, "NEXT_PUBLIC_SITE_URL"] as const;

export type InstagramOAuthConfig = {
  appId: string;
  appSecret: SecretToken;
  siteOrigin: string;
  /** 대시보드 Business login settings에 등록할 고정 redirect URI(이 값 하나만 — 요청 Host 기반 조립 없음) */
  redirectUri: string;
  keyring: Keyring;
};
export type InstagramOAuthConfigResult = { status: "ok"; config: InstagramOAuthConfig } | { status: "not_ready"; missing: string[] };

const APP_ID_RE = /^[0-9]{5,32}$/;
const APP_SECRET_RE = /^[A-Za-z0-9]{16,128}$/;

/** https origin만(경로·자격정보·쿼리 없음). */
export function parseSiteOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return null;
  return u.origin;
}

export function loadInstagramOAuthConfig(source: Readonly<Record<string, string | undefined>>): InstagramOAuthConfigResult {
  const missing: string[] = [];
  const appId = source.INSTAGRAM_APP_ID?.trim();
  const appSecret = source.INSTAGRAM_APP_SECRET?.trim();
  if (!appId || !APP_ID_RE.test(appId)) missing.push("INSTAGRAM_APP_ID");
  if (!appSecret || !APP_SECRET_RE.test(appSecret)) missing.push("INSTAGRAM_APP_SECRET");
  const k = loadKeyring(source);
  if (k.status !== "ok") missing.push(TOKEN_KEY_ENV);
  const siteOrigin = parseSiteOrigin(source.NEXT_PUBLIC_SITE_URL);
  if (!siteOrigin) missing.push("NEXT_PUBLIC_SITE_URL");
  if (missing.length || !appId || !appSecret || k.status !== "ok" || !siteOrigin) return { status: "not_ready", missing };
  return {
    status: "ok",
    config: { appId, appSecret: new SecretToken(appSecret), siteOrigin, redirectUri: `${siteOrigin}${INSTAGRAM_CALLBACK_PATH}`, keyring: k.keyring },
  };
}
