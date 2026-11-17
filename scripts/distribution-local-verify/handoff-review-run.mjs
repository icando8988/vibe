#!/usr/bin/env node
/**
 * AUTOPOST-HANDOFF-SQL-REVIEW-009 — 080000(Blog 확장 인계) 공격·거부 시나리오.
 * ※ AUTOPOST-DESIGN-A-013(2026-11-17)에서 **기존 검토의 최종 회귀 정리**로 바꿨다(새 독립 검토가 아님).
 *   REVIEW-009가 재현했던 F-1·F-1b·F-2·F-3은 080000 최종본에서 수정됐으므로, "FINDING 재현" 집계를 없애고
 *   수정 후 기대 동작(거부·전이)을 일반 단언으로 확인한다. 결함 재현은 통과로 세지 않는다.
 *   그룹 9의 재설정된 요청이 그룹 10 선점에 섞이지 않도록 그룹 사이 대기 요청 0건을 단언한다(데이터 격리).
 * 원 담당의 handoff-run.mjs와 별개. 일회성 PGlite + Supabase 대역(실제 Supabase 아님, 단일 연결).
 *
 *   node web/scripts/distribution-local-verify/handoff-review-run.mjs --pglite-project <dir> [--snapshot <080000 사본>] [--json <out>]
 *   --snapshot을 주면 migrations/의 080000 대신 그 사본을 적용한다(검토 기준 hash 고정). 적용한 hash를 출력한다.
 * 종료 코드: 0 기대(안전) 동작 전부 일치 · 1 불일치 · 2 migration 적용 실패 · 3 PGlite 없음
 *
 * 시험 전용 조작(이 일회성 DB 안에서만): 180초 리스·30분 요청 창을 기다리지 않으려고 superuser가
 * distribution_extension_handoffs의 lease_expires_at / requested_at을 과거로 옮긴다(이 표에는 가드 트리거가 없다).
 */
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { argOf, createHarness, errInfo, HERE, loadPGlite, MIGRATIONS_DIR } from "./lib.mjs";

const HANDOFF = "20261116080000_distribution_extension_handoffs.sql";
const PGlite = await loadPGlite(argOf("--pglite-project"));
const jsonOut = argOf("--json");
const snapshot = argOf("--snapshot");
const db = await PGlite.create();
const H = createHarness(db);
const { group, record, svc, su, scalar, must, expectOk, expectErr, expectEq } = H;
const engine = (await db.query("select version() v")).rows[0].v.split(" on ")[0];
const sha = (s) => createHash("sha256").update(s).digest("hex");
console.log(`# AUTOPOST-HANDOFF-SQL-REVIEW-009 · ${new Date().toISOString()} · ${engine} (Supabase 대역, 실제 Supabase 아님)`);


// ---------------------------------------------------------------- apply
group("0. 대역 + migration 적용(080000은 검토 기준 사본)");
await db.exec(readFileSync(join(HERE, "supabase-local-standin.sql"), "utf8"));
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const diskHash = files.includes(HANDOFF) ? sha(readFileSync(join(MIGRATIONS_DIR, HANDOFF))) : null;
const usedText = snapshot ? readFileSync(snapshot) : readFileSync(join(MIGRATIONS_DIR, HANDOFF));
const usedHash = sha(usedText);
console.log(`  080000 적용 hash=${usedHash}${snapshot ? " (snapshot)" : " (disk)"} · disk hash=${diskHash}${diskHash !== usedHash ? "  ※ 디스크 파일이 검토 기준과 다름 — 원 담당 최종본과 재대조 필요" : ""}`);
for (const f of files) {
  const text = f === HANDOFF ? usedText.toString("utf8") : readFileSync(join(MIGRATIONS_DIR, f), "utf8");
  try {
    await db.exec(`set role supa_owner;\n${text}\n;reset role;`);
    record(`적용 ${f}`, true, "");
  } catch (e) {
    try { await db.exec("rollback; reset role;"); } catch { /* ignore */ }
    record(`적용 ${f}`, false, `${errInfo(e).code} ${errInfo(e).message.slice(0, 200)}`);
    H.finish(engine, jsonOut, 2);
  }
}

