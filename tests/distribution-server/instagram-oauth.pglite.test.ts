/**
 * BE-INSTAGRAM-OAUTH-043 — Instagram OAuth state·callback → M3 저장 왕복(PGlite 대역 + fake https 공급자).
 * `PGLITE_PROJECT`가 있을 때만 실행(건너뜀은 통과로 세지 않음). 000000~160000 전체 migration 적용.
 * 실제 Instagram/Meta·Supabase·env 사용 없음. secret·키·토큰은 실행마다 임시 생성. 단일 연결이라 동시성 증명이 아니다.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { listConnections } from "@/server/distribution/connections/service";
import { loadInstagramOAuthConfig } from "@/server/distribution/instagram/oauth/config";
import { handleInstagramCallback, startInstagramConnect, type InstagramOAuthDeps } from "@/server/distribution/instagram/oauth/flow";
import type { IgHttpDeps } from "@/server/distribution/instagram/types";
import { loadThreadsOAuthConfig } from "@/server/distribution/threads/oauth/config";
import { handleThreadsCallback, startThreadsConnect } from "@/server/distribution/threads/oauth/flow";
import type { RpcClient } from "@/server/distribution/write-runner";
import { inTx, openDb, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const U = { admin: "00000000-0000-4000-8000-00000000005a", admin2: "00000000-0000-4000-8000-00000000005b" };
const KEY = `v1:${randomBytes(32).toString("base64")}`;
const ENV = { INSTAGRAM_APP_ID: "990602627938098", INSTAGRAM_APP_SECRET: randomBytes(16).toString("hex"), DISTRIBUTION_TOKEN_KEY: KEY, NEXT_PUBLIC_SITE_URL: "https://vibe.example" };
const TENV = { THREADS_APP_ID: "1234567890123", THREADS_APP_SECRET: randomBytes(16).toString("hex"), DISTRIBUTION_TOKEN_KEY: KEY, NEXT_PUBLIC_SITE_URL: "https://vibe.example" };
const ACC = "17841405793187218";
const ACC2 = "17841405793187999";
const PERMS = "instagram_business_basic,instagram_business_content_publish";

let db: Db;
let rpc: RpcClient;
const as = (id: string) => async (): Promise<ActorResult> => ({ ok: true, actorId: id });
function provider(userId: string, perms = PERMS): IgHttpDeps & { fetch: ReturnType<typeof vi.fn> } {
  const responses = [
    `{"data":[{"access_token":"IGshort_${randomBytes(12).toString("hex")}","user_id":"${userId}","permissions":"${perms}"}]}`,
    `{"access_token":"IGlong_${randomBytes(16).toString("hex")}","token_type":"bearer","expires_in":5183944}`,
  ];
  let i = 0;
  return { fetch: vi.fn(async () => new Response(responses[Math.min(i++, 1)] ?? "", { status: 200 })), timeoutMs: 1000 };
}
const deps = (id: string, http: IgHttpDeps = provider(ACC)): InstagramOAuthDeps => ({ resolveActor: as(id), getClient: () => rpc, getConfig: () => loadInstagramOAuthConfig(ENV), http });
const CODE = `AQ${randomBytes(20).toString("hex")}`;
async function start(id: string, target?: { connectionId: string; expectedVersion: number }) {
  const out = await startInstagramConnect(deps(id), target ?? {});
  if (out.kind !== "authorize") throw new Error(`start ${JSON.stringify(out)}`);
  return out.cookieValue;
}
async function owner<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("set role supa_owner");
  try {
    return (await db.query(sql, params)).rows as T[];
  } finally {
    await db.exec("reset role");
  }
}
const igConns = async (id: string) => {
  const l = await listConnections({ resolveActor: as(id), getClient: () => rpc });
  return l.status === "ok" ? l.connections.filter((c) => c.channel === "instagram") : [];
};

describe.skipIf(!PROJECT)("PGlite 왕복: Instagram OAuth(160000)", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [U.admin, U.admin2], [], [U.admin, U.admin2]);
    db = opened.db;
    rpc = rpcClientOf(db, new Set(["distribution_list_channel_connections", "distribution_read_channel_credential"]));
    expect(opened.applied).toContain("20261116160000_distribution_instagram_oauth.sql");
  }, 120_000);

  it("migration: channel 제약 threads·instagram만, create 함수 ACL 그대로(service_role 전용), 다른 채널 거부", async () => {
    const con = await owner<{ def: string }>("select pg_get_constraintdef(oid) def from pg_constraint where conname = 'distribution_oauth_states_channel_check'");
    expect(con[0]?.def).toMatch(/threads.*instagram/);
    const acl = await owner<{ a: boolean; u: boolean; s: boolean }>(
      "select has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u, has_function_privilege('service_role', p.oid, 'EXECUTE') s from pg_proc p where p.proname = 'distribution_create_oauth_state'");
    expect(acl).toEqual([{ a: false, u: false, s: true }]);
    for (const role of ["anon", "authenticated"]) {
      await expect(inTx(db, role, null, () => db.query("select public.distribution_create_oauth_state($1::uuid, 'instagram', $2, 'https://vibe.example/cb', 600)", [U.admin, "a".repeat(64)]))).rejects.toMatchObject({ code: "42501" });
    }
    const bad = await rpc.rpc("distribution_create_oauth_state", { p_actor_id: U.admin, p_channel: "blog", p_state_hash: "b".repeat(64), p_redirect_uri: "https://vibe.example/cb", p_ttl_seconds: 600, p_target_connection_id: null, p_target_row_version: null });
    expect((bad.error as { code?: string } | null)?.code).toBe("22023");
  });

  it("새 연결 왕복: start → callback → instagram 연결(계정 문자열·부여 권한·암호문만), state 1회 소비 → replay state_used", async () => {
    const state = await start(U.admin);
    const http = provider(ACC);
    expect(await handleInstagramCallback(deps(U.admin, http), { state, code: CODE, error: null, cookieState: state })).toBe("connected");
    const conns = await igConns(U.admin);
    expect(conns.map((c) => [c.providerAccountId, c.scopes, c.status])).toEqual([[ACC, ["instagram_business_basic", "instagram_business_content_publish"], "connected"]]);
    const row = await owner<{ channel: string; consumed: boolean }>("select channel, consumed_at is not null consumed from public.distribution_oauth_states order by created_at desc limit 1");
    expect(row[0]).toEqual({ channel: "instagram", consumed: true });
    expect(await handleInstagramCallback(deps(U.admin, provider(ACC)), { state, code: CODE, error: null, cookieState: state })).toBe("state_used");
    const raw = JSON.stringify(await owner("select * from public.distribution_channel_connections"));
    expect(raw.includes("IGlong_") || raw.includes("IGshort_")).toBe(false); // 평문 토큰 없음
    expect(http.fetch).toHaveBeenCalledTimes(2);
  });

  it("채널 격리: Threads state는 Instagram callback으로 소비 불가(state_invalid), Threads 흐름은 그대로 동작", async () => {
    const tdeps = { resolveActor: as(U.admin2), getClient: () => rpc, getConfig: () => loadThreadsOAuthConfig(TENV),
      http: { fetch: vi.fn(async () => new Response("{}", { status: 200 })), timeoutMs: 1000 } };
    const ts = await startThreadsConnect(tdeps, {});
    if (ts.kind !== "authorize") throw new Error("threads start");
    // 같은 actor·같은 state를 Instagram callback에 넣어도 channel 불일치 → state_invalid(소비 안 됨)
    expect(await handleInstagramCallback(deps(U.admin2), { state: ts.cookieValue, code: CODE, error: null, cookieState: ts.cookieValue })).toBe("state_invalid");
    let i = 0;
    const tresp = [`{"access_token":"THshort_${randomBytes(12).toString("hex")}","token_type":"bearer","user_id":${ACC}}`, `{"access_token":"THlong_${randomBytes(16).toString("hex")}","token_type":"bearer","expires_in":5183944}`];
    tdeps.http.fetch = vi.fn(async () => new Response(tresp[Math.min(i++, 1)] ?? "", { status: 200 }));
    expect(await handleThreadsCallback(tdeps, { state: ts.cookieValue, code: CODE, error: null, cookieState: ts.cookieValue })).toBe("connected");
    const l = await listConnections({ resolveActor: as(U.admin2), getClient: () => rpc });
    expect(l.status === "ok" && l.connections.map((c) => c.channel)).toEqual(["threads"]);
  });

  it("권한 누락 → permission_missing(저장 0, state 소비됨), 같은 계정 새 연결 → already_connected", async () => {
    const s1 = await start(U.admin);
    expect(await handleInstagramCallback(deps(U.admin, provider(ACC2, "instagram_business_basic")), { state: s1, code: CODE, error: null, cookieState: s1 })).toBe("permission_missing");
    expect((await igConns(U.admin)).map((c) => c.providerAccountId)).toEqual([ACC]);
    const s2 = await start(U.admin);
    expect(await handleInstagramCallback(deps(U.admin, provider(ACC)), { state: s2, code: CODE, error: null, cookieState: s2 })).toBe("already_connected");
  });

  it("재연결: 같은 계정 reconnected(id 불변·버전+1), 다른 계정 account_mismatch(불변), 낡은 버전 start → version_conflict", async () => {
    const [c] = await igConns(U.admin);
    if (!c) throw new Error("conn");
    const s1 = await start(U.admin, { connectionId: c.id, expectedVersion: c.rowVersion });
    expect(await handleInstagramCallback(deps(U.admin, provider(ACC2)), { state: s1, code: CODE, error: null, cookieState: s1 })).toBe("account_mismatch");
    expect((await igConns(U.admin))[0]?.rowVersion).toBe(c.rowVersion);
    const s2 = await start(U.admin, { connectionId: c.id, expectedVersion: c.rowVersion });
    expect(await handleInstagramCallback(deps(U.admin, provider(ACC)), { state: s2, code: CODE, error: null, cookieState: s2 })).toBe("reconnected");
    const after = (await igConns(U.admin))[0];
    expect([after?.id, after?.rowVersion]).toEqual([c.id, c.rowVersion + 1]);
    expect(await startInstagramConnect(deps(U.admin), { connectionId: c.id, expectedVersion: String(c.rowVersion) })).toEqual({ kind: "result", result: "version_conflict" });
  });

  it("다른 actor의 state 소비 불가(state_invalid), 취소는 state를 닫고 저장 0", async () => {
    const s = await start(U.admin);
    expect(await handleInstagramCallback(deps(U.admin2), { state: s, code: CODE, error: null, cookieState: s })).toBe("state_invalid");
    const http = provider(ACC);
    expect(await handleInstagramCallback(deps(U.admin, http), { state: s, code: null, error: "access_denied", cookieState: s })).toBe("cancelled");
    expect(http.fetch).not.toHaveBeenCalled();
    expect(await handleInstagramCallback(deps(U.admin, provider(ACC)), { state: s, code: CODE, error: null, cookieState: s })).toBe("state_used");
  });
});
