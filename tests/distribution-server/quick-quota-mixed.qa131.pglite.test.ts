/**
 * QA-SNS-QUICK R3 보강(Claude(Tester)) — 주제 원고(common)와 채널 초안 예약이 같은 한도 4개를 함께 쓰는지.
 * 실제 migration(20261118020000) + createRpcQuota + generateOriginal을 PGlite로 잇는다.
 * `PGLITE_PROJECT`가 있을 때만 실행한다. 실제 Supabase·OpenAI 없음. 공급자 fetch는 가짜이고, 호출 횟수만 센다.
 * PGlite는 단일 연결이다. 동시성(advisory lock)은 이 시험 범위가 아니다.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { GENERATION_ENV, loadGenerationConfig } from "@/server/distribution/generation/config";
import { generateOriginal } from "@/server/distribution/generation/original";
import type { GenerationHttpDeps } from "@/server/distribution/generation/openai-chat";
import { createRpcQuota, QUOTA_RPC, type QuotaLimits } from "@/server/distribution/generation/quota";
import type { RpcClient } from "@/server/distribution/write-runner";
import { openDb, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const A1 = "00000000-0000-4000-8000-0000000001a1";
const A2 = "00000000-0000-4000-8000-0000000001a2";
const KEY = `sk-test-${randomBytes(20).toString("hex")}`;
const MODEL = "gpt-4o-mini";
let db: Db;
let rpc: RpcClient;

const L = (o: Partial<QuotaLimits> = {}): QuotaLimits => ({ actorPerMinute: 30, actorPerDay: 500, globalPerMinute: 120, globalPerDay: 5000, ...o });
const params = (actor: string, l: QuotaLimits, channel: string) => ({
  p_actor_id: actor, p_channel: channel, p_model: MODEL,
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
const byChannel = async () =>
  Object.fromEntries(
    (await owner<{ channel: string; n: number }>("select channel, count(*)::int as n from public.distribution_generation_reservations group by channel")).map((r) => [r.channel, r.n]),
  );
/** 과거 시각 예약을 owner로 직접 넣는다(일당 창 시험용, 시험 DB 안에서만). */
const seed = (actor: string, channel: string, ago: string) =>
  owner(`insert into public.distribution_generation_reservations (actor_id, channel, model, created_at) values ($1, $2, $3, now() - $4::interval)`, [actor, channel, MODEL, ago]);

function fakeProvider() {
  const fetch = vi.fn<GenerationHttpDeps["fetch"]>(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "제목", body: "본문" }) }, finish_reason: "stop" }] }), { status: 200 }),
  );
  return { fetch, http: { fetch, timeoutMs: 1000 } };
}
function originalDeps(actorId: string, limits: QuotaLimits, http: GenerationHttpDeps) {
  return {
    resolveActor: async (): Promise<ActorResult> => ({ ok: true, actorId }),
    getConfig: () => loadGenerationConfig({ [GENERATION_ENV.enabled]: "true", [GENERATION_ENV.apiKey]: KEY }),
    http,
    acquireQuota: createRpcQuota(rpc, limits),
  };
}
function form(o: Record<string, string>) {
  return { get: (k: string) => (Object.hasOwn(o, k) ? o[k] : null) };
}
const topic = form({ topic: "동네 책방 독서 모임", confirmGenerate: "on" });

