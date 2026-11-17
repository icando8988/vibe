#!/usr/bin/env node
/**
 * AUTOPOST-BLOG-HANDOFF-007 — 확장 승인본 인계(080000) 로컬 검증 러너(독립).
 * 기존 run/m2-run/token-run/lib는 수정하지 않는다. lib의 대역·적용 함수로 migrations 폴더의 모든 파일을 순서대로 적용하고,
 * 실제로 적용된 파일 목록을 결과에 남긴다(070000 등 다른 작업 파일 포함 여부를 명시하기 위함).
 *   node web/scripts/distribution-local-verify/handoff-run.mjs --pglite-project <dir> [--json <out.json>]
 * 종료 코드: 0 전부 통과 · 1 시나리오 실패 · 2 migration 적용 실패 · 3 PGlite 없음(NOT RUN)
 * 실제 Supabase가 아니다. 비밀값·env·네트워크 없음. 토큰은 시험용 무작위 값이며 출력하지 않는다.
 */
import { createHash, randomBytes } from "node:crypto";
import { applyStandinAndMigrations, argOf, createHarness, loadPGlite } from "./lib.mjs";

const PGlite = await loadPGlite(argOf("--pglite-project"));
const jsonOut = argOf("--json");
const db = new PGlite();
const h = createHarness(db);
const { group, record, tx, svc, su, scalar, must, expectOk, expectErr, finish } = h;
// 객체 비교는 양쪽 키를 정렬해 순서와 무관하게 한다.
const expectEq = (name, actual, expected) => h.expectEq(name, sortKeys(actual), sortKeys(expected));

