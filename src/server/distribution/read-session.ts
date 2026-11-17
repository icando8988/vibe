/**
 * 운영용 ReadSource: 사용자 세션 Supabase 클라이언트(publishable 키 + 세션 쿠키) → RLS 적용 조회. server-only.
 * Supabase가 설정되지 않았으면 null(not_configured).
 */
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Query, ReadResult, ReadSource } from "./read";

export async function getSessionReadSource(): Promise<ReadSource | null> {
  const client = await createSupabaseServerClient();
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
      if (error) return { error: { code: error.code, message: error.message } };
      return { rows: (data ?? []) as unknown as Record<string, unknown>[] };
    },
  };
}
