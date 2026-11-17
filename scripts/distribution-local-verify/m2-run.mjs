#!/usr/bin/env node
/**
 * AUTOPOST-M2-VERIFY-003 — M2(20261116040000_distribution_jobs.sql) 나머지 상태 전이 로컬 실행 검증.
 *
 * 대상: 일회성 인메모리 PGlite + Supabase 최소 대역(supabase-local-standin.sql). 실제 Supabase 아님. 단일 연결.
 *   node web/scripts/distribution-local-verify/m2-run.mjs --pglite-project <dir> [--json <out.json>]
 * 종료 코드: 0 기대 동작 전부 일치 · 1 기대와 다른 동작 존재 · 2 migration 적용 실패 · 3 PGlite 없음(NOT RUN)
 *
 * 시험 전용 대역 조작(SQL 파일은 바꾸지 않는다. 이 일회성 DB 안에서만):
 *   * 그룹 5 이후 live 경로를 실행하려고 public.distribution_live_gate(uuid)를 `select true`로 CREATE OR REPLACE한다.
 *     실제 migration의 게이트는 항상 false(fail closed)이며, 그 동작은 그룹 0 대조군과 run.mjs가 확인한다.
 *   * 리스 만료는 실제 시간 경과(lease 10초 + 대기)로 만든다. 시간을 조작하지 않는다.
 *
 * "결함 재현" 항목은 기대 동작과 다른 실제 동작을 재현한 것이다. 통과/실패와 따로 집계한다(종료 코드에 반영하지 않음).
 * AUTOPOST-M2-FIX-006: D-1/D-2/D-2b는 070000 migration으로 수정됐다. 해당 항목은 이제 "재현"이 아니라
 *   수정 후 기대 동작(대소문자 호스트 거부·경로 구분·dry_run 만료 회수·작업별 격리)이 성공해야 통과다.
 */
import { argOf, applyStandinAndMigrations, createHarness, loadPGlite } from "./lib.mjs";

const PGlite = await loadPGlite(argOf("--pglite-project"));
const jsonOut = argOf("--json");
const db = await PGlite.create();
const H = createHarness(db);
const { group, record, tx, svc, su, scalar, must, expectOk, expectErr, expectEq } = H;
const engine = (await db.query("select version() v")).rows[0].v.split(" on ")[0];
console.log(`# AUTOPOST-M2-VERIFY-003 · ${new Date().toISOString()}`);
console.log(`엔진: ${engine} (인메모리, 단일 연결) — Supabase 대역이며 실제 Supabase 아님`);

