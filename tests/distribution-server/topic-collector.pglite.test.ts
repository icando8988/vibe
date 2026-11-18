/**
 * TOPIC-COLLECT-131 — 글감 후보 서비스 → 실제 migration 함수 왕복(PGlite 대역).
 * `PGLITE_PROJECT`가 있을 때만 실행. 실제 Supabase·네트워크 없음(globalThis.fetch 0회).
 * PGlite는 단일 연결 — "동시" 호출은 직렬 실행이다(유일 인덱스·행 잠금 논리만 확인).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { getContentDetail, listContents } from "@/server/distribution/read";
import { listTopicCandidates } from "@/server/distribution/topics/read";
import { convertTopicCandidate, createTopicCandidate, setTopicCandidateStatus } from "@/server/distribution/topics/service";
import type { RpcClient } from "@/server/distribution/write-runner";
import { inTx, openDb, readSourceOf, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const U = {
  a1: "00000000-0000-4000-8000-00000000000a",
  a2: "00000000-0000-4000-8000-00000000000b",
  pending: "00000000-0000-4000-8000-0000000000c1",
  member: "00000000-0000-4000-8000-0000000000c2",
};
let db: Db;
let rpc: RpcClient;
const fetchSpy = vi.spyOn(globalThis, "fetch");
const deps = (id = U.a1) => ({ resolveActor: async (): Promise<ActorResult> => ({ ok: true, actorId: id }), getClient: () => rpc });
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });

async function owner<T = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> {
  await db.exec("set role supa_owner");
  try {
    return (await db.query(sql, p)).rows as T[];
  } finally {
    await db.exec("reset role");
  }
}
const count = async (table: string) => Number((await owner<{ n: number }>(`select count(*)::int as n from public.${table}`))[0]?.n);
async function denied(role: string, sub: string | null, sql: string): Promise<string | null> {
  try {
    await inTx(db, role, sub, () => db.query(sql));
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}
async function collect(o: Record<string, string>, id = U.a1) {
  const out = await createTopicCandidate(deps(id), form(o));
  if (out.status !== "ok") throw new Error(`collect ${JSON.stringify(out)}`);
  return out.data;
}
async function candidate(id: string) {
  const l = await listTopicCandidates(readSourceOf(db, U.a1));
  if (l.status !== "ok") throw new Error("list");
  const c = l.data.find((x) => x.id === id);
  if (!c) throw new Error("missing candidate");
  return c;
}

describe.skipIf(!PROJECT)("PGlite 왕복: 글감 후보 수집 1단계", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [U.a1, U.a2, U.pending, U.member], [U.pending], [U.a1, U.a2, U.pending]);
    db = opened.db;
    rpc = rpcClientOf(db);
    expect(opened.applied).toContain("20261118030000_distribution_topic_candidates.sql");
  }, 120_000);
  afterAll(() => expect(fetchSpy).not.toHaveBeenCalled());

  it("수집: 메모·출처 링크·분류·출처 날짜·수집 시각이 그대로 보존된다(링크는 저장만)", async () => {
    const r = await collect({ title: "자전거 정비 팁", memo: "체인 관리\n타이어 압력", sourceUrl: "https://Example.com/Post?id=1#top", sourceName: "예시 블로그", category: "정비", sourceDate: "2026-11-01" });
    expect(r.created).toBe(true);
    if (!r.created) return;
    const c = await candidate(r.candidateId);
    expect(c).toMatchObject({ title: "자전거 정비 팁", memo: "체인 관리\n타이어 압력", sourceUrl: "https://Example.com/Post?id=1#top", sourceName: "예시 블로그", category: "정비", sourceDate: "2026-11-01", status: "new", convertedContentId: null, collectedBy: U.a1, rowVersion: 1 });
    expect(Date.parse(c.collectedAt)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("중복: 같은 링크(host 대소문자·#조각 차이)는 다른 관리자·다른 메모여도 기존 후보로 귀결", async () => {
    const first = await collect({ title: "링크 글감", sourceUrl: "https://news.example.com/a/1" });
    if (!first.created) throw new Error("first");
    const again = await collect({ title: "제목이 달라도", memo: "메모가 달라도", sourceUrl: "https://NEWS.example.com/a/1#section" }, U.a2);
    expect(again).toEqual({ created: false, duplicateOf: first.candidateId, duplicateStatus: "new" });
    // 경로 대소문자·쿼리가 다르면 다른 글감
    expect((await collect({ title: "링크 글감", sourceUrl: "https://news.example.com/A/1" })).created).toBe(true);
    expect((await collect({ title: "링크 글감", sourceUrl: "https://news.example.com/a/1?page=2" })).created).toBe(true);
  });

  it("중복: 링크 없는 메모는 제목+메모(공백·대소문자 정리)로 판정", async () => {
    const first = await collect({ title: "Winter  Riding", memo: "장갑과   방풍" });
    if (!first.created) throw new Error("first");
    expect(await collect({ title: " winter riding ", memo: "장갑과 방풍" })).toMatchObject({ created: false, duplicateOf: first.candidateId });
    expect((await collect({ title: "Winter Riding", memo: "다른 메모" })).created).toBe(true);
  });

  it("동시 수집 5건(같은 글감) → 1건만 생성, 나머지는 그 후보를 가리킨다", async () => {
    const outs = await Promise.all(Array.from({ length: 5 }, () => collect({ title: "동시 글감", sourceUrl: "https://example.com/same" })));
    const created = outs.filter((o) => o.created);
    expect(created).toHaveLength(1);
    const id = (created[0] as { candidateId: string }).candidateId;
    expect(outs.filter((o) => !o.created).every((o) => !o.created && o.duplicateOf === id)).toBe(true);
  });

  it("상태: 고르기·되돌리기·제외, 기대 버전 불일치 거절, 제외한 글감은 다시 수집 가능·되살리기는 중복이면 거절", async () => {
    const r = await collect({ title: "상태 글감", sourceUrl: "https://example.com/status" });
    if (!r.created) throw new Error("create");
    const id = r.candidateId;
    expect(await setTopicCandidateStatus(deps(), form({ candidateId: id, expectedVersion: "1", status: "selected" }))).toEqual({ status: "ok", data: { candidateId: id, status: "selected", rowVersion: 2 } });
    expect(await setTopicCandidateStatus(deps(), form({ candidateId: id, expectedVersion: "1", status: "new" }))).toMatchObject({ status: "db_error", error: { code: "conflict_version" } });
    expect(await setTopicCandidateStatus(deps(), form({ candidateId: id, expectedVersion: "2", status: "selected" }))).toMatchObject({ status: "db_error", error: { token: "INVALID_TRANSITION" } });
    expect(await setTopicCandidateStatus(deps(U.a2), form({ candidateId: id, expectedVersion: "2", status: "dismissed" }))).toMatchObject({ status: "ok", data: { status: "dismissed", rowVersion: 3 } });
    // 제외 뒤 같은 글감 재수집 가능
    const re = await collect({ title: "상태 글감", sourceUrl: "https://example.com/status" });
    expect(re.created).toBe(true);
    // 그 사이 다시 수집됐으므로 제외를 되돌릴 수 없다
    expect(await setTopicCandidateStatus(deps(), form({ candidateId: id, expectedVersion: "3", status: "new" }))).toMatchObject({ status: "db_error", error: { code: "duplicate", token: "DUPLICATE" } });
    expect((await candidate(id)).status).toBe("dismissed");
  });

  it("변환: 기존 원문 1버전 생성 + 후보 연결(한 트랜잭션). 승인·초안·작업 없음, 수집 시각·출처 보존", async () => {
    const r = await collect({ title: "변환 글감", memo: "메모 내용", sourceUrl: "https://example.com/convert", category: "여행", sourceDate: "2026-10-15" });
    if (!r.created) throw new Error("create");
    const before = { contents: await count("distribution_contents"), approvals: await count("distribution_approvals"), drafts: await count("distribution_channel_drafts"), jobs: await count("distribution_jobs") };
    const collectedAt = (await candidate(r.candidateId)).collectedAt;
    const out = await convertTopicCandidate(deps(U.a2), form({ candidateId: r.candidateId, expectedVersion: "1", title: "변환된 원문 제목", body: "사람이 다듬은 원문 본문", confirmConvert: "on" }));
    expect(out).toMatchObject({ status: "ok", data: { candidateId: r.candidateId, alreadyConverted: false } });
    if (out.status !== "ok") return;
    const contentId = out.data.contentId;
    const c = await candidate(r.candidateId);
    expect(c).toMatchObject({ status: "converted", convertedContentId: contentId, rowVersion: 2, collectedAt, collectedBy: U.a1, category: "여행", sourceDate: "2026-10-15", sourceUrl: "https://example.com/convert", title: "변환 글감", memo: "메모 내용" });
    expect(c.convertedAt).not.toBeNull();
    // 기존 원문 조회 경로에 그대로 보인다(원문 소유자는 변환한 관리자 — 기존 규칙)
    const detail = await getContentDetail(readSourceOf(db, U.a1), contentId);
    expect(detail).toMatchObject({ status: "ok", data: { currentVersionNo: 1, current: { title: "변환된 원문 제목", body: "사람이 다듬은 원문 본문" }, contentApproval: { state: "none" }, drafts: {} } });
    expect((await owner<{ owner_id: string }>("select owner_id from public.distribution_contents where id = $1", [contentId]))[0]?.owner_id).toBe(U.a2);
    const list = await listContents(readSourceOf(db, U.a1));
    expect(list.status === "ok" && list.data.some((x) => x.id === contentId)).toBe(true);
    expect({ contents: await count("distribution_contents"), approvals: await count("distribution_approvals"), drafts: await count("distribution_channel_drafts"), jobs: await count("distribution_jobs") }).toEqual({ ...before, contents: before.contents + 1 });

    // 중복 변환 요청(같은 기대 버전 재전송·다른 본문) → 새 원문 없이 같은 원문
    for (const f of [{ expectedVersion: "1", title: "변환된 원문 제목", body: "사람이 다듬은 원문 본문" }, { expectedVersion: "2", title: "다른 제목", body: "다른 본문" }]) {
      expect(await convertTopicCandidate(deps(), form({ candidateId: r.candidateId, confirmConvert: "on", ...f }))).toEqual({ status: "ok", data: { candidateId: r.candidateId, contentId, alreadyConverted: true } });
    }
    expect(await count("distribution_contents")).toBe(before.contents + 1);
    // 변환된 후보는 최종 상태
    expect(await setTopicCandidateStatus(deps(), form({ candidateId: r.candidateId, expectedVersion: "2", status: "new" }))).toMatchObject({ status: "db_error", error: { token: "ALREADY_CONVERTED" } });
  });

  it("동시 변환 3건 → 원문 1건, 모두 같은 원문 id", async () => {
    const r = await collect({ title: "동시 변환", sourceUrl: "https://example.com/race" });
    if (!r.created) throw new Error("create");
    const before = await count("distribution_contents");
    const outs = await Promise.all([1, 2, 3].map(() => convertTopicCandidate(deps(), form({ candidateId: r.candidateId, expectedVersion: "1", title: "동시 변환", body: "본문", confirmConvert: "on" }))));
    const ids = new Set(outs.map((o) => (o.status === "ok" ? o.data.contentId : "x")));
    expect(ids.size).toBe(1);
    expect(outs.filter((o) => o.status === "ok" && !o.data.alreadyConverted)).toHaveLength(1);
    expect(await count("distribution_contents")).toBe(before + 1);
  });

  it("변환 거절: 제외한 후보·기대 버전 불일치·원문 입력 오류는 원문을 만들지 않는다", async () => {
    const r = await collect({ title: "거절 글감", sourceUrl: "https://example.com/reject" });
    if (!r.created) throw new Error("create");
    const before = await count("distribution_contents");
    expect(await convertTopicCandidate(deps(), form({ candidateId: r.candidateId, expectedVersion: "9", title: "t", body: "b", confirmConvert: "on" }))).toMatchObject({ status: "db_error", error: { code: "conflict_version" } });
    await setTopicCandidateStatus(deps(), form({ candidateId: r.candidateId, expectedVersion: "1", status: "dismissed" }));
    expect(await convertTopicCandidate(deps(), form({ candidateId: r.candidateId, expectedVersion: "2", title: "t", body: "b", confirmConvert: "on" }))).toMatchObject({ status: "db_error", error: { token: "INVALID_TRANSITION" } });
    expect(await convertTopicCandidate(deps(), form({ candidateId: "00000000-0000-4000-8000-0000000000ff", expectedVersion: "1", title: "t", body: "b", confirmConvert: "on" }))).toMatchObject({ status: "db_error", error: { code: "not_found" } });
    expect(await count("distribution_contents")).toBe(before);
    expect((await candidate(r.candidateId)).status).toBe("dismissed");
  });

  it("D1: 승인 대기 admin·일반 회원은 쓰기 42501, 읽기 0행(RLS)", async () => {
    const before = await count("distribution_topic_candidates");
    for (const id of [U.pending, U.member]) {
      expect(await createTopicCandidate(deps(id), form({ title: `권한 없음 ${id}` }))).toMatchObject({ status: "db_error", error: { code: "forbidden", sqlstate: "42501" } });
      expect(await listTopicCandidates(readSourceOf(db, id))).toEqual({ status: "ok", data: [] });
    }
    const any = (await owner<{ id: string }>("select id from public.distribution_topic_candidates where status = 'new' limit 1"))[0]?.id as string;
    expect(await setTopicCandidateStatus(deps(U.pending), form({ candidateId: any, expectedVersion: "1", status: "selected" }))).toMatchObject({ status: "db_error", error: { code: "forbidden" } });
    expect(await convertTopicCandidate(deps(U.member), form({ candidateId: any, expectedVersion: "1", title: "t", body: "b", confirmConvert: "on" }))).toMatchObject({ status: "db_error", error: { code: "forbidden" } });
    expect(await count("distribution_topic_candidates")).toBe(before);
    const adminList = await listTopicCandidates(readSourceOf(db, U.a2));
    expect(adminList.status === "ok" && adminList.data.length).toBeGreaterThan(0);
  });

  it("DB 검증: 잘못된 날짜·http 링크·빈 제목은 직접 RPC로도 거절", async () => {
    const call = (p: Record<string, unknown>) => rpc.rpc("distribution_create_topic_candidate", { p_actor_id: U.a1, p_title: "직접", ...p });
    expect(((await call({ p_source_date: "2026-02-30" })).error as { code?: string }).code).toBe("22023");
    expect(((await call({ p_source_date: "2999-01-01" })).error as { code?: string }).code).toBe("22023");
    expect(((await call({ p_source_url: "http://example.com/x" })).error as { code?: string }).code).toBe("23514");
    expect(((await call({ p_title: "   " })).error as { code?: string }).code).toBe("22023");
    expect(((await call({ p_memo: "가".repeat(5001) })).error as { code?: string }).code).toBe("23514");
  });

  it("권한·불변: 함수는 service_role만, 테이블 직접 쓰기 불가, 입력 열 수정·삭제 불가, dedupe_key는 읽기 권한 없음", async () => {
    const fns = await owner<{ fn: string; anon: boolean; auth: boolean; svc: boolean }>(
      `select p.proname as fn, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname like 'distribution\\_%topic%' order by 1`,
    );
    expect(fns).toEqual([
      { fn: "distribution_convert_topic_candidate", anon: false, auth: false, svc: true },
      { fn: "distribution_create_topic_candidate", anon: false, auth: false, svc: true },
      { fn: "distribution_set_topic_candidate_status", anon: false, auth: false, svc: true },
      { fn: "distribution_topic_candidates_guard", anon: false, auth: false, svc: false },
      { fn: "distribution_topic_dedupe_key", anon: false, auth: false, svc: false },
    ]);
    const ins = `insert into public.distribution_topic_candidates (title, dedupe_key, collected_by) values ('x', repeat('a',64), '${U.a1}')`;
    expect(await denied("authenticated", U.a1, ins)).toBe("42501");
    expect(await denied("service_role", null, ins)).toBe("42501");
    expect(await denied("anon", null, "select id from public.distribution_topic_candidates")).toBe("42501");
    expect(await denied("authenticated", U.a1, "select dedupe_key from public.distribution_topic_candidates")).toBe("42501");
    await expect(owner("update public.distribution_topic_candidates set title = 'changed', row_version = row_version + 1")).rejects.toMatchObject({ code: "23514" });
    await expect(owner("delete from public.distribution_topic_candidates")).rejects.toMatchObject({ code: "23001" });
  });
});
