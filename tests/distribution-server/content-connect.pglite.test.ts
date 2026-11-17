/**
 * AUTOPOST-CONTENT-CONNECT-014 — 서비스 → RPC 어댑터 왕복 검증(PGlite 대역).
 * `PGLITE_PROJECT`(PGlite가 설치된 임시 디렉터리)가 있을 때만 실행한다. 평소 `npm test`에서는 건너뛴다(통과로 세지 않음).
 * 실행: node web/scripts/distribution-local-verify/content-connect-run.mjs --pglite-project <dir>
 * 실제 Supabase가 아니다. 앱 서비스(content-service·approval-service·read)를 그대로 쓰고, DB 쪽만
 * service_role RPC 어댑터와 authenticated(RLS) 조회 어댑터로 바꾼다. 키·env·네트워크 없음.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { decideApproval, revokeApproval } from "@/server/distribution/approval-service";
import { appendContentVersion, appendDraftRevision, createChannelDraft, createContent } from "@/server/distribution/content-service";
import { getContentDetail, listContents, type Query, type ReadSource } from "@/server/distribution/read";
import { writeNoticeOf } from "@/server/distribution/write-notice";
import type { RpcClient } from "@/server/distribution/write-runner";

const PROJECT = process.env.PGLITE_PROJECT;
const WEB = process.cwd();
const VERIFY = join(WEB, "scripts", "distribution-local-verify");
const MIGRATIONS = join(WEB, "supabase", "migrations");

const U = {
  admin: "00000000-0000-4000-8000-00000000000a",
  pending: "00000000-0000-4000-8000-0000000000c1",
  member: "00000000-0000-4000-8000-0000000000d1",
};

type Db = {
  exec(sql: string): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};
let db: Db;
let applied: string[] = [];

const norm = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);
const normRow = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, norm(v)]));

async function inTx<T>(role: string, sub: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    if (sub) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
    await db.exec(`set local role ${role}`);
    const out = await fn();
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}

/** service_role RPC 어댑터: 앱의 RpcClient 계약 그대로 { data, error }. */
const rpcClient: RpcClient = {
  async rpc(fn, params) {
    if (!/^distribution_[a-z_]+$/.test(fn)) throw new Error("bad fn");
    const keys = Object.keys(params);
    const values: unknown[] = [];
    const args = keys.map((k, i) => {
      const v = params[k];
      // null은 형 지정 없이 넘겨 함수 시그니처로 해석시킨다(이름만 보고 형을 추측하지 않음).
      let cast: string | null = "text";
      let val: unknown = v;
      if (v === null || v === undefined) {
        cast = null;
        val = null;
      } else if (k.endsWith("_ids")) {
        cast = "uuid[]";
        val = Array.isArray(v) ? `{${v.join(",")}}` : v;
      } else if (typeof v === "object") {
        cast = "jsonb";
        val = JSON.stringify(v);
      } else if (typeof v === "number") cast = "int";
      else if (typeof v === "boolean") cast = "boolean";
      else if (typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) cast = "uuid";
      values.push(val);
      return `${k} => $${i + 1}${cast ? `::${cast}` : ""}`;
    });
    try {
      const r = await inTx("service_role", null, () => db.query(`select public.${fn}(${args.join(", ")}) as r`, values));
      return { data: r.rows[0]?.r ?? null, error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { data: null, error: { code: err.code, message: err.message } };
    }
  },
};

/** authenticated(RLS) 조회 어댑터: 앱의 ReadSource 계약 그대로. */
function readAs(sub: string): ReadSource {
  return {
    async select(q: Query) {
      if (!/^distribution_[a-z_]+$/.test(q.table) || q.columns.some((c) => !/^[a-z_]+$/.test(c))) throw new Error("bad query");
      const params: unknown[] = [];
      const where = (q.filters ?? []).map((f) => {
        if (f.op === "eq") {
          params.push(f.value);
          return `${f.col}::text = $${params.length}`;
        }
        const list = f.value as readonly string[];
        if (list.length === 0) return "false";
        const ph = list.map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        return `${f.col}::text in (${ph.join(",")})`;
      });
      const order = (q.order ?? []).map((o) => `${o.col} ${o.ascending ? "asc" : "desc"}`);
      const sql = `select ${q.columns.join(", ")} from public.${q.table}${where.length ? ` where ${where.join(" and ")}` : ""}${order.length ? ` order by ${order.join(", ")}` : ""}${q.limit ? ` limit ${q.limit}` : ""}`;
      try {
        const r = await inTx("authenticated", sub, () => db.query(sql, params));
        return { rows: r.rows.map(normRow) };
      } catch (e) {
        const err = e as { code?: string; message?: string };
        return { error: { code: err.code, message: err.message } };
      }
    },
  };
}

const as = (id: string) => async (): Promise<ActorResult> => ({ ok: true, actorId: id });
const deps = (id = U.admin) => ({ resolveActor: as(id), getClient: () => rpcClient });
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });

describe.skipIf(!PROJECT)("PGlite 왕복: 원문 → 초안 → 승인·반려·철회", () => {
  beforeAll(async () => {
    const dir = resolve(PROJECT as string);
    if (!existsSync(join(dir, "node_modules", "@electric-sql", "pglite", "package.json"))) throw new Error("PGlite not installed in PGLITE_PROJECT");
    const req = createRequire(join(dir, "package.json"));
    const { PGlite } = (await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href)) as { PGlite: new () => Db };
    db = new PGlite();
    await db.exec(readFileSync(join(VERIFY, "supabase-local-standin.sql"), "utf8"));
    applied = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    for (const f of applied) await db.exec(`set role supa_owner;\n${readFileSync(join(MIGRATIONS, f), "utf8")}\n;reset role;`);
    await db.exec(`insert into auth.users (id) values ('${U.admin}'),('${U.pending}'),('${U.member}')`);
    await db.exec(`update public.profiles set approval_status = case id when '${U.pending}' then 'pending' else 'approved' end`);
    await db.exec(`insert into public.role_assignments (user_id, role) values ('${U.admin}','admin'),('${U.pending}','admin')`);
  }, 120_000);

  it("적용 migration 목록(000000~080000)", () => {
    expect(applied[0]).toBe("20261116000000_initial_foundation.sql");
    expect(applied).toContain("20261116050000_distribution_content_write_api.sql");
    console.log(`applied: ${applied.map((f) => f.slice(0, 14)).join(", ")}`);
  });

  it("전 과정", async () => {
    // 조회 성공 0건
    expect(await listContents(readAs(U.admin))).toEqual({ status: "ok", data: [] });

    // A1 원문 생성
    const created = await createContent(deps(), form({ title: "출발 준비 기록", body: "<b>본문</b>\n둘째 줄", targetPath: "/about" }));
    if (created.status !== "ok") console.log("createContent:", JSON.stringify(created));
    expect(created.status).toBe("ok");
    if (created.status !== "ok") return;
    const cid = created.data.contentId;
    const listed = await listContents(readAs(U.admin));
    expect(listed.status === "ok" && listed.data.map((c) => c.title)).toEqual(["출발 준비 기록"]);

    // RLS: 일반 회원·비승인 admin은 0건(조회 성공·안 보임)
    expect(await listContents(readAs(U.member))).toEqual({ status: "ok", data: [] });
    expect(await getContentDetail(readAs(U.pending), cid)).toEqual({ status: "ok", data: null });

    // D1(DB): 비승인 admin actor 쓰기 → denied
    expect(writeNoticeOf(await createContent(deps(U.pending), form({ title: "x", body: "y" })))).toBe("denied");

    // 상세: 텍스트 그대로(HTML 해석 없음), 버전 1
    let d = await getContentDetail(readAs(U.admin), cid);
    if (d.status !== "ok" || !d.data?.current) throw new Error("detail");
    expect(d.data.current.body).toBe("<b>본문</b>\n둘째 줄");
    const v1 = d.data.current;

    // A3 초안, A4 리비전(expected 0, 렌더된 원문 버전 ID)
    const draft = await createChannelDraft(deps(), form({ contentId: cid, channel: "blog" }));
    if (draft.status !== "ok") throw new Error("draft");
    expect(writeNoticeOf(await createChannelDraft(deps(), form({ contentId: cid, channel: "blog" })))).toBe("duplicate");
    const rev = await appendDraftRevision(deps(), form({ draftId: draft.data.draftId, expectedRevisionNo: "0", expectedContentVersionId: v1.id, body: "블로그 본문" }));
    expect(rev.status).toBe("ok");
    if (rev.status !== "ok") return;
    expect(writeNoticeOf(await appendDraftRevision(deps(), form({ draftId: draft.data.draftId, expectedRevisionNo: "0", expectedContentVersionId: v1.id, body: "늦은 저장" })))).toBe("conflict_revision");

    // A5 원문 승인: 잘못된 해시 → subject_changed, 렌더 해시 → 성공
    const contentChecks = { check_facts_checked: "on", check_sources_checked: "on", check_public_ok: "on" };
    expect(writeNoticeOf(await decideApproval(deps(), form({ subjectType: "content_version", subjectId: v1.id, decision: "approved", expectedSubjectHash: "f".repeat(64), ...contentChecks })))).toBe("subject_changed");
    expect((await decideApproval(deps(), form({ subjectType: "content_version", subjectId: v1.id, decision: "approved", expectedSubjectHash: v1.contentHash, ...contentChecks }))).status).toBe("ok");
    expect(writeNoticeOf(await decideApproval(deps(), form({ subjectType: "content_version", subjectId: v1.id, decision: "approved", expectedSubjectHash: v1.contentHash, ...contentChecks })))).toBe("already_decided");

    // A6 초안 반려 → 승인
    const revChecks = { check_matches_content: "on", check_facts_checked: "on", check_links_checked: "on", check_media_rights_checked: "on" };
    expect((await decideApproval(deps(), form({ subjectType: "draft_revision", subjectId: rev.data.revisionId, decision: "rejected", expectedSubjectHash: rev.data.revisionHash, reason: "표현 수정" }))).status).toBe("ok");
    d = await getContentDetail(readAs(U.admin), cid);
    expect(d.status === "ok" && d.data?.drafts.blog?.approval.state).toBe("rejected");
    expect((await decideApproval(deps(), form({ subjectType: "draft_revision", subjectId: rev.data.revisionId, decision: "approved", expectedSubjectHash: rev.data.revisionHash, ...revChecks }))).status).toBe("ok");
    d = await getContentDetail(readAs(U.admin), cid);
    if (d.status !== "ok" || !d.data) throw new Error("detail2");
    expect(d.data.contentApproval.state).toBe("approved");
    const blog = d.data.drafts.blog;
    expect(blog?.approval.state).toBe("approved");

    // A7 철회 → revoked(앱 DTO가 SQL과 같은 판정)
    if (blog?.approval.state !== "approved") throw new Error("approval");
    expect((await revokeApproval(deps(), form({ approvalId: blog.approval.approvalId, reason: "다시 검토" }))).status).toBe("ok");
    expect(writeNoticeOf(await revokeApproval(deps(), form({ approvalId: blog.approval.approvalId, reason: "두 번" })))).toBe("already_revoked");
    d = await getContentDetail(readAs(U.admin), cid);
    expect(d.status === "ok" && d.data?.drafts.blog?.approval.state).toBe("revoked");
    // SQL 판정과 대조(owner 권한으로 helper 호출)
    await db.exec("set role supa_owner");
    const sqlEff = await db.query(`select public.distribution_effective_approval_id('draft_revision', $1::uuid) as id`, [rev.data.revisionId]);
    await db.exec("reset role");
    expect(sqlEff.rows[0]?.id ?? null).toBeNull();

    // A2 새 버전: 렌더된 기대 버전(1) 성공 → 같은 기대값 재시도는 충돌
    expect((await appendContentVersion(deps(), form({ contentId: cid, expectedVersionNo: "1", title: "출발 준비 기록 v2", body: "고친 본문" }))).status).toBe("ok");
    expect(writeNoticeOf(await appendContentVersion(deps(), form({ contentId: cid, expectedVersionNo: "1", title: "늦게", body: "늦게" })))).toBe("conflict_version");
    d = await getContentDetail(readAs(U.admin), cid);
    if (d.status !== "ok" || !d.data) throw new Error("detail3");
    expect(d.data.versions.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(d.data.drafts.blog?.basedOnLatest).toBe(false);
    expect(d.data.contentApproval.state).toBe("none");

    // 옛 원문 기준 리비전 승인 → stale, 옛 원문 버전으로 새 리비전 → stale
    expect(writeNoticeOf(await decideApproval(deps(), form({ subjectType: "draft_revision", subjectId: rev.data.revisionId, decision: "approved", expectedSubjectHash: rev.data.revisionHash, ...revChecks })))).toMatch(/^(stale_content|not_latest)$/);
    expect(writeNoticeOf(await appendDraftRevision(deps(), form({ draftId: draft.data.draftId, expectedRevisionNo: "1", expectedContentVersionId: v1.id, body: "옛 기준" })))).toBe("stale_content");

    // 보관 → 쓰기 거절(archived)
    await inTx("service_role", null, () => db.query(`select public.distribution_archive_content($1::uuid, $2::uuid, '정리')`, [U.admin, cid]));
    expect(writeNoticeOf(await appendContentVersion(deps(), form({ contentId: cid, expectedVersionNo: "2", title: "t", body: "b" })))).toBe("archived");
  }, 120_000);
});
