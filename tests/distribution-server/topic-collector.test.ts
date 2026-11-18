/**
 * TOPIC-COLLECT-131 — 글감 후보 서비스·액션(모의 RPC·모의 세션). 실제 DB·네트워크 없음(globalThis.fetch 0회).
 */
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import type { Query, ReadSource } from "@/server/distribution/read";
import type { RpcClient, RpcResponse } from "@/server/distribution/write-runner";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const actor = vi.fn<() => Promise<ActorResult>>();
const readSource = vi.fn<() => Promise<ReadSource | null>>();
const serviceClient = vi.fn<() => RpcClient | null>();
vi.mock("@/server/distribution/actor", () => ({ requireDistributionActor: () => actor() }));
vi.mock("@/server/distribution/read-session", () => ({ getSessionReadSource: () => readSource() }));
vi.mock("@/server/distribution/blog/service", () => ({ getServiceRpcClient: () => serviceClient() }));

const { convertTopicCandidate, createTopicCandidate, parseSourceDate, setTopicCandidateStatus, TOPIC_RPC } = await import("@/server/distribution/topics/service");
const { listTopicCandidates, toTopicCandidate, TOPIC_COLS } = await import("@/server/distribution/topics/read");
const actions = await import("@/app/admin/distribution/topic-actions");

const ADMIN = "00000000-0000-4000-8000-00000000000a";
const CAND = "00000000-0000-4000-8000-0000000000a1";
const CONTENT = "00000000-0000-4000-8000-0000000000c1";
const globalFetch = vi.spyOn(globalThis, "fetch");
afterAll(() => expect(globalFetch).not.toHaveBeenCalled());

const form = (o: Record<string, unknown>) => ({ get: (k: string) => (k in o ? o[k] : null) });
function client(reply: (fn: string, p: Record<string, unknown>) => RpcResponse | "throw") {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const c: RpcClient = {
    async rpc(fn, p) {
      calls.push([fn, p]);
      const r = reply(fn, p);
      if (r === "throw") throw new Error("lost");
      return r;
    },
  };
  return { c, calls };
}
const deps = (c: RpcClient | null, a: ActorResult = { ok: true, actorId: ADMIN }) => ({ resolveActor: async () => a, getClient: () => c });
const NOW = new Date("2026-11-19T03:00:00Z");