const U = {
  A: "00000000-0000-4000-8000-00000000000a",
  B: "00000000-0000-4000-8000-00000000000b",
  S: "00000000-0000-4000-8000-0000000000c2",
  M: "00000000-0000-4000-8000-0000000000d1",
};
await su(`insert into auth.users (id) values ('${U.A}'),('${U.B}'),('${U.S}'),('${U.M}')`);
await su(`update public.profiles set approval_status = case when id = '${U.S}' then 'suspended' else 'approved' end`);
await su(`insert into public.role_assignments (user_id, role) values ('${U.A}','admin'),('${U.B}','admin'),('${U.S}','admin')`);

const j1 = (r) => (r.ok ? r.rows[0]?.r : undefined);
const newToken = () => { const raw = `pat_${randomBytes(32).toString("hex")}`; return sha(raw); };
async function issue(actor, label) {
  const h = newToken();
  const r = j1(await must(`issue ${label}`, svc(`select public.distribution_issue_extension_token($1::uuid, $2, $3, 30) r`, [actor, h, label])));
  return { hash: h, id: r.id };
}
const tA = await issue(U.A, "A-main");
const tA2 = await issue(U.A, "A-second");
const tB = await issue(U.B, "B-main");

let seq = 0;
async function approvedRev(channel) {
  const c = j1(await must("content", svc(`select public.distribution_create_content($1::uuid, $2, $3) r`, [U.A, `인계 원문 ${++seq}`, `원문 본문 ${seq}`])));
  const d = j1(await must("draft", svc(`select public.distribution_create_channel_draft($1::uuid, $2::uuid, $3) r`, [U.A, c.content_id, channel])));
  const r = j1(await must("rev", svc(`select public.distribution_append_draft_revision(p_actor_id => $1::uuid, p_draft_id => $2::uuid,
      p_expected_revision_no => 0, p_expected_content_version_id => $3::uuid, p_body => $4) r`, [U.A, d.draft_id, c.version_id, `블로그 본문 ${seq}`])));
  await must("ac", svc(`select public.distribution_decide_approval($1::uuid, 'content_version', $2::uuid, 'approved', $3, '{"ok":true}'::jsonb) r`, [U.A, c.version_id, c.content_hash]));
  const ra = j1(await must("ar", svc(`select public.distribution_decide_approval($1::uuid, 'draft_revision', $2::uuid, 'approved', $3, '{"ok":true}'::jsonb) r`, [U.A, r.revision_id, r.revision_hash])));
  return { content: c.content_id, versionId: c.version_id, draft: d.draft_id, rev: r.revision_id, revApproval: ra.approval_id, title: `인계 원문 ${seq}`, body: `블로그 본문 ${seq}` };
}
async function blogJob() {
  const x = await approvedRev("blog");
  const job = j1(await must("job", svc(`select public.distribution_create_job($1::uuid, $2::uuid, 'manual') r`, [U.A, x.rev])));
  return { ...x, job };
}
const api = {
  request: (actor, job) => svc(`select public.distribution_request_extension_handoff($1::uuid, $2::uuid) r`, [actor, job]),
  claim: (hash) => svc(`select public.distribution_claim_extension_handoff($1) r`, [hash]),
  heartbeat: (hash, job, run) => svc(`select public.distribution_heartbeat_extension_handoff($1, $2::uuid, $3::uuid) r`, [hash, job, run]),
  input: (hash, job, run, status, code = null) => svc(`select public.distribution_record_extension_input($1, $2::uuid, $3::uuid, $4, $5) r`, [hash, job, run, status, code]),
};
const ho = async (job) => (await su(`select status, last_code, token_id::text tok, run_id::text run, lease_expires_at is not null lease
  from public.distribution_extension_handoffs where job_id = $1::uuid`, [job])).rows[0];
const jobSnap = async (job) => (await su(`select j.status, j.version, j.phase, j.accepted_evidence_id, j.reconciliation_required rr,
  (select count(*)::int from public.distribution_job_events e where e.job_id = j.id) ev,
  (select count(*)::int from public.distribution_publication_evidence e where e.job_id = j.id) evid
  from public.distribution_jobs j where j.id = $1::uuid`, [job])).rows[0];