const defects = [];
function defect(name, reproduced, detail) {
  defects.push({ name, reproduced, detail });
  console.log(`${reproduced ? "DEFECT-REPRODUCED" : "DEFECT-NOT-REPRODUCED"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- setup
group("0. 대역 + migration 적용 · 픽스처 · M2 ACL · live 게이트 대조군");
try {
  const applied = await applyStandinAndMigrations(db);
  const M2_BASE = ["000000", "010000", "020000", "030000", "040000", "050000"];
  record(`대역 + migration ${applied.length}개 순차 적용(owner supa_owner, M0~050000 포함)`,
    M2_BASE.every((p, i) => applied[i]?.file.slice(8, 14) === p),
    applied.map((a) => `${a.file.slice(8, 14)}:${a.ms}ms`).join(" "));
} catch (e) {
  record("대역 + migration 적용", false, e.message.slice(0, 300));
  H.finish(engine, jsonOut, 2);
}
const U = {
  admin: "00000000-0000-4000-8000-00000000000a",
  admin3: "00000000-0000-4000-8000-00000000000c",
  suspended: "00000000-0000-4000-8000-0000000000c2",
  member: "00000000-0000-4000-8000-0000000000d1",
};
await su(`insert into auth.users (id) values ('${U.admin}'),('${U.admin3}'),('${U.suspended}'),('${U.member}')`);
await su(`update public.profiles set approval_status = case when id = '${U.suspended}' then 'suspended' else 'approved' end`);
await su(`insert into public.role_assignments (user_id, role) values ('${U.admin}','admin'),('${U.admin3}','admin'),('${U.suspended}','admin')`);

// M2 + 050000 SECURITY DEFINER API 전부: service_role만 EXECUTE
const defs = (await su(`select p.oid::regprocedure::text sig,
    has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u,
    has_function_privilege('service_role', p.oid, 'EXECUTE') s,
    coalesce(array_to_string(p.proacl, ','), '<default>') acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'distribution\\_%' and p.prosecdef order by 1`)).rows;
// 다른 작업 소유 migration(060000 토큰·080000 handoff)의 함수는 이 검증 범위에서 분리한다(별도 러너 담당).
const OTHER_SCOPE = /^distribution_(extension_token|handoff)/;
const mine = defs.filter((d) => !OTHER_SCOPE.test(d.sig));
const badDefs = mine.filter((d) => d.a || d.u || !d.s || /(^|,)=X/.test(d.acl));
record(`SECURITY DEFINER distribution API(M2·050000·070000 범위) ${mine.length}개: service_role만 EXECUTE`, mine.length >= 25 && badDefs.length === 0,
  badDefs.length ? badDefs.map((d) => d.sig).join("; ") : "");
{
  const other = defs.filter((d) => OTHER_SCOPE.test(d.sig));
  record(`참고: 범위 밖 DEFINER 함수 ${other.length}개 — anon/authenticated EXECUTE 없음`, other.every((d) => !d.a && !d.u && !/(^|,)=X/.test(d.acl)),
    other.filter((d) => !d.s).map((d) => d.sig).join("; ") ? `service_role도 없음(owner 전용): ${other.filter((d) => !d.s).map((d) => d.sig.split("(")[0]).join(",")}` : "");
}
const execRows = (await su(`select p.proname, p.prorettype = 'trigger'::regtype trig,
    has_function_privilege('service_role', p.oid, 'EXECUTE') s,
    has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') c
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'distribution\\_%' and not p.prosecdef`)).rows;
expectEq("비DEFINER helper(트리거 제외): anon/authenticated/service_role EXECUTE 0개",
  execRows.filter((r) => !r.trig && (r.s || r.c)).map((r) => r.proname), []);
expectEq("트리거 함수: anon/authenticated EXECUTE 0개", execRows.filter((r) => r.trig && r.c).map((r) => r.proname), []);
{
  const svcTrig = execRows.filter((r) => r.trig && r.s).map((r) => r.proname).sort();
  // 관찰 O-1: M1(030000) 트리거 함수 9개는 service_role EXECUTE를 회수하지 않았다(M2는 회수). 트리거 함수는 직접 호출이 불가하므로 실해는 없다.
  record(`관찰 O-1: service_role EXECUTE가 남은 트리거 함수 ${svcTrig.length}개(M1 030000, 직접 호출 불가)`, true, svcTrig.join(","));
  expectErr("O-1 확인: service_role이 트리거 함수를 직접 호출하면 거부(0A000)",
    await svc(`select public.distribution_reject_mutation()`), "0A000");
}
expectEq("070000 교체 함수: 시그니처·반환·search_path·SECURITY 속성 유지",
  (await su(`select p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_function_result(p.oid) res,
      p.prosecdef def, array_to_string(p.proconfig, ',') cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('distribution_recover_expired_leases', 'distribution_evidence_conflicts') order by 1`)).rows,
  [{ proname: "distribution_evidence_conflicts", args: "p_job_id uuid, p_channel text, p_external_account_id text, p_external_post_id text, p_external_url text",
     res: "boolean", def: false, cfg: "search_path=\"\"" },
   { proname: "distribution_recover_expired_leases", args: "p_limit integer", res: "TABLE(recovered_job_id uuid, recovered_status text)",
     def: true, cfg: "search_path=\"\"" }]);
for (const t of ["distribution_jobs","distribution_job_attempts", "distribution_publication_evidence", "distribution_reconciliations", "distribution_job_events"]) {
  const p = (await su(`select has_table_privilege('service_role', 'public.${t}', 'INSERT') i, has_table_privilege('service_role', 'public.${t}', 'UPDATE') u,
    has_table_privilege('service_role', 'public.${t}', 'SELECT') s`)).rows[0];
  expectEq(`service_role ${t}: SELECT만`, p, { i: false, u: false, s: true });
}

// ---------------------------------------------------------------- API wrappers
const j1 = (r) => (r.ok ? r.rows[0]?.r : undefined);
const api = {
  createContent: (title) => svc(`select public.distribution_create_content($1::uuid, $2, '본문') r`, [U.admin, title]),
  appendVersion: (cid, exp) => svc(`select public.distribution_append_content_version($1::uuid, $2::uuid, $3, '제목', '새 본문') r`, [U.admin, cid, exp]),
  createDraft: (cid, ch) => svc(`select public.distribution_create_channel_draft($1::uuid, $2::uuid, $3) r`, [U.admin, cid, ch]),
  appendRevision: (did, exp, vid) => svc(`select public.distribution_append_draft_revision(p_actor_id => $1::uuid, p_draft_id => $2::uuid,
      p_expected_revision_no => $3, p_expected_content_version_id => $4::uuid, p_body => '채널 본문') r`, [U.admin, did, exp, vid]),
  decide: (type, id, hash) => svc(`select public.distribution_decide_approval($1::uuid, $2, $3::uuid, 'approved', $4, '{"ok":true}'::jsonb) r`,
    [U.admin, type, id, hash]),
  revoke: (aid) => svc(`select public.distribution_revoke_approval($1::uuid, $2::uuid, '철회') r`, [U.admin, aid]),
  createJob: (actor, rev, mode, o = {}) => svc(`select public.distribution_create_job($1::uuid, $2::uuid, $3, $4::timestamptz, null, $5, $6) r`,
    [actor, rev, mode, o.at ?? null, o.max ?? 3, o.republish ?? false]),
  claim: (worker, limit = 1, lease = 60) => svc(`select * from public.distribution_claim_jobs($1, $2, $3)`, [worker, limit, lease]),
  advance: (job, att, worker, phase, cont = null, status = null, lease = 60) =>
    svc(`select public.distribution_advance_phase($1::uuid, $2::uuid, $3, $4, $5, $6, $7) r`, [job, att, worker, phase, cont, status, lease]),
  complete: (job, att, worker, outcome, o = {}) => svc(`select public.distribution_complete_attempt($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::jsonb, $11) r`,
    [job, att, worker, outcome, o.error ? JSON.stringify(o.error) : null, o.policy ?? null, o.post ?? null, o.url ?? null, o.account ?? null,
      JSON.stringify(o.issues ?? []), o.summary ?? null]),
  recover: (limit = 20) => svc(`select * from public.distribution_recover_expired_leases($1)`, [limit]),
  requeue: (job) => svc(`select public.distribution_requeue_auto_retry($1::uuid) r`, [job]),
  cancel: (actor, job, ver) => svc(`select public.distribution_cancel_job($1::uuid, $2::uuid, $3, '취소') r`, [actor, job, ver]),
  reschedule: (actor, job, ver, at) => svc(`select public.distribution_reschedule_job($1::uuid, $2::uuid, $3, $4::timestamptz) r`, [actor, job, ver, at]),
  posted: (actor, job, ver) => svc(`select public.distribution_mark_manual_posted($1::uuid, $2::uuid, $3) r`, [actor, job, ver]),
  manualEv: (actor, job, ver, o = {}) => svc(`select public.distribution_record_manual_evidence($1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8) r`,
    [actor, job, ver, o.post ?? null, o.url ?? null, o.account ?? null, o.observed ?? past(), o.note ?? null]),
  abandon: (actor, job, ver, reason, ack) => svc(`select public.distribution_abandon_manual_job($1::uuid, $2::uuid, $3, $4, $5) r`, [actor, job, ver, reason, ack]),
  uncertain: (actor, job, ver, reason) => svc(`select public.distribution_mark_manual_uncertain($1::uuid, $2::uuid, $3, $4) r`, [actor, job, ver, reason]),
  recon: (kind, actor, job, ver, method, finding, o = {}) => svc(`select public.distribution_record_reconciliation(
      p_actor_kind => $1, p_actor_id => $2::uuid, p_job_id => $3::uuid, p_expected_version => $4, p_method => $5, p_finding => $6,
      p_checked_scope => $7::jsonb, p_observed_at => $8::timestamptz, p_observation => $9, p_attempt_no => $10,
      p_external_post_id => $11, p_external_url => $12, p_external_account_id => $13) r`,
    [kind, actor, job, ver, method, finding, JSON.stringify(o.scope ?? {}), o.observed ?? past(), o.observation ?? null, o.attempt ?? null,
      o.post ?? null, o.url ?? null, o.account ?? null]),
  rerun: (actor, job, ver, recId = null) => svc(`select public.distribution_approve_rerun($1::uuid, $2::uuid, $3, '재실행 승인', $4::uuid) r`, [actor, job, ver, recId]),
  late: (job, o = {}) => svc(`select public.distribution_record_late_evidence($1::uuid, $2, $3, $4, $5::timestamptz, $6, $7, $8::jsonb) r`,
    [job, o.post ?? null, o.url ?? null, o.account ?? null, o.observed ?? past(), o.note ?? null, o.attempt ?? null, JSON.stringify(o.issues ?? [])]),
  resolve: (actor, job, ver, ev, decision, reason = "검토") => svc(`select public.distribution_resolve_evidence($1::uuid, $2::uuid, $3, $4::uuid, $5, $6) r`,
    [actor, job, ver, ev, decision, reason]),
  correct: (actor, job, ver, o = {}) => svc(`select public.distribution_correct_evidence($1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8, $9) r`,
    [actor, job, ver, o.post ?? null, o.url ?? null, o.account ?? null, o.observed ?? past(), o.reason ?? null, o.note ?? null]),
};
function past(sec = 60) { return new Date(Date.now() - sec * 1000).toISOString(); }
const SCOPE = { account: "acct-main", period: "2026-11-16T00:00Z/2026-11-17T00:00Z" };

let seq = 0;
/** 승인된 원문 버전 + 승인된 채널 리비전 */
async function approvedRev(channel) {
  const c = j1(await must("content", api.createContent(`M2 원문 ${++seq}`)));
  const d = j1(await must("draft", api.createDraft(c.content_id, channel)));
  const r = j1(await must("revision", api.appendRevision(d.draft_id, 0, c.version_id)));
  await must("approve content", api.decide("content_version", c.version_id, c.content_hash));
  const ra = j1(await must("approve revision", api.decide("draft_revision", r.revision_id, r.revision_hash)));
  return { content: c.content_id, versionId: c.version_id, draft: d.draft_id, rev: r.revision_id, revApproval: ra.approval_id };
}
async function job(id) {
  return (await su(`select status, phase, version, hold_reason, retry_policy, attempts, reconciliation_required rr,
      external_id, external_url, accepted_evidence_id::text ev, has_issues, last_error ->> 'code' err, last_reconciliation_id::text rec,
      lease_owner, cancel_requested_at is not null cancel_req
    from public.distribution_jobs where id = $1::uuid`, [id])).rows[0];
}
async function snap(id) {
  const j = await job(id);
  const extra = (await su(`select (select count(*)::int from public.distribution_job_events where job_id = $1::uuid) ev_n,
      (select count(*)::int from public.distribution_publication_evidence where job_id = $1::uuid) evid_n,
      (select count(*)::int from public.distribution_reconciliations where job_id = $1::uuid) rec_n,
      (select coalesce(jsonb_agg(jsonb_build_object('n', attempt_no, 'p', phase_reached, 'c', provider_container_id, 'o', outcome,
         'pr', publish_requested_at is not null) order by attempt_no), '[]') from public.distribution_job_attempts where job_id = $1::uuid) atts`, [id])).rows[0];
  return { ...j, ...extra };
}
async function unchanged(name, id, before) { expectEq(`${name} → 롤백(작업·이벤트·증거·대사·시도 불변)`, await snap(id), before); }
async function createOk(label, rev, mode, o) {
  const r = await api.createJob(U.admin, rev, mode, o);
  expectOk(label, r);
  return j1(r);
}
/** 방금 만든 작업 하나만 claim(다른 due 작업이 없어야 함) */
async function claimMine(label, jobId, worker = "w1", lease = 60) {
  const r = await api.claim(worker, 1, lease);
  const row = r.ok ? r.rows.find((x) => x.claimed_job_id === jobId) : undefined;
  record(label, !!row && r.rows.length === 1, `${H.fmt(r)} attempt=${row?.claimed_attempt_no} resumed=${row?.resumed}`);
  return row ? { att: row.claimed_attempt_id, no: row.claimed_attempt_no } : {};
}
async function drive(jobId, att, worker, phases) {
  for (const [p, c, s, lease] of phases) await must(`advance ${p}`, api.advance(jobId, att, worker, p, c ?? null, s ?? null, lease ?? 60));
}
const LIVE_TO_READY = (cid) => [["container_requested"], ["container_created", cid], ["ready", null, "FINISHED"]];

// live 게이트 대조군 → 시험 전용 override
{
  const g = await approvedRev("threads");
  expectErr("대조군: 원래 live 게이트는 닫힘(LIVE_GATE_CLOSED)", await api.createJob(U.admin, g.rev, "live"), "0A000", "LIVE_GATE_CLOSED");
  await db.exec(`set role supa_owner;
    create or replace function public.distribution_live_gate(p_draft_revision_id uuid) returns boolean
      language sql stable set search_path = '' as $$ select true $$;
    reset role;`);
  record("시험 전용: live 게이트 override(select true) — 이 일회성 DB 안에서만", true, "SQL 파일 변경 없음");
  await su(`select 1`);
}

// ================================================================ 1. Blog 수동 게시
group("1. Blog manual: manual_ready → awaiting_evidence → 증거 수락 published · URL 허용 · 외부 ID 근거 · 충돌 · 정정");
const b1 = await approvedRev("blog");
expectErr("blog live 생성 거부(채널 정책)", await api.createJob(U.admin, b1.rev, "live"), "23514");
const m1 = await createOk("blog manual 작업 생성", b1.rev, "manual");
expectEq("초기 상태 manual_ready/none/v1", await job(m1).then((j) => [j.status, j.phase, j.version]), ["manual_ready", "none", 1]);
let s0 = await snap(m1);
expectErr("정지 admin: 게시 마침 선언 거부", await api.posted(U.suspended, m1, 1), "42501");
expectErr("역할 없는 회원: 게시 마침 선언 거부", await api.posted(U.member, m1, 1), "42501");
expectErr("expected_version 불일치 → VERSION_CONFLICT", await api.posted(U.admin, m1, 9), "P0001", "VERSION_CONFLICT");
expectErr("expected_version null 거부", await api.posted(U.admin, m1, null), "22023");
expectErr("manual_ready에서 증거 기록 → INVALID_TRANSITION", await api.manualEv(U.admin, m1, 1, { url: "https://blog.naver.com/u/1001" }), "23514", "INVALID_TRANSITION");
expectErr("manual_ready에서 불확실 선언 → INVALID_TRANSITION", await api.uncertain(U.admin, m1, 1, "모름"), "23514", "INVALID_TRANSITION");
expectEq("manual 작업은 claim 대상 아님", (await api.claim("w1")).rows.filter((r) => r.claimed_job_id === m1).length, 0);
await unchanged("거부된 호출 6건 + claim", m1, s0);
expectOk("게시 마침 선언(v1)", await api.posted(U.admin, m1, 1));
expectEq("awaiting_evidence/v2", await job(m1).then((j) => [j.status, j.version]), ["awaiting_evidence", 2]);
expectErr("다시 선언 → INVALID_TRANSITION", await api.posted(U.admin, m1, 2), "23514", "INVALID_TRANSITION");
s0 = await snap(m1);
expectErr("URL 호스트 example.com 거부", await api.manualEv(U.admin, m1, 2, { url: "https://example.com/p/1" }), "23514");
expectErr("호스트 위장 blog.naver.com.evil.com 거부", await api.manualEv(U.admin, m1, 2, { url: "https://blog.naver.com.evil.com/p" }), "23514");
expectErr("http URL 거부(형식 check)", await api.manualEv(U.admin, m1, 2, { url: "http://blog.naver.com/u/1" }), "23514");
expectErr("userinfo URL 거부", await api.manualEv(U.admin, m1, 2, { url: "https://x@blog.naver.com/u/1" }), "23514");
expectErr("외부 ID만 + 방법 메모 없음 거부", await api.manualEv(U.admin, m1, 2, { post: "post-1001" }), "23514");
expectErr("ID·URL 모두 없음 거부", await api.manualEv(U.admin, m1, 2, { note: "메모만" }), "23514");
expectErr("observed_at 미래(+1h) 거부", await api.manualEv(U.admin, m1, 2, { url: "https://blog.naver.com/u/1001", observed: past(-3600) }), "23514");
expectErr("정지 admin 증거 기록 거부", await api.manualEv(U.suspended, m1, 2, { url: "https://blog.naver.com/u/1001" }), "42501");
expectErr("stale expected_version(1) 거부", await api.manualEv(U.admin, m1, 1, { url: "https://blog.naver.com/u/1001" }), "P0001", "VERSION_CONFLICT");
await unchanged("거부된 증거 기록 9건", m1, s0);
const ev1 = j1(expectOk("허용 URL 증거 수락", await api.manualEv(U.admin, m1, 2, { url: "https://blog.naver.com/u/1001" })));
let jj = await job(m1);
expectEq("published/none/v3 + 캐시=증거", [jj.status, jj.phase, jj.version, jj.external_url, jj.ev], ["published", "none", 3, "https://blog.naver.com/u/1001", ev1]);
expectEq("증거 source/status/recorded_by", (await su(`select source, status, recorded_by::text r, attempt_no from public.distribution_publication_evidence where id = $1::uuid`, [ev1])).rows[0],
  { source: "operator_manual", status: "accepted", r: U.admin, attempt_no: null });
expectErr("published 취소 → INVALID_TRANSITION", await api.cancel(U.admin, m1, 3), "23514", "INVALID_TRANSITION");
expectErr("published 중단 → INVALID_TRANSITION", await api.abandon(U.admin, m1, 3, "x", true), "23514", "INVALID_TRANSITION");
// 동일 게시물 충돌
const b2 = await approvedRev("blog");
const m2 = await createOk("두 번째 원문 blog manual", b2.rev, "manual");
await must("posted m2", api.posted(U.admin, m2, 1));
s0 = await snap(m2);
expectErr("다른 작업과 같은 URL → EVIDENCE_CONFLICT", await api.manualEv(U.admin, m2, 2, { url: "https://blog.naver.com/u/1001" }), "23505", "EVIDENCE_CONFLICT");
await unchanged("충돌 거부", m2, s0);
// D-1 수정 확인(070000): 호스트 대소문자 우회 거부 · 경로 대소문자 구분 · 원문 보존 · UNIQUE 경계 동일 canonical
expectErr("D-1: 호스트 대문자 같은 URL → EVIDENCE_CONFLICT", await api.manualEv(U.admin, m2, 2, { url: "https://BLOG.NAVER.COM/u/1001" }), "23505", "EVIDENCE_CONFLICT");
expectErr("D-1: 호스트 혼합 대소문자 + 같은 경로 → EVIDENCE_CONFLICT", await api.manualEv(U.admin, m2, 2, { url: "https://Blog.Naver.Com/u/1001" }), "23505", "EVIDENCE_CONFLICT");
await unchanged("D-1 거부 2건", m2, s0);
const evPath = j1(expectOk("D-1: 경로 대소문자가 다르면 다른 게시물로 수락(/U/1001)", await api.manualEv(U.admin, m2, 2, { url: "https://Blog.Naver.com/U/1001" })));
expectEq("D-1: 증거·작업 캐시는 입력 원문 그대로 저장(정규화로 덮어쓰지 않음)",
  [await scalar(`select external_url from public.distribution_publication_evidence where id = $1::uuid`, [evPath]), (await job(m2)).external_url],
  ["https://Blog.Naver.com/U/1001", "https://Blog.Naver.com/U/1001"]);
{
  const C = (u) => scalar(`select public.distribution_canonical_url($1)`, [u]);
  expectEq("canonical: scheme·host 소문자, 경로·쿼리·프래그먼트 보존", await C("https://BLOG.Naver.COM/Path/A?Q=Upper#Frag"), "https://blog.naver.com/Path/A?Q=Upper#Frag");
  expectEq("canonical: 포트 보존(제거·변경 없음)", await C("https://Blog.naver.com:8443/x"), "https://blog.naver.com:8443/x");
  expectEq("canonical: 경로 없는 URL", await C("https://BLOG.NAVER.COM"), "https://blog.naver.com");
  expectEq("canonical: 사용자정보 포함 값은 변경 없음(규칙 약화 없음)", await C("https://U@Blog.naver.com/x"), "https://U@Blog.naver.com/x");
  expectEq("canonical: https 아닌 값은 변경 없음", await C("http://BLOG.naver.com/x"), "http://BLOG.naver.com/x");
  expectEq("canonical: null → null", await C(null), null);
  expectEq("canonical helper: service_role/anon/authenticated EXECUTE 없음",
    (await su(`select has_function_privilege('service_role', 'public.distribution_canonical_url(text)', 'EXECUTE') s,
      has_function_privilege('anon', 'public.distribution_canonical_url(text)', 'EXECUTE') a,
      has_function_privilege('authenticated', 'public.distribution_canonical_url(text)', 'EXECUTE') u`)).rows[0], { s: false, a: false, u: false });
  expectEq("UNIQUE 경계: raw 인덱스 제거 + canonical 표현식 인덱스",
    (await su(`select string_agg(indexname, ',' order by indexname) n from pg_indexes
      where tablename = 'distribution_publication_evidence' and indexname like '%accepted_url%'`)).rows[0].n,
    "distribution_publication_evidence_accepted_url_canonical_unique");
  const b5 = await approvedRev("blog");
  const m5 = await createOk("D-1 UNIQUE 경계 확인용 blog manual", b5.rev, "manual");
  await must("posted m5", api.posted(U.admin, m5, 1));
  const r = await su(`insert into public.distribution_publication_evidence (job_id, source, status, external_url, observed_at, recorded_by)
    values ($1::uuid, 'operator_manual', 'accepted', 'https://BLOG.naver.com/u/1001', now(), $2::uuid)`, [m5, U.admin]);
  record("D-1: helper를 거치지 않은 superuser 직접 INSERT도 canonical UNIQUE가 23505로 거부",
    !r.ok && r.code === "23505" && /accepted_url_canonical_unique/.test(r.message ?? ""), `${H.fmt(r)}`);
}
const b3 = await approvedRev("blog");
const m3 = await createOk("세 번째 원문 blog manual", b3.rev, "manual");
await must("posted m3", api.posted(U.admin, m3, 1));
const ev3 = j1(expectOk("외부 ID + 방법 메모 근거로 수락", await api.manualEv(U.admin, m3, 2, { post: "post-3003", account: "naver-acct", note: "관리 화면에서 글 번호 확인" })));
expectEq("ID만 published: external_id=post-3003, url null", await job(m3).then((j) => [j.status, j.external_id, j.external_url]), ["published", "post-3003", null]);
const b4 = await approvedRev("blog");
const m4 = await createOk("네 번째 원문 blog manual", b4.rev, "manual");
await must("posted m4", api.posted(U.admin, m4, 1));
expectErr("같은 계정·같은 외부 ID → EVIDENCE_CONFLICT", await api.manualEv(U.admin, m4, 2, { post: "post-3003", account: "naver-acct", note: "확인" }), "23505", "EVIDENCE_CONFLICT");
expectOk("다른 계정의 같은 외부 ID는 별개 게시물로 수락", await api.manualEv(U.admin, m4, 2, { post: "post-3003", account: "naver-other", note: "확인" }));
// 정정
s0 = await snap(m1);
expectErr("정정 사유 없음 거부", await api.correct(U.admin, m1, 3, { url: "https://blog.naver.com/u/1001-fix" }), "22023");
expectErr("정정: 허용 외 호스트 거부", await api.correct(U.admin, m1, 3, { url: "https://example.com/x", reason: "오기" }), "23514");
expectErr("정정: 다른 작업 게시물(ID) → EVIDENCE_CONFLICT", await api.correct(U.admin, m1, 3, { post: "post-3003", account: "naver-acct", note: "n", reason: "오기" }), "23505", "EVIDENCE_CONFLICT");
expectErr("정정: expected_version 불일치", await api.correct(U.admin, m1, 2, { url: "https://blog.naver.com/u/1001-fix", reason: "오기" }), "P0001", "VERSION_CONFLICT");
expectErr("정정: 정지 admin 거부", await api.correct(U.suspended, m1, 3, { url: "https://blog.naver.com/u/1001-fix", reason: "오기" }), "42501");
await unchanged("거부된 정정 5건", m1, s0);
const evFix = j1(expectOk("증거 정정(URL 교체)", await api.correct(U.admin, m1, 3, { url: "https://blog.naver.com/u/1001-fix", reason: "주소 오기" })));
expectEq("정정 후 published 유지 + 캐시 교체 + v4", await job(m1).then((j) => [j.status, j.external_url, j.ev, j.version]),
  ["published", "https://blog.naver.com/u/1001-fix", evFix, 4]);
expectEq("이전 증거 superseded, 새 증거가 supersedes", (await su(`select (select status from public.distribution_publication_evidence where id = $1::uuid) o,
  (select supersedes_id::text from public.distribution_publication_evidence where id = $2::uuid) s`, [ev1, evFix])).rows[0], { o: "superseded", s: ev1 });
expectErr("정정은 published만(awaiting 작업) → INVALID_TRANSITION", await (async () => {
  const b = await approvedRev("blog"); const m = j1(await api.createJob(U.admin, b.rev, "manual")); await api.posted(U.admin, m, 1);
  return api.correct(U.admin, m, 2, { url: "https://blog.naver.com/u/9", reason: "x" });
})(), "23514", "INVALID_TRANSITION");
// 재게시 확인
const nv = j1(await must("b1 새 버전", api.appendVersion(b1.content, 1)));
const nr = j1(await must("b1 새 리비전", api.appendRevision(b1.draft, 1, nv.version_id)));
await must("새 버전 승인", api.decide("content_version", nv.version_id, nv.content_hash));
await must("새 리비전 승인", api.decide("draft_revision", nr.revision_id, nr.revision_hash));
expectErr("이미 published 채널 새 버전 manual → REPUBLISH_CONFIRMATION_REQUIRED", await api.createJob(U.admin, nr.revision_id, "manual"), "23514", "REPUBLISH_CONFIRMATION_REQUIRED");
const mRe = j1(expectOk("allow_republish=true면 생성", await api.createJob(U.admin, nr.revision_id, "manual", { republish: true })));
expectEq("재게시 생성 이벤트 reason", await scalar(`select reason_code from public.distribution_job_events where job_id = $1::uuid and seq = 1`, [mRe]), "job_created_republish");

// ================================================================ 2. abandoned 키 점유
group("2. abandoned 키 점유 · cancelled 키 해제");
const a1 = await approvedRev("blog");
const ma = await createOk("blog manual", a1.rev, "manual");
s0 = await snap(ma);
expectErr("중단: 외부 잔존 확인 false 거부", await api.abandon(U.admin, ma, 1, "중단", false), "22023");
expectErr("중단: 사유 공백 거부", await api.abandon(U.admin, ma, 1, "  ", true), "22023");
expectErr("중단: 회원 actor 거부", await api.abandon(U.member, ma, 1, "중단", true), "42501");
await unchanged("거부된 중단 3건", ma, s0);
expectOk("manual_ready → abandoned", await api.abandon(U.admin, ma, 1, "게시 취소", true));
expectEq("abandoned", (await job(ma)).status, "abandoned");
expectErr("같은 리비전 manual 재생성 → DUPLICATE(키 점유)", await api.createJob(U.admin, a1.rev, "manual"), "23505", "DUPLICATE");
expectErr("abandoned 취소 → INVALID_TRANSITION", await api.cancel(U.admin, ma, 2), "23514", "INVALID_TRANSITION");
expectErr("abandoned 게시 선언 → INVALID_TRANSITION", await api.posted(U.admin, ma, 2), "23514", "INVALID_TRANSITION");
expectOk("같은 리비전 dry_run은 별도 키로 생성 가능", await api.createJob(U.admin, a1.rev, "dry_run", { at: past(-3600) }));
const a2 = await approvedRev("blog");
const ma2 = await createOk("blog manual(awaiting에서 중단)", a2.rev, "manual");
await must("posted", api.posted(U.admin, ma2, 1));
expectOk("awaiting_evidence → abandoned", await api.abandon(U.admin, ma2, 2, "확인 불가", true));
const lateAb = j1(expectOk("abandoned 작업 늦은 증거 → 플래그만", await api.late(ma2, { url: "https://blog.naver.com/u/ab" })));
expectEq("abandoned 유지 + reconciliation_required", await job(ma2).then((j) => [j.status, j.rr]), ["abandoned", true]);
expectErr("abandoned에서 늦은 증거 수락 → INVALID_TRANSITION", await api.resolve(U.admin, ma2, 4, lateAb, "accept"), "23514", "INVALID_TRANSITION");
expectOk("늦은 증거 반려 → 플래그 해제", await api.resolve(U.admin, ma2, 4, lateAb, "reject"));
expectEq("플래그 해제, abandoned 유지", await job(ma2).then((j) => [j.status, j.rr]), ["abandoned", false]);
const a3 = await approvedRev("blog");
const mc = await createOk("blog manual(취소용)", a3.rev, "manual");
expectOk("manual_ready → cancelled", await api.cancel(U.admin, mc, 1));
expectOk("cancelled는 키 해제 → 같은 리비전 manual 재생성", await api.createJob(U.admin, a3.rev, "manual"));

// ================================================================ 3. manual unknown → 대사 → confirmed_absent → operator_only 재실행
group("3. unknown → 대사 · confirmed_absent → failed(operator_only) → 별도 승인 재실행");
const u1 = await approvedRev("blog");
const mu = await createOk("blog manual", u1.rev, "manual");
await must("posted", api.posted(U.admin, mu, 1));
expectErr("불확실 선언 사유 없음 거부", await api.uncertain(U.admin, mu, 2, " "), "22023");
expectOk("awaiting_evidence → unknown", await api.uncertain(U.admin, mu, 2, "게시 여부 확인 불가"));
expectEq("unknown + MANUAL_OUTCOME_UNCERTAIN", await job(mu).then((j) => [j.status, j.err, j.version]), ["unknown", "MANUAL_OUTCOME_UNCERTAIN", 3]);
expectErr("unknown 취소 불가", await api.cancel(U.admin, mu, 3), "23514", "INVALID_TRANSITION");
s0 = await snap(mu);
expectErr("worker confirmed_absent 거부", await api.recon("worker", null, mu, 3, "provider_recent_posts", "confirmed_absent", { scope: SCOPE, observation: "없음" }), "42501");
expectErr("worker operator_manual 방법 거부", await api.recon("worker", null, mu, 3, "operator_manual", "still_unknown"), "42501");
expectErr("worker found_published via container_status 거부", await api.recon("worker", null, mu, 3, "provider_container_status", "found_published", { post: "x" }), "42501");
expectErr("worker에 actor id 지정 거부", await api.recon("worker", U.admin, mu, 3, "provider_recent_posts", "still_unknown"), "22023");
expectErr("admin confirmed_absent: 범위(period) 누락 거부", await api.recon("admin", U.admin, mu, 3, "operator_manual", "confirmed_absent",
  { scope: { account: "a" }, observation: "목록 확인" }), "23514");
expectErr("admin confirmed_absent: 관찰 근거 없음 거부", await api.recon("admin", U.admin, mu, 3, "operator_manual", "confirmed_absent", { scope: SCOPE }), "23514");
expectErr("대사 expected_version 불일치", await api.recon("admin", U.admin, mu, 2, "operator_manual", "still_unknown"), "P0001", "VERSION_CONFLICT");
expectErr("정지 admin 대사 거부", await api.recon("admin", U.suspended, mu, 3, "operator_manual", "still_unknown"), "42501");
expectErr("observed_at 미래 거부", await api.recon("admin", U.admin, mu, 3, "operator_manual", "still_unknown", { observed: past(-3600) }), "23514");
await unchanged("거부된 대사 9건", mu, s0);
const recStill = j1(expectOk("worker still_unknown 기록", await api.recon("worker", null, mu, 3, "provider_recent_posts", "still_unknown")));
expectEq("unknown 유지, last_reconciliation 갱신", await job(mu).then((j) => [j.status, j.rec, j.version]), ["unknown", recStill, 4]);
const recAbs = j1(expectOk("admin confirmed_absent", await api.recon("admin", U.admin, mu, 4, "operator_manual", "confirmed_absent",
  { scope: SCOPE, observation: "블로그 글 목록 전체 확인, 없음" })));
jj = await job(mu);
expectEq("failed + operator_only + CONFIRMED_ABSENT", [jj.status, jj.retry_policy, jj.err, jj.rec], ["failed", "operator_only", "CONFIRMED_ABSENT", recAbs]);
expectErr("operator_only는 자동 재시도 불가", await api.requeue(mu), "23514", "RETRY_NOT_ALLOWED");
s0 = await snap(mu);
expectErr("재실행: 대사 ID 없음 거부", await api.rerun(U.admin, mu, 5), "23514");
expectErr("재실행: 다른 대사(still_unknown) ID 거부", await api.rerun(U.admin, mu, 5, recStill), "23514");
expectErr("재실행: 정지 admin 거부", await api.rerun(U.suspended, mu, 5, recAbs), "42501");
expectErr("재실행: expected_version 불일치", await api.rerun(U.admin, mu, 4, recAbs), "P0001", "VERSION_CONFLICT");
expectErr("failed에서 대사 → INVALID_TRANSITION", await api.recon("admin", U.admin, mu, 5, "operator_manual", "still_unknown"), "23514", "INVALID_TRANSITION");
await unchanged("거부된 재실행·대사 5건", mu, s0);
expectOk("operator 재실행 승인(confirmed_absent 대사 인용)", await api.rerun(U.admin, mu, 5, recAbs));
expectEq("manual_ready로 복귀, retry_policy null", await job(mu).then((j) => [j.status, j.retry_policy, j.phase]), ["manual_ready", null, "none"]);
expectEq("재실행 이벤트 reason + 대사 ID", (await su(`select reason_code, reconciliation_id::text r from public.distribution_job_events where job_id = $1::uuid order by seq desc limit 1`, [mu])).rows[0],
  { reason_code: "operator_rerun_approved", r: recAbs });
// manual found_published 경로
const u2 = await approvedRev("blog");
const mf = await createOk("blog manual(대사 게시 확인)", u2.rev, "manual");
await must("posted", api.posted(U.admin, mf, 1));
await must("uncertain", api.uncertain(U.admin, mf, 2, "모름"));
expectErr("found_published: 허용 외 URL 거부", await api.recon("admin", U.admin, mf, 3, "operator_manual", "found_published", { url: "https://example.com/z", observation: "확인" }), "23514");
expectErr("found_published: ID·URL 없음 → NO_EVIDENCE", await api.recon("admin", U.admin, mf, 3, "operator_manual", "found_published", { observation: "확인" }), "23514", "NO_EVIDENCE");
expectOk("admin found_published(URL)", await api.recon("admin", U.admin, mf, 3, "operator_manual", "found_published", { url: "https://blog.naver.com/u/fp", observation: "글 확인" }));
expectEq("published/none(manual)", await job(mf).then((j) => [j.status, j.phase, j.external_url]), ["published", "none", "https://blog.naver.com/u/fp"]);

// ================================================================ 4. dry_run 완료 · retry policy · 취소
group("4. dry_run 완료 · 단계 순서 · retry policy · 취소");
const d1 = await approvedRev("threads");
const jd = await createOk("dry_run 작업", d1.rev, "dry_run");
const cd = await claimMine("claim → attempt 1", jd, "w1");
s0 = await snap(jd);
expectErr("다른 워커 advance → LEASE_NOT_HELD", await api.advance(jd, cd.att, "w2", "container_requested"), "55P03", "LEASE_NOT_HELD");
expectErr("잘못된 worker id 거부", await api.advance(jd, cd.att, "bad worker!", "container_requested"), "22023");
expectErr("단계 건너뛰기 none→ready 거부", await api.advance(jd, cd.att, "w1", "ready"), "23514");
expectErr("dry_run 컨테이너 ID 거부", await api.advance(jd, cd.att, "w1", "container_created", "c-dry"), "22023");
expectErr("dry_run 컨테이너 상태 거부", await api.advance(jd, cd.att, "w1", "container_requested", null, "IN_PROGRESS"), "22023");
expectErr("publish 요청 전 dry_run_ok 아닌 published → PUBLISH_NOT_REQUESTED", await api.complete(jd, cd.att, "w1", "published", { post: "x" }), "23514", "PUBLISH_NOT_REQUESTED");
expectErr("잘못된 attempt id 거부", await api.advance(jd, "99999999-9999-4999-8999-999999999999", "w1", "container_requested"), "23514");
await unchanged("거부된 워커 호출 7건", jd, s0);
await drive(jd, cd.att, "w1", [["container_requested"], ["container_created"], ["processing"], ["ready"], ["publish_requested"]]);
expectEq("dry_run 단계 publish_requested 도달", (await job(jd)).phase, "publish_requested");
expectErr("dry_run published → MODE_MISMATCH", await api.complete(jd, cd.att, "w1", "published", { post: "x" }), "23514", "MODE_MISMATCH");
expectErr("dry_run unknown 거부", await api.complete(jd, cd.att, "w1", "unknown"), "23514");
expectOk("dry_run_ok", await api.complete(jd, cd.att, "w1", "dry_run_ok"));
jj = await job(jd);
expectEq("dry_run_succeeded/done, lease 해제", [jj.status, jj.phase, jj.lease_owner], ["dry_run_succeeded", "done", null]);
expectErr("완료 후 다시 complete → LEASE_NOT_HELD", await api.complete(jd, cd.att, "w1", "dry_run_ok"), "55P03", "LEASE_NOT_HELD");
expectErr("dry_run_succeeded 취소 → INVALID_TRANSITION", await api.cancel(U.admin, jd, jj.version), "23514", "INVALID_TRANSITION");
expectErr("dry_run 늦은 증거 거부", await api.late(jd, { post: "x" }), "23514");
// retry: auto
const d2 = await approvedRev("threads");
const jr = await createOk("dry_run max_attempts=2", d2.rev, "dry_run", { max: 2 });
let cr = await claimMine("claim attempt 1", jr, "w1");
s0 = await snap(jr);
expectErr("failed: error JSON 형식 불량 거부", await api.complete(jr, cr.att, "w1", "failed", { error: { code: "X" }, policy: "auto" }), "22023");
expectErr("failed: retry_policy 누락 거부", await api.complete(jr, cr.att, "w1", "failed", { error: { code: "NET", retryable: true, autoRetry: true } }), "22023");
expectErr("failed auto + autoRetry=false 불일치(check) 거부", await api.complete(jr, cr.att, "w1", "failed", { error: { code: "NET", retryable: true, autoRetry: false }, policy: "auto" }), "23514");
expectErr("cancel 요청 없이 cancelled 거부", await api.complete(jr, cr.att, "w1", "cancelled"), "23514");
await unchanged("거부된 complete 4건", jr, s0);
expectOk("failed(auto) 기록", await api.complete(jr, cr.att, "w1", "failed", { error: { code: "NET_TIMEOUT", retryable: true, autoRetry: true }, policy: "auto" }));
expectEq("failed/auto/NET_TIMEOUT", await job(jr).then((j) => [j.status, j.retry_policy, j.err]), ["failed", "auto", "NET_TIMEOUT"]);
expectErr("auto 실패에 operator 재실행 승인 거부", await api.rerun(U.admin, jr, (await job(jr)).version), "23514", "INVALID_TRANSITION");
expectOk("자동 재시도 재예약", await api.requeue(jr));
expectEq("scheduled/none, retry_policy null", await job(jr).then((j) => [j.status, j.phase, j.retry_policy]), ["scheduled", "none", null]);
cr = await claimMine("재claim → attempt 2", jr, "w1");
expectEq("attempt_no=2", cr.no, 2);
await must("fail 2", api.complete(jr, cr.att, "w1", "failed", { error: { code: "NET_TIMEOUT", retryable: true, autoRetry: true }, policy: "auto" }));
expectErr("횟수 한도(2/2) → RETRY_NOT_ALLOWED", await api.requeue(jr), "23514", "RETRY_NOT_ALLOWED");
expectOk("failed 취소", await api.cancel(U.admin, jr, (await job(jr)).version));
// retry: never
const d3 = await approvedRev("instagram");
const jn = await createOk("dry_run(never)", d3.rev, "dry_run");
const cn = await claimMine("claim", jn, "w1");
await must("fail never", api.complete(jn, cn.att, "w1", "failed", { error: { code: "INVALID_MEDIA", retryable: false, autoRetry: false }, policy: "never" }));
expectErr("never: 자동 재시도 거부", await api.requeue(jn), "23514", "RETRY_NOT_ALLOWED");
expectErr("never: operator 재실행 거부", await api.rerun(U.admin, jn, (await job(jn)).version), "23514", "INVALID_TRANSITION");
// 예약·취소
const d4 = await approvedRev("threads");
const js = await createOk("dry_run 미래 예약", d4.rev, "dry_run", { at: past(-3600) });
expectEq("예약 작업은 claim 대상 아님", (await api.claim("w1", 5)).rows.filter((r) => r.claimed_job_id === js).length, 0);
expectErr("재예약 expected_version 불일치", await api.reschedule(U.admin, js, 9, past(-7200)), "P0001", "VERSION_CONFLICT");
expectErr("재예약 과거 시각 거부", await api.reschedule(U.admin, js, 1, past(60)), "22023");
expectOk("재예약", await api.reschedule(U.admin, js, 1, past(-7200)));
expectErr("회원 취소 거부", await api.cancel(U.member, js, 2), "42501");
expectOk("scheduled 취소", await api.cancel(U.admin, js, 2));
expectOk("취소 후 같은 dry_run 재생성(키 해제)", await api.createJob(U.admin, d4.rev, "dry_run", { at: past(-3600) }));
// dispatching 취소 요청
const d5 = await approvedRev("threads");
const jc = await createOk("dry_run(취소 요청)", d5.rev, "dry_run");
const cc = await claimMine("claim", jc, "w1");
await drive(jc, cc.att, "w1", [["container_requested"]]);
expectEq("dispatching 취소 → cancel_requested", j1(await api.cancel(U.admin, jc, (await job(jc)).version)), "cancel_requested");
const vcr = (await job(jc)).version;
expectEq("두 번째 취소 요청은 변경 없음", [j1(await api.cancel(U.admin, jc, vcr)), (await job(jc)).version], ["cancel_requested", vcr]);
expectErr("취소 요청 후 publish 요청 → CANCEL_REQUESTED", await api.advance(jc, cc.att, "w1", "publish_requested"), "23514", "CANCEL_REQUESTED");
expectOk("워커가 취소 존중", await api.complete(jc, cc.att, "w1", "cancelled"));
expectEq("cancelled, attempt cancelled", (await snap(jc)).atts.map((a) => a.o), ["cancelled"]);

// ================================================================ 5. live: 컨테이너 선커밋 · 단계 순서 · publish · 충돌 · unknown · 대사
group("5. live(게이트 override): 컨테이너 선커밋 · 단계 순서 · 게시 · 증거 충돌 · unknown 대사 · 재실행");
const l1 = await approvedRev("threads");
const L1 = await createOk("live threads 작업", l1.rev, "live");
const c1 = await claimMine("claim", L1, "w1");
expectErr("container_created에 ID 없음 거부", await api.advance(L1, c1.att, "w1", "container_created"), "22023");
await drive(L1, c1.att, "w1", [["container_requested"]]);
s0 = await snap(L1);
const sameTx = await tx("service_role", null, [
  ["select public.distribution_advance_phase($1::uuid, $2::uuid, 'w1', 'container_created', 'C-L1') r", [L1, c1.att]],
  ["select public.distribution_advance_phase($1::uuid, $2::uuid, 'w1', 'ready', null, 'FINISHED') r", [L1, c1.att]],
  ["select public.distribution_advance_phase($1::uuid, $2::uuid, 'w1', 'publish_requested') r", [L1, c1.att]],
]);
expectErr("컨테이너 기록과 같은 트랜잭션의 publish 요청 거부(선커밋 강제)", sameTx, "23514");
await unchanged("같은 트랜잭션 전체 롤백(컨테이너 ID도 미기록)", L1, s0);
expectOk("container_created(C-L1) 커밋", await api.advance(L1, c1.att, "w1", "container_created", "C-L1"));
expectErr("processing에 FINISHED 거부", await api.advance(L1, c1.att, "w1", "processing", null, "FINISHED"), "22023");
expectErr("container_created→publish_requested 건너뛰기 → CONTAINER_NOT_READY", await api.advance(L1, c1.att, "w1", "publish_requested"), "23514", "CONTAINER_NOT_READY");
expectOk("processing(IN_PROGRESS)", await api.advance(L1, c1.att, "w1", "processing", null, "IN_PROGRESS"));
s0 = await snap(L1);
expectErr("processing에서 publish 요청 → CONTAINER_NOT_READY", await api.advance(L1, c1.att, "w1", "publish_requested"), "23514", "CONTAINER_NOT_READY");
expectErr("컨테이너 ERROR → CONTAINER_FAILED", await api.advance(L1, c1.att, "w1", "processing", null, "ERROR"), "23514", "CONTAINER_FAILED");
expectErr("컨테이너 PUBLISHED는 진행 단계 아님", await api.advance(L1, c1.att, "w1", "ready", null, "PUBLISHED"), "23514");
expectErr("ready에 IN_PROGRESS 거부", await api.advance(L1, c1.att, "w1", "ready", null, "IN_PROGRESS"), "22023");
expectErr("container_created 외 단계에서 컨테이너 ID 전달 거부", await api.advance(L1, c1.att, "w1", "processing", "C-OTHER", "IN_PROGRESS"), "22023");
expectErr("이미 지난 container_created로 되돌아가 ID 재기록 거부(단계 역행)", await api.advance(L1, c1.att, "w1", "container_created", "C-OTHER"), "23514");
expectErr("미지원 상태값 거부", await api.advance(L1, c1.att, "w1", "ready", null, "DONE"), "22023");
expectErr("publish 요청 전 published → PUBLISH_NOT_REQUESTED", await api.complete(L1, c1.att, "w1", "published", { post: "th-1" }), "23514", "PUBLISH_NOT_REQUESTED");
expectErr("publish 요청 전 unknown → PUBLISH_NOT_REQUESTED", await api.complete(L1, c1.att, "w1", "unknown"), "23514", "PUBLISH_NOT_REQUESTED");
await unchanged("거부된 단계/결과 8건", L1, s0);
expectOk("ready(FINISHED)", await api.advance(L1, c1.att, "w1", "ready", null, "FINISHED"));
expectErr("ready에서 processing 역행 거부", await api.advance(L1, c1.att, "w1", "processing", null, "IN_PROGRESS"), "23514");
expectOk("publish_requested(이전 트랜잭션 컨테이너)", await api.advance(L1, c1.att, "w1", "publish_requested"));
expectErr("publish 요청 후 failed(auto) 거부", await api.complete(L1, c1.att, "w1", "failed", { error: { code: "NET", retryable: true, autoRetry: true }, policy: "auto" }), "23514");
expectErr("published 외부 ID 없음 → NO_EVIDENCE", await api.complete(L1, c1.att, "w1", "published", { url: "https://www.threads.net/@a/post/1" }), "23514", "NO_EVIDENCE");
expectEq("published 실행", j1(await api.complete(L1, c1.att, "w1", "published", { post: "th-1", account: "acct-main", issues: ["caption_truncated"] })), "published");
jj = await job(L1);
expectEq("published/done/has_issues, external_id th-1", [jj.status, jj.phase, jj.has_issues, jj.external_id], ["published", "done", true, "th-1"]);
expectEq("증거 provider_response/accepted/attempt 1", (await su(`select source, status, attempt_no from public.distribution_publication_evidence where id = $1::uuid`, [jj.ev])).rows[0],
  { source: "provider_response", status: "accepted", attempt_no: 1 });
// 컨테이너 재사용 + 동일 게시물 충돌
const l2 = await approvedRev("threads");
const L2 = await createOk("live 작업 2", l2.rev, "live");
const c2 = await claimMine("claim", L2, "w1");
await drive(L2, c2.att, "w1", [["container_requested"]]);
expectErr("다른 작업에서 같은 컨테이너 ID 재사용 거부", await api.advance(L2, c2.att, "w1", "container_created", "C-L1"), "23505");
await drive(L2, c2.att, "w1", [["container_created", "C-L2"], ["ready", null, "FINISHED"], ["publish_requested"]]);
expectEq("같은 계정·외부 ID 게시 결과 → unknown(충돌)", j1(await api.complete(L2, c2.att, "w1", "published", { post: "th-1", account: "acct-main" })), "unknown");
jj = await job(L2);
expectEq("unknown + reconciliation_required + EVIDENCE_CONFLICT", [jj.status, jj.rr, jj.err, jj.ev], ["unknown", true, "EVIDENCE_CONFLICT", null]);
const conflictEv = await scalar(`select id::text from public.distribution_publication_evidence where job_id = $1::uuid and status = 'conflict'`, [L2]);
record("conflict 증거 행 보존", !!conflictEv, "");
expectErr("충돌 미해결 상태 confirmed_absent 거부", await api.recon("admin", U.admin, L2, jj.version, "operator_manual", "confirmed_absent", { scope: SCOPE, observation: "x" }), "23514");
expectErr("conflict 증거 수락 거부", await api.resolve(U.admin, L2, jj.version, conflictEv, "accept"), "23514");
expectOk("conflict 증거 반려", await api.resolve(U.admin, L2, jj.version, conflictEv, "reject"));
expectEq("반려 후 플래그 해제, unknown 유지", await job(L2).then((j) => [j.status, j.rr]), ["unknown", false]);
jj = await job(L2);
expectErr("live found_published: 외부 ID 없음 거부", await api.recon("worker", null, L2, jj.version, "provider_recent_posts", "found_published", { url: "https://www.threads.net/@a/post/2" }), "23514", "NO_EVIDENCE");
expectErr("worker found_published 다른 작업 게시물 → EVIDENCE_CONFLICT", await api.recon("worker", null, L2, jj.version, "provider_recent_posts", "found_published", { post: "th-1", account: "acct-main" }), "23505", "EVIDENCE_CONFLICT");
expectOk("worker found_published(목록 매칭)", await api.recon("worker", null, L2, jj.version, "provider_recent_posts", "found_published", { post: "th-2", account: "acct-main" }));
expectEq("unknown→published/done", await job(L2).then((j) => [j.status, j.phase, j.external_id]), ["published", "done", "th-2"]);
// unknown → confirmed_absent → operator_only 재실행 → 새 attempt
const l3 = await approvedRev("instagram");
const L3 = await createOk("live instagram 작업", l3.rev, "live");
const c3 = await claimMine("claim", L3, "w1");
await drive(L3, c3.att, "w1", [...LIVE_TO_READY("C-L3"), ["publish_requested"]]);
expectEq("publish 후 응답 유실 → unknown", j1(await api.complete(L3, c3.att, "w1", "unknown", { summary: "timeout after publish" })), "unknown");
jj = await job(L3);
expectEq("unknown/publish_requested/UNKNOWN_OUTCOME", [jj.status, jj.phase, jj.err], ["unknown", "publish_requested", "UNKNOWN_OUTCOME"]);
expectEq("unknown에서는 claim 대상 아님", (await api.claim("w9", 5)).rows.filter((r) => r.claimed_job_id === L3).length, 0);
const recL3 = j1(expectOk("admin confirmed_absent", await api.recon("admin", U.admin, L3, jj.version, "operator_manual", "confirmed_absent", { scope: SCOPE, observation: "계정 게시물 목록 확인" })));
jj = await job(L3);
expectEq("failed(operator_only)", [jj.status, jj.retry_policy], ["failed", "operator_only"]);
expectErr("requeue 거부", await api.requeue(L3), "23514", "RETRY_NOT_ALLOWED");
expectOk("재실행 승인", await api.rerun(U.admin, L3, jj.version, recL3));
expectEq("scheduled/none", await job(L3).then((j) => [j.status, j.phase]), ["scheduled", "none"]);
const c3b = await claimMine("재claim → 새 attempt", L3, "w1");
expectEq("attempt 2, 이전 attempt outcome unknown", [c3b.no, (await snap(L3)).atts[0].o], [2, "unknown"]);
expectErr("새 attempt에서 이전 컨테이너 ID 재사용 거부", await (async () => { await api.advance(L3, c3b.att, "w1", "container_requested");
  return api.advance(L3, c3b.att, "w1", "container_created", "C-L3"); })(), "23505");
await must("L3 종료", api.complete(L3, c3b.att, "w1", "failed", { error: { code: "STOP", retryable: false, autoRetry: false }, policy: "never" }));
// 늦은 증거: unknown
const l4 = await approvedRev("threads");
const L4 = await createOk("live 작업 4", l4.rev, "live");
const c4 = await claimMine("claim", L4, "w1");
await drive(L4, c4.att, "w1", [...LIVE_TO_READY("C-L4"), ["publish_requested"], ["confirming"]]);
await must("unknown", api.complete(L4, c4.att, "w1", "unknown"));
const lateNo = j1(expectOk("늦은 증거(attempt 미지정) → pending_review", await api.late(L4, { post: "th-4", account: "acct-main" })));
jj = await job(L4);
expectEq("unknown 유지 + 플래그", [jj.status, jj.rr], ["unknown", true]);
expectErr("attempt 없는 live 증거 수락 → PUBLISH_NOT_REQUESTED", await api.resolve(U.admin, L4, jj.version, lateNo, "accept"), "23514", "PUBLISH_NOT_REQUESTED");
expectErr("검토 사유 없음 거부", await api.resolve(U.admin, L4, jj.version, lateNo, "reject", " "), "22023");
expectOk("반려", await api.resolve(U.admin, L4, jj.version, lateNo, "reject"));
const lateYes = j1(await api.late(L4, { post: "th-4", account: "acct-main", attempt: 1, issues: ["late_link"] }));
jj = await job(L4);
expectErr("수락: expected_version 불일치", await api.resolve(U.admin, L4, jj.version - 1, lateYes, "accept"), "P0001", "VERSION_CONFLICT");
expectErr("수락: 정지 admin 거부", await api.resolve(U.suspended, L4, jj.version, lateYes, "accept"), "42501");
expectEq("attempt 1 귀속 늦은 증거 수락 → published", j1(await api.resolve(U.admin, L4, jj.version, lateYes, "accept")), "published");
jj = await job(L4);
expectEq("published/done/플래그 해제/issues", [jj.status, jj.phase, jj.rr, jj.has_issues], ["published", "done", false, true]);
expectEq("이벤트 reason late_evidence_accepted", await scalar(`select reason_code from public.distribution_job_events where job_id = $1::uuid order by seq desc limit 1`, [L4]), "late_evidence_accepted");
// 늦은 증거: failed(operator_only) → published
const l5 = await approvedRev("instagram");
const L5 = await createOk("live 작업 5", l5.rev, "live");
const c5 = await claimMine("claim", L5, "w1");
await drive(L5, c5.att, "w1", [...LIVE_TO_READY("C-L5"), ["publish_requested"]]);
await must("failed operator_only", api.complete(L5, c5.att, "w1", "failed", { error: { code: "HTTP_500", retryable: true, autoRetry: false }, policy: "operator_only" }));
const late5 = j1(await api.late(L5, { post: "ig-5", attempt: 1 }));
expectEq("failed → published(늦은 증거 수락)", j1(await api.resolve(U.admin, L5, (await job(L5)).version, late5, "accept")), "published");
expectEq("published/done, retry_policy null", await job(L5).then((j) => [j.status, j.phase, j.retry_policy]), ["published", "done", null]);
// 늦은 증거: published 작업
jj = await job(L1);
const lateP = j1(expectOk("published 작업 늦은 증거 → 플래그", await api.late(L1, { post: "th-1-dup", account: "acct-main", attempt: 1 })));
jj = await job(L1);
expectEq("published 유지 + 플래그", [jj.status, jj.rr], ["published", true]);
expectErr("published에서 늦은 증거 수락 → INVALID_TRANSITION", await api.resolve(U.admin, L1, jj.version, lateP, "accept"), "23514", "INVALID_TRANSITION");
expectOk("반려 → 플래그 해제", await api.resolve(U.admin, L1, jj.version, lateP, "reject"));
// live 정정
jj = await job(L1);
expectErr("live 정정: 외부 ID 없음 → NO_EVIDENCE", await api.correct(U.admin, L1, jj.version, { url: "https://www.threads.net/@a/post/1", reason: "x" }), "23514", "NO_EVIDENCE");
expectErr("live 정정: 외부 ID만 + 방법 메모 없음 거부(operator_manual 근거)", await api.correct(U.admin, L1, jj.version, { post: "th-1b", account: "acct-main", reason: "ID 오기" }), "23514");
const fixL = j1(expectOk("live 정정(외부 ID 교체 + 확인 메모)", await api.correct(U.admin, L1, jj.version, { post: "th-1b", account: "acct-main", reason: "ID 오기", note: "앱에서 게시물 ID 재확인" })));
expectEq("정정 후 published/done, external_id th-1b, 새 증거 attempt 1 승계, issues 승계",
  [...await job(L1).then((j) => [j.status, j.phase, j.external_id, j.ev === fixL]),
    ...(await su(`select attempt_no, issues from public.distribution_publication_evidence where id = $1::uuid`, [fixL])).rows.map((r) => [r.attempt_no, r.issues])],
  ["published", "done", "th-1b", true, [1, ["caption_truncated"]]]);

// ================================================================ 6. 리스 만료(실시간 대기)
group("6. 리스 만료 · publish 요청 후 unknown · 재개(T6) · dry_run publish 후 만료");
const e1 = await approvedRev("threads"); const E1 = await createOk("E1 live", e1.rev, "live");
const ce1 = await claimMine("E1 claim(lease 10)", E1, "w1", 10);
await drive(E1, ce1.att, "w1", [["container_requested", null, null, 10], ["container_created", "C-E1", null, 10], ["ready", null, "FINISHED", 10], ["publish_requested", null, null, 10]]);
const e2 = await approvedRev("instagram"); const E2 = await createOk("E2 live", e2.rev, "live");
const ce2 = await claimMine("E2 claim(lease 10)", E2, "w1", 10);
await drive(E2, ce2.att, "w1", [["container_requested", null, null, 10]]);
const e3 = await approvedRev("threads"); const E3 = await createOk("E3 live", e3.rev, "live");
const ce3 = await claimMine("E3 claim(lease 10)", E3, "w1", 10);
await drive(E3, ce3.att, "w1", [["container_requested", null, null, 10], ["container_created", "C-E3", null, 10]]);
const e5 = await approvedRev("threads"); const E5 = await createOk("E5 dry_run", e5.rev, "dry_run");
await claimMine("E5 claim(lease 10, 단계 없음)", E5, "w1", 10);
const e4 = await approvedRev("instagram"); const E4 = await createOk("E4 dry_run", e4.rev, "dry_run");
const ce4 = await claimMine("E4 claim(lease 30)", E4, "w1", 30);
await drive(E4, ce4.att, "w1", [["container_requested", null, null, 30], ["container_created", null, null, 30], ["ready", null, null, 30],
  ["publish_requested", null, null, 30]]);
const e4At = Date.now();
expectEq("만료 전 recover는 아무것도 회수하지 않음", (await api.recover()).rows.length, 0);
console.log("  … lease 10초 만료 대기(11.5초)");
await sleep(11500);
expectErr("만료 후 소유 워커 advance → LEASE_NOT_HELD", await api.advance(E1, ce1.att, "w1", "confirming"), "55P03", "LEASE_NOT_HELD");
expectErr("만료 후 다른 워커 complete → LEASE_NOT_HELD", await api.complete(E1, ce1.att, "w2", "published", { post: "x" }), "55P03", "LEASE_NOT_HELD");
const rec1 = await api.recover();
expectOk("recover 실행", rec1);
const recMap = Object.fromEntries((rec1.rows ?? []).map((r) => [r.recovered_job_id, r.recovered_status]));
expectEq("E1(publish 요청 후) → unknown", recMap[E1], "unknown");
expectEq("E1 last_error LEASE_EXPIRED_AFTER_PUBLISH_REQUEST, phase 유지", await job(E1).then((j) => [j.err, j.phase]), ["LEASE_EXPIRED_AFTER_PUBLISH_REQUEST", "publish_requested"]);
expectEq("E2(컨테이너 전) → failed(auto)", [recMap[E2], (await job(E2)).retry_policy, (await job(E2)).err], ["failed", "auto", "LEASE_EXPIRED_BEFORE_CONTAINER"]);
expectEq("E5(dry_run 단계 없음) → failed(auto)", recMap[E5], "failed");
expectEq("E3(container_created)는 recover 대상 아님", recMap[E3], undefined);
const rs = await api.claim("w2", 5, 60);
const e3row = rs.rows.find((r) => r.claimed_job_id === E3);
expectEq("E3 claim 재개: 같은 attempt, resumed=true, lease_owner w2", [e3row?.claimed_attempt_no, e3row?.resumed, (await job(E3)).lease_owner], [1, true, "w2"]);
expectErr("재개 후 원래 워커 w1 advance 거부", await api.advance(E3, ce3.att, "w1", "ready", null, "FINISHED"), "55P03", "LEASE_NOT_HELD");
expectOk("재개 워커 w2가 같은 컨테이너로 진행", await api.advance(E3, ce3.att, "w2", "ready", null, "FINISHED"));
await must("E3 종료", api.complete(E3, ce3.att, "w2", "failed", { error: { code: "STOP", retryable: false, autoRetry: false }, policy: "never" }));
expectOk("E2 자동 재시도 재예약", await api.requeue(E2));
const ce2b = await claimMine("E2 재claim → attempt 2", E2, "w1");
await must("E2 종료", api.complete(E2, ce2b.att, "w1", "failed", { error: { code: "STOP", retryable: false, autoRetry: false }, policy: "never" }));
await must("E5 종료", api.cancel(U.admin, E5, (await job(E5)).version));
expectEq("E1 unknown은 이후 대사로만 — claim 대상 아님", (await api.claim("w3", 5)).rows.length, 0);
const waitE4 = Math.max(0, 31500 - (Date.now() - e4At));
console.log(`  … E4 lease 30초 만료 대기(${Math.round(waitE4 / 100) / 10}초)`);
await sleep(waitE4);
{
  // D-2 수정 확인(070000): dry_run publish 요청 후 만료 → failed(operator_only, autoRetry=false)
  const r = await api.recover();
  expectOk("D-2: recover 성공(가드 거부 없음)", r);
  expectEq("D-2: E4 → failed 반환", r.rows?.find((x) => x.recovered_job_id === E4)?.recovered_status, "failed");
  const j4 = (await su(`select status, retry_policy, last_error from public.distribution_jobs where id = $1::uuid`, [E4])).rows[0];
  expectEq("D-2: E4 failed/operator_only/LEASE_EXPIRED_AFTER_PUBLISH_REQUEST/retryable=true/autoRetry=false",
    [j4.status, j4.retry_policy, j4.last_error.code, j4.last_error.retryable, j4.last_error.autoRetry, Object.keys(j4.last_error).length],
    ["failed", "operator_only", "LEASE_EXPIRED_AFTER_PUBLISH_REQUEST", true, false, 3]);
  expectEq("D-2: E4 attempt failed + error_code", (await su(`select outcome, error_code from public.distribution_job_attempts where job_id = $1::uuid`, [E4])).rows,
    [{ outcome: "failed", error_code: "LEASE_EXPIRED_AFTER_PUBLISH_REQUEST" }]);
  expectErr("D-2: 자동 재시도는 계속 불가(가드 의미 유지)", await api.requeue(E4), "23514", "RETRY_NOT_ALLOWED");
  expectEq("D-2: 이벤트 reason lease_expired_after_publish_request(actor system)",
    (await su(`select reason_code, actor_kind from public.distribution_job_events where job_id = $1::uuid order by seq desc limit 1`, [E4])).rows[0],
    { reason_code: "lease_expired_after_publish_request", actor_kind: "system" });
  expectOk("D-2: operator 재실행 승인으로만 재개 가능", await api.rerun(U.admin, E4, (await job(E4)).version));
  expectEq("D-2: 재실행 후 scheduled", (await job(E4)).status, "scheduled");
  await must("E4 정리", api.cancel(U.admin, E4, (await job(E4)).version));

  // D-2b 수정 확인: 작업별 격리 — 한 작업의 회수 오류가 다른 작업을 막지 않고, 실패는 ID+SQLSTATE로 드러난다.
  // 시험 전용(일회성 DB): E7의 attempt 갱신만 실패시키는 트리거를 superuser로 잠시 설치해 "작업별 예기치 못한 오류"를 만든다.
  const e7 = await approvedRev("instagram"); const E7 = await createOk("D-2b: E7 live(회수 실패 주입 대상, 먼저 만료)", e7.rev, "live");
  const ce7 = await claimMine("D-2b: E7 claim(lease 10)", E7, "w1", 10);
  await drive(E7, ce7.att, "w1", [["container_requested", null, null, 10], ["container_created", "C-E7", null, 10], ["ready", null, "FINISHED", 10],
    ["publish_requested", null, null, 10]]);
  const e6 = await approvedRev("threads"); const E6 = await createOk("D-2b: E6 live(뒤에 만료)", e6.rev, "live");
  const ce6 = await claimMine("D-2b: E6 claim(lease 10)", E6, "w1", 10);
  await drive(E6, ce6.att, "w1", [["container_requested", null, null, 10], ["container_created", "C-E6", null, 10], ["ready", null, "FINISHED", 10],
    ["publish_requested", null, null, 10]]);
  await db.exec(`create function public.zz_test_fail_e7() returns trigger language plpgsql as $f$
    begin if new.job_id = '${E7}'::uuid then raise exception 'injected test failure' using errcode = 'P0001'; end if; return new; end $f$;
    create trigger zz_test_fail_e7 before update on public.distribution_job_attempts for each row execute function public.zz_test_fail_e7();`);
  console.log("  … E7/E6 lease 만료 대기(11.5초)");
  await sleep(11500);
  const order = (await su(`select id::text from public.distribution_jobs where status = 'dispatching' and lease_expires_at <= now() order by lease_expires_at, id`)).rows.map((x) => x.id);
  expectEq("D-2b: 만료 순서상 E7(실패 주입)이 E6보다 앞", order.indexOf(E7) >= 0 && order.indexOf(E7) < order.indexOf(E6), true);
  const r2 = await api.recover(100);
  expectOk("D-2b: 한 작업 오류가 있어도 recover 호출 자체는 성공", r2);
  const m = Object.fromEntries((r2.rows ?? []).map((x) => [x.recovered_job_id, x.recovered_status]));
  expectEq("D-2b: E7은 숨기지 않고 recovery_failed:<SQLSTATE>로 보고", m[E7], "recovery_failed:P0001");
  expectEq("D-2b: 뒤에 만료된 E6은 unknown 전환", [m[E6], (await job(E6)).status, (await job(E6)).err], ["unknown", "unknown", "LEASE_EXPIRED_AFTER_PUBLISH_REQUEST"]);
  expectEq("D-2b: 실패한 E7은 자기 변경만 롤백(dispatching, attempt pending, 이벤트 증가 없음)",
    [(await job(E7)).status, (await snap(E7)).atts.map((a) => a.o), (await snap(E7)).ev_n === (await job(E7)).version], ["dispatching", ["pending"], true]);
  expectEq("D-2b: 결과 행에 메시지 본문 없음(ID·SQLSTATE만)", /injected/.test(JSON.stringify(r2.rows)), false);
  const r3 = await api.recover(100);
  expectEq("D-2b: 다음 호출에서도 E7 실패가 다시 보고(조용히 사라지지 않음)", r3.rows?.find((x) => x.recovered_job_id === E7)?.recovered_status, "recovery_failed:P0001");
  await db.exec(`drop trigger zz_test_fail_e7 on public.distribution_job_attempts; drop function public.zz_test_fail_e7();`);
  const r4 = await api.recover(100);
  expectEq("D-2b: 원인 제거 후 E7 정상 회수(live → unknown)", [r4.rows?.find((x) => x.recovered_job_id === E7)?.recovered_status, (await job(E7)).status], ["unknown", "unknown"]);
}

// ================================================================ 7. 승인 철회 · stale · actor 권한 철회
group("7. 승인 철회 · stale · admin 권한 철회");
const r1 = await approvedRev("threads");
const JR = await createOk("dry_run(승인 철회용)", r1.rev, "dry_run");
await must("revoke", api.revoke(r1.revApproval));
expectEq("claim 시 hold=approval_revoked, 미claim", [(await api.claim("w1", 5)).rows.filter((x) => x.claimed_job_id === JR).length, (await job(JR)).hold_reason], [0, "approval_revoked"]);
expectErr("hold(approval_revoked) 재예약 거부", await api.reschedule(U.admin, JR, (await job(JR)).version, past(-3600)), "23514", "INVALID_TRANSITION");
expectOk("hold 작업 취소", await api.cancel(U.admin, JR, (await job(JR)).version));
const r2 = await approvedRev("instagram");
const JS = await createOk("live(재실행 stale용)", r2.rev, "live");
const cs = await claimMine("claim", JS, "w1");
await must("fail operator_only", api.complete(JS, cs.att, "w1", "failed", { error: { code: "HTTP_500", retryable: true, autoRetry: false }, policy: "operator_only" }));
await must("새 원문 버전", api.appendVersion(r2.content, 1));
s0 = await snap(JS);
expectErr("근거 stale 후 재실행 거부(basis)", await api.rerun(U.admin, JS, (await job(JS)).version), "23514");
await unchanged("거부된 재실행", JS, s0);
const r3 = await approvedRev("blog");
const JA = j1(await must("admin3 manual 작업", api.createJob(U.admin3, r3.rev, "manual")));
await su(`delete from public.role_assignments where user_id = '${U.admin3}'`);
s0 = await snap(JA);
expectErr("admin 역할 회수된 actor: 게시 선언 거부", await api.posted(U.admin3, JA, 1), "42501");
expectErr("admin 역할 회수된 actor: 취소 거부", await api.cancel(U.admin3, JA, 1), "42501");
await unchanged("권한 철회 후 거부", JA, s0);
expectOk("다른 승인 admin은 처리 가능", await api.posted(U.admin, JA, 1));

// ================================================================ 8. 우회 차단 · 이벤트 불변식
group("8. 우회 차단 · 이벤트 불변식");
expectErr("service_role jobs 직접 UPDATE 거부", await svc(`update public.distribution_jobs set status = 'cancelled' where id = $1::uuid`, [JA]), "42501");
expectErr("superuser도 컨텍스트 없이 jobs UPDATE 거부(가드)", await su(`update public.distribution_jobs set status = 'cancelled' where id = $1::uuid`, [JA]), "42501");
expectErr("superuser가 admin 컨텍스트를 위조해도 증거 없는 published 거부", await tx(null, null, [
  ["select public.distribution_set_event_context('admin', $1::uuid, 'forged')", [U.admin]],
  ["update public.distribution_jobs set status = 'published', external_url = 'https://blog.naver.com/f' where id = $1::uuid", [JA]],
]), "23514");
expectErr("superuser jobs DELETE 거부", await su(`delete from public.distribution_jobs where id = $1::uuid`, [JA]), "23514");
expectErr("superuser job_events UPDATE 거부", await su(`update public.distribution_job_events set reason_code = 'x' where job_id = $1::uuid`, [JA]), "23514");
expectErr("superuser reconciliations DELETE 거부", await su(`delete from public.distribution_reconciliations`), "23514");
expectErr("evidence 상태 외 열 변경 거부", await su(`update public.distribution_publication_evidence set external_url = 'https://blog.naver.com/z' where id = $1::uuid`, [ev3]), "23514");
const inv = (await su(`select count(*)::int bad from public.distribution_jobs j
  where j.version <> (select count(*) from public.distribution_job_events e where e.job_id = j.id)
     or j.version <> (select max(seq) from public.distribution_job_events e where e.job_id = j.id)`)).rows[0].bad;
expectEq("모든 작업: 이벤트 수 = max(seq) = version(누락·중복 없음)", inv, 0);
const pubInv = (await su(`select count(*)::int bad from public.distribution_jobs j where (j.status = 'published') <>
  exists (select 1 from public.distribution_publication_evidence e where e.job_id = j.id and e.status = 'accepted')`)).rows[0].bad;
expectEq("published ⇔ accepted 증거 1개", pubInv, 0);
const evCount = await scalar(`select count(*)::int from public.distribution_job_events`);
record(`누적 작업 이벤트 ${evCount}행`, evCount > 0, "");

console.log("\n## 결함 재현 요약(통과 집계와 별도)");
for (const d of defects) console.log(`${d.reproduced ? "재현됨" : "재현 안 됨"}  ${d.name}`);
H.results.push(...defects.map((d) => ({ group: "defects", name: d.name, pass: true, defect: true, reproduced: d.reproduced, detail: d.detail })));
H.finish(engine, jsonOut);