describe("수집(createTopicCandidate)", () => {
  it("정상 입력 → RPC 1회(정리된 값), 생성 결과", async () => {
    const k = client(() => ({ data: { created: true, candidate_id: CAND }, error: null }));
    const out = await createTopicCandidate(deps(k.c), form({ title: "  자전거 정비 팁  ", memo: "체인 관리\r\n타이어 압력", sourceUrl: "https://Example.com/a?x=1", sourceName: "예시 블로그", category: "정비", sourceDate: "2026-11-01" }), NOW);
    expect(out).toEqual({ status: "ok", data: { created: true, candidateId: CAND } });
    expect(k.calls).toEqual([[TOPIC_RPC.create, { p_actor_id: ADMIN, p_title: "자전거 정비 팁", p_memo: "체인 관리\n타이어 압력", p_source_url: "https://Example.com/a?x=1", p_source_name: "예시 블로그", p_category: "정비", p_source_date: "2026-11-01" }]]);
  });
  it("메모·출처 없이 제목만 → 선택 값은 null", async () => {
    const k = client(() => ({ data: { created: true, candidate_id: CAND }, error: null }));
    await createTopicCandidate(deps(k.c), form({ title: "제목만" }), NOW);
    expect(k.calls[0]?.[1]).toMatchObject({ p_memo: "", p_source_url: null, p_source_name: null, p_category: null, p_source_date: null });
  });
  it("중복 응답은 오류가 아니라 created:false + 기존 후보", async () => {
    const k = client(() => ({ data: { created: false, duplicate_of: CAND, duplicate_status: "selected" }, error: null }));
    expect(await createTopicCandidate(deps(k.c), form({ title: "x" }), NOW)).toEqual({ status: "ok", data: { created: false, duplicateOf: CAND, duplicateStatus: "selected" } });
  });
  it("입력 오류 → invalid, RPC 0회", async () => {
    const k = client(() => ({ data: null, error: null }));
    const cases: Array<[Record<string, unknown>, string[]]> = [
      [{ title: "   " }, ["title"]],
      [{ title: "가".repeat(201) }, ["title"]],
      [{ title: "줄\n바꿈" }, ["title"]],
      [{ title: "x", memo: "가".repeat(5001) }, ["memo"]],
      [{ title: "x", memo: "a\u0007b" }, ["memo"]],
      [{ title: "x", sourceUrl: "http://example.com" }, ["sourceUrl"]],
      [{ title: "x", sourceUrl: "https://user@example.com/" }, ["sourceUrl"]],
      [{ title: "x", sourceUrl: "javascript:alert(1)" }, ["sourceUrl"]],
      [{ title: "x", sourceName: "가".repeat(101) }, ["sourceName"]],
      [{ title: "x", category: "가".repeat(51) }, ["category"]],
      [{ title: "x", sourceDate: "2026-02-30" }, ["sourceDate"]],
      [{ title: "x", sourceDate: "2026/11/01" }, ["sourceDate"]],
      [{ title: "x", sourceDate: "2026-11-25" }, ["sourceDate"]], // 미래
      [{ title: "x", sourceDate: "1989-12-31" }, ["sourceDate"]],
    ];
    for (const [f, fields] of cases) {
      const out = await createTopicCandidate(deps(k.c), form(f), NOW);
      expect(out.status, JSON.stringify(f)).toBe("invalid");
      expect((out as { errors: Array<{ field: string }> }).errors.map((e) => e.field)).toEqual(fields);
    }
    expect(k.calls).toHaveLength(0);
  });
  it("D1 실패 → denied, RPC 0회 / service 연결 없음 → not_ready / 응답 유실·형식 불명 구분", async () => {
    const k = client(() => ({ data: { created: true }, error: null }));
    expect(await createTopicCandidate(deps(k.c, { ok: false, reason: "not_approved" }), form({ title: "x" }), NOW)).toEqual({ status: "denied", reason: "not_approved" });
    expect(k.calls).toHaveLength(0);
    expect(await createTopicCandidate(deps(null), form({ title: "x" }), NOW)).toEqual({ status: "not_ready" });
    expect(await createTopicCandidate(deps(k.c), form({ title: "x" }), NOW)).toEqual({ status: "bad_response" });
    expect(await createTopicCandidate(deps(client(() => "throw").c), form({ title: "x" }), NOW)).toMatchObject({ status: "db_error", error: { code: "unavailable" } });
    expect(await createTopicCandidate(deps(client(() => ({ data: null, error: { code: "42501", message: "actor is not an approved distribution admin" } })).c), form({ title: "x" }), NOW)).toMatchObject({ status: "db_error", error: { code: "forbidden" } });
  });
  it("날짜 파서: 오늘·내일(UTC)까지 허용", () => {
    expect(parseSourceDate("2026-11-19", NOW)).toEqual({ ok: true, value: "2026-11-19" });
    expect(parseSourceDate("2026-11-20", NOW)).toEqual({ ok: true, value: "2026-11-20" });
    expect(parseSourceDate("2026-11-21", NOW)).toEqual({ ok: false });
    expect(parseSourceDate("", NOW)).toEqual({ ok: true, value: null });
  });
});