const expire = (job) => su(`update public.distribution_extension_handoffs set lease_expires_at = now() - interval '1 second' where job_id = $1::uuid`, [job]);
const RANDOM = "99999999-9999-4999-8999-999999999999";

// ---------------------------------------------------------------- 1. ACL / RLS / search_path
group("1. SECURITY DEFINER · owner/service ACL · RLS · search_path");
const fns = (await su(`select p.proname, p.prosecdef def, array_to_string(p.proconfig, ',') cfg, pg_get_userbyid(p.proowner) own,
    has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u,
    has_function_privilege('service_role', p.oid, 'EXECUTE') s, coalesce(array_to_string(p.proacl, ','), '<default>') acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'distribution\\_handoff\\_%' or p.proname like '%extension\\_handoff' or p.proname = 'distribution_record_extension_input')
  order by 1`)).rows;
const PUBLIC_API = ["distribution_claim_extension_handoff", "distribution_heartbeat_extension_handoff", "distribution_record_extension_input", "distribution_request_extension_handoff"];
expectEq("080000 함수 8개(공개 4 + 내부 4)", fns.length, 8);
for (const f of fns) {
  const pub = PUBLIC_API.includes(f.proname);
  record(`${f.proname}: DEFINER·search_path=''·owner supa_owner·${pub ? "service_role만" : "owner 전용"}`,
    f.def && f.cfg === 'search_path=""' && f.own === "supa_owner" && !f.a && !f.u && f.s === pub && !/(^|,)=X/.test(f.acl),
    `def=${f.def} cfg=${f.cfg} anon=${f.a} auth=${f.u} svc=${f.s}`);
}
const tp = (await su(`select c.relrowsecurity rls, c.relforcerowsecurity force,
    has_table_privilege('service_role', c.oid, 'SELECT') s, has_table_privilege('authenticated', c.oid, 'SELECT') u,
    has_table_privilege('anon', c.oid, 'SELECT') a, has_table_privilege('service_role', c.oid, 'UPDATE') su,
    (select count(*)::int from pg_policies p where p.tablename = c.relname) pol
  from pg_class c where c.oid = 'public.distribution_extension_handoffs'::regclass`)).rows[0];
expectEq("handoffs 표: RLS on · 정책 0 · 모든 역할 권한 없음", tp, { rls: true, force: false, s: false, u: false, a: false, su: false, pol: 0 });
expectErr("service_role 직접 SELECT 거부", await svc(`select status from public.distribution_extension_handoffs`), "42501");
expectErr("service_role 직접 UPDATE 거부", await svc(`update public.distribution_extension_handoffs set status = 'requested'`), "42501");
expectErr("service_role 내부 helper(problem) 직접 호출 거부", await svc(`select public.distribution_handoff_problem($1::uuid)`, [RANDOM]), "42501");
expectErr("service_role 내부 helper(lock_run) 직접 호출로 run 우회 거부",
  await svc(`select public.distribution_handoff_lock_run($1::uuid, $2::uuid, $3::uuid, $4::uuid)`, [U.A, tA.id, RANDOM, RANDOM]), "42501");
expectErr("authenticated(admin JWT) claim 실행 거부",
  await H.tx("authenticated", U.A, [[`select public.distribution_claim_extension_handoff($1)`, [tA.hash]]]), "42501");

