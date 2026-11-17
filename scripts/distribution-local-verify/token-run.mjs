#!/usr/bin/env node
/**
 * AUTOPOST-BLOG-TOKEN-005 — 확장 연결 토큰 migration(060000) 로컬 검증 러너(독립).
 * 기존 run.mjs는 수정하지 않는다. 같은 대역(supabase-local-standin.sql)에 M0~M2+050000+060000을 순서대로 적용한다.
 *   node web/scripts/distribution-local-verify/token-run.mjs --pglite-project <dir> [--json <out.json>]
 * 종료 코드: 0 전부 통과 · 1 시나리오 실패 · 2 migration 적용 실패 · 3 PGlite 없음(NOT RUN)
 * 실제 Supabase가 아니다. 비밀값·env·네트워크를 쓰지 않는다. 토큰은 시험용 무작위 값이며 출력하지 않는다.
 */
import { createHash, randomBytes } from "node:crypto";
import { applyStandinAndMigrations, argOf, createHarness, loadPGlite } from "./lib.mjs";

const PGlite = await loadPGlite(argOf("--pglite-project"));
const jsonOut = argOf("--json");
const db = new PGlite();
const h = createHarness(db);
const { group, record, tx, svc, su, scalar, expectOk, expectErr, expectEq, finish } = h;

const U = {
  admin: "00000000-0000-4000-8000-00000000000a", // admin + approved
  admin2: "00000000-0000-4000-8000-00000000000b", // admin + approved (다른 소유자)
  pending: "00000000-0000-4000-8000-0000000000c1",
  suspended: "00000000-0000-4000-8000-0000000000c2",
  member: "00000000-0000-4000-8000-0000000000d1", // approved, 역할 없음
  ghost: "00000000-0000-4000-8000-0000000000ee", // auth.users에 없음
};
const newToken = () => `pat_${randomBytes(32).toString("hex")}`;
const hashOf = (t) => createHash("sha256").update(t).digest("hex");
const ISSUE = "select public.distribution_issue_extension_token($1::uuid, $2, $3, $4) r";
const LIST = "select * from public.distribution_list_extension_tokens($1::uuid)";
const REVOKE = "select public.distribution_revoke_extension_token($1::uuid, $2::uuid) r";
const AUTH = "select * from public.distribution_authenticate_extension_token($1)";
const FUNCS = [
  "public.distribution_issue_extension_token(uuid,text,text,integer)",
  "public.distribution_list_extension_tokens(uuid)",
  "public.distribution_revoke_extension_token(uuid,uuid)",
  "public.distribution_authenticate_extension_token(text)",
];

const ver = await scalar("select version()");
console.log(`# AUTOPOST-BLOG-TOKEN-005 token-run · ${new Date().toISOString()}`);
console.log(`엔진: ${String(ver).split(" on ")[0]} — Supabase 대역이며 실제 Supabase 아님`);

// ---- 0. 적용
group("0. 대역 + M0~M2+050000+060000 적용 (owner = 비superuser supa_owner)");
let applied;
try {
  applied = await applyStandinAndMigrations(db);
} catch (e) {
  record("migration 적용", false, String(e.message).slice(0, 300));
  finish({ ver }, jsonOut, 2);
}
for (const a of applied) record(`적용 ${a.file}`, true, `${a.ms}ms`);
// 000000~060000 필수 prefix 순서를 확인하고, 이후 forward migration(070000·080000 등)은 허용한다.
const REQUIRED_PREFIX = [
  "20261116000000_initial_foundation.sql",
  "20261116010000_private_role_functions.sql",
  "20261116020000_profile_on_signup.sql",
  "20261116030000_distribution_content.sql",
  "20261116040000_distribution_jobs.sql",
  "20261116050000_distribution_content_write_api.sql",
  "20261116060000_distribution_extension_tokens.sql",
];
expectEq("필수 migration 000000~060000이 순서대로 앞에 있음", applied.slice(0, REQUIRED_PREFIX.length).map((a) => a.file), REQUIRED_PREFIX);
record("적용된 migration 목록(후속 forward 포함)", true, applied.map((a) => a.file.slice(0, 14)).join(", "));
expectEq("토큰 테이블 owner", await scalar(
  "select pg_get_userbyid(relowner) from pg_class where oid = 'public.distribution_extension_tokens'::regclass"), "supa_owner");