const U = {
  admin: "00000000-0000-4000-8000-00000000000a",
  admin2: "00000000-0000-4000-8000-00000000000b",
  pending: "00000000-0000-4000-8000-0000000000c1",
  suspended: "00000000-0000-4000-8000-0000000000c2",
  member: "00000000-0000-4000-8000-0000000000d1",
};
const newToken = () => `pat_${randomBytes(32).toString("hex")}`;
const hashOf = (t) => createHash("sha256").update(t).digest("hex");
// jsonb는 키 순서를 보존하지 않으므로 비교 전에 키를 정렬한다.
const sortKeys = (v) => (v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const j1 = (r) => (r.ok ? sortKeys(r.rows[0]?.r) : undefined);

const api = {
  issueToken: (actor, hash) => svc("select public.distribution_issue_extension_token($1::uuid, $2, 'pc', 30) r", [actor, hash]),
  revokeToken: (actor, id) => svc("select public.distribution_revoke_extension_token($1::uuid, $2::uuid) r", [actor, id]),
  createContent: (title) => svc("select public.distribution_create_content($1::uuid, $2, '원문 본문') r", [U.admin, title]),
  appendVersion: (cid, exp) => svc("select public.distribution_append_content_version($1::uuid, $2::uuid, $3, '바뀐 제목', '바뀐 본문') r", [U.admin, cid, exp]),
  createDraft: (cid, ch) => svc("select public.distribution_create_channel_draft($1::uuid, $2::uuid, $3) r", [U.admin, cid, ch]),
  appendRevision: (did, exp, vid, body) => svc(`select public.distribution_append_draft_revision(p_actor_id => $1::uuid, p_draft_id => $2::uuid,
      p_expected_revision_no => $3, p_expected_content_version_id => $4::uuid, p_body => $5) r`, [U.admin, did, exp, vid, body]),
  decide: (type, id, hash) => svc("select public.distribution_decide_approval($1::uuid, $2, $3::uuid, 'approved', $4, '{\"ok\":true}'::jsonb) r", [U.admin, type, id, hash]),
  revokeApproval: (aid) => svc("select public.distribution_revoke_approval($1::uuid, $2::uuid, '철회') r", [U.admin, aid]),
  archiveContent: (cid) => svc("select public.distribution_archive_content($1::uuid, $2::uuid, '보관') r", [U.admin, cid]),
  createJob: (rev, mode) => svc("select public.distribution_create_job($1::uuid, $2::uuid, $3) r", [U.admin, rev, mode]),
  request: (actor, job) => svc("select public.distribution_request_extension_handoff($1::uuid, $2::uuid) r", [actor, job]),
  claim: (hash) => svc("select public.distribution_claim_extension_handoff($1) r", [hash]),
  heartbeat: (hash, job, run) => svc("select public.distribution_heartbeat_extension_handoff($1, $2::uuid, $3::uuid) r", [hash, job, run]),
  input: (hash, job, run, status, code = null) =>
    svc("select public.distribution_record_extension_input($1, $2::uuid, $3::uuid, $4, $5) r", [hash, job, run, status, code]),
};

let seq = 0;
async function approvedBlogJob(mode = "manual", channel = "blog") {
  const title = `승인 원문 제목 ${++seq}`;
  const body = `승인 리비전 본문 ${seq}\n\n둘째 문단`;
  const c = j1(await must("content", api.createContent(title)));
  const d = j1(await must("draft", api.createDraft(c.content_id, channel)));
  const r = j1(await must("revision", api.appendRevision(d.draft_id, 0, c.version_id, body)));
  await must("approve content", api.decide("content_version", c.version_id, c.content_hash));
  const ra = j1(await must("approve revision", api.decide("draft_revision", r.revision_id, r.revision_hash)));
  const jobId = j1(await must("job", api.createJob(r.revision_id, mode)));
  return { jobId, contentId: c.content_id, title, body, revApproval: ra.approval_id };
}
async function jobSnap(id) {
  return (await su(`select j.status, j.version, j.external_id, j.accepted_evidence_id,
      (select count(*)::int from public.distribution_job_events e where e.job_id = j.id) ev_n,
      (select count(*)::int from public.distribution_publication_evidence p where p.job_id = j.id) evid_n
    from public.distribution_jobs j where j.id = $1::uuid`, [id])).rows[0];
}
const handoff = async (jobId) => (await su(
  "select status, last_code, run_id::text run, token_id::text tok from public.distribution_extension_handoffs where job_id = $1::uuid", [jobId])).rows[0];

console.log(`# AUTOPOST-BLOG-HANDOFF-007 handoff-run · ${new Date().toISOString()}`);
console.log(`엔진: ${String(await scalar("select version()")).split(" on ")[0]} — Supabase 대역이며 실제 Supabase 아님`);

// ---- 0. 적용
group("0. 대역 + migrations 폴더 전체 순서 적용 (owner = 비superuser supa_owner)");
let applied;
try {
  applied = await applyStandinAndMigrations(db);
} catch (e) {
  record("migration 적용", false, String(e.message).slice(0, 300));
  finish({}, jsonOut, 2);
}
record("적용된 migration 목록", true, applied.map((a) => a.file.slice(0, 14)).join(", "));
expectEq("080000이 적용 목록에 있음", applied.some((a) => a.file === "20261116080000_distribution_extension_handoffs.sql"), true);
await su(`insert into auth.users (id) values ${Object.values(U).map((v) => `('${v}')`).join(",")}`);
await su(`update public.profiles set approval_status = case id
  when '${U.pending}' then 'pending' when '${U.suspended}' then 'suspended' else 'approved' end`);
await su(`insert into public.role_assignments (user_id, role) values
  ('${U.admin}','admin'),('${U.admin2}','admin'),('${U.pending}','admin'),('${U.suspended}','admin')`);
const tokA = newToken();
const tokA2 = newToken();
const tokB = newToken();
const tokAId = j1(await must("token A", api.issueToken(U.admin, hashOf(tokA)))).id;
const tokA2Id = j1(await must("token A2", api.issueToken(U.admin, hashOf(tokA2)))).id;
await must("token B", api.issueToken(U.admin2, hashOf(tokB)));
record("픽스처: 사용자·역할·토큰(admin 2개, admin2 1개)", true);

// ---- 1. ACL
group("1. ACL — 테이블 직접 접근 차단, 공개 RPC는 service_role만, 내부 helper는 owner만");
for (const role of ["anon", "authenticated", "service_role"]) {
  const p = (await su(`select has_table_privilege('${role}', 'public.distribution_extension_handoffs', 'SELECT') s,
      has_table_privilege('${role}', 'public.distribution_extension_handoffs', 'INSERT') i,
      has_table_privilege('${role}', 'public.distribution_extension_handoffs', 'UPDATE') u,
      has_table_privilege('${role}', 'public.distribution_extension_handoffs', 'DELETE') d`)).rows[0];
  expectEq(`${role}: 인계 테이블 권한 없음`, p, { s: false, i: false, u: false, d: false });
}
expectEq("RLS 활성", await scalar("select relrowsecurity from pg_class where oid = 'public.distribution_extension_handoffs'::regclass"), true);
const PUBLIC_FNS = [
  "public.distribution_request_extension_handoff(uuid,uuid)",
  "public.distribution_claim_extension_handoff(text)",
  "public.distribution_heartbeat_extension_handoff(text,uuid,uuid)",
  "public.distribution_record_extension_input(text,uuid,uuid,text,text)",
];
const INTERNAL_FNS = [
  "public.distribution_handoff_token_owner(text)",
  "public.distribution_handoff_expire(uuid)",
  "public.distribution_handoff_problem(uuid)",
  "public.distribution_handoff_lock_run(uuid,uuid,uuid,uuid)",
];
for (const [list, svcOk] of [[PUBLIC_FNS, true], [INTERNAL_FNS, false]]) {
  for (const f of list) {
    const g = (await su(`select has_function_privilege('anon', '${f}', 'EXECUTE') a,
        has_function_privilege('authenticated', '${f}', 'EXECUTE') au,
        has_function_privilege('service_role', '${f}', 'EXECUTE') s,
        coalesce((select bool_or(grantee = 0) from aclexplode(p.proacl)), false) pub, p.prosecdef def, p.proconfig cfg
      from pg_proc p where p.oid = '${f}'::regprocedure`)).rows[0];
    expectEq(`${f.split("(")[0].replace("public.", "")}: ${svcOk ? "service_role만" : "owner만"}, DEFINER, search_path=''`, g,
      { a: false, au: false, s: svcOk, pub: false, def: true, cfg: ['search_path=""'] });
  }
}
expectErr("service_role 직접 SELECT 거부", await svc("select count(*) from public.distribution_extension_handoffs"), "42501");
expectErr("service_role 내부 helper 호출 거부", await svc("select public.distribution_handoff_problem(gen_random_uuid())"), "42501");
expectErr("authenticated(admin JWT) 선점 호출 거부", await tx("authenticated", U.admin, [["select public.distribution_claim_extension_handoff($1)", [hashOf(tokA)]]]), "42501");
expectErr("anon 입력 결과 호출 거부", await tx("anon", null, [["select public.distribution_record_extension_input($1, gen_random_uuid(), gen_random_uuid(), 'failed')", [hashOf(tokA)]]]), "42501");

// ---- 2. 요청
group("2. 요청 — D1 actor, manual_ready blog만, 중복·다른 admin 차단");
const J1 = await approvedBlogJob();
for (const [name, actor] of [["admin pending", U.pending], ["admin suspended", U.suspended], ["역할 없는 회원", U.member]]) {
  expectErr(`요청 거부: ${name}`, await api.request(actor, J1.jobId), "42501");
}
const dry = await approvedBlogJob("dry_run");
expectErr("blog dry_run 작업 → NOT_HANDOFFABLE", await api.request(U.admin, dry.jobId), "23514", "NOT_HANDOFFABLE");
const thr = await approvedBlogJob("dry_run", "threads");
expectErr("threads 작업 → NOT_HANDOFFABLE", await api.request(U.admin, thr.jobId), "23514", "NOT_HANDOFFABLE");
expectErr("없는 작업 → P0002", await svc("select public.distribution_request_extension_handoff($1::uuid, gen_random_uuid()) r", [U.admin]), "P0002");
expectEq("요청 성공", j1(await api.request(U.admin, J1.jobId))?.status, "requested");
expectEq("같은 admin 재요청 → 창만 갱신", j1(await api.request(U.admin, J1.jobId))?.refreshed, true);
expectErr("다른 admin 요청 → HANDOFF_EXISTS", await api.request(U.admin2, J1.jobId), "23505", "HANDOFF_EXISTS");

// ---- 3. 선점
group("3. 선점 — 토큰 소유자 요청만, 승인 원문 title + 승인 리비전 body, 1회만, 최신성 재검사");
const before1 = await jobSnap(J1.jobId);
expectErr("모르는 토큰 → UNAUTHENTICATED", await api.claim(hashOf(newToken())), "28000", "UNAUTHENTICATED");
expectErr("원문 토큰을 해시 자리에 → UNAUTHENTICATED", await api.claim(tokA), "28000", "UNAUTHENTICATED");
expectEq("다른 admin 토큰은 남의 요청을 못 가져감", j1(await api.claim(hashOf(tokB))), null);
const task1 = j1(await api.claim(hashOf(tokA)));
expectEq("선점 응답 키(토큰·해시 없음)", Object.keys(task1 ?? {}).sort(), ["body", "job_id", "lease_seconds", "run_id", "title"]);
expectEq("title = 승인 원문 버전 제목, body = 승인 리비전 본문", { t: task1?.title, b: task1?.body, j: task1?.job_id }, { t: J1.title, b: J1.body, j: J1.jobId });
expectEq("응답에 토큰·해시 문자열 없음", JSON.stringify(task1).includes(hashOf(tokA)) || JSON.stringify(task1).includes(tokA), false);
expectEq("두 번째 선점 → null(같은 작업 재인계 없음)", j1(await api.claim(hashOf(tokA))), null);
expectEq("선점해도 M2 작업 불변(manual_ready, 이벤트·증거 그대로)", await jobSnap(J1.jobId), before1);
expectErr("인계 행 중복 생성 불가(unique job_id, superuser 직접 삽입)", await su(
  "insert into public.distribution_extension_handoffs (job_id, requested_by) values ($1::uuid, $2::uuid)", [J1.jobId, U.admin]), "23505");

const Jstale = await approvedBlogJob();
await must("req stale", api.request(U.admin, Jstale.jobId));
await must("new version", api.appendVersion(Jstale.contentId, 1));
expectEq("원문 새 버전 후 선점 → null", j1(await api.claim(hashOf(tokA))), null);
expectEq("최신성 위반 인계 → rejected(BASIS_STALE), 내용 미전달", await handoff(Jstale.jobId).then((x) => ({ s: x.status, c: x.last_code, run: x.run })),
  { s: "rejected", c: "BASIS_STALE", run: null });
const Jrev = await approvedBlogJob();
await must("req rev", api.request(U.admin, Jrev.jobId));
await must("revoke approval", api.revokeApproval(Jrev.revApproval));
expectEq("승인 철회 후 선점 → null, rejected(BASIS_APPROVAL_REVOKED)", (await api.claim(hashOf(tokA)), (await handoff(Jrev.jobId)).last_code), "BASIS_APPROVAL_REVOKED");
const Jarc = await approvedBlogJob();
await must("req arc", api.request(U.admin, Jarc.jobId));
await must("archive", api.archiveContent(Jarc.contentId));
expectEq("보관 후 선점 → rejected(BASIS_ARCHIVED)", (await api.claim(hashOf(tokA)), (await handoff(Jarc.jobId)).last_code), "BASIS_ARCHIVED");
const Jold = await approvedBlogJob();
await must("req old", api.request(U.admin, Jold.jobId));
await su("update public.distribution_extension_handoffs set requested_at = now() - interval '31 minutes' where job_id = $1::uuid", [Jold.jobId]);
expectEq("30분 지난 요청은 자동 시작 안 함", j1(await api.claim(hashOf(tokA))), null);
expectEq("지난 요청은 requested 그대로", (await handoff(Jold.jobId)).status, "requested");

// ---- 4. 리스 연장
group("4. heartbeat — 소유 토큰·run만, 만료 → needs_check(자동 재입력·새 run 없음)");
expectErr("다른 run → SUPERSEDED", await api.heartbeat(hashOf(tokA), J1.jobId, "00000000-0000-4000-8000-000000000999"), "P0001", "SUPERSEDED");
expectErr("같은 소유자의 다른 토큰 → SUPERSEDED", await api.heartbeat(hashOf(tokA2), J1.jobId, task1.run_id), "P0001", "SUPERSEDED");
expectErr("다른 admin 토큰 → P0002(존재 비노출)", await api.heartbeat(hashOf(tokB), J1.jobId, task1.run_id), "P0002");
expectErr("모르는 토큰 → UNAUTHENTICATED", await api.heartbeat(hashOf(newToken()), J1.jobId, task1.run_id), "28000", "UNAUTHENTICATED");
expectEq("소유 토큰·run → 연장", j1(await api.heartbeat(hashOf(tokA), J1.jobId, task1.run_id)), { ok: true, lease_seconds: 180 });

const J2 = await approvedBlogJob();
await must("req J2", api.request(U.admin, J2.jobId));
const task2 = j1(await api.claim(hashOf(tokA)));
await su("update public.distribution_extension_handoffs set lease_expires_at = now() - interval '1 second' where job_id = $1::uuid", [J2.jobId]);
expectEq("리스 만료 heartbeat → superseded(LEASE_EXPIRED)", j1(await api.heartbeat(hashOf(tokA), J2.jobId, task2.run_id)),
  { ok: false, superseded: true, reason: "LEASE_EXPIRED" });
expectEq("만료 기록이 남음(needs_check, run 유지)", await handoff(J2.jobId).then((x) => ({ s: x.status, c: x.last_code, run: x.run })),
  { s: "needs_check", c: "LEASE_EXPIRED", run: task2.run_id });
expectErr("만료 뒤 heartbeat → SUPERSEDED", await api.heartbeat(hashOf(tokA), J2.jobId, task2.run_id), "P0001", "SUPERSEDED");
expectErr("만료 뒤 입력 결과 → SUPERSEDED", await api.input(hashOf(tokA), J2.jobId, task2.run_id, "publish_ready"), "P0001", "SUPERSEDED");
expectEq("만료 뒤 재선점 → null(새 run 미발급)", j1(await api.claim(hashOf(tokA))), null);
expectErr("만료 뒤 재요청 → HANDOFF_EXISTS(자동 재입력 없음)", await api.request(U.admin, J2.jobId), "23505", "HANDOFF_EXISTS");

const J3 = await approvedBlogJob();
await must("req J3", api.request(U.admin, J3.jobId));
const task3 = j1(await api.claim(hashOf(tokA)));
await must("revoke J3 approval", api.revokeApproval(J3.revApproval));
expectEq("입력 중 승인 철회 → heartbeat superseded", j1(await api.heartbeat(hashOf(tokA), J3.jobId, task3.run_id))?.reason, "BASIS_APPROVAL_REVOKED");
expectEq("철회 감지 기록(needs_check)", (await handoff(J3.jobId)).status, "needs_check");

// ---- 5. 입력 결과
group("5. input-result — 상태 기록만, M2 작업 불변(published·awaiting_evidence 안 됨)");
const before5 = await jobSnap(J1.jobId);
expectErr("지원하지 않는 상태 → 22023", await api.input(hashOf(tokA), J1.jobId, task1.run_id, "published"), "22023");
expectErr("다른 run → SUPERSEDED", await api.input(hashOf(tokA), J1.jobId, "00000000-0000-4000-8000-000000000999", "completed"), "P0001", "SUPERSEDED");
expectEq("completed 기록", j1(await api.input(hashOf(tokA), J1.jobId, task1.run_id, "completed")), { success: true, persisted: true, status: "completed", unchanged: false });
expectEq("같은 상태 재보고 → unchanged", j1(await api.input(hashOf(tokA), J1.jobId, task1.run_id, "completed"))?.unchanged, true);
expectEq("publish_ready 기록", j1(await api.input(hashOf(tokA), J1.jobId, task1.run_id, "publish_ready"))?.status, "publish_ready");
expectErr("publish_ready 뒤 늦은 failed → SUPERSEDED", await api.input(hashOf(tokA), J1.jobId, task1.run_id, "failed", "LATE"), "P0001", "SUPERSEDED");
expectEq("입력 결과 뒤에도 M2 작업 불변(manual_ready, 증거 0)", await jobSnap(J1.jobId), before5);
expectEq("작업 상태가 published·awaiting_evidence가 아님", (await jobSnap(J1.jobId)).status, "manual_ready");
expectErr("publish_ready 뒤 heartbeat → SUPERSEDED", await api.heartbeat(hashOf(tokA), J1.jobId, task1.run_id), "P0001", "SUPERSEDED");

const J4 = await approvedBlogJob();
await must("req J4", api.request(U.admin, J4.jobId));
const task4 = j1(await api.claim(hashOf(tokA)));
expectEq("failed + 소문자 코드 → 코드는 저장 안 함(기본 EXTENSION_FAILED)", (await api.input(hashOf(tokA), J4.jobId, task4.run_id, "failed", "네이버 오류 문장 그대로"),
  (await handoff(J4.jobId)).last_code), "EXTENSION_FAILED");

const J5 = await approvedBlogJob();
await must("req J5", api.request(U.admin, J5.jobId));
const task5 = j1(await api.claim(hashOf(tokA)));
await must("revoke token A", api.revokeToken(U.admin, tokAId));
expectErr("토큰 철회 후 heartbeat → UNAUTHENTICATED", await api.heartbeat(hashOf(tokA), J5.jobId, task5.run_id), "28000", "UNAUTHENTICATED");
expectErr("토큰 철회 후 입력 결과 → UNAUTHENTICATED", await api.input(hashOf(tokA), J5.jobId, task5.run_id, "completed"), "28000", "UNAUTHENTICATED");
expectErr("다른 토큰(A2)으로 이어받기 → SUPERSEDED", await api.input(hashOf(tokA2), J5.jobId, task5.run_id, "completed"), "P0001", "SUPERSEDED");

const J6 = await approvedBlogJob();
await must("req J6", api.request(U.admin, J6.jobId));
const task6 = j1(await api.claim(hashOf(tokA2)));
await su(`update public.profiles set approval_status = 'suspended' where id = '${U.admin}'`);
expectErr("소유자 정지 → 진행 요청 UNAUTHENTICATED", await api.heartbeat(hashOf(tokA2), J6.jobId, task6.run_id), "28000", "UNAUTHENTICATED");
await su(`update public.profiles set approval_status = 'approved' where id = '${U.admin}'`);
expectEq("재승인 → 같은 run 계속", j1(await api.heartbeat(hashOf(tokA2), J6.jobId, task6.run_id))?.ok, true);
void tokA2Id;

// ---- 6. REVIEW-009 수정 확인(F-1·F-2·F-3) — 결함 재현이 아니라 수정 후 기대 동작을 단언한다
group("6. REVIEW-009 수정 — F-1 만료 우선, F-2 미전달 rejected만 재요청, F-3 관리자 조회·정리");
const tokC = newToken();
await must("token C", api.issueToken(U.admin, hashOf(tokC)));
const F1 = await approvedBlogJob();
await must("req F1", api.request(U.admin, F1.jobId));
const tF1 = j1(await api.claim(hashOf(tokC)));
await su("update public.distribution_extension_handoffs set lease_expires_at = now() - interval '1 second' where job_id = $1::uuid", [F1.jobId]);
expectEq("F-1: 만료 뒤 같은 상태(in_progress) 재보고 → 성공 아님(superseded LEASE_EXPIRED)",
  j1(await api.input(hashOf(tokC), F1.jobId, tF1.run_id, "in_progress")), { success: false, persisted: false, superseded: true, reason: "LEASE_EXPIRED" });
expectEq("F-1: needs_check 기록이 남음", (await handoff(F1.jobId)).status, "needs_check");
const F1b = await approvedBlogJob();
await must("req F1b", api.request(U.admin, F1b.jobId));
const tF1b = j1(await api.claim(hashOf(tokC)));
await must("completed", api.input(hashOf(tokC), F1b.jobId, tF1b.run_id, "completed"));
await su("update public.distribution_extension_handoffs set lease_expires_at = now() - interval '1 second' where job_id = $1::uuid", [F1b.jobId]);
expectEq("F-1b: 만료 뒤 completed 재보고 → superseded", j1(await api.input(hashOf(tokC), F1b.jobId, tF1b.run_id, "completed"))?.superseded, true);

const F2 = await approvedBlogJob();
await must("req F2", api.request(U.admin, F2.jobId));
// 일시 조건은 실제 M2 흐름으로 만든다(REVIEW-009 그룹 9와 같은 경로): 늦은 증거 → reconciliation_required → 반려로 해제.
const lateEv = j1(await must("late evidence", svc(
  "select public.distribution_record_late_evidence($1::uuid, null, 'https://blog.naver.com/x/1', null, now() - interval '1 minute') r", [F2.jobId])));
const f2Rejected = (await api.claim(hashOf(tokC)), await handoff(F2.jobId));
expectEq("F-2 준비: 일시 조건(대사 필요)으로 rejected, 내용 미전달(run 없음)", { s: f2Rejected.status, c: f2Rejected.last_code, run: f2Rejected.run },
  { s: "rejected", c: "RECONCILIATION_REQUIRED", run: null });
expectErr("F-2: 조건이 남아 있으면 재요청 거절(NOT_HANDOFFABLE)", await api.request(U.admin, F2.jobId), "23514", "NOT_HANDOFFABLE");
const f2Version = await scalar("select version from public.distribution_jobs where id = $1::uuid", [F2.jobId]);
await must("reject late evidence", svc("select public.distribution_resolve_evidence($1::uuid, $2::uuid, $3, $4::uuid, 'reject', '오탐') r",
  [U.admin, F2.jobId, f2Version, typeof lateEv === "string" ? lateEv : lateEv?.r ?? lateEv]));
expectEq("F-2 준비: 반려 후 대사 필요 해제·manual_ready", await scalar(
  "select status || ':' || reconciliation_required from public.distribution_jobs where id = $1::uuid", [F2.jobId]), "manual_ready:false");
expectEq("F-2: 조건 해소 후 재요청 → requested로 재설정", j1(await api.request(U.admin, F2.jobId))?.status, "requested");
expectEq("F-2: 재설정 후 정상 선점", j1(await api.claim(hashOf(tokC)))?.job_id, F2.jobId);
expectErr("F-2: needs_check(전달됐을 수 있음)는 여전히 재요청 거절", await api.request(U.admin, F1.jobId), "23505", "HANDOFF_EXISTS");
expectErr("F-2: completed 인계도 재요청 거절", await api.request(U.admin, F1b.jobId), "23505", "HANDOFF_EXISTS");
expectErr("F-2: 재요청도 D1 재검사(비승인 actor 거부)",
  await svc("select public.distribution_request_extension_handoff($1::uuid, $2::uuid) r", [U.pending, F2.jobId]), "42501");

const LIST = "select * from public.distribution_list_extension_handoffs($1::uuid)";
const F3 = await approvedBlogJob();
await must("req F3", api.request(U.admin, F3.jobId));
const tokD = newToken();
const tokDId = j1(await must("token D", api.issueToken(U.admin, hashOf(tokD)))).id;
await must("claim F3", api.claim(hashOf(tokD)));
await must("revoke D", api.revokeToken(U.admin, tokDId));
expectEq("F-3 준비: 토큰 철회 직후에도 인계 행은 in_progress(리스 남음)", (await handoff(F3.jobId)).status, "in_progress");
const listed = expectOk("F-3: 관리자 인계 조회", await svc(LIST, [U.admin]));
const row = listed.rows.find((r) => r.job_id === F3.jobId);
expectEq("F-3: 조회 시 철회된 토큰의 인계 → needs_check(TOKEN_REVOKED)", { s: row?.status, c: row?.last_code }, { s: "needs_check", c: "TOKEN_REVOKED" });
expectEq("F-3: 조회 열(본문·토큰·해시·run 없음)", Object.keys(listed.rows[0] ?? {}).sort(),
  ["claimed_at", "finished_at", "job_id", "last_code", "lease_expires_at", "requested_at", "status", "updated_at"]);
expectEq("F-3: 본인 요청만(다른 admin 목록에 없음)", (await svc(LIST, [U.admin2])).rows.some((r) => r.job_id === F3.jobId), false);
expectErr("F-3: 비승인 actor 조회 거부", await svc(LIST, [U.suspended]), "42501");
expectErr("F-3: needs_check 자동 재요청 없음(재요청 거절)", await api.request(U.admin, F3.jobId), "23505", "HANDOFF_EXISTS");
const acl = (await su(`select has_function_privilege('anon', 'public.distribution_list_extension_handoffs(uuid)', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.distribution_list_extension_handoffs(uuid)', 'EXECUTE') au,
  has_function_privilege('service_role', 'public.distribution_list_extension_handoffs(uuid)', 'EXECUTE') s,
  p.prosecdef def, p.proconfig cfg from pg_proc p where p.oid = 'public.distribution_list_extension_handoffs(uuid)'::regprocedure`)).rows[0];
expectEq("F-3: 조회 RPC ACL·DEFINER·search_path", acl, { a: false, au: false, s: true, def: true, cfg: ['search_path=""'] });
expectEq("F-3: 인계 정리 후에도 M2 작업 불변(manual_ready)", (await jobSnap(F3.jobId)).status, "manual_ready");

finish({}, jsonOut);