// ---------------------------------------------------------------- 2. 요청(D1) · 대상 제한
group("2. 요청: D1 재검사 · blog manual_ready만 · 중복 요청");
const J1 = await blogJob();
expectErr("정지 admin 요청 거부", await api.request(U.S, J1.job), "42501");
expectErr("역할 없는 회원 요청 거부", await api.request(U.M, J1.job), "42501");
expectErr("없는 작업 → no_data_found", await api.request(U.A, RANDOM), "P0002");
{
  const t = await approvedRev("threads");
  const dj = j1(await must("dry job", svc(`select public.distribution_create_job($1::uuid, $2::uuid, 'dry_run', now() + interval '1 hour') r`, [U.A, t.rev])));
  expectErr("threads dry_run 작업 → NOT_HANDOFFABLE(NOT_BLOG_MANUAL)", await api.request(U.A, dj), "23514", "NOT_HANDOFFABLE");
  const J0 = await blogJob();
  await must("posted", svc(`select public.distribution_mark_manual_posted($1::uuid, $2::uuid, 1) r`, [U.A, J0.job]));
  expectErr("awaiting_evidence 작업 → NOT_HANDOFFABLE", await api.request(U.A, J0.job), "23514", "NOT_HANDOFFABLE");
}
const rq = j1(expectOk("승인 admin A 요청", await api.request(U.A, J1.job)));
expectEq("요청 결과 refreshed=false, requested", [rq?.refreshed, rq?.status], [false, "requested"]);
expectErr("다른 admin B가 같은 작업 요청 → HANDOFF_EXISTS", await api.request(U.B, J1.job), "23505", "HANDOFF_EXISTS");
expectEq("A 재요청은 창만 갱신(refreshed=true)", j1(await api.request(U.A, J1.job))?.refreshed, true);

// ---------------------------------------------------------------- 3. 선점: 토큰 소유권 · 인증
group("3. 선점: 토큰 소유권 · 인증 실패 · 전달 내용");
expectErr("형식 불량 해시 → UNAUTHENTICATED(28000)", await api.claim("not-a-hash"), "28000", "UNAUTHENTICATED");
expectErr("등록 안 된 해시 → UNAUTHENTICATED", await api.claim(newToken()), "28000", "UNAUTHENTICATED");
expectEq("B 토큰은 A가 요청한 인계를 가져가지 못함(null)", j1(await api.claim(tB.hash)), null);
expectEq("B 토큰 시도 후에도 requested 유지", (await ho(J1.job)).status, "requested");
const jsBefore = await jobSnap(J1.job);
const c1 = j1(expectOk("A 토큰 선점", await api.claim(tA.hash)));
expectEq("전달 내용 = 작업에 고정된 승인 원문 title + 승인 리비전 body, lease 180", [c1?.job_id, c1?.title, c1?.body, c1?.lease_seconds], [J1.job, J1.title, J1.body, 180]);
expectEq("in_progress + token=A-main + run 발급", await ho(J1.job).then((h) => [h.status, h.tok, h.run === c1?.run_id]), ["in_progress", tA.id, true]);
expectEq("다시 선점 → null(같은 인계 재발급 없음)", j1(await api.claim(tA.hash)), null);

// ---------------------------------------------------------------- 4. runId 위조 · 다른 토큰
group("4. runId 위조 · 같은 소유자 다른 토큰 · 다른 소유자");
expectErr("임의 runId heartbeat → SUPERSEDED", await api.heartbeat(tA.hash, J1.job, RANDOM), "P0001", "SUPERSEDED");
expectErr("null runId → SUPERSEDED", await api.heartbeat(tA.hash, J1.job, null), "P0001", "SUPERSEDED");
expectErr("같은 소유자 다른 토큰(A-second) + 올바른 run → SUPERSEDED", await api.heartbeat(tA2.hash, J1.job, c1.run_id), "P0001", "SUPERSEDED");
expectErr("다른 소유자 B 토큰 + 올바른 run → 없음(P0002)", await api.heartbeat(tB.hash, J1.job, c1.run_id), "P0002");
expectErr("다른 작업 ID + 올바른 run → 없음/위조 거부", await api.input(tA.hash, RANDOM, c1.run_id, "completed"), "P0002");
expectErr("B 토큰으로 입력 결과 위조 거부", await api.input(tB.hash, J1.job, c1.run_id, "publish_ready"), "P0002");
expectEq("위조 시도 후 상태 그대로", (await ho(J1.job)).status, "in_progress");
expectEq("정상 heartbeat ok", j1(await api.heartbeat(tA.hash, J1.job, c1.run_id))?.ok, true);