await su(`insert into auth.users (id) values ${Object.entries(U).filter(([k]) => k !== "ghost").map(([, v]) => `('${v}')`).join(",")}`);
await su(`update public.profiles set approval_status = case id
  when '${U.pending}' then 'pending' when '${U.suspended}' then 'suspended' else 'approved' end`);
await su(`insert into public.role_assignments (user_id, role) values
  ('${U.admin}','admin'),('${U.admin2}','admin'),('${U.pending}','admin'),('${U.suspended}','admin')`);
record("픽스처: 사용자·승인·역할", true, "admin×2 승인, admin pending/suspended, 역할 없는 승인 회원");

// ---- 1. ACL
group("1. ACL — 테이블 직접 접근 차단, 함수는 service_role만, SECURITY DEFINER + 빈 search_path");
for (const role of ["anon", "authenticated", "service_role"]) {
  const p = (await su(`select
      has_table_privilege('${role}', 'public.distribution_extension_tokens', 'SELECT') s,
      has_table_privilege('${role}', 'public.distribution_extension_tokens', 'INSERT') i,
      has_table_privilege('${role}', 'public.distribution_extension_tokens', 'UPDATE') u,
      has_table_privilege('${role}', 'public.distribution_extension_tokens', 'DELETE') d,
      has_column_privilege('${role}', 'public.distribution_extension_tokens', 'token_hash', 'SELECT') hcol`)).rows[0];
  expectEq(`${role}: 테이블 SELECT/INSERT/UPDATE/DELETE·token_hash 열 권한 없음`, p, { s: false, i: false, u: false, d: false, hcol: false });
}
expectEq("RLS 활성", await scalar("select relrowsecurity from pg_class where oid = 'public.distribution_extension_tokens'::regclass"), true);
for (const f of FUNCS) {
  const g = (await su(`select has_function_privilege('anon', '${f}', 'EXECUTE') a,
      has_function_privilege('authenticated', '${f}', 'EXECUTE') au,
      has_function_privilege('service_role', '${f}', 'EXECUTE') s,
      (select bool_or(grantee = 0) from aclexplode(p.proacl)) pub,
      p.prosecdef def, p.proconfig cfg
    from pg_proc p where p.oid = '${f}'::regprocedure`)).rows[0];
  expectEq(`${f.split("(")[0]}: EXECUTE service_role만, PUBLIC 없음, DEFINER, search_path=''`,
    { a: g.a, au: g.au, s: g.s, pub: g.pub ?? false, def: g.def, cfg: g.cfg },
    { a: false, au: false, s: true, pub: false, def: true, cfg: ['search_path=""'] });
}
expectErr("service_role 직접 SELECT 거부", await svc("select count(*) from public.distribution_extension_tokens"), "42501");
expectErr("service_role 직접 INSERT 거부", await svc(
  `insert into public.distribution_extension_tokens (owner_id, label, token_hash, expires_at) values ($1::uuid, 'x', $2, now() + interval '1 day')`,
  [U.admin, hashOf(newToken())]), "42501");
expectErr("authenticated(admin JWT) 직접 SELECT 거부", await tx("authenticated", U.admin,
  [["select token_hash from public.distribution_extension_tokens"]]), "42501");
expectErr("anon 직접 SELECT 거부", await tx("anon", null, [["select 1 from public.distribution_extension_tokens"]]), "42501");
expectErr("authenticated(admin JWT)가 발급 함수 호출 거부", await tx("authenticated", U.admin,
  [[ISSUE, [U.admin, hashOf(newToken()), "x", 30]]]), "42501");
