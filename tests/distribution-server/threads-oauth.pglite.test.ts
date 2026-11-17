/**
 * AUTOPOST-THREADS-OAUTH-019 — OAuth state·callback → M3 저장 왕복(PGlite 대역 + mock HTTP).
 * `PGLITE_PROJECT`가 있을 때만 실행(평소 npm test에서는 건너뜀 — 통과로 세지 않음).
 * 실행: node web/scripts/distribution-local-verify/oauth-run.mjs --pglite-project <dir>
 * 실제 Threads/Meta·Supabase·env 사용 없음. 시험 secret·키·토큰은 실행마다 임시 생성. 비밀 문자열은 단언 값으로 쓰지 않는다.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { readCredentialForWorker, listConnections } from "@/server/distribution/connections/service";
import { loadThreadsOAuthConfig } from "@/server/distribution/threads/oauth/config";
import { handleThreadsCallback, startThreadsConnect, type OAuthDeps } from "@/server/distribution/threads/oauth/flow";
import type { ThreadsHttpDeps } from "@/server/distribution/threads/types";
import type { RpcClient } from "@/server/distribution/write-runner";
import { inTx, openDb, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const U = {
  admin: "00000000-0000-4000-8000-00000000000a",
  admin2: "00000000-0000-4000-8000-00000000000b",
  pending: "00000000-0000-4000-8000-0000000000c1",
};
const ENV = {
  THREADS_APP_ID: "1234567890123",
  THREADS_APP_SECRET: randomBytes(16).toString("hex"),
  DISTRIBUTION_TOKEN_KEY: `v1:${randomBytes(32).toString("base64")}`,
  NEXT_PUBLIC_SITE_URL: "https://vibe.example",
};
const ACC = "17841405793187218";
const ACC2 = "17841405793187999";

let db: Db;
let rpc: RpcClient;
const as = (id: string) => async (): Promise<ActorResult> => ({ ok: true, actorId: id });
function provider(userId: string, longToken: string): ThreadsHttpDeps {
  const responses = [
    { status: 200, text: `{"access_token":"THshort_${randomBytes(12).toString("hex")}","token_type":"bearer","user_id":${userId}}` },
    { status: 200, text: `{"access_token":"${longToken}","token_type":"bearer","expires_in":5183944}` },
  ];
  let i = 0;
  return { fetch: vi.fn(async () => new Response(responses[Math.min(i++, 1)]?.text ?? "", { status: 200 })), timeoutMs: 1000 };
}
const deps = (id: string, http: ThreadsHttpDeps): OAuthDeps => ({ resolveActor: as(id), getClient: () => rpc, getConfig: () => loadThreadsOAuthConfig(ENV), http });
const keyring = () => {
  const c = loadThreadsOAuthConfig(ENV);
  if (c.status !== "ok") throw new Error("cfg");
  return { status: "ok" as const, keyring: c.config.keyring };
};
async function start(id: string, target?: { connectionId: string; expectedVersion: number }) {
  const out = await startThreadsConnect(deps(id, provider(ACC, "x")), target ?? {});
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
const tok = () => `THlong_${randomBytes(20).toString("hex")}`;

describe.skipIf(!PROJECT)("PGlite 왕복: Threads OAuth state → callback → M3 암호화 저장", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [U.admin, U.admin2, U.pending], [U.pending], [U.admin, U.admin2, U.pending]);
    db = opened.db;
    rpc = rpcClientOf(db, new Set(["distribution_list_channel_connections", "distribution_read_channel_credential"]));
    expect(opened.applied).toContain("20261116100000_distribution_oauth_states.sql");
    console.log(`applied: ${opened.applied.map((f) => f.slice(0, 14)).join(", ")}`);
  }, 120_000);

  it("ACL: state 테이블 직접 접근 차단, RPC는 service_role만", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await expect(inTx(db, role, null, () => db.query("select * from public.distribution_oauth_states"))).rejects.toMatchObject({ code: "42501" });
    }
    const acl = await owner<{ n: string; a: boolean; u: boolean; s: boolean; d: boolean }>(
      `select p.proname n, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u,
              has_function_privilege('service_role', p.oid, 'EXECUTE') s, p.prosecdef d
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname like '%oauth_state%' order by 1`,
    );
    expect(acl).toEqual([
      { n: "distribution_consume_oauth_state", a: false, u: false, s: true, d: true },
      { n: "distribution_create_oauth_state", a: false, u: false, s: true, d: true },
    ]);
  });

  it("D1·DB에는 해시만·연결 성공·같은 state 재사용 거부·DB에 평문 없음", async () => {
    expect(await startThreadsConnect(deps(U.pending, provider(ACC, "x")))).toEqual({ kind: "result", result: "denied" });
    const state = await start(U.admin);
    const rows = await owner<{ j: string }>("select row_to_json(s)::text j from public.distribution_oauth_states s");
    expect(rows.length).toBe(1);
    expect(rows.some((r) => r.j.includes(state))).toBe(false);

    const long = tok();
    expect(await handleThreadsCallback(deps(U.admin, provider(ACC, long)), { state, code: "AQcode_1234567890", error: null, cookieState: state })).toBe("connected");
    const w = await readCredentialForWorker({ getClient: () => rpc, getKeyring: keyring }, { ownerId: U.admin, connectionId: (await connId(U.admin, ACC)) });
    expect(w.status === "ok" && w.credential.token.equals(long) && w.credential.providerAccountId === ACC).toBe(true);
    // 재사용 → state_used, 교환 0회
    const again = provider(ACC, tok());
    expect(await handleThreadsCallback(deps(U.admin, again), { state, code: "AQcode_1234567890", error: null, cookieState: state })).toBe("state_used");
    expect(again.fetch).not.toHaveBeenCalled();
    const dump = await owner<{ j: string }>("select row_to_json(k)::text j from public.distribution_channel_credentials k");
    expect(dump.some((r) => r.j.includes(long) || r.j.includes(ENV.THREADS_APP_SECRET))).toBe(false);
    // 같은 계정을 '새 연결'로 다시 → already_connected(저장 없음)
    const s2 = await start(U.admin);
    expect(await handleThreadsCallback(deps(U.admin, provider(ACC, tok())), { state: s2, code: "AQcode_1234567890", error: null, cookieState: s2 })).toBe("already_connected");
  });

  it("동시 재사용: 같은 state 두 callback → 하나만 저장", async () => {
    const state = await start(U.admin2);
    const [a, b] = await Promise.all([
      handleThreadsCallback(deps(U.admin2, provider(ACC2, tok())), { state, code: "AQcode_1234567890", error: null, cookieState: state }),
      handleThreadsCallback(deps(U.admin2, provider(ACC2, tok())), { state, code: "AQcode_1234567890", error: null, cookieState: state }),
    ]);
    expect([a, b].sort()).toEqual(["connected", "state_used"]);
    const listed = await listConnections({ resolveActor: as(U.admin2), getClient: () => rpc });
    expect(listed.status === "ok" && listed.connections.length).toBe(1);
  });

  it("다른 actor·만료·D1 상실 → 거부(교환 0회), 다른 actor 시도는 원래 state를 소비하지 않음", async () => {
    const state = await start(U.admin);
    const h = provider(ACC2, tok());
    expect(await handleThreadsCallback(deps(U.admin2, h), { state, code: "AQcode_1234567890", error: null, cookieState: state })).toBe("state_invalid");
    expect(h.fetch).not.toHaveBeenCalled();
    const open = await owner<{ consumed_at: string | null }>("select consumed_at from public.distribution_oauth_states where state_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [state]);
    expect(open[0]?.consumed_at).toBeNull();

    // 만료(시각을 과거로 당김)
    await owner("update public.distribution_oauth_states set created_at = now() - interval '20 minutes', expires_at = now() - interval '19 minutes' where state_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [state]);
    const h2 = provider(ACC, tok());
    expect(await handleThreadsCallback(deps(U.admin, h2), { state, code: "AQcode_1234567890", error: null, cookieState: state })).toBe("state_expired");
    expect(h2.fetch).not.toHaveBeenCalled();

    // start 후 권한 회수 → callback denied
    const s3 = await start(U.admin2);
    await owner("update public.profiles set approval_status = 'pending' where id = $1::uuid", [U.admin2]);
    const h3 = provider(ACC2, tok());
    expect(await handleThreadsCallback(deps(U.admin2, h3), { state: s3, code: "AQcode_1234567890", error: null, cookieState: s3 })).toBe("denied");
    expect(h3.fetch).not.toHaveBeenCalled();
    await owner("update public.profiles set approval_status = 'approved' where id = $1::uuid", [U.admin2]);
  });

  it("재연결: 같은 계정은 같은 id·row_version+1, 다른 계정은 저장 없음, 철회된 연결은 시작 거부", async () => {
    const id = await connId(U.admin, ACC);
    const before = await owner<{ row_version: number }>("select row_version from public.distribution_channel_connections where id = $1::uuid", [id]);
    const v = before[0]?.row_version ?? 0;
    // 다른 계정으로 로그인 → account_mismatch, 변화 없음
    const sMis = await start(U.admin, { connectionId: id, expectedVersion: v });
    expect(await handleThreadsCallback(deps(U.admin, provider(ACC2, tok())), { state: sMis, code: "AQcode_1234567890", error: null, cookieState: sMis })).toBe("account_mismatch");
    const mid = await owner<{ row_version: number; provider_account_id: string }>("select row_version, provider_account_id from public.distribution_channel_connections where id = $1::uuid", [id]);
    expect(mid[0]).toEqual({ row_version: v, provider_account_id: ACC });
    // 같은 계정 → reconnected
    const long = tok();
    const sSame = await start(U.admin, { connectionId: id, expectedVersion: v });
    expect(await handleThreadsCallback(deps(U.admin, provider(ACC, long)), { state: sSame, code: "AQcode_1234567890", error: null, cookieState: sSame })).toBe("reconnected");
    const after = await owner<{ row_version: number }>("select row_version from public.distribution_channel_connections where id = $1::uuid", [id]);
    expect(after[0]?.row_version).toBe(v + 1);
    const w = await readCredentialForWorker({ getClient: () => rpc, getKeyring: keyring }, { ownerId: U.admin, connectionId: id });
    expect(w.status === "ok" && w.credential.token.equals(long)).toBe(true);
    // 낡은 version으로 시작 → version_conflict
    expect(await startThreadsConnect(deps(U.admin, provider(ACC, "x")), { connectionId: id, expectedVersion: v })).toEqual({ kind: "result", result: "version_conflict" });
    // 철회 후 재연결 시작 → connection_revoked
    await rpc.rpc("distribution_revoke_channel_connection", { p_actor_id: U.admin, p_connection_id: id, p_expected_version: v + 1, p_reason: null });
    expect(await startThreadsConnect(deps(U.admin, provider(ACC, "x")), { connectionId: id, expectedVersion: v + 2 })).toEqual({ kind: "result", result: "connection_revoked" });
    // 남의 연결로 재연결 시작 → connection_not_found
    expect(await startThreadsConnect(deps(U.admin2, provider(ACC, "x")), { connectionId: id, expectedVersion: v + 2 })).toEqual({ kind: "result", result: "connection_not_found" });
  });

  it("공급자 취소 → state만 닫힘, 열린 state 상한", async () => {
    const s = await start(U.admin2);
    expect(await handleThreadsCallback(deps(U.admin2, provider(ACC2, tok())), { state: s, code: null, error: "access_denied", cookieState: s })).toBe("cancelled");
    expect(await handleThreadsCallback(deps(U.admin2, provider(ACC2, tok())), { state: s, code: "AQcode_1234567890", error: null, cookieState: s })).toBe("state_used");
    // 앞 시험에서 남은 열린 state(권한 회수로 거부된 것)까지 세어 상한 5까지 채운다
    const open = await owner<{ n: number }>("select count(*)::int n from public.distribution_oauth_states where actor_id = $1::uuid and consumed_at is null and expires_at > now()", [U.admin2]);
    for (let i = open[0]?.n ?? 0; i < 5; i += 1) await start(U.admin2);
    expect(await startThreadsConnect(deps(U.admin2, provider(ACC, "x")))).toEqual({ kind: "result", result: "state_limit" });
  });
});

async function connId(owner: string, account: string): Promise<string> {
  const listed = await listConnections({ resolveActor: async () => ({ ok: true, actorId: owner }), getClient: () => rpc });
  const c = listed.status === "ok" ? listed.connections.find((x) => x.providerAccountId === account && x.status !== "revoked") : undefined;
  if (!c) throw new Error("connection not found");
  return c.id;
}
