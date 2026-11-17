#!/usr/bin/env node
/**
 * AUTOPOST-M2-FIX-006 — 070000 migration의 D-1 사전 점검(기존 accepted 증거 canonical 중복 시 명시 실패) 독립 검증.
 *
 * 흐름(일회성 PGlite + Supabase 대역, 실제 Supabase 아님):
 *   1) 대역 + 070000 이전 migration 전부 적용(000000~060000)
 *   2) 수정 전 동작(D-1)으로 호스트 대소문자만 다른 같은 URL을 두 작업에 accepted로 만든다
 *   3) 070000 적용 → D1_CANONICAL_URL_DUPLICATES(23505)로 실패해야 하고, 증거·인덱스·함수 정의가 전부 그대로여야 한다
 *   4) 운영 절차(distribution_correct_evidence)로 중복을 정리한 뒤 070000 재적용 → 성공, canonical 경계 활성
 *   node web/scripts/distribution-local-verify/fix006-precheck-run.mjs --pglite-project <dir> [--json <out.json>]
 * 종료 코드: 0 전부 일치 · 1 불일치 · 2 기반 migration 적용 실패 · 3 PGlite 없음
 * lib.mjs는 수정하지 않고 export만 사용한다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { argOf, createHarness, errInfo, HERE, loadPGlite, MIGRATIONS_DIR } from "./lib.mjs";

const FIX = "20261116070000_distribution_evidence_recovery_fix.sql";
const PGlite = await loadPGlite(argOf("--pglite-project"));
const jsonOut = argOf("--json");
const db = await PGlite.create();
const H = createHarness(db);
const { group, record, svc, su, scalar, must, expectOk, expectErr, expectEq } = H;
const engine = (await db.query("select version() v")).rows[0].v.split(" on ")[0];
console.log(`# AUTOPOST-M2-FIX-006 precheck · ${new Date().toISOString()} · ${engine} (Supabase 대역, 실제 Supabase 아님)`);

async function applyFile(f) {
  try {
    await db.exec(`set role supa_owner;\n${readFileSync(join(MIGRATIONS_DIR, f), "utf8")}\n;reset role;`);
    return { ok: true };
  } catch (e) {
    try { await db.exec("rollback; reset role;"); } catch { /* ignore */ }
    return { ok: false, ...errInfo(e) };
  }
}

group("1. 070000 이전 migration 적용");
await db.exec(readFileSync(join(HERE, "supabase-local-standin.sql"), "utf8"));
const base = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f < FIX).sort();
for (const f of base) {
  const r = await applyFile(f);
  record(`적용 ${f}`, r.ok, r.ok ? "" : `${r.code} ${r.message?.slice(0, 200)}`);
  if (!r.ok) H.finish(engine, jsonOut, 2);
}
const fixExists = readdirSync(MIGRATIONS_DIR).includes(FIX);
record(`${FIX} 존재`, fixExists, "");

const A = "00000000-0000-4000-8000-00000000000a";
await su(`insert into auth.users (id) values ('${A}')`);
await su(`update public.profiles set approval_status = 'approved'`);
await su(`insert into public.role_assignments (user_id, role) values ('${A}', 'admin')`);
const j1 = (r) => (r.ok ? r.rows[0]?.r : undefined);
let n = 0;
async function manualAwaiting() {
  const c = j1(await must("content", svc(`select public.distribution_create_content($1::uuid, $2, '본문') r`, [A, `원문 ${++n}`])));
  const d = j1(await must("draft", svc(`select public.distribution_create_channel_draft($1::uuid, $2::uuid, 'blog') r`, [A, c.content_id])));
  const r = j1(await must("rev", svc(`select public.distribution_append_draft_revision(p_actor_id => $1::uuid, p_draft_id => $2::uuid,
      p_expected_revision_no => 0, p_expected_content_version_id => $3::uuid, p_body => 'b') r`, [A, d.draft_id, c.version_id])));
  await must("ac", svc(`select public.distribution_decide_approval($1::uuid, 'content_version', $2::uuid, 'approved', $3, '{"ok":true}'::jsonb) r`, [A, c.version_id, c.content_hash]));
  await must("ar", svc(`select public.distribution_decide_approval($1::uuid, 'draft_revision', $2::uuid, 'approved', $3, '{"ok":true}'::jsonb) r`, [A, r.revision_id, r.revision_hash]));
  const job = j1(await must("job", svc(`select public.distribution_create_job($1::uuid, $2::uuid, 'manual') r`, [A, r.revision_id])));
  await must("posted", svc(`select public.distribution_mark_manual_posted($1::uuid, $2::uuid, 1) r`, [A, job]));
  return job;
}
const ev = (job, url) => svc(`select public.distribution_record_manual_evidence($1::uuid, $2::uuid, 2, null, $3, null, now() - interval '1 minute', null) r`, [A, job, url]);

