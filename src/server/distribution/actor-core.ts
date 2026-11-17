/**
 * 쓰기 actor 도출 — 순수 함수(테스트 대상).
 * actor는 검증된 세션의 viewer(getViewer: auth.getUser() 서버 검증 + RLS 본인 행)에서만 나온다.
 * 폼·쿼리·헤더의 어떤 actor 값도 받지 않는다(인자에 그런 자리가 없다).
 * D1 = admin 역할 AND approval_status=approved (decideDistributionAccess와 같은 판정).
 */
import { decideDistributionAccess, type DistributionDenyReason } from "@/components/distribution-console/access";
import type { Viewer } from "@/lib/auth/viewer";

export type ActorResult = { ok: true; actorId: string } | { ok: false; reason: DistributionDenyReason };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveDistributionActor(viewer: Viewer): ActorResult {
  const decision = decideDistributionAccess(viewer);
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  if (viewer.kind !== "member" || !UUID_RE.test(viewer.userId)) return { ok: false, reason: "unauthenticated" };
  return { ok: true, actorId: viewer.userId.toLowerCase() };
}