expectErr("anon이 인증 함수 호출 거부", await tx("anon", null, [[AUTH, [hashOf(newToken())]]]), "42501");

// ---- 2. 발급 + D1
group("2. 발급 — D1 actor·입력 검증·상한");
const tA = newToken();
const issued = expectOk("승인 admin 발급", await svc(ISSUE, [U.admin, hashOf(tA), "내 노트북", 90]));
const issuedRow = issued.rows[0]?.r ?? {};
expectEq("발급 응답 키(해시·원문 없음)", Object.keys(issuedRow).sort(), ["created_at", "expires_at", "id", "label"]);
expectEq("발급 응답에 해시 문자열 없음", JSON.stringify(issuedRow).includes(hashOf(tA)), false);
const storedHash = await scalar("select token_hash from public.distribution_extension_tokens where id = $1::uuid", [issuedRow.id]);
expectEq("DB에는 sha256 해시만(원문 아님)", storedHash === hashOf(tA) && storedHash !== tA, true);
expectEq("만료 = 발급 + 90일", await scalar(
  "select (expires_at - created_at) = interval '90 days' from public.distribution_extension_tokens where id = $1::uuid", [issuedRow.id]), true);
for (const [name, actor] of [["admin pending", U.pending], ["admin suspended", U.suspended], ["역할 없는 승인 회원", U.member], ["없는 사용자", U.ghost], ["null", null]]) {
  expectErr(`발급 거부: ${name}`, await svc(ISSUE, [actor, hashOf(newToken()), "x", 30]), "42501");
}
expectEq("거부된 발급은 행을 만들지 않음", Number(await scalar("select count(*) from public.distribution_extension_tokens")), 1);
for (const [name, hash, label, ttl] of [
  ["대문자 해시", hashOf(newToken()).toUpperCase(), "x", 30],
  ["짧은 해시", "abc", "x", 30],
  ["토큰 원문을 해시 자리에", newToken(), "x", 30],
  ["빈 label", hashOf(newToken()), "  ", 30],
  ["61자 label", hashOf(newToken()), "x".repeat(61), 30],
  ["제어문자 label", hashOf(newToken()), "a\nb", 30],
  ["ttl 0", hashOf(newToken()), "x", 0],
  ["ttl 366", hashOf(newToken()), "x", 366],
]) {
  expectErr(`발급 입력 거부: ${name}`, await svc(ISSUE, [U.admin, hash, label, ttl]), "22023");
}
expectErr("같은 해시 재등록 → DUPLICATE", await svc(ISSUE, [U.admin, hashOf(tA), "dup", 30]), "23505", "DUPLICATE");
for (let i = 0; i < 9; i++) await h.must("fill", svc(ISSUE, [U.admin, hashOf(newToken()), `t${i}`, 30]));
expectErr("유효 토큰 10개 상한 → TOKEN_LIMIT", await svc(ISSUE, [U.admin, hashOf(newToken()), "11번째", 30]), "23514", "TOKEN_LIMIT");

// ---- 3. 목록 — 소유자만, 해시 없음
group("3. 목록 — actor 소유만, 해시 열 없음");
const tB = newToken();
const b = await svc(ISSUE, [U.admin2, hashOf(tB), "다른 관리자", 30]);
const tokenB = b.rows[0]?.r?.id;
const listA = expectOk("admin 목록", await svc(LIST, [U.admin]));
expectEq("admin 목록 = 자기 토큰 10개", listA.rows.length, 10);
expectEq("다른 소유자 토큰 미포함", listA.rows.some((r) => r.id === tokenB), false);
expectEq("목록 열(해시 없음)", Object.keys(listA.rows[0] ?? {}).sort(), ["created_at", "expires_at", "id", "label", "last_used_at", "revoked_at"]);
expectErr("비승인 actor 목록 거부", await svc(LIST, [U.suspended]), "42501");

