/**
 * Threads OAuth 런타임 연결(server-only). AUTOPOST-THREADS-OAUTH-019.
 * 서버 env를 이 파일에서만 읽어 설정 판정 함수에 넘긴다(값은 로그·응답에 싣지 않음). 키가 하나라도 없으면 준비 전.
 * 실제 공급자 호출은 서버 설정이 모두 준비된 운영 환경에서 사용자가 연결을 누를 때만 일어난다(이번 작업에서 실행하지 않음).
 */
import "server-only";
import { requireDistributionActor } from "../../actor";
import { getServiceRpcClient } from "../../blog/service";
import { loadThreadsOAuthConfig, OAUTH_ENV } from "./config";
import type { OAuthDeps } from "./flow";

export function getThreadsOAuthDeps(): OAuthDeps {
  return {
    resolveActor: requireDistributionActor,
    getClient: getServiceRpcClient,
    getConfig: () => loadThreadsOAuthConfig(process.env),
    http: { fetch: (url, init) => fetch(url, init), timeoutMs: 15_000 },
  };
}

/** 화면 표시용: 준비 여부와 빠진 설정 **이름**만(값 없음). service 키는 별도 판정. */
export function threadsOAuthReadiness(): { ready: boolean; missing: string[]; serviceReady: boolean; redirectUri: string | null } {
  const cfg = loadThreadsOAuthConfig(process.env);
  const serviceReady = getServiceRpcClient() !== null;
  return {
    ready: cfg.status === "ok" && serviceReady,
    missing: cfg.status === "ok" ? [] : cfg.missing,
    serviceReady,
    redirectUri: cfg.status === "ok" ? cfg.config.redirectUri : null,
  };
}

export { OAUTH_ENV };