// ---------------------------------------------------------------- 5. 결과의 published 비전환 · 상태 순서
group("5. 입력 결과: M2 작업 불변(published 비전환) · 상태 순서");
expectErr("지원 안 하는 상태 거부", await api.input(tA.hash, J1.job, c1.run_id, "published"), "22023");
expectEq("completed 기록", j1(await api.input(tA.hash, J1.job, c1.run_id, "completed"))?.status, "completed");
expectErr("completed → in_progress 역행 거부", await api.input(tA.hash, J1.job, c1.run_id, "in_progress"), "P0001", "SUPERSEDED");
expectEq("publish_ready 기록", j1(await api.input(tA.hash, J1.job, c1.run_id, "publish_ready"))?.status, "publish_ready");
expectErr("publish_ready → failed 거부(종료)", await api.input(tA.hash, J1.job, c1.run_id, "failed"), "P0001", "SUPERSEDED");
expectErr("publish_ready 후 heartbeat → SUPERSEDED", await api.heartbeat(tA.hash, J1.job, c1.run_id), "P0001", "SUPERSEDED");
expectEq("M2 작업 행·이벤트·증거 전부 불변(manual_ready 유지, published 아님)", await jobSnap(J1.job), jsBefore);
expectEq("사람이 기존 manual RPC로 게시 선언은 가능", (await svc(`select public.distribution_mark_manual_posted($1::uuid, $2::uuid, $3) r`, [U.A, J1.job, jsBefore.version])).ok, true);
{
  const Jf = await blogJob();
  await must("req", api.request(U.A, Jf.job));
  const cf = j1(await must("claim", api.claim(tA.hash)));
  expectEq("failed + 형식 불량 코드 → EXTENSION_FAILED로 저장(원문 저장 안 함)",
    [j1(await api.input(tA.hash, Jf.job, cf.run_id, "failed", "bad code with spaces"))?.status, (await ho(Jf.job)).last_code], ["failed", "EXTENSION_FAILED"]);
  expectErr("failed → completed 거부", await api.input(tA.hash, Jf.job, cf.run_id, "completed"), "P0001", "SUPERSEDED");
}

// ---------------------------------------------------------------- 6. 진행 중 D1·토큰 철회
group("6. 진행 중 D1 상실 · 토큰 철회");
const J2 = await blogJob();
await must("req", api.request(U.A, J2.job));
const c2 = j1(await must("claim", api.claim(tA.hash)));
await su(`update public.profiles set approval_status = 'suspended' where id = '${U.A}'`);
expectErr("소유자 정지 후 heartbeat → UNAUTHENTICATED", await api.heartbeat(tA.hash, J2.job, c2.run_id), "28000", "UNAUTHENTICATED");
expectErr("소유자 정지 후 입력 결과 → UNAUTHENTICATED", await api.input(tA.hash, J2.job, c2.run_id, "completed"), "28000", "UNAUTHENTICATED");
await su(`update public.profiles set approval_status = 'approved' where id = '${U.A}'`);
await su(`delete from public.role_assignments where user_id = '${U.A}' and role = 'admin'`);
expectErr("admin 역할 회수 후 heartbeat → UNAUTHENTICATED", await api.heartbeat(tA.hash, J2.job, c2.run_id), "28000", "UNAUTHENTICATED");
await su(`insert into public.role_assignments (user_id, role) values ('${U.A}', 'admin')`);
expectEq("복구 후 heartbeat ok", j1(await api.heartbeat(tA.hash, J2.job, c2.run_id))?.ok, true);
await must("revoke tA", svc(`select public.distribution_revoke_extension_token($1::uuid, $2::uuid) r`, [U.A, tA.id]));
expectErr("토큰 철회 후 heartbeat → UNAUTHENTICATED", await api.heartbeat(tA.hash, J2.job, c2.run_id), "28000", "UNAUTHENTICATED");
expectErr("철회 토큰 선점 → UNAUTHENTICATED", await api.claim(tA.hash), "28000", "UNAUTHENTICATED");
{
  // F-3 수정 확인: 철회된 토큰의 진행 건은 관리자 조회 시 needs_check로 정리된다(외부 스케줄러 없이). 자동 재인계 없음.
  expectEq("F-3 전제: 철회 직후 인계는 아직 in_progress", (await ho(J2.job)).status, "in_progress");
  await su(`update public.distribution_extension_handoffs set lease_expires_at = now() - interval '1 hour' where job_id = $1::uuid`, [J2.job]);
  const listed = await svc(`select * from public.distribution_list_extension_handoffs($1::uuid)`, [U.A]);
  expectOk("F-3: 관리자 인계 조회 RPC", listed);
  const row = listed.rows.find((r) => r.job_id === J2.job);
  expectEq("F-3: 조회 시 needs_check로 정리(리스 만료 우선 코드)", [row?.status, row?.last_code], ["needs_check", "LEASE_EXPIRED"]);
  expectEq("F-3: 정리 결과가 표에 남음", (await ho(J2.job)).status, "needs_check");
  expectErr("F-3: needs_check 재요청은 HANDOFF_EXISTS(자동 재인계 없음)", await api.request(U.A, J2.job), "23505", "HANDOFF_EXISTS");
}
const tA3 = await issue(U.A, "A-third");