// ---- 4. 인증
group("4. 인증 — 해시 조회, 철회·만료·D1 매번 확인, 실패 사유 비구분");
const authA = expectOk("유효 토큰 인증", await svc(AUTH, [hashOf(tA)]));
expectEq("인증 결과 = 소유자·토큰 ID만", authA.rows, [{ user_id: U.admin, token_id: issuedRow.id }]);
expectEq("last_used_at 기록", await scalar(
  "select last_used_at is not null from public.distribution_extension_tokens where id = $1::uuid", [issuedRow.id]), true);
expectEq("모르는 해시 → 0행", (await svc(AUTH, [hashOf(newToken())])).rows.length, 0);
expectEq("원문 토큰을 넘기면 → 0행", (await svc(AUTH, [tA])).rows.length, 0);
expectEq("null → 0행", (await svc(AUTH, [null])).rows.length, 0);
await su(`update public.profiles set approval_status = 'suspended' where id = '${U.admin}'`);
expectEq("소유자 정지 → 0행(즉시)", (await svc(AUTH, [hashOf(tA)])).rows.length, 0);
await su(`update public.profiles set approval_status = 'approved' where id = '${U.admin}'`);
expectEq("재승인 → 다시 인증", (await svc(AUTH, [hashOf(tA)])).rows.length, 1);
await su(`delete from public.role_assignments where user_id = '${U.admin2}' and role = 'admin'`);
expectEq("소유자 admin 역할 회수 → 0행", (await svc(AUTH, [hashOf(tB)])).rows.length, 0);
await su(`insert into public.role_assignments (user_id, role) values ('${U.admin2}', 'admin')`);
await su(`update public.distribution_extension_tokens
  set created_at = now() - interval '40 days', expires_at = now() - interval '1 second' where id = '${issuedRow.id}'`);
expectEq("만료 → 0행", (await svc(AUTH, [hashOf(tA)])).rows.length, 0);
await su(`update public.distribution_extension_tokens set expires_at = now() + interval '1 day' where id = '${issuedRow.id}'`);
expectEq("만료 해제(대역 조작) → 다시 인증", (await svc(AUTH, [hashOf(tA)])).rows.length, 1);

// ---- 5. 철회
group("5. 철회 — 소유자만, 철회 즉시 인증 불가");
expectErr("다른 소유자 토큰 철회 → 없음(P0002)", await svc(REVOKE, [U.admin, tokenB]), "P0002");
expectEq("다른 소유자 토큰은 그대로 유효", (await svc(AUTH, [hashOf(tB)])).rows.length, 1);
expectErr("비승인 actor 철회 거부", await svc(REVOKE, [U.pending, issuedRow.id]), "42501");
const rev = expectOk("자기 토큰 철회", await svc(REVOKE, [U.admin, issuedRow.id]));
expectEq("철회 응답 키", Object.keys(rev.rows[0]?.r ?? {}).sort(), ["id", "revoked_at"]);
expectEq("철회 기록(revoked_by = actor)", await scalar(
  "select revoked_by::text from public.distribution_extension_tokens where id = $1::uuid", [issuedRow.id]), U.admin);
expectEq("철회 후 인증 → 0행", (await svc(AUTH, [hashOf(tA)])).rows.length, 0);
expectErr("두 번 철회 → ALREADY_REVOKED", await svc(REVOKE, [U.admin, issuedRow.id]), "23505", "ALREADY_REVOKED");
expectOk("철회로 상한 여유가 생기면 다시 발급", await svc(ISSUE, [U.admin, hashOf(newToken()), "새 토큰", 30]));
expectErr("철회 표시 직접 해제 시도(service_role UPDATE) 거부", await svc(
  "update public.distribution_extension_tokens set revoked_at = null, revoked_by = null where id = $1::uuid", [issuedRow.id]), "42501");

finish({ ver }, jsonOut);
