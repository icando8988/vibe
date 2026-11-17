#!/usr/bin/env node
/**
 * AUTOPOST-LOCAL-DB-VERIFY-002 — distribution M0~M2+050000 로컬 실행 검증 러너.
 *
 * 대상: 일회성 인메모리 PGlite(PostgreSQL WASM) + Supabase 최소 대역(supabase-local-standin.sql).
 * 실제 Supabase 검증이 아니다. 비밀값·env·원격 DB를 읽거나 쓰지 않는다. 네트워크를 쓰지 않는다.
 *
 * PGlite는 web/에 설치하지 않는다. OS 임시 디렉터리 등 별도 프로젝트에 설치하고 경로를 넘긴다.
 *   node web/scripts/distribution-local-verify/run.mjs --pglite-project <dir> [--json <out.json>]
 *     <dir> = `npm install @electric-sql/pglite@0.5.16`을 실행한 디렉터리(그 안의 node_modules에서 해석)
 * 종료 코드: 0 전부 통과 · 1 시나리오 실패 · 2 migration 적용 실패 · 3 PGlite 없음(NOT RUN)
 *
 * 로그에는 행 내용 대신 SQLSTATE·건수·오류 접두어만 남긴다(고정 UUID는 가짜 식별자).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB = resolve(HERE, "..", "..");
const MIGRATIONS_DIR = join(WEB, "supabase", "migrations");
const EXPECTED_MIGRATIONS = [
  "20261116000000_initial_foundation.sql",
  "20261116010000_private_role_functions.sql",
  "20261116020000_profile_on_signup.sql",
  "20261116030000_distribution_content.sql",
  "20261116040000_distribution_jobs.sql",
  "20261116050000_distribution_content_write_api.sql",
];

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const pgliteProject = argOf("--pglite-project");
const jsonOut = argOf("--json");

async function loadPGlite() {
  try {
    if (pgliteProject) {
      // 상위 디렉터리 node_modules로 새지 않도록 지정 디렉터리 안의 설치만 인정한다.
      if (!existsSync(join(resolve(pgliteProject), "node_modules", "@electric-sql", "pglite", "package.json"))) {
        throw Object.assign(new Error("not installed in --pglite-project"), { code: "MODULE_NOT_FOUND" });
      }
      const req = createRequire(join(resolve(pgliteProject), "package.json"));
      const entry = req.resolve("@electric-sql/pglite");
      return (await import(pathToFileURL(entry).href)).PGlite;
    }
    return (await import("@electric-sql/pglite")).PGlite;
  } catch (e) {
    console.log(`NOT RUN: @electric-sql/pglite을 찾지 못했다 (${e && e.code ? e.code : "load error"}).`);
    console.log("  임시 디렉터리에 설치 후 --pglite-project <dir>로 넘긴다. web/에는 설치하지 않는다.");
    process.exit(3);
  }
}

// ---------------------------------------------------------------- fixed ids (가짜)
const U = {
  admin: "00000000-0000-4000-8000-00000000000a", // admin + approved
  admin2: "00000000-0000-4000-8000-00000000000b", // admin + approved (나중에 정지)
  pending: "00000000-0000-4000-8000-0000000000c1", // admin + pending
  suspended: "00000000-0000-4000-8000-0000000000c2", // admin + suspended
  rejected: "00000000-0000-4000-8000-0000000000c3", // admin + rejected
  member: "00000000-0000-4000-8000-0000000000d1", // approved, 역할 없음
  seller: "00000000-0000-4000-8000-0000000000d2", // approved, seller 역할
  ghost: "00000000-0000-4000-8000-0000000000ee", // auth.users에 없음
};
const ASSET = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const VARIANT = "44444444-4444-4444-8444-444444444444";
const CHECK_OK = JSON.stringify({ facts_checked: true, links_checked: true });

// ---------------------------------------------------------------- result bookkeeping
const results = [];
let currentGroup = "";
function group(name) {
  currentGroup = name;
  console.log(`\n## ${name}`);
}
function record(name, pass, detail) {
  results.push({ group: currentGroup, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const fmt = (r) => (r.ok ? `ok rows=${r.rowCount}` : `ERR ${r.code} ${r.prefix ?? ""}`.trim());

// ---------------------------------------------------------------- db helpers
let db;
function errInfo(e) {
  const code = e && typeof e === "object" && typeof e.code === "string" ? e.code : "UNKNOWN";
  const msg = e && typeof e.message === "string" ? e.message : String(e);
  const m = msg.match(/^([A-Z][A-Z_]{3,}):/);
  return { code, prefix: m ? m[1] : undefined, message: msg };
}

/**
 * 한 트랜잭션: (sub 설정) → (SET LOCAL ROLE) → 문장들 실행 → 성공 시 commit(기본) / rollback(opts.rollback).
 * 오류 시 항상 rollback. role=null이면 superuser(대역 관리자) — 픽스처·변조 전용.
 */
async function tx(role, sub, statements, opts = {}) {
  const list = Array.isArray(statements) ? statements : [statements];
  await db.exec("begin");
  let out;
  try {
    if (sub) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
    if (role) await db.exec(`set local role ${role}`);
    let last;
    for (const s of list) {
      const [sql, params] = Array.isArray(s) ? s : [s, []];
      last = await db.query(sql, params);
    }
    const affected = typeof last.affectedRows === "number" ? last.affectedRows : 0;
    out = { ok: true, rows: last.rows, rowCount: last.rows.length > 0 ? last.rows.length : affected };
    await db.exec(opts.rollback ? "rollback" : "commit");
  } catch (e) {
    await db.exec("rollback");
    out = { ok: false, rows: [], rowCount: 0, ...errInfo(e) };
  }
  return out;
}
const svc = (sql, params = [], opts) => tx("service_role", null, [[sql, params]], opts);
const su = (sql, params = []) => tx(null, null, [[sql, params]]);
async function scalar(sql, params = []) {
  const r = await su(sql, params);
  if (!r.ok) throw new Error(`fixture query failed: ${r.code} ${r.message}`);
  const row = r.rows[0];
  return row ? Object.values(row)[0] : undefined;
}
const json = (r) => (r.ok ? r.rows[0]?.r : undefined);

