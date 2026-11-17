/**
 * Threads OAuth 서버 설정 판정 — 순수 함수(테스트 대상). AUTOPOST-THREADS-OAUTH-019.
 * 필요한 서버 env(이름만): THREADS_APP_ID, THREADS_APP_SECRET, DISTRIBUTION_TOKEN_KEY, NEXT_PUBLIC_SITE_URL(https origin).
 * 하나라도 없거나 형식이 틀리면 not_ready(준비 전) — 이유는 변수 이름만 담고 값은 담지 않는다.
 * 이 모듈은 process.env를 직접 읽지 않는다(호출자가 source를 넘긴다). 앱 secret은 DB에 저장하지 않는다.
 */
import { loadKeyring, SecretToken, TOKEN_KEY_ENV, type Keyring } from "../../connections/crypto";
import { THREADS_CALLBACK_PATH } from "./endpoints";

export const OAUTH_ENV = ["THREADS_APP_ID", "THREADS_APP_SECRET", TOKEN_KEY_ENV, "NEXT_PUBLIC_SITE_URL"] as const;

export type ThreadsOAuthConfig = {
  appId: string;
  appSecret: SecretToken;
  siteOrigin: string;
  /** Meta 앱에 등록할 고정 redirect URI(이 값 하나만 쓴다 — 이중 주소·요청 Host 기반 조립 없음) */
  redirectUri: string;
  keyring: Keyring;
};

export type ThreadsOAuthConfigResult = { status: "ok"; config: ThreadsOAuthConfig } | { status: "not_ready"; missing: string[] };

const APP_ID_RE = /^[0-9]{5,32}$/;
const APP_SECRET_RE = /^[A-Za-z0-9]{16,128}$/;

/** https origin만(경로·자격정보·쿼리 없음). localhost http는 허용하지 않는다(Meta redirect는 https 전제). */
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

export function loadThreadsOAuthConfig(source: Readonly<Record<string, string | undefined>>): ThreadsOAuthConfigResult {
  const missing: string[] = [];
  const appId = source.THREADS_APP_ID?.trim();
  const appSecret = source.THREADS_APP_SECRET?.trim();
  if (!appId || !APP_ID_RE.test(appId)) missing.push("THREADS_APP_ID");
  if (!appSecret || !APP_SECRET_RE.test(appSecret)) missing.push("THREADS_APP_SECRET");
  const k = loadKeyring(source);
  if (k.status !== "ok") missing.push(TOKEN_KEY_ENV);
  const siteOrigin = parseSiteOrigin(source.NEXT_PUBLIC_SITE_URL);
  if (!siteOrigin) missing.push("NEXT_PUBLIC_SITE_URL");
  if (missing.length || !appId || !appSecret || k.status !== "ok" || !siteOrigin) return { status: "not_ready", missing };
  return {
    status: "ok",
    config: { appId, appSecret: new SecretToken(appSecret), siteOrigin, redirectUri: `${siteOrigin}${THREADS_CALLBACK_PATH}`, keyring: k.keyring },
  };
}