group("2. 수정 전(D-1) 상태에서 canonical 중복 accepted 생성");
const J1 = await manualAwaiting();
const J2 = await manualAwaiting();
expectOk("작업 1: https://blog.naver.com/u/1", await ev(J1, "https://blog.naver.com/u/1"));
expectOk("작업 2: https://BLOG.naver.com/u/1 (수정 전에는 수락됨 = D-1)", await ev(J2, "https://BLOG.naver.com/u/1"));
const evSnap = async () => (await su(`select id::text, job_id::text, status, external_url from public.distribution_publication_evidence order by id`)).rows;
const idxSnap = async () => (await su(`select string_agg(indexname, ',' order by indexname) n from pg_indexes
  where tablename = 'distribution_publication_evidence' and indexname like '%accepted_url%'`)).rows[0].n;
const fnSnap = async () => (await su(`select md5(prosrc) from pg_proc where proname in ('distribution_recover_expired_leases', 'distribution_evidence_conflicts') order by proname`)).rows;
const before = { ev: await evSnap(), idx: await idxSnap(), fn: await fnSnap() };

group("3. 070000 적용 → 사전 점검 명시 실패 · 데이터/정의 무변경");
const r1 = await applyFile(FIX);
record("070000 적용 실패: D1_CANONICAL_URL_DUPLICATES (23505)",
  !r1.ok && r1.code === "23505" && (r1.message ?? "").startsWith("D1_CANONICAL_URL_DUPLICATES:"), `${H.fmt(r1)} ${(r1.message ?? "").slice(0, 90)}`);
record("오류 메시지에 건수만, 증거 원문 URL 없음", !/naver\.com\/u\/1/.test(r1.message ?? ""), (r1.message ?? "").slice(0, 120));
expectEq("증거 행(상태·원문 URL) 그대로 — 자동 삭제·재배정·정규화 없음", await evSnap(), before.ev);
expectEq("기존 raw UNIQUE 인덱스 유지, canonical 인덱스 미생성", await idxSnap(), before.idx);
expectEq("recover/conflicts 함수 정의 그대로(부분 적용 없음)", await fnSnap(), before.fn);
expectEq("canonical helper 미생성(같은 트랜잭션 롤백)", await scalar(`select count(*)::int from pg_proc where proname = 'distribution_canonical_url'`), 0);

group("4. 운영 정리(정정) 후 재적용 → 성공");
expectOk("작업 2 증거를 실제 다른 글 URL로 정정(distribution_correct_evidence)",
  await svc(`select public.distribution_correct_evidence($1::uuid, $2::uuid, 3, null, 'https://blog.naver.com/u/2', null, now() - interval '1 minute', '중복 정리') r`, [A, J2]));
const r2 = await applyFile(FIX);
record("070000 재적용 성공", r2.ok, r2.ok ? "" : `${r2.code} ${r2.message?.slice(0, 200)}`);
expectEq("canonical UNIQUE 인덱스로 교체", await idxSnap(), "distribution_publication_evidence_accepted_url_canonical_unique");
expectEq("정정 이력 보존(이전 증거 superseded 원문 그대로)", (await su(`select status, external_url from public.distribution_publication_evidence
  where job_id = $1::uuid order by created_at, id`, [J2])).rows.map((x) => [x.status, x.external_url]),
  [["superseded", "https://BLOG.naver.com/u/1"], ["accepted", "https://blog.naver.com/u/2"]]);
const J3 = await manualAwaiting();
expectErr("적용 후 대문자 호스트 같은 URL → EVIDENCE_CONFLICT", await ev(J3, "https://Blog.Naver.Com/u/1"), "23505", "EVIDENCE_CONFLICT");

H.finish(engine, jsonOut);