describe.skipIf(!PROJECT)("QA-131 PGlite: common·채널 예약 공통 한도 합산", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [A1, A2], [], [A1, A2]);
    db = opened.db;
    rpc = rpcClientOf(db);
    expect(opened.applied).toContain("20261118020000_distribution_generation_quota.sql");
  }, 120_000);
  beforeEach(async () => {
    await owner("truncate public.distribution_generation_reservations");
  });

  it("관리자 분당: 채널 초안이 한도를 채우면 주제 원고 생성은 공급자를 부르지 않고 quota_exceeded", async () => {
    const l = L({ actorPerMinute: 2 });
    expect((await rpc.rpc(QUOTA_RPC, params(A1, l, "blog"))).data).toMatchObject({ reserved: true });
    expect((await rpc.rpc(QUOTA_RPC, params(A1, l, "instagram"))).data).toMatchObject({ reserved: true });
    const p = fakeProvider();
    const out = await generateOriginal(originalDeps(A1, l, p.http), topic);
    expect(out).toMatchObject({ status: "quota_exceeded" });
    const retry = (out as { retryAfterSeconds: number | null }).retryAfterSeconds;
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    expect(p.fetch).not.toHaveBeenCalled();
    expect(await byChannel()).toEqual({ blog: 1, instagram: 1 }); // 거절은 기록하지 않는다
  });

  it("역순: 주제 원고 2건이 관리자 분당 한도를 채우면 채널 초안 예약이 actor_minute로 거절", async () => {
    const l = L({ actorPerMinute: 2 });
    const p = fakeProvider();
    expect(await generateOriginal(originalDeps(A1, l, p.http), topic)).toMatchObject({ status: "ok" });
    expect(await generateOriginal(originalDeps(A1, l, p.http), topic)).toMatchObject({ status: "ok" });
    expect(p.fetch).toHaveBeenCalledTimes(2);
    expect((await rpc.rpc(QUOTA_RPC, params(A1, l, "threads"))).data).toMatchObject({ reserved: false, scope: "actor_minute" });
    expect(await byChannel()).toEqual({ common: 2 });
  });

  it("관리자 일당: 지난 24시간의 채널 예약과 common 예약을 함께 센다(25시간 전은 제외)", async () => {
    const l = L({ actorPerMinute: 3, actorPerDay: 3 }); // 관계 규칙: 분당 ≤ 일당
    await seed(A1, "blog", "2 hours");
    await seed(A1, "common", "5 hours");
    await seed(A1, "threads", "25 hours"); // 창 밖
    const p = fakeProvider();
    expect(await generateOriginal(originalDeps(A1, l, p.http), topic)).toMatchObject({ status: "ok" }); // 창 안 2 → 3
    const out = await generateOriginal(originalDeps(A1, l, p.http), topic);
    expect(out).toMatchObject({ status: "quota_exceeded" });
    const retry = (out as { retryAfterSeconds: number }).retryAfterSeconds;
    expect(retry).toBeGreaterThan(18 * 3600); // 창 안 가장 오래된 예약은 5시간 전의 common 예약 → 약 19시간 뒤에 빈다(common도 셈)
    expect(retry).toBeLessThanOrEqual(19 * 3600);
    expect(p.fetch).toHaveBeenCalledTimes(1);
    expect((await rpc.rpc(QUOTA_RPC, params(A1, l, "instagram"))).data).toMatchObject({ reserved: false, scope: "actor_day" });
  });

  it("전체 분당: 다른 관리자의 채널 예약과 내 common 예약을 합산한다(global_minute)", async () => {
    const l = L({ actorPerMinute: 2, globalPerMinute: 3 });
    expect((await rpc.rpc(QUOTA_RPC, params(A2, l, "blog"))).data).toMatchObject({ reserved: true });
    expect((await rpc.rpc(QUOTA_RPC, params(A2, l, "threads"))).data).toMatchObject({ reserved: true });
    const p = fakeProvider();
    expect(await generateOriginal(originalDeps(A1, l, p.http), topic)).toMatchObject({ status: "ok" }); // 전체 3/3
    expect((await rpc.rpc(QUOTA_RPC, params(A1, l, "instagram"))).data).toMatchObject({ reserved: false, scope: "global_minute" });
    expect(await generateOriginal(originalDeps(A1, l, p.http), topic)).toMatchObject({ status: "quota_exceeded" });
    expect(p.fetch).toHaveBeenCalledTimes(1);
  });

  it("전체 일당: 다른 관리자의 과거 채널·common 예약이 전체 일당 한도에 함께 잡힌다(global_day)", async () => {
    const l = L({ actorPerMinute: 3, actorPerDay: 3, globalPerMinute: 3, globalPerDay: 3 }); // 관계 규칙: 분당 ≤ 일당, 관리자 ≤ 전체
    await seed(A2, "blog", "1 hour");
    await seed(A2, "common", "3 hours");
    await seed(A2, "instagram", "6 hours");
    const p = fakeProvider();
    expect(await generateOriginal(originalDeps(A1, l, p.http), topic)).toMatchObject({ status: "quota_exceeded" });
    expect((await rpc.rpc(QUOTA_RPC, params(A1, l, "threads"))).data).toMatchObject({ reserved: false, scope: "global_day" });
    expect(p.fetch).not.toHaveBeenCalled();
  });

  it("예약 기록에는 채널·모델만 남고 주제·키는 저장되지 않는다", async () => {
    const p = fakeProvider();
    expect(await generateOriginal(originalDeps(A1, L(), p.http), topic)).toMatchObject({ status: "ok" });
    const rows = await owner("select * from public.distribution_generation_reservations");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: A1, channel: "common", model: MODEL });
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("책방");
    expect(dump).not.toContain(KEY);
  });

  it("허용되지 않은 채널 이름은 22023으로 거절되고 기록이 남지 않는다(common 외 임의 값)", async () => {
    const r = await rpc.rpc(QUOTA_RPC, params(A1, L(), "original"));
    expect((r.error as { code?: string } | null)?.code).toBe("22023");
    expect(await byChannel()).toEqual({});
  });
});
