/**
 * DRAFT-GEN-QUOTA — distribution_reserve_generation_quota(실제 migration) + 앱 어댑터 왕복(PGlite 대역).
 * `PGLITE_PROJECT`가 있을 때만 실행. 실제 Supabase·OpenAI 없음. 키·토큰·원문 없음.
 * PGlite는 단일 연결 — "동시" 호출은 직렬로 실행된다(advisory lock 상호배제 자체는 실제 Postgres 두 연결로 따로 확인 필요).
 * 테이블 비우기는 시험 DB 안에서만 supa_owner TRUNCATE(행 트리거 미발동)로 한다.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRpcQuota, loadQuotaLimits, QUOTA_RPC, type QuotaLimits } from "@/server/distribution/generation/quota";
import type { RpcClient } from "@/server/distribution/write-runner";
import { inTx, openDb, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const U = {
  a1: "00000000-0000-4000-8000-00000000000a",
  a2: "00000000-0000-4000-8000-00000000000b",
  pending: "00000000-0000-4000-8000-0000000000c1",
  member: "00000000-0000-4000-8000-0000000000c2",
};
let db: Db;
let rpc: RpcClient;
const L = (o: Partial<QuotaLimits> = {}): QuotaLimits => ({ actorPerMinute: 2, actorPerDay: 20, globalPerMinute: 3, globalPerDay: 100, ...o });
const params = (actor: string, l: QuotaLimits, channel = "threads", model = "gpt-4o-mini") => ({
  p_actor_id: actor, p_channel: channel, p_model: model,
  p_actor_per_minute: l.actorPerMinute, p_actor_per_day: l.actorPerDay, p_global_per_minute: l.globalPerMinute, p_global_per_day: l.globalPerDay,
});

async function owner<T = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> {
  await db.exec("set role supa_owner");
  try {
    return (await db.query(sql, p)).rows as T[];
  } finally {
    await db.exec("reset role");
  }
}
const count = async () => Number((await owner<{ n: number }>("select count(*)::int as n from public.distribution_generation_reservations"))[0]?.n);
async function denied(role: string, sql: string): Promise<string | null> {
  try {
    await inTx(db, role, null, () => db.query(sql));
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}

describe.skipIf(!PROJECT)("PGlite 왕복: AI 생성 요청 수 예약", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [U.a1, U.a2, U.pending, U.member], [U.pending], [U.a1, U.a2, U.pending]);
    db = opened.db;
    rpc = rpcClientOf(db);
    expect(opened.applied).toContain("20261118020000_distribution_generation_quota.sql");
  }, 120_000);
  beforeEach(async () => {
    await owner("truncate public.distribution_generation_reservations");
  });

  it("관리자 분당 상한: 2건 예약 후 3번째 거절(actor_minute, retry 1~60초), 어댑터도 같은 판정", async () => {
    const q = createRpcQuota(rpc, L());
    expect(await q({ actorId: U.a1, channel: "threads", model: "gpt-4o-mini" })).toEqual({ ok: true });
    expect(await q({ actorId: U.a1, channel: "common", model: "gpt-4o-mini" })).toEqual({ ok: true });
    const third = await rpc.rpc(QUOTA_RPC, params(U.a1, L()));
    expect(third.data).toMatchObject({ reserved: false, scope: "actor_minute" });
    const retry = (third.data as { retry_after_seconds: number }).retry_after_seconds;
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    expect(await q({ actorId: U.a1, channel: "threads", model: "gpt-4o-mini" })).toMatchObject({ ok: false });
    expect(await count()).toBe(2); // 거절은 기록하지 않는다
  });

  it("프로젝트 전체 분당 상한: 다른 관리자도 전체 한도를 넘지 못한다(global_minute)", async () => {
    const l = L({ actorPerMinute: 2, globalPerMinute: 3 });
    expect((await rpc.rpc(QUOTA_RPC, params(U.a1, l))).data).toMatchObject({ reserved: true });
    expect((await rpc.rpc(QUOTA_RPC, params(U.a1, l))).data).toMatchObject({ reserved: true });
    expect((await rpc.rpc(QUOTA_RPC, params(U.a2, l))).data).toMatchObject({ reserved: true });
    expect((await rpc.rpc(QUOTA_RPC, params(U.a2, l))).data).toMatchObject({ reserved: false, scope: "global_minute" });
  });

  it("일당 상한(24시간 이동 창): 과거 예약을 세고, 24시간이 지난 예약은 세지 않는다", async () => {
    await owner(
      `insert into public.distribution_generation_reservations (actor_id, channel, model, created_at) values
         ($1,'blog','gpt-4o-mini', now() - interval '2 hours'), ($1,'blog','gpt-4o-mini', now() - interval '3 hours'),
         ($1,'blog','gpt-4o-mini', now() - interval '25 hours')`,
      [U.a1],
    );
    const l = L({ actorPerMinute: 2, actorPerDay: 2, globalPerMinute: 3, globalPerDay: 100 });
    const r = await rpc.rpc(QUOTA_RPC, params(U.a1, l));
    expect(r.data).toMatchObject({ reserved: false, scope: "actor_day" });
    const retry = (r.data as { retry_after_seconds: number }).retry_after_seconds;
    expect(retry).toBeGreaterThan(20 * 3600); // 3시간 전 예약이 빠지는 약 21시간 뒤
    expect(retry).toBeLessThanOrEqual(21 * 3600 + 5);
    expect((await rpc.rpc(QUOTA_RPC, params(U.a2, l))).data).toMatchObject({ reserved: true }); // 다른 관리자는 별개
  });

  it("동시 호출 10건(전체 분당 3) → 정확히 3건만 예약", async () => {
    const l = L({ actorPerMinute: 3, actorPerDay: 20, globalPerMinute: 3, globalPerDay: 100 });
    const outs = await Promise.all(Array.from({ length: 10 }, (_, i) => rpc.rpc(QUOTA_RPC, params(i % 2 ? U.a1 : U.a2, l))));
    expect(outs.filter((o) => (o.data as { reserved?: boolean } | null)?.reserved === true)).toHaveLength(3);
    expect(outs.every((o) => o.error === null)).toBe(true);
    expect(await count()).toBe(3);
  });

  it("D1: 승인 대기 admin·일반 회원·없는 사용자는 42501, 기록 0 — 어댑터는 거절", async () => {
    for (const actor of [U.pending, U.member, "00000000-0000-4000-8000-0000000000ff"]) {
      const r = await rpc.rpc(QUOTA_RPC, params(actor, L()));
      expect((r.error as { code?: string } | null)?.code).toBe("42501");
      expect(await createRpcQuota(rpc, L())({ actorId: actor, channel: "threads", model: "gpt-4o-mini" })).toEqual({ ok: false, retryAfterSeconds: null });
    }
    expect(await count()).toBe(0);
  });

  it("범위·관계 위반 한도, 잘못된 채널·모델 → 22023, 기록 0", async () => {
    const bad: Array<Partial<QuotaLimits>> = [{ actorPerMinute: 0 }, { actorPerMinute: 31 }, { actorPerDay: 501 }, { globalPerMinute: 121 }, { globalPerDay: 5001 }, { actorPerMinute: 3, actorPerDay: 2 }, { actorPerMinute: 4, globalPerMinute: 3 }, { actorPerDay: 200, globalPerDay: 100 }];
    for (const o of bad) {
      const r = await rpc.rpc(QUOTA_RPC, params(U.a1, L(o)));
      expect((r.error as { code?: string; message?: string }).code, JSON.stringify(o)).toBe("22023");
    }
    expect(((await rpc.rpc(QUOTA_RPC, params(U.a1, L(), "tiktok"))).error as { code?: string }).code).toBe("22023");
    expect(((await rpc.rpc(QUOTA_RPC, params(U.a1, L(), "threads", "bad model"))).error as { code?: string }).code).toBe("22023");
    expect(await count()).toBe(0);
  });

  it("앱 한도 파서와 DB 범위가 같다(경계값)", () => {
    const env = (o: Record<string, string>) => ({ DISTRIBUTION_AI_ACTOR_PER_MINUTE: "30", DISTRIBUTION_AI_ACTOR_PER_DAY: "500", DISTRIBUTION_AI_GLOBAL_PER_MINUTE: "120", DISTRIBUTION_AI_GLOBAL_PER_DAY: "5000", ...o });
    expect(loadQuotaLimits(env({}))).toEqual({ status: "ok", limits: { actorPerMinute: 30, actorPerDay: 500, globalPerMinute: 120, globalPerDay: 5000 } });
    expect(loadQuotaLimits(env({ DISTRIBUTION_AI_ACTOR_PER_MINUTE: "31" }))).toEqual({ status: "invalid", fields: ["actorPerMinute"] });
    expect(loadQuotaLimits(env({ DISTRIBUTION_AI_GLOBAL_PER_DAY: "5001" }))).toEqual({ status: "invalid", fields: ["globalPerDay"] });
    expect(loadQuotaLimits({})).toMatchObject({ status: "invalid", fields: ["actorPerMinute", "actorPerDay", "globalPerMinute", "globalPerDay"] });
  });

  it("저장 열은 id·actor·채널·모델·시각뿐(원문·초안·토큰 열 없음), 예약은 수정·삭제 불가", async () => {
    const cols = await owner<{ column_name: string }>("select column_name from information_schema.columns where table_schema='public' and table_name='distribution_generation_reservations' order by ordinal_position");
    expect(cols.map((c) => c.column_name)).toEqual(["id", "actor_id", "channel", "model", "created_at"]);
    await rpc.rpc(QUOTA_RPC, params(U.a1, L()));
    await expect(owner("update public.distribution_generation_reservations set model = 'x'")).rejects.toMatchObject({ code: "23001" });
    await expect(owner("delete from public.distribution_generation_reservations")).rejects.toMatchObject({ code: "23001" });
  });

  it("권한: 함수는 service_role만, 테이블은 공개 역할 모두 직접 접근 불가", async () => {
    const rows = await owner<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='distribution_reserve_generation_quota'`,
    );
    expect(rows).toEqual([{ anon: false, auth: false, svc: true }]);
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(await denied(role, "select * from public.distribution_generation_reservations")).toBe("42501");
      expect(await denied(role, `insert into public.distribution_generation_reservations (actor_id, channel, model) values ('${U.a1}','blog','m')`)).toBe("42501");
    }
  });
});