// ---------------------------------------------------------------- 7. 최신성·승인·보관·작업 상태 재검사
group("7. 선점·진행 중 재검사: 승인 철회 · stale · 보관 · 작업 상태");
{
  const J = await blogJob();
  await must("req", api.request(U.A, J.job));
  await must("revoke approval", svc(`select public.distribution_revoke_approval($1::uuid, $2::uuid, '철회') r`, [U.A, J.revApproval]));
  expectEq("요청 후 승인 철회 → 선점 null(내용 미전달)", j1(await api.claim(tA3.hash)), null);
  expectEq("rejected + BASIS_APPROVAL_REVOKED, run 없음", await ho(J.job).then((h) => [h.status, h.last_code, h.run]), ["rejected", "BASIS_APPROVAL_REVOKED", null]);
}
async function midRun(label, mutate, expectCode) {
  const J = await blogJob();
  await must("req", api.request(U.A, J.job));
  const c = j1(await must("claim", api.claim(tA3.hash)));
  await mutate(J);
  const hb = j1(await api.heartbeat(tA3.hash, J.job, c.run_id));
  expectEq(`진행 중 ${label} → heartbeat ok=false reason=${expectCode}, needs_check`, [hb?.ok, hb?.reason, (await ho(J.job)).status], [false, expectCode, "needs_check"]);
  expectErr(`${label} 후 입력 결과 거부`, await api.input(tA3.hash, J.job, c.run_id, "completed"), "P0001", "SUPERSEDED");
}
await midRun("리비전 승인 철회", (J) => must("rv", svc(`select public.distribution_revoke_approval($1::uuid, $2::uuid, '철회') r`, [U.A, J.revApproval])), "BASIS_APPROVAL_REVOKED");
await midRun("새 원문 버전(stale)", (J) => must("ver", svc(`select public.distribution_append_content_version($1::uuid, $2::uuid, 1, '새 제목', '새 본문') r`, [U.A, J.content])), "BASIS_STALE");
await midRun("초안 보관", (J) => must("arch", svc(`select public.distribution_archive_channel_draft($1::uuid, $2::uuid, '보관') r`, [U.A, J.draft])), "BASIS_ARCHIVED");
await midRun("작업 취소", async (J) => must("cancel", svc(`select public.distribution_cancel_job($1::uuid, $2::uuid, 1, 'x') r`, [U.A, J.job])), "NOT_MANUAL_READY");

