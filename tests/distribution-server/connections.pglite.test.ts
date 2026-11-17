/**
 * AUTOPOST-M3-CONNECTION-017 — 채널 연결 저장 경계 서비스 → RPC 왕복(PGlite 대역).
 * `PGLITE_PROJECT`가 있을 때만 실행(평소 npm test에서는 건너뜀 — 통과로 세지 않음).
 * 실행: node web/scripts/distribution-local-verify/connections-run.mjs --pglite-project <dir>
 * 시험 키·토큰은 실행마다 randomBytes로 만든 임시 값. 실제 env·키·Threads·Meta 호출 없음. 실제 Supabase 아님.
 * 토큰 문자열은 단언 값으로 쓰지 않는다(boolean 비교만).
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { decideApproval } from "@/server/distribution/approval-service";
import { parseKeyring, type KeyringResult } from "@/server/distribution/connections/crypto";
import {
  isAccountMismatch,
  listConnections,
  markReauthRequired,
  readCredentialForWorker,
  reconnectSameAccount,
  revokeConnection,
  saveNewConnection,
} from "@/server/distribution/connections/service";
import type { ConnectionDto } from "@/server/distribution/connections/types";
import { appendDraftRevision, createChannelDraft, createContent } from "@/server/distribution/content-service";
import { getJobDetail } from "@/server/distribution/jobs-read";
import { createThreadsDryRunJob } from "@/server/distribution/jobs-service";
import { getContentDetail } from "@/server/distribution/read";
import { writeNoticeOf } from "@/server/distribution/write-notice";
import type { RpcClient } from "@/server/distribution/write-runner";
import { inTx, openDb, readSourceOf, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const U = {
  admin: "00000000-0000-4000-8000-00000000000a",
  admin2: "00000000-0000-4000-8000-00000000000b",
  admin3: "00000000-0000-4000-8000-00000000000e",
  pending: "00000000-0000-4000-8000-0000000000c1",
};
const SET = new Set(["distribution_list_channel_connections", "distribution_read_channel_credential"]);
const tok = () => `THtest_${randomBytes(20).toString("hex")}`;
const KEY = `v1:${randomBytes(32).toString("base64")}`;
const keyring = (): KeyringResult => parseKeyring(KEY);
const ACC = "17841400000000001";
const ACC2 = "17841400000000002";
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

let db: Db;
let rpc: RpcClient;
const as = (id: string) => async (): Promise<ActorResult> => ({ ok: true, actorId: id });
const deps = (id = U.admin) => ({ resolveActor: as(id), getClient: () => rpc, getKeyring: keyring });
const worker = { getClient: () => rpc, getKeyring: keyring };
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });

async function owner<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("set role supa_owner");
  try {
    return (await db.query(sql, params)).rows as T[];
  } finally {
    await db.exec("reset role");
  }
}
async function denied(role: string, sql: string): Promise<string | null> {
  try {
    await inTx(db, role, null, () => db.query(sql));
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}
async function connect(id: string, account: string, token: string): Promise<ConnectionDto> {
  const out = await saveNewConnection(deps(id), { channel: "threads", providerAccountId: account, accountLabel: "테스트", scopes: ["threads_basic", "threads_content_publish"], expiresAt: future(60), token });
  if (out.status !== "ok") throw new Error(`connect ${JSON.stringify(out)}`);
  return out.data;
}

describe.skipIf(!PROJECT)("PGlite 왕복: 채널 연결 metadata + 암호화 credential", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [U.admin, U.admin2, U.admin3, U.pending], [U.pending], [U.admin, U.admin2, U.admin3, U.pending]);
    db = opened.db;
    rpc = rpcClientOf(db, SET);
    expect(opened.applied).toContain("20261116090000_distribution_channel_connections.sql");
    console.log(`applied: ${opened.applied.map((f) => f.slice(0, 14)).join(", ")}`);
  }, 120_000);

  it("ACL: 두 테이블 직접 접근·RPC·내부 helper 차단", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(await denied(role, "select * from public.distribution_channel_connections")).toBe("42501");
      expect(await denied(role, "select * from public.distribution_channel_credentials")).toBe("42501");
      expect(await denied(role, `insert into public.distribution_channel_credentials (connection_id, key_version, aad_version, ciphertext, nonce, auth_tag) values (gen_random_uuid(), 1, 1, 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==')`)).toBe("42501");
    }
    for (const role of ["anon", "authenticated"]) {
      expect(await denied(role, `select public.distribution_list_channel_connections('${U.admin}'::uuid)`)).toBe("42501");
      expect(await denied(role, `select * from public.distribution_read_channel_credential('${U.admin}'::uuid, gen_random_uuid())`)).toBe("42501");
    }
    const acl = await owner<{ sig: string; a: boolean; u: boolean; s: boolean; definer: boolean }>(
      `select p.oid::regprocedure::text sig, has_function_privilege('anon', p.oid, 'EXECUTE') a,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') u, has_function_privilege('service_role', p.oid, 'EXECUTE') s, p.prosecdef definer
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and (p.proname like '%channel_connection%' or p.proname like '%channel_credential%' or p.proname like 'distribution_connection_%' or p.proname = 'distribution_draft_revisions_target_check')
       order by 1`,
    );
    const rpcs = acl.filter((f) => f.definer);
    expect(rpcs.map((f) => f.sig.split("(")[0])).toEqual([
      "distribution_create_channel_connection", "distribution_list_channel_connections", "distribution_mark_channel_connection_reauth",
      "distribution_read_channel_credential", "distribution_reconnect_channel_connection", "distribution_revoke_channel_connection",
    ]);
    expect(rpcs.every((f) => !f.a && !f.u && f.s)).toBe(true);
    expect(acl.filter((f) => !f.definer).every((f) => !f.a && !f.u && !f.s)).toBe(true); // 내부 helper·트리거는 모든 공개 역할 회수
    expect(await denied("service_role", `select public.distribution_connection_lock('${U.admin}'::uuid, gen_random_uuid(), 1)`)).toBe("42501");
    expect(await denied("service_role", `select public.distribution_connection_check_envelope(1, 1, 'x', 'x', 'x')`)).toBe("42501");
  });

  it("D1·저장·목록(비밀 없음)·중복·DB에 평문 없음", async () => {
    const token = tok();
    expect(writeNoticeOf(await saveNewConnection(deps(U.pending), { channel: "threads", providerAccountId: ACC, scopes: ["threads_basic"], expiresAt: future(10), token }))).toBe("denied");
    expect((await saveNewConnection({ ...deps(), getKeyring: () => ({ status: "not_configured" }) }, { channel: "threads", providerAccountId: ACC, scopes: ["threads_basic"], expiresAt: future(10), token })).status).toBe("not_ready");

    const c = await connect(U.admin, ACC, token);
    expect(c).toMatchObject({ channel: "threads", providerAccountId: ACC, status: "connected", rowVersion: 1, keyVersion: 1 });
    const listed = await listConnections(deps());
    expect(listed.status === "ok" && listed.connections.map((x) => [x.id, x.hasCredential])).toEqual([[c.id, true]]);
    // 다른 소유자는 안 보임
    const other = await listConnections(deps(U.admin2));
    expect(other.status === "ok" && other.connections).toEqual([]);

    // 원시 RPC 응답에도 credential 열 없음
    const raw = await rpc.rpc("distribution_list_channel_connections", { p_actor_id: U.admin });
    const keys = Object.keys((raw.data as Record<string, unknown>[])[0] ?? {});
    expect(keys.some((k) => ["ciphertext", "nonce", "auth_tag"].includes(k))).toBe(false);

    // DB 어디에도 평문 없음
    const dump = await owner("select row_to_json(k)::text as j from public.distribution_channel_credentials k");
    expect(dump.length).toBe(1);
    expect(dump.some((r) => String(r.j).includes(token))).toBe(false);
    const meta = await owner("select row_to_json(c)::text as j from public.distribution_channel_connections c");
    expect(meta.some((r) => String(r.j).includes(token))).toBe(false);

    // 같은 계정 새 연결 → duplicate(재연결로)
    expect(writeNoticeOf(await saveNewConnection(deps(), { channel: "threads", providerAccountId: ACC, scopes: ["threads_basic"], expiresAt: future(10), token: tok() }))).toBe("duplicate");
  });

  it("worker 읽기: 소유자·D1·복호화, AAD로 행 이동 차단, 잘못된 키 fail closed", async () => {
    const t1 = tok();
    const t2 = tok();
    const a = await connect(U.admin2, ACC, t1);
    const b = await connect(U.admin2, ACC2, t2);
    const r = await readCredentialForWorker(worker, { ownerId: U.admin2, connectionId: a.id, expectChannel: "threads" });
    expect(r.status === "ok" && r.credential.token.equals(t1) && r.credential.providerAccountId === ACC).toBe(true);
    // 다른 소유자로는 없음
    expect((await readCredentialForWorker(worker, { ownerId: U.admin, connectionId: a.id })).status).toBe("not_found");
    // 잘못된 키 → reauth_required(decrypt_failed)
    const wrongKey = { getClient: () => rpc, getKeyring: () => parseKeyring(`v1:${randomBytes(32).toString("base64")}`) };
    expect(await readCredentialForWorker(wrongKey, { ownerId: U.admin2, connectionId: a.id })).toMatchObject({ status: "reauth_required", reason: "decrypt_failed" });
    // 키 버전 없는 키링(회전으로 제거) → key_rotated
    const rotated = { getClient: () => rpc, getKeyring: () => parseKeyring(`v2:${randomBytes(32).toString("base64")}`) };
    expect(await readCredentialForWorker(rotated, { ownerId: U.admin2, connectionId: a.id })).toMatchObject({ status: "reauth_required", reason: "key_rotated" });
    // b의 봉투를 a 행으로 복사(DB 직접 조작 공격) → AAD(계정) 불일치로 복호화 실패
    await owner(
      `update public.distribution_channel_credentials t set ciphertext = s.ciphertext, nonce = s.nonce, auth_tag = s.auth_tag
       from public.distribution_channel_credentials s where t.connection_id = $1::uuid and s.connection_id = $2::uuid`,
      [a.id, b.id],
    );
    expect(await readCredentialForWorker(worker, { ownerId: U.admin2, connectionId: a.id })).toMatchObject({ status: "reauth_required", reason: "decrypt_failed" });

    // 같은 계정 재연결: 낡은 version 충돌 → 렌더 version 성공(id 유지, row_version+1, 새 토큰)
    const t3 = tok();
    const base = { channel: "threads", providerAccountId: ACC, accountLabel: "테스트", scopes: ["threads_basic", "threads_content_publish"], expiresAt: future(60), token: t3 };
    expect(writeNoticeOf(await reconnectSameAccount(deps(U.admin2), { ...base, connectionId: a.id, expectedVersion: a.rowVersion + 3 }))).toBe("conflict_version");
    const re = await reconnectSameAccount(deps(U.admin2), { ...base, connectionId: a.id, expectedVersion: a.rowVersion });
    expect(re.status === "ok" && [re.data.id, re.data.rowVersion]).toEqual([a.id, a.rowVersion + 1]);
    const after = await readCredentialForWorker(worker, { ownerId: U.admin2, connectionId: a.id });
    expect(after.status === "ok" && after.credential.token.equals(t3) && !after.credential.token.equals(t1)).toBe(true);

    // 다른 계정으로 재연결 시도 → ACCOUNT_MISMATCH(기존 행 불변)
    const mismatch = await reconnectSameAccount(deps(U.admin2), { ...base, providerAccountId: "17841400000000099", connectionId: a.id, expectedVersion: a.rowVersion + 1 });
    expect(isAccountMismatch(mismatch)).toBe(true);
    const still = await owner<{ provider_account_id: string }>("select provider_account_id from public.distribution_channel_connections where id = $1::uuid", [a.id]);
    expect(still[0]?.provider_account_id).toBe(ACC);
    // 다른 소유자의 재연결 → not_found(존재 비노출)
    expect(writeNoticeOf(await reconnectSameAccount(deps(U.admin), { ...base, connectionId: a.id, expectedVersion: a.rowVersion + 1 }))).toBe("not_found");
  });

  it("만료·재인증 표시·철회(최종)·D1 상실 fail closed", async () => {
    const t = tok();
    const c = await connect(U.admin3, ACC, t);
    // 만료(소유자 권한으로 시각만 당김) → reauth_required(expired)
    await owner("update public.distribution_channel_connections set expires_at = now() - interval '1 minute', row_version = row_version + 1 where id = $1::uuid", [c.id]);
    expect(await readCredentialForWorker(worker, { ownerId: U.admin3, connectionId: c.id })).toMatchObject({ status: "reauth_required", reason: "expired" });
    const v = c.rowVersion + 1;

    // 재인증 표시 → 읽기 차단
    const marked = await markReauthRequired(deps(U.admin3), { connectionId: c.id, expectedVersion: v, reason: "decrypt_failed" });
    expect(marked.status === "ok" && [marked.data.status, marked.data.reauthReason]).toEqual(["reauth_required", "decrypt_failed"]);
    expect((await readCredentialForWorker(worker, { ownerId: U.admin3, connectionId: c.id })).status).toBe("reauth_required");

    // 철회 → credential 삭제, 읽기 revoked, 재철회·재연결 불가, 같은 계정은 새 연결(새 id)
    expect(writeNoticeOf(await revokeConnection(deps(U.admin3), { connectionId: c.id, expectedVersion: v }))).toBe("conflict_version");
    const rv = await revokeConnection(deps(U.admin3), { connectionId: c.id, expectedVersion: v + 1, reason: "계정 정리" });
    expect(rv.status === "ok" && [rv.data.status, rv.data.keyVersion]).toEqual(["revoked", null]);
    expect((await owner("select 1 from public.distribution_channel_credentials where connection_id = $1::uuid", [c.id])).length).toBe(0);
    expect(await readCredentialForWorker(worker, { ownerId: U.admin3, connectionId: c.id })).toMatchObject({ status: "reauth_required", reason: "revoked" });
    expect(writeNoticeOf(await revokeConnection(deps(U.admin3), { connectionId: c.id, expectedVersion: v + 2 }))).toBe("already_revoked");
    expect(writeNoticeOf(await reconnectSameAccount(deps(U.admin3), { channel: "threads", providerAccountId: ACC, scopes: ["threads_basic"], expiresAt: future(10), token: tok(), connectionId: c.id, expectedVersion: v + 2 }))).toBe("already_revoked");
    const fresh = await connect(U.admin3, ACC, tok());
    expect(fresh.id).not.toBe(c.id);
    // 연결 행은 삭제 불가
    expect(await (async () => { try { await owner("delete from public.distribution_channel_connections where id = $1::uuid", [c.id]); return null; } catch (e) { return (e as { code?: string }).code; } })()).toBe("23001");

    // 소유자 D1 상실 → worker 읽기 denied, 관리 RPC도 denied
    await owner("delete from public.role_assignments where user_id = $1::uuid", [U.admin3]);
    expect((await readCredentialForWorker(worker, { ownerId: U.admin3, connectionId: fresh.id })).status).toBe("denied");
    expect(writeNoticeOf(await revokeConnection(deps(U.admin3), { connectionId: fresh.id, expectedVersion: fresh.rowVersion }))).toBe("denied");
  });

  it("기존 target_connection_id 호환: 리비전 대상 검사·작업 스냅샷·live gate 닫힘", async () => {
    const conn = await connect(U.admin, "17841400000000777", tok());
    const blogConn = conn; // Blog 리비전에 Threads 연결 지정 → 거절 확인용
    const c = await createContent(deps(), form({ title: "연결 대상 원문", body: "본문" }));
    if (c.status !== "ok") throw new Error("content");
    const d = await getContentDetail(readSourceOf(db, U.admin), c.data.contentId);
    if (d.status !== "ok" || !d.data?.current) throw new Error("detail");
    const v = d.data.current;
    const td = await createChannelDraft(deps(), form({ contentId: c.data.contentId, channel: "threads" }));
    const bd = await createChannelDraft(deps(), form({ contentId: c.data.contentId, channel: "blog" }));
    if (td.status !== "ok" || bd.status !== "ok") throw new Error("drafts");
    const rev = (draftId: string, no: string, conn: string, acct: string) =>
      appendDraftRevision(deps(), form({ draftId, expectedRevisionNo: no, expectedContentVersionId: v.id, body: "스레드 본문", preserveTargetConnectionId: conn, preserveTargetAccountId: acct }));

    // 계정 불일치·없는 연결·다른 채널 → TARGET_CONNECTION_MISMATCH
    for (const out of [
      await rev(td.data.draftId, "0", conn.id, "17841400000000000"),
      await rev(td.data.draftId, "0", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "17841400000000777"),
      await rev(bd.data.draftId, "0", blogConn.id, "17841400000000777"),
    ]) {
      expect(out.status === "db_error" && out.error.token).toBe("TARGET_CONNECTION_MISMATCH");
    }
    const ok = await rev(td.data.draftId, "0", conn.id, "17841400000000777");
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;

    // 승인 → dry_run 작업: 대상 스냅샷 복사
    await decideApproval(deps(), form({ subjectType: "content_version", subjectId: v.id, decision: "approved", expectedSubjectHash: v.contentHash, check_facts_checked: "on", check_sources_checked: "on", check_public_ok: "on" }));
    await decideApproval(deps(), form({ subjectType: "draft_revision", subjectId: ok.data.revisionId, decision: "approved", expectedSubjectHash: ok.data.revisionHash, check_matches_content: "on", check_facts_checked: "on", check_links_checked: "on", check_media_rights_checked: "on" }));
    const job = await createThreadsDryRunJob(deps(), form({ draftRevisionId: ok.data.revisionId, channel: "threads" }));
    expect(job.status).toBe("ok");
    if (job.status !== "ok") return;
    const snap = await owner<{ target_connection_id: string; target_external_account_id: string }>("select target_connection_id, target_external_account_id from public.distribution_jobs where id = $1::uuid", [job.data]);
    expect(snap[0]).toEqual({ target_connection_id: conn.id, target_external_account_id: "17841400000000777" });

    // 같은 계정 재연결 후에도 대상(id·계정) 그대로, 철회 후에도 작업 스냅샷은 조용히 바뀌지 않음
    await reconnectSameAccount(deps(), { channel: "threads", providerAccountId: "17841400000000777", scopes: ["threads_basic"], expiresAt: future(30), token: tok(), connectionId: conn.id, expectedVersion: conn.rowVersion });
    await revokeConnection(deps(), { connectionId: conn.id, expectedVersion: conn.rowVersion + 1 });
    const snap2 = await owner("select target_connection_id, target_external_account_id from public.distribution_jobs where id = $1::uuid", [job.data]);
    expect(snap2[0]).toEqual(snap[0]);
    const jd = await getJobDetail(readSourceOf(db, U.admin), job.data);
    expect(jd.status === "ok" && jd.data?.job.status).toBe("scheduled");
    // 철회된 연결로 새 리비전 → 거절
    const late = await rev(td.data.draftId, "1", conn.id, "17841400000000777");
    expect(late.status === "db_error" && late.error.token).toBe("TARGET_CONNECTION_MISMATCH");
    // live gate는 여전히 닫힘, FK는 NOT VALID로 추가됨
    const gate = await owner<{ g: boolean }>("select public.distribution_live_gate($1::uuid) as g", [ok.data.revisionId]);
    expect(gate[0]?.g).toBe(false);
    const fks = await owner<{ conname: string; convalidated: boolean }>("select conname, convalidated from pg_constraint where conname like '%target_connection_fk' order by conname");
    expect(fks).toEqual([
      { conname: "distribution_draft_revisions_target_connection_fk", convalidated: false },
      { conname: "distribution_jobs_target_connection_fk", convalidated: false },
    ]);
  });
});
