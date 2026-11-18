/**
 * 글감 후보 런타임 배선(server-only). TOPIC-COLLECT-131.
 * - 쓰기: requireDistributionActor(요청마다 세션 검증 + D1) + service_role RPC(없으면 not_ready).
 * - 읽기: 앱에서 D1을 먼저 확인한 뒤 세션(RLS) 읽기 — DB 정책도 같은 D1을 다시 강제한다.
 */
import "server-only";
import { requireDistributionActor } from "../actor";
import { getServiceRpcClient } from "../blog/service";
import { getSessionReadSource } from "../read-session";
import { listTopicCandidates } from "./read";
import type { TopicWriteDeps } from "./service";
import type { TopicListOutcome, TopicStatus } from "./types";

export const topicWriteDeps: TopicWriteDeps = { resolveActor: requireDistributionActor, getClient: getServiceRpcClient };

/** 서버 컴포넌트·액션용 목록 조회. D1 실패면 조회하지 않는다. */
export async function getTopicCandidates(filter: { status?: TopicStatus } = {}): Promise<TopicListOutcome> {
  const actor = await requireDistributionActor();
  if (!actor.ok) return { status: "denied", reason: actor.reason };
  return listTopicCandidates(await getSessionReadSource(), filter);
}