// ---------------------------------------------------------------- 8. 리스 만료 · 자동 재인계 방지 · 요청 창
group("8. 리스 만료 → needs_check · 자동 재인계 없음 · 30분 요청 창");
{
  const J = await blogJob();
  await must("req", api.request(U.A, J.job));
  const c = j1(await must("claim", api.claim(tA3.hash)));
  await expire(J.job);
  const hb = j1(await api.heartbeat(tA3.hash, J.job, c.run_id));
  expectEq("만료 후 heartbeat → ok=false LEASE_EXPIRED, needs_check 기록(롤백 안 됨)", [hb?.ok, hb?.reason, (await ho(J.job)).status, (await ho(J.job)).last_code],
    [false, "LEASE_EXPIRED", "needs_check", "LEASE_EXPIRED"]);
  expectErr("needs_check 후 입력 결과 거부", await api.input(tA3.hash, J.job, c.run_id, "publish_ready"), "P0001", "SUPERSEDED");
  expectErr("재요청 → HANDOFF_EXISTS(자동 재인계 없음)", await api.request(U.A, J.job), "23505", "HANDOFF_EXISTS");
  expectEq("재선점 → null(새 run 재발급 없음)", j1(await api.claim(tA3.hash)), null);
}
{
  const J = await blogJob();
  await must("req", api.request(U.A, J.job));
  const c = j1(await must("claim", api.claim(tA3.hash)));
  await expire(J.job);
  const r = j1(await api.input(tA3.hash, J.job, c.run_id, "completed"));
  expectEq("만료 후 다른 상태 보고 → success=false LEASE_EXPIRED + needs_check", [r?.success, r?.reason, (await ho(J.job)).status], [false, "LEASE_EXPIRED", "needs_check"]);
}
{
  const J = await blogJob();
  await must("req", api.request(U.A, J.job));
  const c = j1(await must("claim", api.claim(tA3.hash)));
  await expire(J.job);
  const r = j1(await api.input(tA3.hash, J.job, c.run_id, "in_progress"));
  // F-1 수정 확인: 만료 검사가 unchanged보다 먼저 → 성공 아님 + needs_check 기록
  expectEq("F-1: 만료 후 같은 상태(in_progress) 재보고 → success=false LEASE_EXPIRED + needs_check",
    [r?.success, r?.superseded, r?.reason, (await ho(J.job)).status], [false, true, "LEASE_EXPIRED", "needs_check"]);
}
{
  const J = await blogJob();
  await must("req", api.request(U.A, J.job));
  const c = j1(await must("claim", api.claim(tA3.hash)));
  await must("completed", api.input(tA3.hash, J.job, c.run_id, "completed"));
  await expire(J.job);
  const r = j1(await api.input(tA3.hash, J.job, c.run_id, "completed"));
  expectEq("F-1b: 만료 후 completed 재보고 → success=false + needs_check",
    [r?.success, r?.reason, (await ho(J.job)).status], [false, "LEASE_EXPIRED", "needs_check"]);
}
{
  const J = await blogJob();
  await must("req", api.request(U.A, J.job));
  await su(`update public.distribution_extension_handoffs set requested_at = now() - interval '31 minutes' where job_id = $1::uuid`, [J.job]);
  expectEq("31분 지난 요청은 선점 대상 아님(null)", j1(await api.claim(tA3.hash)), null);
  expectEq("요청자 재요청으로 창 갱신 후 선점 가능", [j1(await api.request(U.A, J.job))?.refreshed, !!j1(await api.claim(tA3.hash))?.run_id], [true, true]);
}