describe("상태 변경·변환", () => {
  it("상태 변경: 허용 값만(converted는 직접 지정 불가), 기대 버전 필수", async () => {
    const k = client(() => ({ data: { candidate_id: CAND, status: "selected", row_version: 2 }, error: null }));
    expect(await setTopicCandidateStatus(deps(k.c), form({ candidateId: CAND, expectedVersion: "1", status: "selected" }))).toEqual({ status: "ok", data: { candidateId: CAND, status: "selected", rowVersion: 2 } });
    expect(k.calls[0]).toEqual([TOPIC_RPC.setStatus, { p_actor_id: ADMIN, p_candidate_id: CAND, p_expected_version: 1, p_status: "selected" }]);
    for (const f of [{ candidateId: CAND, expectedVersion: "1", status: "converted" }, { candidateId: "x", expectedVersion: "1", status: "new" }, { candidateId: CAND, status: "new" }]) {
      expect((await setTopicCandidateStatus(deps(k.c), form(f))).status).toBe("invalid");
    }
    expect(k.calls).toHaveLength(1);
  });
  it("버전 충돌·전이 오류는 db_error 토큰으로 전달", async () => {
    const conflict = client(() => ({ data: null, error: { code: "P0001", message: "VERSION_CONFLICT: topic candidate x is at version 3 (expected 1)" } }));
    expect(await setTopicCandidateStatus(deps(conflict.c), form({ candidateId: CAND, expectedVersion: "1", status: "dismissed" }))).toMatchObject({ status: "db_error", error: { code: "conflict_version", token: "VERSION_CONFLICT" } });
    const final = client(() => ({ data: null, error: { code: "23514", message: "ALREADY_CONVERTED: converted topic candidates are final" } }));
    expect(await setTopicCandidateStatus(deps(final.c), form({ candidateId: CAND, expectedVersion: "1", status: "new" }))).toMatchObject({ status: "db_error", error: { token: "ALREADY_CONVERTED" } });
  });
  it("변환: 제목·본문·확인 체크 필수, RPC 인자에 승인·채널 없음", async () => {
    const k = client(() => ({ data: { candidate_id: CAND, content_id: CONTENT, already_converted: false, version_id: CONTENT, version_no: 1, content_hash: "a".repeat(64) }, error: null }));
    const ok = { candidateId: CAND, expectedVersion: "2", title: "정비 팁", body: "본문입니다", confirmConvert: "on" };
    expect(await convertTopicCandidate(deps(k.c), form(ok))).toEqual({ status: "ok", data: { candidateId: CAND, contentId: CONTENT, alreadyConverted: false } });
    expect(k.calls[0]).toEqual([TOPIC_RPC.convert, { p_actor_id: ADMIN, p_candidate_id: CAND, p_expected_version: 2, p_title: "정비 팁", p_body: "본문입니다", p_target_path: null }]);
    for (const f of [{ ...ok, confirmConvert: undefined }, { ...ok, body: "  " }, { ...ok, title: "" }, { ...ok, expectedVersion: "x" }]) {
      expect((await convertTopicCandidate(deps(k.c), form(f))).status).toBe("invalid");
    }
    expect(k.calls).toHaveLength(1);
  });
  it("이미 변환된 후보 → 같은 원문(alreadyConverted:true)", async () => {
    const k = client(() => ({ data: { candidate_id: CAND, content_id: CONTENT, already_converted: true }, error: null }));
    expect(await convertTopicCandidate(deps(k.c), form({ candidateId: CAND, expectedVersion: "1", title: "t", body: "b", confirmConvert: "on" }))).toEqual({ status: "ok", data: { candidateId: CAND, contentId: CONTENT, alreadyConverted: true } });
  });
});

describe("목록 조회", () => {
  const row = { id: CAND, title: "t", memo: "", source_url: null, source_name: null, category: "정비", source_date: "2026-11-01", status: "new", converted_content_id: null, converted_at: null, collected_by: ADMIN, collected_at: "2026-11-19T00:00:00Z", row_version: 1, updated_at: "2026-11-19T00:00:00Z" };
  it("허용 열만 요청, 최신 수집 순·100건 제한·상태 필터", async () => {
    const queries: Query[] = [];
    const src: ReadSource = { select: async (q) => (queries.push(q), { rows: [row] }) };
    const out = await listTopicCandidates(src, { status: "new" });
    expect(out).toMatchObject({ status: "ok", data: [{ id: CAND, category: "정비", sourceDate: "2026-11-01", rowVersion: 1, status: "new" }] });
    expect(queries[0]).toEqual({ table: "distribution_topic_candidates", columns: TOPIC_COLS, filters: [{ col: "status", op: "eq", value: "new" }], order: [{ col: "collected_at", ascending: false }], limit: 100 });
    expect(TOPIC_COLS).not.toContain("dedupe_key");
  });
  it("0건·미설정·schema 없음·형식 다른 행을 구분", async () => {
    expect(await listTopicCandidates({ select: async () => ({ rows: [] }) })).toEqual({ status: "ok", data: [] });
    expect(await listTopicCandidates(null)).toEqual({ status: "not_configured" });
    expect(await listTopicCandidates({ select: async () => ({ error: { code: "42P01" } }) })).toEqual({ status: "schema_missing" });
    expect(await listTopicCandidates({ select: async () => ({ rows: [{ ...row, status: "weird" }] }) })).toEqual({ status: "error" });
    expect(toTopicCandidate({ ...row, source_date: "2026-11-01T00:00:00.000Z" })?.sourceDate).toBe("2026-11-01");
  });
});

