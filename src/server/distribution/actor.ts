/**
 * 서버 액션·라우트에서 쓰는 actor 진입점(server-only). 요청마다 세션을 다시 검증한다.
 */
import "server-only";
import { getViewer } from "@/lib/auth/viewer";
import { resolveDistributionActor, type ActorResult } from "./actor-core";

export async function requireDistributionActor(): Promise<ActorResult> {
  return resolveDistributionActor(await getViewer());
}
