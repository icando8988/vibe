/**
 * 콘텐츠 화면용 서버 로더(server-only). 조회는 사용자 세션(RLS), 쓰기 준비 여부는 service 키 존재로만 판단한다.
 * 전역 상수(DATA_SOURCE_CONNECTED)로 준비 신호를 만들지 않는다 — 실제 조회 결과와 키 유무에서 도출한다.
 */
import "server-only";
import { getServiceRpcClient } from "./blog/service";
import { listExtensionHandoffs } from "./blog/handoff-status";
import { requireDistributionActor } from "./actor";
import { getJobDetail, listJobs } from "./jobs-read";
import { getContentDetail, listContents } from "./read";
import { getSessionReadSource } from "./read-session";

export async function loadContentList() {
  return listContents(await getSessionReadSource());
}

export async function loadContentDetail(contentId: string) {
  return getContentDetail(await getSessionReadSource(), contentId);
}

export async function loadJobs(filter: { contentId?: string } = {}) {
  return listJobs(await getSessionReadSource(), filter);
}

export async function loadJobDetail(jobId: string) {
  return getJobDetail(await getSessionReadSource(), jobId);
}

/** 본인이 요청한 확장 인계 상태(F-3 조회 RPC — 조회 시점에 만료·토큰 철회 건을 needs_check로 정리). */
export async function loadHandoffs() {
  return listExtensionHandoffs({ resolveActor: requireDistributionActor, getClient: getServiceRpcClient });
}

/** 서버 저장 경로(service 키)가 설정됐는가. 값은 노출하지 않는다. */
export function isWriteConfigured(): boolean {
  return getServiceRpcClient() !== null;
}