describe("서버 액션(모의 세션)", () => {
  beforeEach(() => {
    actor.mockReset().mockResolvedValue({ ok: true, actorId: ADMIN });
    readSource.mockReset().mockResolvedValue({ select: async () => ({ rows: [] }) });
    serviceClient.mockReset().mockReturnValue(null);
  });
  const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  it("D1 실패: 쓰기·읽기 모두 denied(읽기 소스·RPC 클라이언트를 만들지 않음)", async () => {
    actor.mockResolvedValue({ ok: false, reason: "forbidden" });
    expect(await actions.createTopicCandidateAction(fd({ title: "x" }))).toEqual({ status: "denied", reason: "forbidden" });
    expect(await actions.setTopicCandidateStatusAction(fd({ candidateId: CAND, expectedVersion: "1", status: "new" }))).toEqual({ status: "denied", reason: "forbidden" });
    expect(await actions.convertTopicCandidateAction(fd({ candidateId: CAND, expectedVersion: "1", title: "t", body: "b", confirmConvert: "on" }))).toEqual({ status: "denied", reason: "forbidden" });
    expect(await actions.listTopicCandidatesAction()).toEqual({ status: "denied", reason: "forbidden" });
    expect(readSource).not.toHaveBeenCalled();
    expect(serviceClient).not.toHaveBeenCalled();
  });
  it("service 키 없음 → 쓰기 not_ready, 목록은 세션 읽기로 동작", async () => {
    expect(await actions.createTopicCandidateAction(fd({ title: "x" }))).toEqual({ status: "not_ready" });
    expect(await actions.listTopicCandidatesAction("selected")).toEqual({ status: "ok", data: [] });
    expect(await actions.listTopicCandidatesAction("bogus")).toEqual({ status: "ok", data: [] }); // 알 수 없는 필터는 무시
  });
  it("액션 → RPC 배선", async () => {
    const k = client(() => ({ data: { created: true, candidate_id: CAND }, error: null }));
    serviceClient.mockReturnValue(k.c);
    expect(await actions.createTopicCandidateAction(fd({ title: "제목", sourceUrl: "https://example.com/p" }))).toEqual({ status: "ok", data: { created: true, candidateId: CAND } });
    expect(k.calls[0]?.[0]).toBe(TOPIC_RPC.create);
  });
});

describe("경계(소스)", () => {
  it("수집 모듈은 네트워크·env·승인/작업 RPC를 쓰지 않는다", () => {
    const dir = "src/server/distribution/topics";
    const files = [...readdirSync(dir).map((f) => `${dir}/${f}`), "src/app/admin/distribution/topic-actions.ts"];
    for (const f of files) {
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/\bfetch\(|XMLHttpRequest|node:https?|process\.env/);
      expect(code, f).not.toMatch(/decide_approval|decideApproval|create_job|createBlogManualJob|create_channel_draft|Posting_Kit|handoff\//);
    }
  });
  it("액션 파일: use server, export는 async 함수 4개뿐", () => {
    const a = readFileSync("src/app/admin/distribution/topic-actions.ts", "utf8");
    expect(a.startsWith('"use server";')).toBe(true);
    expect(a.match(/^export async function /gm)).toHaveLength(4);
    expect(a.match(/^export /gm)).toHaveLength(4);
  });
});