function expectOk(name, r, extra) {
  record(name, r.ok, fmt(r) + (extra ? ` ${extra}` : ""));
  return r;
}
function expectErr(name, r, code, prefix) {
  const pass = !r.ok && r.code === code && (prefix === undefined || r.prefix === prefix);
  record(name, pass, `${fmt(r)} (기대 ${code}${prefix ? ` ${prefix}` : ""})`);
  return r;
}
function expectEq(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  record(name, pass, `실제=${JSON.stringify(actual)} 기대=${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------- API wrappers (service_role)
const api = {
  createContent: (actor, title = "제목", body = "본문", extra = {}) =>
    svc(
      `select public.distribution_create_content(p_actor_id => $1::uuid, p_title => $2, p_body => $3,
         p_story_slug => $4, p_target_path => $5, p_source_refs => $6::jsonb, p_media_asset_ids => $7::uuid[],
         p_change_summary => $8) as r`,
      [actor, title, body, extra.slug ?? null, extra.path ?? null, extra.refs ?? "[]", extra.media ?? "{}", extra.summary ?? null],
    ),
  appendVersion: (actor, contentId, expected, title = "제목 v+", body = "본문 v+", extra = {}) =>
    svc(
      `select public.distribution_append_content_version(p_actor_id => $1::uuid, p_content_id => $2::uuid,
         p_expected_version_no => $3, p_title => $4, p_body => $5, p_target_path => $6,
         p_source_refs => $7::jsonb, p_media_asset_ids => $8::uuid[]) as r`,
      [actor, contentId, expected, title, body, extra.path ?? null, extra.refs ?? "[]", extra.media ?? "{}"],
    ),
  createDraft: (actor, contentId, channel) =>
    svc(`select public.distribution_create_channel_draft($1::uuid, $2::uuid, $3) as r`, [actor, contentId, channel]),
  appendRevision: (actor, draftId, expectedRev, expectedVersionId, body = "채널 본문", extra = {}) =>
    svc(
      `select public.distribution_append_draft_revision(p_actor_id => $1::uuid, p_draft_id => $2::uuid,
         p_expected_revision_no => $3, p_expected_content_version_id => $4::uuid, p_body => $5,
         p_link_url => $6, p_utm => $7::jsonb, p_target_connection_id => $8::uuid,
         p_target_external_account_id => $9, p_validation => $10::jsonb, p_media => $11::jsonb) as r`,
      [actor, draftId, expectedRev, expectedVersionId, body, extra.link ?? null, extra.utm ?? "{}",
        extra.conn ?? null, extra.ext ?? null, extra.validation ?? "{}", extra.media ?? "[]"],
    ),
  decide: (actor, type, id, decision, hash, checklist = CHECK_OK, reason = null, opts) =>
    svc(
      `select public.distribution_decide_approval($1::uuid, $2, $3::uuid, $4, $5, $6::jsonb, $7) as r`,
      [actor, type, id, decision, hash, checklist, reason],
      opts,
    ),
  revoke: (actor, approvalId, reason = "철회 사유") =>
    svc(`select public.distribution_revoke_approval($1::uuid, $2::uuid, $3) as r`, [actor, approvalId, reason]),
  archiveContent: (actor, contentId, reason = "보관 사유") =>
    svc(`select public.distribution_archive_content($1::uuid, $2::uuid, $3) as r`, [actor, contentId, reason]),
  archiveDraft: (actor, draftId, reason = "보관 사유") =>
    svc(`select public.distribution_archive_channel_draft($1::uuid, $2::uuid, $3) as r`, [actor, draftId, reason]),
  createJob: (actor, revisionId, mode, scheduledAt = null) =>
    svc(`select public.distribution_create_job($1::uuid, $2::uuid, $3, $4::timestamptz) as r`,
      [actor, revisionId, mode, scheduledAt]),
};

// ---------------------------------------------------------------- 해시 명세 독립 구현(node:crypto)
function hf(name, value) {
  return value === null || value === undefined
    ? `${name}=-\n`
    : `${name}=${Buffer.byteLength(value, "utf8")}:${value}\n`;
}
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
function specContentHash({ contentId, title, body, targetPath, sourceRefsText, media }) {
  let s = "distribution.content_version.v1\n" + hf("content_id", contentId) + hf("title", title) + hf("body", body)
    + hf("target_path", targetPath) + hf("source_refs", sourceRefsText) + hf("media_asset_ids.count", String(media.length));
  media.forEach((m, i) => { s += hf(`media_asset_ids[${i + 1}]`, m); });
  return sha(s);
}
function specRevisionHash(r) {
  const keys = Object.keys(r.utm).sort((a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b))));
  let s = "distribution.draft_revision.v1\n" + hf("draft_id", r.draftId) + hf("content_id", r.contentId)
    + hf("channel", r.channel) + hf("content_version_id", r.versionId) + hf("content_hash", r.contentHash)
    + hf("body", r.body) + hf("link_url", r.link) + hf("utm.count", String(keys.length));
  for (const k of keys) s += hf("utm.key", k) + hf("utm.value", r.utm[k]);
  s += hf("target_connection_id", r.conn) + hf("target_external_account_id", r.ext) + hf("media.count", String(r.media.length));
  r.media.forEach((m, i) => {
    s += hf(`media[${i + 1}].asset_id`, m.asset_id) + hf(`media[${i + 1}].variant_id`, m.variant_id ?? null)
      + hf(`media[${i + 1}].alt_text`, m.alt_text ?? null);
  });
  return sha(s);
}

// ================================================================ main
const PGlite = await loadPGlite();
db = await PGlite.create();
const ver = (await db.query("select version() v")).rows[0].v;
console.log(`# AUTOPOST-LOCAL-DB-VERIFY-002 · ${new Date().toISOString()}`);
console.log(`엔진: ${ver.split(" on ")[0]} (인메모리, 단일 연결) — Supabase 대역이며 실제 Supabase 아님`);

// ---- 0. 대역 + migration 순차 적용
group("0. Supabase 최소 대역 + M0~M2+050000 순차 적용 (owner = 비superuser supa_owner)");
await db.exec(readFileSync(join(HERE, "supabase-local-standin.sql"), "utf8"));
record("대역(stand-in) 적용", true, "anon/authenticated/service_role/supa_owner, auth.users, auth.uid()");
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
// M2-VERIFY-003: 이후 migration(예: 060000)이 추가돼도 앞 6개가 기대 순서와 같으면 통과하고, 추가분도 순서대로 적용한다.
expectEq("migration 앞 6개 = 기대 목록(순서 포함)", files.slice(0, EXPECTED_MIGRATIONS.length), EXPECTED_MIGRATIONS);
if (files.length > EXPECTED_MIGRATIONS.length) console.log(`  추가 migration 함께 적용: ${files.slice(EXPECTED_MIGRATIONS.length).join(", ")}`);
for (const f of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
  const t0 = Date.now();
  try {
    await db.exec(`set role supa_owner;\n${sql}\n;reset role;`);
    record(`적용 ${f}`, true, `${Date.now() - t0}ms`);
  } catch (e) {
    const info = errInfo(e);
    try { await db.exec("rollback; reset role;"); } catch { /* ignore */ }
    record(`적용 ${f}`, false, `${info.code} ${info.message.slice(0, 300)}`);
    finish(2);
  }
}
const owner = await scalar(
  "select pg_get_userbyid(relowner) from pg_class where oid = 'public.distribution_contents'::regclass");
expectEq("M1 테이블 owner", owner, "supa_owner");
const ownerSuper = await scalar("select rolsuper from pg_roles where rolname = 'supa_owner'");
expectEq("owner superuser 아님", ownerSuper, false);
// 대조군: 대역의 Supabase식 기본 권한이 실제로 열리는지(열리지 않으면 아래 REVOKE 검증이 공허해진다)
await db.exec(`set role supa_owner;
  create table public.zz_control (id int); create function public.zz_control_fn() returns int language sql as 'select 1';
  reset role;`);
const ctl = (await su(`select has_table_privilege('anon', 'public.zz_control', 'SELECT') t,
  has_function_privilege('anon', 'public.zz_control_fn()', 'EXECUTE') f`)).rows[0];
expectEq("대조군: 새 테이블·함수에 anon 기본 권한이 실제로 생김", ctl, { t: true, f: true });
await su("drop table public.zz_control; drop function public.zz_control_fn()");
// 판정기 자기 점검: 성공 호출을 오류 기대로 판정하면 FAIL이어야 한다(결과 목록에는 넣지 않음)
{
  const probe = await su("select 1");
  const wouldPass = !probe.ok && probe.code === "42501";
  record("판정기 자기 점검: 성공 호출을 42501 기대로 보면 불통과", wouldPass === false, "");
}

// ---- 픽스처
await su(`insert into auth.users (id) values ${Object.entries(U).filter(([k]) => k !== "ghost").map(([, v]) => `('${v}')`).join(",")}`);
const profCount = await scalar("select count(*)::int from public.profiles");
expectEq("가입 트리거가 profiles(pending) 생성", profCount, 7);
await su(`update public.profiles set approval_status = case id
  when '${U.admin}' then 'approved' when '${U.admin2}' then 'approved' when '${U.pending}' then 'pending'
  when '${U.suspended}' then 'suspended' when '${U.rejected}' then 'rejected'
  when '${U.member}' then 'approved' when '${U.seller}' then 'approved' end`);
await su(`insert into public.role_assignments (user_id, role) values
  ('${U.admin}','admin'),('${U.admin2}','admin'),('${U.pending}','admin'),('${U.suspended}','admin'),
  ('${U.rejected}','admin'),('${U.seller}','seller')`);

// ---- 1. D1 actor
group("1. D1 actor 거부/허용 (service_role 호출, p_actor_id 재검증)");
const c0 = json(expectOk("승인 admin: create_content 허용", await api.createContent(U.admin, "D1 원문", "D1 본문")));
const contentsBefore = await scalar("select count(*)::int from public.distribution_contents");
for (const [label, id] of [["admin+pending", U.pending], ["admin+suspended", U.suspended], ["admin+rejected", U.rejected],
  ["approved 일반회원(역할 없음)", U.member], ["approved seller", U.seller], ["auth.users에 없는 uuid", U.ghost], ["null", null]]) {
  expectErr(`${label}: create_content 거부`, await api.createContent(id), "42501");
}
expectEq("거부된 호출은 행을 만들지 않음", await scalar("select count(*)::int from public.distribution_contents"), contentsBefore);
// 8개 API 전부 비승인 actor 거부(첫 문장 재검증)
const dummy = "99999999-9999-4999-8999-999999999999";
const allApis = [
  ["append_content_version", (a) => api.appendVersion(a, c0.content_id, 1)],
  ["create_channel_draft", (a) => api.createDraft(a, c0.content_id, "blog")],
  ["append_draft_revision", (a) => api.appendRevision(a, dummy, 0, dummy)],
  ["decide_approval", (a) => api.decide(a, "content_version", c0.version_id, "approved", c0.content_hash)],
  ["revoke_approval", (a) => api.revoke(a, dummy)],
  ["archive_content", (a) => api.archiveContent(a, c0.content_id)],
  ["archive_channel_draft", (a) => api.archiveDraft(a, dummy)],
  ["create_job(M2)", (a) => api.createJob(a, dummy, "dry_run")],
];
for (const [n, f] of allApis) expectErr(`suspended actor: ${n} 거부`, await f(U.suspended), "42501");
// 승인 admin이 도중에 정지되면 즉시 거부
const c1 = json(expectOk("admin2(승인) create_content 허용", await api.createContent(U.admin2, "정지 전", "본문")));
await su(`update public.profiles set approval_status = 'suspended' where id = '${U.admin2}'`);
expectErr("admin2 정지 후 append_content_version 거부", await api.appendVersion(U.admin2, c1.content_id, 1), "42501");
await su(`update public.profiles set approval_status = 'approved' where id = '${U.admin2}'`);
expectOk("admin2 재승인 후 append_content_version 허용", await api.appendVersion(U.admin2, c1.content_id, 1));
await su(`delete from public.role_assignments where user_id = '${U.admin2}'`);
expectErr("admin2 admin 역할 회수 후 거부", await api.appendVersion(U.admin2, c1.content_id, 2), "42501");

// ---- 2. ACL
group("2. ACL — EXECUTE / 직접 DML / 읽기 RLS·열 권한");
const apiSigs = [
  "distribution_create_content(uuid, text, text, text, text, jsonb, uuid[], text)",
  "distribution_append_content_version(uuid, uuid, integer, text, text, text, jsonb, uuid[], text)",
  "distribution_create_channel_draft(uuid, uuid, text)",
  "distribution_append_draft_revision(uuid, uuid, integer, uuid, text, text, jsonb, uuid, text, jsonb, jsonb)",
  "distribution_decide_approval(uuid, text, uuid, text, text, jsonb, text)",
  "distribution_revoke_approval(uuid, uuid, text)",
  "distribution_archive_content(uuid, uuid, text)",
  "distribution_archive_channel_draft(uuid, uuid, text)",
];
const helperSigs = [
  "distribution_hash_field(text, text)",
  "distribution_compute_content_hash(uuid, text, text, text, jsonb, uuid[])",
  "distribution_compute_revision_hash(uuid, uuid, text, uuid, text, text, text, jsonb, uuid, text, jsonb)",
  "distribution_recompute_subject_hash(text, uuid)",
  "distribution_assert_content_input(text, text, jsonb, uuid[])",
  "distribution_assert_utm(jsonb)",
  "distribution_assert_checklist(jsonb, boolean)",
  "distribution_normalize_media(jsonb)",
  "distribution_assert_admin_actor(uuid)",
  "distribution_effective_approval_id(text, uuid)",
];
const privRows = (await su(
  `select f.sig, r.role, has_function_privilege(r.role, ('public.' || f.sig)::regprocedure, 'EXECUTE') as x
   from unnest($1::text[]) f(sig) cross join unnest(array['public','anon','authenticated','service_role']) r(role)`,
  [[...apiSigs, ...helperSigs]],
)).rows;
// 'public' 의사 역할은 has_function_privilege에서 직접 지원되지 않으므로 proacl로 따로 확인
const pubRows = (await su(
  `select f.sig, coalesce(array_to_string(p.proacl, ','), '<default>') acl
   from unnest($1::text[]) f(sig) join pg_proc p on p.oid = ('public.' || f.sig)::regprocedure`,
  [[...apiSigs, ...helperSigs]],
)).rows;
for (const sig of apiSigs) {
  const g = (role) => privRows.find((r) => r.sig === sig && r.role === role)?.x;
  const acl = pubRows.find((r) => r.sig === sig)?.acl ?? "";
  const pubExec = /(^|,)=X/.test(acl);
  record(`API ${sig.split("(")[0]} EXECUTE: service_role만`, g("service_role") === true && g("anon") === false
    && g("authenticated") === false && !pubExec, `anon=${g("anon")} auth=${g("authenticated")} svc=${g("service_role")} PUBLIC=${pubExec}`);
}
for (const sig of helperSigs) {
  const g = (role) => privRows.find((r) => r.sig === sig && r.role === role)?.x;
  const acl = pubRows.find((r) => r.sig === sig)?.acl ?? "";
  const pubExec = /(^|,)=X/.test(acl);
  record(`helper ${sig.split("(")[0]} EXECUTE: owner만`, g("service_role") === false && g("anon") === false
    && g("authenticated") === false && !pubExec, `anon=${g("anon")} auth=${g("authenticated")} svc=${g("service_role")} PUBLIC=${pubExec}`);
}
// 실제 호출로도 확인
expectErr("anon: create_content 실행 거부", await tx("anon", null,
  [[`select public.distribution_create_content($1::uuid, 'x', 'y')`, [U.admin]]]), "42501");
expectErr("authenticated(admin JWT): create_content 실행 거부", await tx("authenticated", U.admin,
  [[`select public.distribution_create_content($1::uuid, 'x', 'y')`, [U.admin]]]), "42501");
expectErr("authenticated(admin JWT): decide_approval 실행 거부", await tx("authenticated", U.admin,
  [[`select public.distribution_decide_approval($1::uuid, 'content_version', $2::uuid, 'approved', $3, '{"a":true}'::jsonb)`,
    [U.admin, c0.version_id, c0.content_hash]]]), "42501");
expectErr("service_role: helper compute_content_hash 실행 거부",
  await svc(`select public.distribution_compute_content_hash($1::uuid,'t','b',null,'[]'::jsonb,'{}'::uuid[])`, [dummy]), "42501");
expectErr("service_role: helper assert_admin_actor 실행 거부",
  await svc(`select public.distribution_assert_admin_actor($1::uuid)`, [U.admin]), "42501");
// service_role 직접 DML
expectErr("service_role: contents 직접 INSERT 거부",
  await svc(`insert into public.distribution_contents (owner_id) values ($1::uuid)`, [U.admin]), "42501");
expectErr("service_role: contents 직접 UPDATE 거부",
  await svc(`update public.distribution_contents set story_slug = 'x' where id = $1::uuid`, [c0.content_id]), "42501");
expectErr("service_role: contents 직접 DELETE 거부",
  await svc(`delete from public.distribution_contents where id = $1::uuid`, [c0.content_id]), "42501");
expectErr("service_role: content_versions 직접 INSERT 거부",
  await svc(`insert into public.distribution_content_versions (content_id, version_no, title, body, content_hash, created_by)
             values ($1::uuid, 2, 't', 'b', repeat('a', 64), $2::uuid)`, [c0.content_id, U.admin]), "42501");
expectErr("service_role: approvals 직접 INSERT 거부",
  await svc(`insert into public.distribution_approvals (subject_type, content_version_id, subject_hash, decision, actor_id)
             values ('content_version', $1::uuid, $2, 'approved', $3::uuid)`, [c0.version_id, c0.content_hash, U.admin]), "42501");
expectErr("service_role: archive_events 직접 INSERT 거부",
  await svc(`insert into public.distribution_archive_events (subject_type, content_id, reason, actor_id)
             values ('content', $1::uuid, 'r', $2::uuid)`, [c0.content_id, U.admin]), "42501");
expectErr("service_role: content_versions TRUNCATE 거부",
  await svc(`truncate public.distribution_content_versions`), "42501");
expectOk("service_role: contents SELECT 허용", await svc(`select id from public.distribution_contents`));
expectOk("service_role: archive_events SELECT 허용", await svc(`select id from public.distribution_archive_events`));
// 클라이언트 읽기
const readAdmin = await tx("authenticated", U.admin, [["select id, current_version_no from public.distribution_contents"]]);
record("authenticated(승인 admin): contents 명시 열 읽기 → 행 보임", readAdmin.ok && readAdmin.rowCount >= 2, fmt(readAdmin));
for (const [label, id] of [["admin+pending", U.pending], ["admin+suspended", U.suspended], ["일반회원", U.member]]) {
  const r = await tx("authenticated", id, [["select id from public.distribution_contents"]]);
  record(`authenticated(${label}): contents 0행(RLS)`, r.ok && r.rowCount === 0, fmt(r));
}
expectErr("anon: contents 읽기 거부", await tx("anon", null, [["select id from public.distribution_contents"]]), "42501");
expectErr("authenticated(admin): draft_revisions.created_xact_id 열 거부",
  await tx("authenticated", U.admin, [["select created_xact_id from public.distribution_draft_revisions"]]), "42501");
expectErr("authenticated(admin): draft_revisions select * 거부",
  await tx("authenticated", U.admin, [["select * from public.distribution_draft_revisions"]]), "42501");
expectErr("authenticated(admin): contents 직접 INSERT 거부",
  await tx("authenticated", U.admin, [[`insert into public.distribution_contents (owner_id) values ($1::uuid)`, [U.admin]]]), "42501");
const arAdmin = await tx("authenticated", U.admin, [["select id, reason from public.distribution_archive_events"]]);
record("authenticated(admin): archive_events 명시 열 읽기 허용", arAdmin.ok, fmt(arAdmin));

// ---- 3. 버전 충돌
group("3. 콘텐츠 버전·리비전 충돌 / stale");
const A = json(expectOk("원문 생성 v1", await api.createContent(U.admin, "버전 원문", "v1 본문", { slug: "trip-day-1", path: "/stories/day-1" })));
expectEq("create_content 반환 version_no", A.version_no, 1);
const A2 = json(expectOk("expected=1 → v2", await api.appendVersion(U.admin, A.content_id, 1, "버전 원문", "v2 본문")));
expectEq("v2 version_no", A2.version_no, 2);
expectErr("같은 expected=1 재요청 → VERSION_CONFLICT", await api.appendVersion(U.admin, A.content_id, 1), "P0001", "VERSION_CONFLICT");
expectErr("expected=null → VERSION_CONFLICT", await api.appendVersion(U.admin, A.content_id, null), "P0001", "VERSION_CONFLICT");
expectErr("expected=5(미래) → VERSION_CONFLICT", await api.appendVersion(U.admin, A.content_id, 5), "P0001", "VERSION_CONFLICT");
expectEq("머리 포인터 = v2", await scalar(
  "select current_version_no from public.distribution_contents where id = $1::uuid", [A.content_id]), 2);
expectErr("없는 content → no_data_found", await api.appendVersion(U.admin, dummy, 0), "P0002");
expectErr("빈 title(M1 check) 거부", await api.appendVersion(U.admin, A.content_id, 2, "", "b"), "23514");
expectErr("target_path '//evil' 거부", await api.appendVersion(U.admin, A.content_id, 2, "t", "b", { path: "//evil" }), "23514");
expectErr("source_refs 비배열 거부", await api.appendVersion(U.admin, A.content_id, 2, "t", "b", { refs: '{"a":1}' }), "22023");
expectErr("media_asset_ids null 원소 거부", await api.appendVersion(U.admin, A.content_id, 2, "t", "b", { media: "{NULL}" }), "22023");
expectEq("실패 후에도 v2 유지(부분 쓰기 없음)", await scalar(
  "select count(*)::int from public.distribution_content_versions where content_id = $1::uuid", [A.content_id]), 2);
expectErr("superuser 직접 포인터 되감기(트리거) 거부",
  await su(`update public.distribution_contents set current_version_id = $1::uuid, current_version_no = 1 where id = $2::uuid`,
    [A.version_id, A.content_id]), "23514");
expectErr("superuser 직접 version 행 UPDATE(append-only 트리거) 거부",
  await su(`update public.distribution_content_versions set title = 'x' where id = $1::uuid`, [A.version_id]), "23514");

const dB = json(expectOk("blog 초안 생성", await api.createDraft(U.admin, A.content_id, "blog")));
expectErr("같은 채널 초안 중복 → DUPLICATE", await api.createDraft(U.admin, A.content_id, "blog"), "23505", "DUPLICATE");
expectErr("잘못된 채널 거부", await api.createDraft(U.admin, A.content_id, "tiktok"), "22023");
expectErr("v1(이전 버전) 기준 리비전 → STALE_CONTENT_VERSION",
  await api.appendRevision(U.admin, dB.draft_id, 0, A.version_id), "P0001", "STALE_CONTENT_VERSION");
const r1 = json(expectOk("v2 기준 리비전 1", await api.appendRevision(U.admin, dB.draft_id, 0, A2.version_id, "블로그 본문 1")));
expectErr("같은 expected_revision=0 재요청 → REVISION_CONFLICT",
  await api.appendRevision(U.admin, dB.draft_id, 0, A2.version_id), "P0001", "REVISION_CONFLICT");
const r2 = json(expectOk("expected_revision=1 → 리비전 2", await api.appendRevision(U.admin, dB.draft_id, 1, A2.version_id, "블로그 본문 2")));
expectEq("리비전 2 revision_no", r2.revision_no, 2);

// ---- 4. 초안 + 미디어 원자성
group("4. 리비전 + 미디어 원자성");
const tD = json(expectOk("threads 초안 생성", await api.createDraft(U.admin, A.content_id, "threads")));
const mediaOk = JSON.stringify([
  { asset_id: ASSET[0].toUpperCase(), alt_text: "첫 장" },
  { asset_id: ASSET[1], variant_id: VARIANT },
  { asset_id: ASSET[2], variant_id: null, alt_text: null },
]);
const tr1 = json(expectOk("미디어 3개 리비전", await api.appendRevision(U.admin, tD.draft_id, 0, A2.version_id, "스레드 본문",
  { media: mediaOk, utm: '{"utm_source":"threads","utm_campaign":"day1"}', link: "https://example.com/stories/day-1" })));
expectEq("media_count = 3", tr1.media_count, 3);
const mrows = (await su(`select position, asset_id::text a, variant_id::text v from public.distribution_draft_revision_media
  where revision_id = $1::uuid order by position`, [tr1.revision_id])).rows;
expectEq("position 1..3 + 소문자 uuid 정규화", mrows.map((m) => [m.position, m.a]), [[1, ASSET[0]], [2, ASSET[1]], [3, ASSET[2]]]);
const badMedia = [
  ["스칼라 원소", '["x"]', "22023"],
  ["객체+스칼라 혼합", `[{"asset_id":"${ASSET[0]}"}, 5]`, "22023"],
  ["asset_id uuid 아님", '[{"asset_id":"not-a-uuid"}]', "22023"],
  ["허용 외 키", `[{"asset_id":"${ASSET[0]}","url":"https://x"}]`, "22023"],
  ["alt_text 숫자", `[{"asset_id":"${ASSET[0]}","alt_text":3}]`, "22023"],
  ["media 객체(비배열)", `{"asset_id":"${ASSET[0]}"}`, "22023"],
  ["21개 초과", JSON.stringify(Array.from({ length: 21 }, () => ({ asset_id: ASSET[0] }))), "22023"],
];
for (const [label, media, code] of badMedia) {
  const r = await api.appendRevision(U.admin, tD.draft_id, 1, A2.version_id, "잘못된 미디어", { media });
  expectErr(`잘못된 미디어(${label}) 거부`, r, code);
}
{
  // AUTOPOST-M1-VERIFY-001 수정 확인: 스칼라 원소는 의도한 문장('media items must be json objects')에서 거부돼야 한다.
  const r = await api.appendRevision(U.admin, tD.draft_id, 1, A2.version_id, "b", { media: `[{"asset_id":"${ASSET[0]}"}, "x"]` });
  record("스칼라 원소 → 의도한 오류 문장(json objects)", !r.ok && r.code === "22023" && /media items must be json objects/.test(r.message ?? ""),
    `${fmt(r)}`);
}
expectErr("utm 대문자 키 거부", await api.appendRevision(U.admin, tD.draft_id, 1, A2.version_id, "b", { utm: '{"UTM":"x"}' }), "22023");
expectErr("utm 숫자 값 거부", await api.appendRevision(U.admin, tD.draft_id, 1, A2.version_id, "b", { utm: '{"utm_source":1}' }), "22023");
expectErr("link_url http 거부(M1 check)", await api.appendRevision(U.admin, tD.draft_id, 1, A2.version_id, "b", { link: "http://x.com" }), "23514");
expectEq("실패 후 threads 리비전 수 = 1, 포인터 = 1", (await su(
  `select (select count(*)::int from public.distribution_draft_revisions where draft_id = $1::uuid) n,
          (select current_revision_no from public.distribution_channel_drafts where id = $1::uuid) p`, [tD.draft_id])).rows[0],
  { n: 1, p: 1 });
expectEq("실패 후 미디어 총계 변화 없음(3)", await scalar(
  `select count(*)::int from public.distribution_draft_revision_media m join public.distribution_draft_revisions r on r.id = m.revision_id
   where r.draft_id = $1::uuid`, [tD.draft_id]), 3);
expectErr("다음 트랜잭션에서 미디어 사후 추가(superuser) 거부",
  await su(`insert into public.distribution_draft_revision_media (revision_id, position, asset_id) values ($1::uuid, 4, $2::uuid)`,
    [tr1.revision_id, ASSET[0]]), "23514");
// 같은 트랜잭션 내 리비전 성공 후 오류 → 전체 롤백 확인
const atomic = await tx("service_role", null, [
  [`select public.distribution_append_draft_revision(p_actor_id => $1::uuid, p_draft_id => $2::uuid, p_expected_revision_no => 1,
     p_expected_content_version_id => $3::uuid, p_body => 'tx 내부 성공') as r`, [U.admin, tD.draft_id, A2.version_id]],
  ["select 1/0"],
]);
expectErr("같은 트랜잭션 후속 오류 → 22012", atomic, "22012");
expectEq("롤백 후 리비전 포인터 여전히 1", await scalar(
  "select current_revision_no from public.distribution_channel_drafts where id = $1::uuid", [tD.draft_id]), 1);
const rNoMedia = json(expectOk("미디어 없는 리비전 2", await api.appendRevision(U.admin, tD.draft_id, 1, A2.version_id, "미디어 없음")));
expectEq("media_count = 0", rNoMedia.media_count, 0);

// ---- 5. 해시 검증
group("5. 해시 — 명세 독립 재현 · 결정성 · 민감도 · 변조 탐지");
const vrow = (await su(`select content_id::text cid, title, body, target_path, source_refs::text refs, media_asset_ids::text[] media, content_hash
  from public.distribution_content_versions where id = $1::uuid`, [A2.version_id])).rows[0];
expectEq("content_hash = node:crypto 명세 재현값", vrow.content_hash, specContentHash({
  contentId: vrow.cid, title: vrow.title, body: vrow.body, targetPath: vrow.target_path, sourceRefsText: vrow.refs, media: vrow.media }));
expectEq("API 반환 content_hash = 저장값", A2.content_hash, vrow.content_hash);
const trow = (await su(`select r.draft_id::text d, r.content_id::text c, dr.channel, r.content_version_id::text v, cv.content_hash ch,
  r.body, r.link_url, r.utm, r.target_connection_id::text conn, r.target_external_account_id ext, r.revision_hash
  from public.distribution_draft_revisions r join public.distribution_channel_drafts dr on dr.id = r.draft_id
  join public.distribution_content_versions cv on cv.id = r.content_version_id where r.id = $1::uuid`, [tr1.revision_id])).rows[0];
expectEq("revision_hash = node:crypto 명세 재현값(미디어 3·utm 2)", trow.revision_hash, specRevisionHash({
  draftId: trow.d, contentId: trow.c, channel: trow.channel, versionId: trow.v, contentHash: trow.ch, body: trow.body,
  link: trow.link_url, utm: trow.utm, conn: trow.conn, ext: trow.ext,
  media: [{ asset_id: ASSET[0], alt_text: "첫 장" }, { asset_id: ASSET[1], variant_id: VARIANT }, { asset_id: ASSET[2] }] }));
// helper를 owner 권한으로 직접 호출(테스트 전용)
const H = async (title, body, path, refs, media) => scalar(
  `select public.distribution_compute_content_hash($1::uuid, $2, $3, $4, $5::jsonb, $6::uuid[])`,
  [A.content_id, title, body, path, refs, media]);
const h0 = await H("t", "b", null, "[]", "{}");
expectEq("같은 입력 → 같은 해시", await H("t", "b", null, "[]", "{}"), h0);
record("target_path NULL vs '' 다른 해시", h0 !== (await H("t", "b", "", "[]", "{}")), "");
record("body 1글자 변경 → 다른 해시", h0 !== (await H("t", "b.", null, "[]", "{}")), "");
record("미디어 순서 변경 → 다른 해시",
  (await H("t", "b", null, "[]", `{${ASSET[0]},${ASSET[1]}}`)) !== (await H("t", "b", null, "[]", `{${ASSET[1]},${ASSET[0]}}`)), "");
record("길이 접두: title='a=1' body='' vs title='a' body='=1' 구분",
  (await H("a=1", "", null, "[]", "{}")) !== (await H("a", "=1", null, "[]", "{}")), "");
expectEq("source_refs 키 순서 무관(jsonb 정규화)", await H("t", "b", null, '[{"b":1,"a":2}]', "{}"), await H("t", "b", null, '[{"a":2,"b":1}]', "{}"));
record("source_refs 1 vs 1.0 다른 해시(명세대로)", (await H("t", "b", null, "[1]", "{}")) !== (await H("t", "b", null, "[1.0]", "{}")), "");
expectEq("recompute_subject_hash(revision) = 저장값", await scalar(
  "select public.distribution_recompute_subject_hash('draft_revision', $1::uuid)", [tr1.revision_id]), trow.revision_hash);

// ---- 6. 승인·반려·철회
group("6. 승인 · 반려 · 철회");
expectErr("checklist 빈 객체로 승인 → CHECKLIST_INCOMPLETE",
  await api.decide(U.admin, "content_version", A2.version_id, "approved", A2.content_hash, "{}"), "23514", "CHECKLIST_INCOMPLETE");
expectErr("checklist false 항목 → CHECKLIST_INCOMPLETE",
  await api.decide(U.admin, "content_version", A2.version_id, "approved", A2.content_hash, '{"facts_checked":false}'), "23514", "CHECKLIST_INCOMPLETE");
expectErr("checklist 값 문자열 → 22023",
  await api.decide(U.admin, "content_version", A2.version_id, "approved", A2.content_hash, '{"facts_checked":"yes"}'), "22023");
expectErr("검토 해시 불일치 → SUBJECT_CHANGED",
  await api.decide(U.admin, "content_version", A2.version_id, "approved", "f".repeat(64)), "P0001", "SUBJECT_CHANGED");
expectErr("대문자 해시 형식 거부", await api.decide(U.admin, "content_version", A2.version_id, "approved", A2.content_hash.toUpperCase()), "22023");
expectErr("이전 버전 v1 승인 → NOT_LATEST",
  await api.decide(U.admin, "content_version", A.version_id, "approved", A.content_hash), "P0001", "NOT_LATEST");
expectErr("decision='revoked' 직접 지정 거부", await api.decide(U.admin, "content_version", A2.version_id, "revoked", A2.content_hash), "22023");
expectErr("반려 사유 없음 거부", await api.decide(U.admin, "content_version", A2.version_id, "rejected", A2.content_hash, "{}", "  "), "22023");
const apC = json(expectOk("원문 v2 승인", await api.decide(U.admin, "content_version", A2.version_id, "approved", A2.content_hash)));
expectErr("원문 v2 재승인 → ALREADY_APPROVED",
  await api.decide(U.admin, "content_version", A2.version_id, "approved", A2.content_hash), "P0001", "ALREADY_APPROVED");
expectErr("이전 리비전 1 승인 → NOT_LATEST",
  await api.decide(U.admin, "draft_revision", r1.revision_id, "approved", r1.revision_hash), "P0001", "NOT_LATEST");
const apR = json(expectOk("blog 리비전 2 승인", await api.decide(U.admin, "draft_revision", r2.revision_id, "approved", r2.revision_hash)));
const eff = (t, id) => scalar("select public.distribution_effective_approval_id($1, $2::uuid)::text", [t, id]);
expectEq("유효 승인(리비전) = 방금 승인", await eff("draft_revision", r2.revision_id), apR.approval_id);
// 같은 트랜잭션 두 번째 결정
const sameTx = await tx("service_role", null, [
  [`select public.distribution_decide_approval($1::uuid, 'draft_revision', $2::uuid, 'rejected', $3, '{}'::jsonb, '반려') r`,
    [U.admin, rNoMedia.revision_id, rNoMedia.revision_hash]],
  [`select public.distribution_decide_approval($1::uuid, 'draft_revision', $2::uuid, 'approved', $3, $4::jsonb) r`,
    [U.admin, rNoMedia.revision_id, rNoMedia.revision_hash, CHECK_OK]],
]);
expectErr("같은 트랜잭션 같은 대상 두 번째 결정 → DECISION_IN_SAME_TRANSACTION", sameTx, "P0001", "DECISION_IN_SAME_TRANSACTION");
expectEq("롤백되어 결정 0건", await scalar("select count(*)::int from public.distribution_approvals where draft_revision_id = $1::uuid",
  [rNoMedia.revision_id]), 0);
// 반려 후 승인, 승인 후 반려 → 유효 승인 변화
expectOk("threads 리비전2 반려", await api.decide(U.admin, "draft_revision", rNoMedia.revision_id, "rejected", rNoMedia.revision_hash, "{}", "톤 수정"));
expectEq("반려 후 유효 승인 없음", await eff("draft_revision", rNoMedia.revision_id), null);
const apT = json(expectOk("반려 뒤(새 트랜잭션) 승인 허용", await api.decide(U.admin, "draft_revision", rNoMedia.revision_id, "approved", rNoMedia.revision_hash)));
expectEq("유효 승인 = 최신 승인", await eff("draft_revision", rNoMedia.revision_id), apT.approval_id);
// 철회
expectErr("철회 사유 없음 거부", await api.revoke(U.admin, apT.approval_id, " "), "22023");
const rv = json(expectOk("승인 철회", await api.revoke(U.admin, apT.approval_id)));
expectEq("철회 후 유효 승인 없음", await eff("draft_revision", rNoMedia.revision_id), null);
expectErr("같은 승인 재철회 → ALREADY_REVOKED", await api.revoke(U.admin, apT.approval_id), "23505", "ALREADY_REVOKED");
expectErr("반려 결정 철회 거부", await api.revoke(U.admin, (await scalar(
  "select id::text from public.distribution_approvals where draft_revision_id = $1::uuid and decision = 'rejected'", [rNoMedia.revision_id]))), "23514");
expectErr("철회 행 철회 거부", await api.revoke(U.admin, rv.approval_id), "23514");
expectErr("없는 승인 철회 → no_data_found", await api.revoke(U.admin, dummy), "P0002");
expectErr("approvals 행 UPDATE(superuser, append-only) 거부",
  await su("update public.distribution_approvals set reason = 'x' where id = $1::uuid", [apC.approval_id]), "23514");
expectErr("approvals DELETE(superuser) 거부",
  await su("delete from public.distribution_approvals where id = $1::uuid", [apC.approval_id]), "23514");
// 승인 후 새 버전 → 기존 승인은 이전 버전에 고정
const A3 = json(expectOk("승인 뒤 원문 v3 추가", await api.appendVersion(U.admin, A.content_id, 2, "버전 원문", "v3 본문")));
expectEq("v3 유효 승인 없음(승인 이동 없음)", await eff("content_version", A3.version_id), null);
expectErr("v3 이후 v2 리비전(blog r2) 승인 시도 → STALE/NOT_LATEST",
  await api.decide(U.admin, "draft_revision", r2.revision_id, "rejected", r2.revision_hash, "{}", "stale"), "P0001", "STALE_CONTENT_VERSION");

// ---- 7. M2 연결 (dry_run create_job · claim 재검사)
group("7. M2 연결 — create_job(dry_run) · 재검사 hold");
const B = json(expectOk("M2용 원문 생성", await api.createContent(U.admin, "M2 원문", "본문")));
const Bd = json(expectOk("M2용 threads 초안", await api.createDraft(U.admin, B.content_id, "threads")));
const Br = json(expectOk("M2용 리비전", await api.appendRevision(U.admin, Bd.draft_id, 0, B.version_id, "스레드")));
expectErr("승인 전 create_job → NOT_APPROVED", await api.createJob(U.admin, Br.revision_id, "dry_run"), "23514", "NOT_APPROVED");
expectOk("원문 승인", await api.decide(U.admin, "content_version", B.version_id, "approved", B.content_hash));
expectErr("리비전 승인 전 create_job → NOT_APPROVED", await api.createJob(U.admin, Br.revision_id, "dry_run"), "23514", "NOT_APPROVED");
expectOk("리비전 승인", await api.decide(U.admin, "draft_revision", Br.revision_id, "approved", Br.revision_hash));
expectErr("live → LIVE_GATE_CLOSED", await api.createJob(U.admin, Br.revision_id, "live"), "0A000", "LIVE_GATE_CLOSED");
expectErr("threads manual → 거부", await api.createJob(U.admin, Br.revision_id, "manual"), "23514");
const job = expectOk("dry_run create_job 허용", await api.createJob(U.admin, Br.revision_id, "dry_run"));
const jobId = job.rows[0]?.r;
expectErr("같은 dry_run 재생성 → DUPLICATE", await api.createJob(U.admin, Br.revision_id, "dry_run"), "23505", "DUPLICATE");
const ev = (await su("select count(*)::int n, min(seq) s from public.distribution_job_events where job_id = $1::uuid", [jobId])).rows[0];
expectEq("job 이벤트 1행(seq=1) 자동 기록", ev, { n: 1, s: 1 });
// 새 원문 버전 → claim 시 stale hold
expectOk("원문 v2 추가(작업 근거 stale화)", await api.appendVersion(U.admin, B.content_id, 1, "M2 원문", "본문 v2"));
const claim = await svc("select * from public.distribution_claim_jobs('verify-worker-1', 5, 60)");
expectOk("claim 실행", claim);
expectEq("stale 작업은 claim되지 않음", claim.rows.filter((r) => r.claimed_job_id === jobId).length, 0);
expectEq("작업 hold_reason = stale", await scalar("select hold_reason from public.distribution_jobs where id = $1::uuid", [jobId]), "stale");
// 승인 철회 → approval_revoked hold
const C = json(await api.createContent(U.admin, "M2 철회", "본문"));
const Cd = json(await api.createDraft(U.admin, C.content_id, "instagram"));
const Cr = json(await api.appendRevision(U.admin, Cd.draft_id, 0, C.version_id, "인스타"));
await api.decide(U.admin, "content_version", C.version_id, "approved", C.content_hash);
const CrAp = json(await api.decide(U.admin, "draft_revision", Cr.revision_id, "approved", Cr.revision_hash));
const job2 = (await api.createJob(U.admin, Cr.revision_id, "dry_run")).rows[0]?.r;
record("철회 시나리오 dry_run 작업 생성", !!job2, "");
expectOk("리비전 승인 철회", await api.revoke(U.admin, CrAp.approval_id));
await svc("select * from public.distribution_claim_jobs('verify-worker-1', 5, 60)");
expectEq("철회 후 hold_reason = approval_revoked", await scalar("select hold_reason from public.distribution_jobs where id = $1::uuid", [job2]),
  "approval_revoked");
// 정상 claim
const D = json(await api.createContent(U.admin, "M2 정상", "본문"));
const Dd = json(await api.createDraft(U.admin, D.content_id, "threads"));
const Dr = json(await api.appendRevision(U.admin, Dd.draft_id, 0, D.version_id, "정상"));
await api.decide(U.admin, "content_version", D.version_id, "approved", D.content_hash);
await api.decide(U.admin, "draft_revision", Dr.revision_id, "approved", Dr.revision_hash);
const job3 = (await api.createJob(U.admin, Dr.revision_id, "dry_run")).rows[0]?.r;
const claim3 = await svc("select * from public.distribution_claim_jobs('verify-worker-1', 5, 60)");
expectEq("근거 정상 작업은 claim됨(attempt 1)", claim3.rows.filter((r) => r.claimed_job_id === job3).map((r) => r.claimed_attempt_no), [1]);

// ---- 8. 보관
group("8. 보관(archive)");
const E = json(await api.createContent(U.admin, "보관 원문", "본문"));
const Ed = json(await api.createDraft(U.admin, E.content_id, "blog"));
const Er = json(await api.appendRevision(U.admin, Ed.draft_id, 0, E.version_id, "블로그"));
const EAp = json(await api.decide(U.admin, "content_version", E.version_id, "approved", E.content_hash));
expectErr("보관 사유 없음 거부", await api.archiveDraft(U.admin, Ed.draft_id, ""), "22023");
expectOk("초안 보관", await api.archiveDraft(U.admin, Ed.draft_id));
expectErr("보관 초안에 리비전 → ARCHIVED", await api.appendRevision(U.admin, Ed.draft_id, 1, E.version_id), "23514", "ARCHIVED");
expectErr("보관 초안 리비전 승인 → ARCHIVED", await api.decide(U.admin, "draft_revision", Er.revision_id, "approved", Er.revision_hash), "23514", "ARCHIVED");
expectErr("초안 재보관 → ALREADY_ARCHIVED", await api.archiveDraft(U.admin, Ed.draft_id), "23514", "ALREADY_ARCHIVED");
expectErr("보관된 같은 채널 새 초안 → DUPLICATE(문서화된 한계)", await api.createDraft(U.admin, E.content_id, "blog"), "23505", "DUPLICATE");
expectOk("원문 보관", await api.archiveContent(U.admin, E.content_id));
expectErr("보관 원문에 새 버전 → ARCHIVED", await api.appendVersion(U.admin, E.content_id, 1), "23514", "ARCHIVED");
expectErr("보관 원문에 새 초안 → ARCHIVED", await api.createDraft(U.admin, E.content_id, "threads"), "23514", "ARCHIVED");
expectErr("보관 원문 버전 반려 → ARCHIVED",
  await api.decide(U.admin, "content_version", E.version_id, "rejected", E.content_hash, "{}", "x"), "23514", "ARCHIVED");
expectErr("원문 재보관 → ALREADY_ARCHIVED", await api.archiveContent(U.admin, E.content_id), "23514", "ALREADY_ARCHIVED");
expectOk("보관 후에도 승인 철회는 허용(fail-safe)", await api.revoke(U.admin, EAp.approval_id));
expectEq("보관 이력 2행(content 1 + draft 1)", await scalar(
  "select count(*)::int from public.distribution_archive_events where content_id = $1::uuid", [E.content_id]), 2);
expectErr("archive_events UPDATE(superuser) 거부",
  await su("update public.distribution_archive_events set reason = 'x' where content_id = $1::uuid", [E.content_id]), "23514");

// ---- 9. 변조 탐지(HASH_INTEGRITY) — superuser가 append-only 트리거를 끄고 저장 내용을 바꾼 상황
group("9. 해시 변조 탐지 (트리거 우회 변조 → HASH_INTEGRITY)");
const F = json(await api.createContent(U.admin, "변조 원문", "원래 본문"));
const Fd = json(await api.createDraft(U.admin, F.content_id, "threads"));
const Fr = json(await api.appendRevision(U.admin, Fd.draft_id, 0, F.version_id, "원래 스레드",
  { media: JSON.stringify([{ asset_id: ASSET[0] }, { asset_id: ASSET[1] }]) }));
await su(`alter table public.distribution_content_versions disable trigger distribution_content_versions_immutable`);
await su(`update public.distribution_content_versions set body = '변조된 본문' where id = $1::uuid`, [F.version_id]);
await su(`alter table public.distribution_content_versions enable trigger distribution_content_versions_immutable`);
expectErr("원문 본문 변조 후 승인 → HASH_INTEGRITY(XX001)",
  await api.decide(U.admin, "content_version", F.version_id, "approved", F.content_hash), "XX001", "HASH_INTEGRITY");
await su(`alter table public.distribution_draft_revisions disable trigger distribution_draft_revisions_immutable`);
await su(`update public.distribution_draft_revisions set utm = '{"utm_source":"evil"}' where id = $1::uuid`, [Fr.revision_id]);
await su(`alter table public.distribution_draft_revisions enable trigger distribution_draft_revisions_immutable`);
expectErr("리비전 utm 변조 후 반려 → HASH_INTEGRITY",
  await api.decide(U.admin, "draft_revision", Fr.revision_id, "rejected", Fr.revision_hash, "{}", "x"), "XX001", "HASH_INTEGRITY");
// 미디어 position 비연속 변조
const G = json(await api.createContent(U.admin, "미디어 변조", "본문"));
const Gd = json(await api.createDraft(U.admin, G.content_id, "instagram"));
const Gr = json(await api.appendRevision(U.admin, Gd.draft_id, 0, G.version_id, "인스타",
  { media: JSON.stringify([{ asset_id: ASSET[0] }, { asset_id: ASSET[1] }]) }));
await su(`alter table public.distribution_draft_revision_media disable trigger distribution_draft_revision_media_immutable`);
await su(`delete from public.distribution_draft_revision_media where revision_id = $1::uuid and position = 1`, [Gr.revision_id]);
await su(`alter table public.distribution_draft_revision_media enable trigger distribution_draft_revision_media_immutable`);
expectErr("미디어 position 1 삭제 변조 → HASH_INTEGRITY",
  await api.decide(U.admin, "draft_revision", Gr.revision_id, "approved", Gr.revision_hash), "XX001", "HASH_INTEGRITY");
expectEq("변조 대상 승인 0건", await scalar(
  "select count(*)::int from public.distribution_approvals where content_version_id = $1::uuid or draft_revision_id in ($2::uuid, $3::uuid)",
  [F.version_id, Fr.revision_id, Gr.revision_id]), 0);
// 미디어 순서 바꿔치기(같은 집합, position 연속 유지) → 재계산 해시 불일치
const Hc = json(await api.createContent(U.admin, "순서 변조", "본문"));
const Hd = json(await api.createDraft(U.admin, Hc.content_id, "instagram"));
const Hr = json(await api.appendRevision(U.admin, Hd.draft_id, 0, Hc.version_id, "인스타",
  { media: JSON.stringify([{ asset_id: ASSET[0] }, { asset_id: ASSET[1] }]) }));
await su(`alter table public.distribution_draft_revision_media disable trigger distribution_draft_revision_media_immutable`);
await su(`update public.distribution_draft_revision_media set asset_id = case position when 1 then $2::uuid else $3::uuid end
  where revision_id = $1::uuid`, [Hr.revision_id, ASSET[1], ASSET[0]]);
await su(`alter table public.distribution_draft_revision_media enable trigger distribution_draft_revision_media_immutable`);
expectErr("미디어 순서 바꿔치기 → HASH_INTEGRITY",
  await api.decide(U.admin, "draft_revision", Hr.revision_id, "approved", Hr.revision_hash), "XX001", "HASH_INTEGRITY");

// 관찰(현재 설계 동작 기록, 결함 판정 아님): 승인이 끝난 뒤 트리거 우회 변조 → create_job/claim은 저장 해시끼리만 비교하므로
// 재계산 없이 통과한다. 변조 탐지는 decide_approval 시점에만 일어난다(결과 보고서 제안 P-1).
const K = json(await api.createContent(U.admin, "승인 후 변조", "본문"));
const Kd = json(await api.createDraft(U.admin, K.content_id, "threads"));
const Kr = json(await api.appendRevision(U.admin, Kd.draft_id, 0, K.version_id, "원래"));
await api.decide(U.admin, "content_version", K.version_id, "approved", K.content_hash);
await api.decide(U.admin, "draft_revision", Kr.revision_id, "approved", Kr.revision_hash);
await su(`alter table public.distribution_draft_revisions disable trigger distribution_draft_revisions_immutable`);
await su(`update public.distribution_draft_revisions set body = '승인 후 변조' where id = $1::uuid`, [Kr.revision_id]);
await su(`alter table public.distribution_draft_revisions enable trigger distribution_draft_revisions_immutable`);
expectOk("관찰: 승인 후 변조된 리비전도 create_job(dry_run) 허용(재계산 없음, 제안 P-1)",
  await api.createJob(U.admin, Kr.revision_id, "dry_run"));

finish();

function finish(forceCode) {
  const failed = results.filter((r) => !r.pass);
  const groups = [...new Set(results.map((r) => r.group))];
  console.log("\n## 요약");
  for (const g of groups) {
    const rs = results.filter((r) => r.group === g);
    console.log(`${rs.every((r) => r.pass) ? "PASS" : "FAIL"}  ${g}: ${rs.filter((r) => r.pass).length}/${rs.length}`);
  }
  console.log(`전체 ${results.length - failed.length}/${results.length} 통과, 실패 ${failed.length}`);
  const code = forceCode ?? (failed.length ? 1 : 0);
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ engine: ver, at: new Date().toISOString(), exitCode: code, results }, null, 2));
  }
  console.log(`exit ${code}`);
  process.exit(code);
}
