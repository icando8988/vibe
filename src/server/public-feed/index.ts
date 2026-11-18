/**
 * 방문자 공개 채널 피드 조회 진입점 — BE-PUBLIC-CHANNEL-FEED-084. server-only(클라이언트 번들에 들어가면 빌드 실패).
 *
 * service_role 읽기를 쓰는 이유: 배포 테이블은 anon 권한이 없고 authenticated도 배포 관리자 RLS로만 읽힌다.
 * 방문자 세션으로는 읽을 수 없으므로 서버에서만 service_role SELECT로 읽고, core.ts가 공개 자격을 판정해
 * 최소 DTO(PublicChannelFeed)만 넘긴다. 요청 열은 core.ts의 *_COLS 상수뿐이며 쓰기·RPC 호출은 없다.
 * 키가 없으면 not_configured(정상 0건과 구분).
 */
import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import type { Query, ReadResult, ReadSource } from "../distribution/read";
import { loadPublicChannelFeeds, type PublicChannelFeedsResult } from "./core";

export type {
  ExclusionReason,
  PublicChannelAvailability,
  PublicChannelFeedsData,
  PublicChannelFeedsResult,
} from "./core";

function getServiceReadSource(): ReadSource | null {
  const client = createSupabaseServiceClient();
  if (!client) return null;
  return {
    async select(q: Query): Promise<ReadResult> {
      let b = client.from(q.table).select(q.columns.join(","));
      for (const f of q.filters ?? []) {
        b = f.op === "eq" ? b.eq(f.col, f.value as string) : b.in(f.col, [...(f.value as readonly string[])]);
      }
      for (const o of q.order ?? []) b = b.order(o.col, { ascending: o.ascending });
      if (q.limit) b = b.limit(q.limit);
      const { data, error } = await b;
      if (error) return { error: { code: error.code } }; // 메시지는 넘기지 않는다
      return { rows: (data ?? []) as unknown as Record<string, unknown>[] };
    },
  };
}

/** 홈 등 서버 컴포넌트에서 호출. status가 "ok"가 아니면 UI는 "게시물 없음"이 아니라 "불러오지 못함"으로 다룬다. */
export async function getPublicChannelFeeds(now: Date = new Date()): Promise<PublicChannelFeedsResult> {
  return loadPublicChannelFeeds(getServiceReadSource(), now);
}
