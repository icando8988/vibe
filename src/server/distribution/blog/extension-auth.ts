/**
 * 확장 요청 Bearer 인증 — 의존성 주입 순수 함수(테스트 대상). AUTOPOST-BLOG-TOKEN-005.
 * 매 요청: 형식 확인 → sha256 → service_role RPC(distribution_authenticate_extension_token)가
 * 철회·만료·소유자 D1(현재 상태)을 확인. 토큰·해시·DB 원문은 반환·로그하지 않는다.
 */
import type { RpcClient } from "../write-runner";
import { isUuid } from "../validation";
import { hashExtensionToken, parseBearerToken } from "./token";
import { TOKEN_RPC } from "./token-service";

export type ExtensionAuth = { ok: true; userId: string; tokenId: string } | { ok: false; status: 401 | 503 };

export async function authenticateExtensionRequest(
  authorization: string | null,
  getClient: () => RpcClient | null,
): Promise<ExtensionAuth> {
  const token = parseBearerToken(authorization);
  if (!token) return { ok: false, status: 401 }; // 형식 불일치: 서버 조회 없음
  const client = getClient();
  if (!client) return { ok: false, status: 503 }; // 키 없음: 준비 전
  let res;
  try {
    res = await client.rpc(TOKEN_RPC.authenticate, { p_token_hash: hashExtensionToken(token) });
  } catch {
    return { ok: false, status: 503 };
  }
  if (res.error) return { ok: false, status: 503 };
  const rows = Array.isArray(res.data) ? res.data : [];
  if (rows.length !== 1) return { ok: false, status: 401 }; // 없음·철회·만료·권한 상실을 구분하지 않는다
  const row = rows[0] as Record<string, unknown>;
  if (!isUuid(row.user_id) || !isUuid(row.token_id)) return { ok: false, status: 401 };
  return { ok: true, userId: row.user_id, tokenId: row.token_id };
}