// ---------------------------------------------------------------- 9. 일시적 거절 → 수정 후 재요청 (F-2)
group("9. 선점 시 일시적 조건 거절 → 해소 후 재요청(F-2 수정 확인)");
{
  const J = await blogJob();
  await must("req", api.request(U.A, J.job));
  const late = j1(await must("late", svc(`select public.distribution_record_late_evidence($1::uuid, null, 'https://blog.naver.com/u/late', null, now() - interval '1 minute') r`, [J.job])));
  expectEq("늦은 증거로 reconciliation_required → 선점 null", j1(await api.claim(tA3.hash)), null);
  expectEq("rejected RECONCILIATION_REQUIRED", await ho(J.job).then((h) => [h.status, h.last_code]), ["rejected", "RECONCILIATION_REQUIRED"]);
  await must("resolve reject", svc(`select public.distribution_resolve_evidence($1::uuid, $2::uuid, $3, $4::uuid, 'reject', '무관') r`,
    [U.A, J.job, (await jobSnap(J.job)).version, late]));
  expectEq("증거 반려로 작업은 다시 manual_ready·플래그 해제", await jobSnap(J.job).then((j) => [j.status, j.rr]), ["manual_ready", false]);
  // F-2 수정 확인: 내용 미전달(run·claimed_at 없음)이 증명된 rejected만, D1·근거 재검사 뒤 requested로 재설정
  const r = j1(await api.request(U.A, J.job));
  expectEq("F-2: 조건 해소 후 재요청 → requested 재설정", [r?.status, r?.refreshed], ["requested", true]);
  const c = j1(await api.claim(tA3.hash));
  expectEq("F-2: 재설정된 요청을 정상 선점(승인 내용 전달)", c?.job_id, J.job);
  // 데이터 격리: 이 인계를 끝내 다음 그룹 선점에 섞이지 않게 한다
  await must("finish F-2 handoff", api.input(tA3.hash, J.job, c.run_id, "publish_ready"));
}
{
  // F-2 경계: 전달됐을 수 있는 상태는 재설정하지 않는다
  const J = await blogJob();
  await must("req", api.request(U.A, J.job));
  const c = j1(await must("claim", api.claim(tA3.hash)));
  await must("failed", api.input(tA3.hash, J.job, c.run_id, "failed", "NAVER_ERROR"));
  expectErr("F-2 경계: failed(전달됨) 재요청 → HANDOFF_EXISTS", await api.request(U.A, J.job), "23505", "HANDOFF_EXISTS");
}
expectEq("격리: 그룹 10 전 요청자 A의 대기(requested) 인계 0건", Number(await scalar(
  `select count(*) from public.distribution_extension_handoffs where requested_by = $1::uuid and status = 'requested' and requested_at >= now() - interval '30 minutes'`, [U.A])), 0);

// ---------------------------------------------------------------- 10. 070000 상호작용
group("10. 070000(증거 canonical · recover 격리)과의 상호작용");
expectEq("080000이 070000 함수를 재정의하지 않음(recover 격리·canonical 비교 유지)",
  [/recovery_failed/.test(await scalar(`select prosrc from pg_proc where proname = 'distribution_recover_expired_leases'`)),
   /distribution_canonical_url/.test(await scalar(`select prosrc from pg_proc where proname = 'distribution_evidence_conflicts'`))], [true, true]);
{
  const Ja = await blogJob(); const Jb = await blogJob();
  for (const J of [Ja, Jb]) {
    await must("req", api.request(U.A, J.job));
    const c = j1(await must("claim", api.claim(tA3.hash)));
    await must("ready", api.input(tA3.hash, J.job, c.run_id, "publish_ready"));
    await must("posted", svc(`select public.distribution_mark_manual_posted($1::uuid, $2::uuid, $3) r`, [U.A, J.job, (await jobSnap(J.job)).version]));
  }
  expectOk("인계 publish_ready 후 사람이 증거 기록(작업 a)", await svc(`select public.distribution_record_manual_evidence($1::uuid, $2::uuid, $3, null, 'https://blog.naver.com/u/h1', null, now() - interval '1 minute') r`,
    [U.A, Ja.job, (await jobSnap(Ja.job)).version]));
  expectErr("작업 b에 호스트 대문자 같은 URL → 070000 canonical 충돌 거부 유지", await svc(`select public.distribution_record_manual_evidence($1::uuid, $2::uuid, $3, null, 'https://BLOG.NAVER.COM/u/h1', null, now() - interval '1 minute') r`,
    [U.A, Jb.job, (await jobSnap(Jb.job)).version]), "23505", "EVIDENCE_CONFLICT");
  expectEq("recover는 manual/handoff를 건드리지 않음", (await svc(`select * from public.distribution_recover_expired_leases(100)`)).rows.length, 0);
  expectEq("인계 상태는 M2 published와 독립(published 작업의 handoff는 publish_ready 그대로)", (await ho(Ja.job)).status, "publish_ready");
}

console.log("\n## REVIEW-009 지적(F-1·F-1b·F-2·F-3)은 수정 후 기대 동작 단언으로 위 집계에 포함됨(재현 집계 없음)");
console.log(`적용 080000 hash=${usedHash}`);
H.finish(engine, jsonOut);
