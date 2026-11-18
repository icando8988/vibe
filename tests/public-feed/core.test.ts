/**
 * QA-PUBLIC-FEED-SECURITY-098 — 방문자 공개 피드 보안 계약 시험(CC-TESTER-01).
 * 주입 ReadSource(메모리 표)와 고정 fixture만 쓴다. DB·네트워크·환경변수·브라우저 없음.
 * index.ts는 "server-only"를 import하므로 실행하지 않고 소스 문자열로만 검사한다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  loadPublicChannelFeeds,
  opaquePostId,
  plainExcerpt,
  publicTitle,
  publishedAtOf,
  PUBLIC_FEED_POST_LIMIT,
  PUBLIC_SUMMARY_MAX,
  type ExclusionReason,
  type PublicChannelFeedsData,
} from "@/server/public-feed/core";
import { PublicChannelFeedGrid, visiblePosts, type PublicChannelFeed } from "@/components/public-channel-feed";
import type { Query, ReadResult, ReadSource } from "@/server/distribution/read";

const NOW = new Date("2026-11-18T03:00:00.000Z");

// ---------------------------------------------------------------- fixture
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** n번째 고정 UUID(v4 형식). 앞 2자리 접두로 종류를 구분한다. */
function uid(prefix: string, n: number): string {
  const p = prefix.padEnd(2, "0").slice(0, 2);
  const tail = n.toString(16).padStart(10, "0");
  return `${p}${"0".repeat(6)}-0000-4000-8000-00${tail}`;
}

type Ids = { job: string; content: string; version: string; revision: string; cvAppr: string; drAppr: string; ev: string };

/** 공개 자격을 모두 갖춘 블로그 게시물 1건의 표 행 묶음. */
function eligiblePost(n: number, over: { observedAt?: string; url?: string } = {}) {
  const ids: Ids = {
    job: uid("a1", n), content: uid("c1", n), version: uid("b1", n), revision: uid("d1", n),
    cvAppr: uid("e1", n), drAppr: uid("e2", n), ev: uid("f1", n),
  };
  const url = over.url ?? `https://blog.naver.com/vibe/${1000 + n}`;
  const t = (h: number) => new Date(NOW.getTime() - (100 - n) * 3_600_000 - h * 60_000).toISOString();
  const tables: Tables = {
    distribution_jobs: [{
      id: ids.job, content_id: ids.content, content_version_id: ids.version, draft_revision_id: ids.revision,
      approval_id: ids.drAppr, content_approval_id: ids.cvAppr, channel: "blog", mode: "manual", status: "published",
      accepted_evidence_id: ids.ev, external_url: url, has_issues: false, reconciliation_required: false, created_at: t(10),
      // 판정에 쓰이면 안 되는 내부 열(요청되지 않아야 함)
      target_connection_id: uid("99", n), last_error: "secret-error", actor_id: uid("98", n),
    }],
    distribution_publication_evidence: [{
      id: ids.ev, job_id: ids.job, channel: "blog", status: "accepted", external_url: url,
      observed_at: over.observedAt ?? t(1), source: "operator_manual", method_note: "reviewer note", actor_id: uid("98", n),
    }],
    distribution_contents: [{ id: ids.content, archived_at: null }],
    distribution_content_versions: [{ id: ids.version, content_id: ids.content, title: `제목 ${n}`, body: "원문 본문(비공개)" }],
    distribution_draft_revisions: [{ id: ids.revision, content_version_id: ids.version, body: `블로그 본문 ${n}`, target_external_account_id: "acct-secret" }],
    distribution_approvals: [
      { id: ids.cvAppr, subject_type: "content_version", content_version_id: ids.version, draft_revision_id: null, subject_hash: "h".repeat(64),
        decision: "approved", revokes_approval_id: null, checklist: { facts_checked: true, sources_checked: true, public_ok: true },
        created_at: t(30), reason: null, actor_id: uid("97", n) },
      { id: ids.drAppr, subject_type: "draft_revision", content_version_id: null, draft_revision_id: ids.revision, subject_hash: "g".repeat(64),
        decision: "approved", revokes_approval_id: null, checklist: { body_checked: true }, created_at: t(20), reason: null, actor_id: uid("97", n) },
    ],
  };
  return { ids, tables };
}

function merge(...parts: Tables[]): Tables {
  const out: Tables = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) (out[k] ??= []).push(...v.map((r) => ({ ...r })));
  return out;
}

const find = (t: Tables, table: string, id: string): Row => {
  const r = (t[table] ?? []).find((x) => x.id === id);
  if (!r) throw new Error(`fixture: ${table} ${id}`);
  return r;
};

/** fixture 표 배열. 없으면 빈 배열로 만들어 두고 돌려준다(변경 전 초기화). */
const table = (t: Tables, name: string): Row[] => (t[name] ??= []);

/** 있어야 하는 i번째 항목. 없으면 시험 실패(조용히 undefined로 넘어가지 않음). */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`expected item at index ${i} (length ${xs.length})`);
  return v;
}
const first = <T,>(xs: readonly T[]): T => at(xs, 0);

/** 메모리 ReadSource: eq/in 필터·정렬·limit 적용, 요청 열만 투영, 질의 기록. */
function memorySource(tables: Tables, opts: { error?: { code?: string; message?: string }; throws?: boolean } = {}) {
  const queries: Query[] = [];
  const src: ReadSource = {
    async select(q: Query): Promise<ReadResult> {
      queries.push(q);
      if (opts.throws) throw new Error("network down: secret detail");
      if (opts.error) return { error: opts.error };
      let list = [...(tables[q.table] ?? [])];
      for (const f of q.filters ?? []) {
        list = f.op === "eq" ? list.filter((r) => r[f.col] === f.value) : list.filter((r) => (f.value as readonly string[]).includes(r[f.col] as string));
      }
      for (const o of [...(q.order ?? [])].reverse()) {
        list.sort((a, b) => {
          const x = String(a[o.col]); const y = String(b[o.col]);
          return (x < y ? -1 : x > y ? 1 : 0) * (o.ascending ? 1 : -1);
        });
      }
      if (q.limit) list = list.slice(0, q.limit);
      return { rows: list.map((r) => Object.fromEntries(q.columns.map((c) => [c, r[c]]))) };
    },
  };
  return { src, queries };
}

async function load(tables: Tables, now = NOW): Promise<PublicChannelFeedsData> {
  const res = await loadPublicChannelFeeds(memorySource(tables).src, now);
  if (res.status !== "ok") throw new Error(`expected ok, got ${res.status}`);
  return res.data;
}
const blogPosts = (d: PublicChannelFeedsData) => d.feeds.find((f) => f.channel === "blog")!.posts;

/** 한 게시물을 변형해 제외 사유 1건만 남는지 확인. */
async function expectExcluded(mutate: (t: Tables, ids: Ids) => void, reason: ExclusionReason) {
  const { ids, tables } = eligiblePost(1);
  mutate(tables, ids);
  const d = await load(tables);
  expect(blogPosts(d)).toEqual([]);
  expect(d.excluded).toEqual({ [reason]: 1 });
}

// ---------------------------------------------------------------- 공개 자격 통과
describe("공개 자격을 모두 갖춘 수동 블로그 게시물", () => {
  it("1건이 최소 DTO로 노출된다", async () => {
    const { ids, tables } = eligiblePost(1);
    const d = await load(tables);
    expect(d.excluded).toEqual({});
    expect(d.availability).toEqual({ blog: "supported", threads: "unsupported", instagram: "unsupported" });
    expect(d.feeds.map((f) => f.channel)).toEqual(["blog", "threads", "instagram"]);
    const ev = find(tables, "distribution_publication_evidence", ids.ev);
    expect(blogPosts(d)).toEqual([{
      id: opaquePostId(ids.ev), channel: "blog", title: "제목 1", summary: "블로그 본문 1",
      publishedAt: new Date(ev.observed_at as string).toISOString(), url: "https://blog.naver.com/vibe/1001",
    }]);
    for (const f of d.feeds) expect(f.profileUrl).toBeNull();
  });

  it("m.blog.naver.com·대문자 호스트도 허용 호스트로 통과한다", async () => {
    for (const url of ["https://m.blog.naver.com/vibe/1", "https://BLOG.NAVER.COM/vibe/2"]) {
      const d = await load(eligiblePost(1, { url }).tables);
      expect(blogPosts(d).map((p) => p.url)).toEqual([url]);
    }
  });

  it("최신 게시 확인순으로 정렬하고 채널당 상한으로 자른다", async () => {
    const parts = Array.from({ length: PUBLIC_FEED_POST_LIMIT + 2 }, (_, i) => eligiblePost(i + 1).tables);
    const d = await load(merge(...parts));
    const posts = blogPosts(d);
    expect(posts).toHaveLength(PUBLIC_FEED_POST_LIMIT);
    const times = posts.map((p) => Date.parse(p.publishedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(first(posts).title).toBe(`제목 ${PUBLIC_FEED_POST_LIMIT + 2}`);
  });

  it("공개 id는 증거 UUID의 불투명 해시이고 내부 UUID가 아니다", async () => {
    const { ids, tables } = eligiblePost(1);
    const post = first(blogPosts(await load(tables)));
    expect(post.id).toMatch(/^[0-9a-f]{24}$/);
    expect(Object.values(ids)).not.toContain(post.id);
    expect(opaquePostId(ids.ev.toUpperCase())).toBe(post.id);
  });
});

// ---------------------------------------------------------------- 제외(fail closed)
describe("공개 자격 미달은 노출하지 않고 사유별로 센다", () => {
  it("증거 행 없음 → evidence_missing", () =>
    expectExcluded((t) => { t.distribution_publication_evidence = []; }, "evidence_missing"));

  it("작업이 다른 증거를 가리킴 → evidence_missing", () =>
    expectExcluded((t, ids) => { find(t, "distribution_jobs", ids.job).accepted_evidence_id = uid("f9", 9); }, "evidence_missing"));

  for (const status of ["pending", "rejected", "superseded", "ACCEPTED"]) {
    it(`증거 status=${status} → evidence_not_accepted`, () =>
      expectExcluded((t, ids) => { find(t, "distribution_publication_evidence", ids.ev).status = status; }, "evidence_not_accepted"));
  }

  it("증거 job_id 불일치 → evidence_mismatch", () =>
    expectExcluded((t, ids) => { find(t, "distribution_publication_evidence", ids.ev).job_id = uid("a9", 9); }, "evidence_mismatch"));
  it("증거 channel 불일치 → evidence_mismatch", () =>
    expectExcluded((t, ids) => { find(t, "distribution_publication_evidence", ids.ev).channel = "threads"; }, "evidence_mismatch"));
  it("증거 URL과 작업 URL 불일치 → evidence_mismatch", () =>
    expectExcluded((t, ids) => { find(t, "distribution_publication_evidence", ids.ev).external_url = "https://blog.naver.com/vibe/other"; }, "evidence_mismatch"));
  it("증거 URL null(작업 URL도 null) → evidence_mismatch", () =>
    expectExcluded((t, ids) => {
      find(t, "distribution_publication_evidence", ids.ev).external_url = null;
      find(t, "distribution_jobs", ids.job).external_url = null;
    }, "evidence_mismatch"));

  for (const url of [
    "http://blog.naver.com/vibe/1",
    "https://evil.example.com/vibe/1",
    "https://blog.naver.com.evil.com/vibe/1",
    "https://sub.blog.naver.com/vibe/1",
    "https://blog.naver.com:8443/vibe/1",
    "https://user@blog.naver.com/vibe/1",
    "https://blog.naver.com./vibe/1",
    "javascript:alert(1)",
    "https://blog.naver.com/a b",
  ]) {
    it(`허용되지 않은 URL ${url} → url_not_allowed`, () =>
      expectExcluded((t, ids) => {
        find(t, "distribution_publication_evidence", ids.ev).external_url = url;
        find(t, "distribution_jobs", ids.job).external_url = url;
      }, "url_not_allowed"));
  }

  for (const [label, observed] of [
    ["미래 시각(1초 뒤)", new Date(NOW.getTime() + 1000).toISOString()],
    ["형식 오류", "not-a-date"],
    ["null", null],
    ["숫자", NOW.getTime() - 1000],
    ["빈 문자열", ""],
  ] as const) {
    it(`관측 시각 ${label} → time_invalid_or_future`, () =>
      expectExcluded((t, ids) => { find(t, "distribution_publication_evidence", ids.ev).observed_at = observed; }, "time_invalid_or_future"));
  }

  it("관측 시각이 정확히 now면 허용한다(경계)", async () => {
    const d = await load(eligiblePost(1, { observedAt: NOW.toISOString() }).tables);
    expect(blogPosts(d)).toHaveLength(1);
  });

  it("has_issues=true → has_issues", () =>
    expectExcluded((t, ids) => { find(t, "distribution_jobs", ids.job).has_issues = true; }, "has_issues"));
  it("reconciliation_required=true → reconciliation_pending", () =>
    expectExcluded((t, ids) => { find(t, "distribution_jobs", ids.job).reconciliation_required = true; }, "reconciliation_pending"));

  it("원문 보관(archived_at) → content_archived", () =>
    expectExcluded((t, ids) => { find(t, "distribution_contents", ids.content).archived_at = "2026-11-17T00:00:00Z"; }, "content_archived"));
  it("원문 행 없음 → content_archived", () =>
    expectExcluded((t) => { t.distribution_contents = []; }, "content_archived"));

  it("원문 승인 철회 → content_approval_not_effective", () =>
    expectExcluded((t, ids) => {
      table(t, "distribution_approvals").push({ id: uid("e3", 1), subject_type: "content_version", content_version_id: ids.version, draft_revision_id: null,
        subject_hash: "h".repeat(64), decision: "revoked", revokes_approval_id: ids.cvAppr, checklist: {}, created_at: NOW.toISOString(), reason: "철회", actor_id: uid("97", 1) });
    }, "content_approval_not_effective"));
  it("원문에 더 새 승인이 있어 스냅샷 승인이 현재 유효 승인이 아님 → content_approval_not_effective", () =>
    expectExcluded((t, ids) => {
      table(t, "distribution_approvals").push({ id: uid("e4", 1), subject_type: "content_version", content_version_id: ids.version, draft_revision_id: null,
        subject_hash: "h".repeat(64), decision: "approved", revokes_approval_id: null, checklist: { public_ok: true }, created_at: new Date(NOW.getTime() - 1000).toISOString(), reason: null, actor_id: uid("97", 1) });
    }, "content_approval_not_effective"));
  it("원문 최신 결정이 반려 → content_approval_not_effective", () =>
    expectExcluded((t, ids) => {
      table(t, "distribution_approvals").push({ id: uid("e5", 1), subject_type: "content_version", content_version_id: ids.version, draft_revision_id: null,
        subject_hash: "h".repeat(64), decision: "rejected", revokes_approval_id: null, checklist: {}, created_at: new Date(NOW.getTime() - 1000).toISOString(), reason: "반려", actor_id: uid("97", 1) });
    }, "content_approval_not_effective"));
  it("원문 승인 행 없음 → content_approval_not_effective", () =>
    expectExcluded((t, ids) => { t.distribution_approvals = table(t, "distribution_approvals").filter((a) => a.id !== ids.cvAppr); }, "content_approval_not_effective"));

  for (const [label, checklist] of [
    ["키 없음", { facts_checked: true, sources_checked: true }],
    ["false", { facts_checked: true, sources_checked: true, public_ok: false }],
    ["문자열 'true'", { facts_checked: true, sources_checked: true, public_ok: "true" }],
    ["숫자 1", { public_ok: 1 }],
  ] as const) {
    it(`public_ok ${label} → public_ok_missing`, () =>
      expectExcluded((t, ids) => { find(t, "distribution_approvals", ids.cvAppr).checklist = checklist; }, "public_ok_missing"));
  }

  it("리비전 승인 철회 → revision_approval_not_effective", () =>
    expectExcluded((t, ids) => {
      table(t, "distribution_approvals").push({ id: uid("e6", 1), subject_type: "draft_revision", content_version_id: null, draft_revision_id: ids.revision,
        subject_hash: "g".repeat(64), decision: "revoked", revokes_approval_id: ids.drAppr, checklist: {}, created_at: NOW.toISOString(), reason: "철회", actor_id: uid("97", 1) });
    }, "revision_approval_not_effective"));
  it("리비전에 더 새 승인이 있음 → revision_approval_not_effective", () =>
    expectExcluded((t, ids) => {
      table(t, "distribution_approvals").push({ id: uid("e7", 1), subject_type: "draft_revision", content_version_id: null, draft_revision_id: ids.revision,
        subject_hash: "g".repeat(64), decision: "approved", revokes_approval_id: null, checklist: {}, created_at: new Date(NOW.getTime() - 1000).toISOString(), reason: null, actor_id: uid("97", 1) });
    }, "revision_approval_not_effective"));
  it("작업 approval_id가 다른 승인을 가리킴 → revision_approval_not_effective", () =>
    expectExcluded((t, ids) => { find(t, "distribution_jobs", ids.job).approval_id = uid("e8", 1); }, "revision_approval_not_effective"));

  it("원문 버전 행 없음 → approved_text_missing", () =>
    expectExcluded((t) => { t.distribution_content_versions = []; }, "approved_text_missing"));
  it("원문 버전이 다른 원문 소속 → approved_text_missing", () =>
    expectExcluded((t, ids) => { find(t, "distribution_content_versions", ids.version).content_id = uid("c9", 9); }, "approved_text_missing"));
  it("리비전 행 없음 → approved_text_missing", () =>
    expectExcluded((t) => { t.distribution_draft_revisions = []; }, "approved_text_missing"));
  it("리비전이 다른 원문 버전 기준 → approved_text_missing", () =>
    expectExcluded((t, ids) => { find(t, "distribution_draft_revisions", ids.revision).content_version_id = uid("b9", 9); }, "approved_text_missing"));

  it("섞인 목록에서 적격 건만 남고 사유가 각각 집계된다", async () => {
    const ok = eligiblePost(1);
    const bad1 = eligiblePost(2); find(bad1.tables, "distribution_jobs", bad1.ids.job).has_issues = true;
    const bad2 = eligiblePost(3); find(bad2.tables, "distribution_approvals", bad2.ids.cvAppr).checklist = {};
    const d = await load(merge(ok.tables, bad1.tables, bad2.tables));
    expect(blogPosts(d).map((p) => p.title)).toEqual(["제목 1"]);
    expect(d.excluded).toEqual({ has_issues: 1, public_ok_missing: 1 });
  });

  it("published가 아닌 작업(dry_run_succeeded 등)은 조회 단계에서 빠진다", async () => {
    for (const status of ["dry_run_succeeded", "scheduled", "awaiting_evidence", "unknown", "failed"]) {
      const { ids, tables } = eligiblePost(1);
      find(tables, "distribution_jobs", ids.job).status = status;
      const d = await load(tables);
      expect(blogPosts(d)).toEqual([]);
      expect(d.excluded).toEqual({});
    }
  });
});

// ---------------------------------------------------------------- Threads·Instagram
describe("Threads·Instagram은 unsupported이고 게시물이 없다", () => {
  it("published·증거·승인이 모두 있어도 노출하지 않는다", async () => {
    const blog = eligiblePost(1);
    const th = eligiblePost(2, { url: "https://www.threads.net/@vibe/post/1" });
    const ig = eligiblePost(3, { url: "https://www.instagram.com/p/abc/" });
    for (const [x, ch, mode] of [[th, "threads", "auto"], [ig, "instagram", "auto"]] as const) {
      Object.assign(find(x.tables, "distribution_jobs", x.ids.job), { channel: ch, mode });
      find(x.tables, "distribution_publication_evidence", x.ids.ev).channel = ch;
    }
    const d = await load(merge(blog.tables, th.tables, ig.tables));
    expect(d.availability.threads).toBe("unsupported");
    expect(d.availability.instagram).toBe("unsupported");
    expect(d.feeds.find((f) => f.channel === "threads")!.posts).toEqual([]);
    expect(d.feeds.find((f) => f.channel === "instagram")!.posts).toEqual([]);
    expect(blogPosts(d)).toHaveLength(1);
  });

  it("blog auto 모드도 노출하지 않는다", async () => {
    const { ids, tables } = eligiblePost(1);
    find(tables, "distribution_jobs", ids.job).mode = "auto";
    expect(blogPosts(await load(tables))).toEqual([]);
  });

  it("조회 필터가 무시돼 다른 채널 행이 와도 전체 error로 닫힌다(fail closed)", async () => {
    const { ids, tables } = eligiblePost(1);
    find(tables, "distribution_jobs", ids.job).channel = "threads";
    const raw: ReadSource = { async select(q) { return { rows: (tables[q.table] ?? []).map((r) => ({ ...r })) }; } };
    expect((await loadPublicChannelFeeds(raw, NOW)).status).toBe("error");
  });
});

// ---------------------------------------------------------------- DTO 누출·질의 최소성
const FORBIDDEN_KEY = /job|account|reviewer|actor|token|error|reason|source|note|checklist|approval|evidence|connection|hash|content_?id|version|revision|status|secret/i;

function allKeys(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); allKeys(x, out); }
  return out;
}

describe("DTO와 조회 열", () => {
  it("게시물 DTO 키는 정확히 공개 필드뿐이고 내부 값이 들어 있지 않다", async () => {
    const { ids, tables } = eligiblePost(1);
    const d = await load(tables);
    const post = first(blogPosts(d));
    expect(Object.keys(post).sort()).toEqual(["channel", "id", "publishedAt", "summary", "title", "url"]);
    const feedKeys = new Set(d.feeds.flatMap((f) => Object.keys(f)));
    expect([...feedKeys].sort()).toEqual(["channel", "posts", "profileUrl"]);
    for (const k of allKeys(d.feeds)) expect(k).not.toMatch(FORBIDDEN_KEY);
    const json = JSON.stringify(d);
    for (const v of [...Object.values(ids), "secret-error", "acct-secret", "reviewer note", "operator_manual", "원문 본문(비공개)", uid("97", 1), uid("98", 1), uid("99", 1)]) {
      expect(json).not.toContain(v);
    }
  });

  it("excluded는 사유별 숫자만 담는다", async () => {
    const { ids, tables } = eligiblePost(1);
    find(tables, "distribution_jobs", ids.job).has_issues = true;
    const d = await load(tables);
    expect(JSON.stringify(d.excluded)).toBe('{"has_issues":1}');
  });

  it("질의는 읽기 전용 select이고 민감 열을 요청하지 않는다", async () => {
    const { tables } = eligiblePost(1);
    const { src, queries } = memorySource(tables);
    await loadPublicChannelFeeds(src, NOW);
    expect(queries.map((q) => q.table).sort()).toEqual([
      "distribution_approvals", "distribution_approvals", "distribution_content_versions", "distribution_contents",
      "distribution_draft_revisions", "distribution_jobs", "distribution_publication_evidence",
    ]);
    const banned = /^(reason|actor_id|source|method_note|last_error|.*token.*|.*secret.*|target_connection_id|target_external_account_id|external_account_id|external_post_id|link_url|utm)$/;
    for (const q of queries) {
      expect(q.columns).not.toContain("*");
      for (const c of q.columns) expect(c).not.toMatch(banned);
    }
    const jobs = queries.find((q) => q.table === "distribution_jobs")!;
    expect(jobs.filters).toEqual([
      { col: "status", op: "eq", value: "published" },
      { col: "channel", op: "eq", value: "blog" },
      { col: "mode", op: "eq", value: "manual" },
    ]);
    expect(jobs.limit).toBeGreaterThan(0);
    // 원문 버전 body는 요청하지 않는다(요약은 승인된 리비전 본문에서만)
    expect(queries.find((q) => q.table === "distribution_content_versions")!.columns).not.toContain("body");
  });

  it("적격 후보가 없으면 후속 질의를 하지 않는다", async () => {
    const { ids, tables } = eligiblePost(1);
    find(tables, "distribution_jobs", ids.job).has_issues = true;
    const { src, queries } = memorySource(tables);
    await loadPublicChannelFeeds(src, NOW);
    expect(queries.map((q) => q.table)).toEqual(["distribution_jobs"]);
  });
});

// ---------------------------------------------------------------- 읽기 실패 상태
describe("읽기 실패는 0건과 구분된다", () => {
  it("소스 없음 → not_configured", async () => {
    expect(await loadPublicChannelFeeds(null, NOW)).toEqual({ status: "not_configured" });
  });
  it("표·열 없음 코드 → schema_missing", async () => {
    for (const code of ["42P01", "42703", "PGRST205"]) {
      expect(await loadPublicChannelFeeds(memorySource({}, { error: { code, message: "secret" } }).src, NOW)).toEqual({ status: "schema_missing" });
    }
  });
  it("그 밖의 오류·예외 → error이고 메시지를 넘기지 않는다", async () => {
    const a = await loadPublicChannelFeeds(memorySource({}, { error: { code: "42501", message: "permission secret" } }).src, NOW);
    const b = await loadPublicChannelFeeds(memorySource({}, { throws: true }).src, NOW);
    expect(a).toEqual({ status: "error" });
    expect(b).toEqual({ status: "error" });
  });
  it("형식 이상 행(UUID 아님·boolean 아님·checklist 배열)은 조용히 거르지 않고 error", async () => {
    const cases: Array<(t: Tables, ids: Ids) => void> = [
      (t, ids) => { find(t, "distribution_jobs", ids.job).accepted_evidence_id = null; },
      (t, ids) => { find(t, "distribution_jobs", ids.job).has_issues = "false"; },
      (t, ids) => { find(t, "distribution_approvals", ids.cvAppr).checklist = [true]; },
      (t, ids) => { find(t, "distribution_draft_revisions", ids.revision).body = null; },
      (t, ids) => { find(t, "distribution_publication_evidence", ids.ev).job_id = "not-a-uuid"; },
    ];
    for (const mutate of cases) {
      const { ids, tables } = eligiblePost(1);
      mutate(tables, ids);
      expect((await loadPublicChannelFeeds(memorySource(tables).src, NOW)).status).toBe("error");
    }
  });
});

// ---------------------------------------------------------------- 요약·시각 헬퍼
describe("plainExcerpt", () => {
  it("C0·C1 제어문자와 bidi·zero-width 문자를 제거하고 공백을 정리한다", () => {
    const body = "a\u0000b\u0007c\u001b[31m\u007fd\u0085e​f‎g‮h⁦i⁩j\r\n\t  k";
    expect(plainExcerpt(body)).toBe("abc[31mdefghij k");
  });
  it("HTML·마크다운은 해석하지 않고 그대로 일반 텍스트로 둔다", () => {
    expect(plainExcerpt("<script>alert(1)</script> **굵게**")).toBe("<script>alert(1)</script> **굵게**");
  });
  it("비었거나 제거 후 비면 null", () => {
    expect(plainExcerpt("")).toBeNull();
    expect(plainExcerpt(" ​‮\n\t ")).toBeNull();
  });
  it("상한 이하이면 그대로, 넘으면 코드포인트 기준으로 자르고 … 포함 상한 길이", () => {
    const exact = "가".repeat(PUBLIC_SUMMARY_MAX);
    expect(plainExcerpt(exact)).toBe(exact);
    const long = plainExcerpt("가".repeat(PUBLIC_SUMMARY_MAX + 50))!;
    expect(Array.from(long)).toHaveLength(PUBLIC_SUMMARY_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
  it("보조 평면 문자(이모지)를 반으로 쪼개지 않는다", () => {
    const out = plainExcerpt("😀".repeat(PUBLIC_SUMMARY_MAX + 5))!;
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    expect(Array.from(out)).toHaveLength(PUBLIC_SUMMARY_MAX);
  });
  it("자르는 지점 앞 공백은 남기지 않는다", () => {
    const out = plainExcerpt(`${"a".repeat(9)} ${"b".repeat(20)}`, 11)!;
    expect(out).toBe("aaaaaaaaa…");
  });
  it("공개 피드 요약에도 적용된다", async () => {
    const { ids, tables } = eligiblePost(1);
    find(tables, "distribution_draft_revisions", ids.revision).body = `‮위험\u0000 ${"x".repeat(500)}`;
    const post = first(blogPosts(await load(tables)));
    expect(post.summary!.startsWith("위험 x")).toBe(true);
    expect(post.summary).not.toMatch(/[\u0000-\u001f‪-‮]/);
    expect(Array.from(post.summary!)).toHaveLength(PUBLIC_SUMMARY_MAX);
  });
});

// ---------------------------------------------------------------- BE-PUBLIC-FEED-TEXT-SANITIZE-099: 제목·요약 보이지 않는 문자
describe("공개 텍스트 정리(099)", () => {
  // QA 098이 남는다고 실측한 문자 + bidi/보이지 않는 형식 제어
  const CONTROLS: Array<[string, string]> = [
    ["U+0000", "\u0000"], ["U+001B", "\u001b"], ["U+007F", "\u007f"], ["U+0085", "\u0085"], ["U+009F", "\u009f"],
    ["U+00AD", "­"], ["U+061C", "؜"], ["U+180E", "᠎"], ["U+200B", "​"], ["U+200E", "‎"], ["U+200F", "‏"],
    ["U+202A", "‪"], ["U+202B", "‫"], ["U+202C", "‬"], ["U+202D", "‭"], ["U+202E", "‮"],
    ["U+2060", "⁠"], ["U+2061", "⁡"], ["U+2064", "⁤"], ["U+2066", "⁦"], ["U+2067", "⁧"], ["U+2068", "⁨"], ["U+2069", "⁩"],
    ["U+206A", "⁪"], ["U+206F", "⁯"], ["U+FEFF", "﻿"], ["U+FFF9", "￹"],
    ["U+E0000", "\u{e0000}"], ["U+E0001", "\u{e0001}"], ["U+E0041", "\u{e0041}"], ["U+E007F", "\u{e007f}"],
  ];
  const UNSAFE_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f­؜᠎​‎‏‪-‮⁠-⁯﻿￹-￻\u{e0000}-\u{e007f}]/u;

  for (const [name, ch] of CONTROLS) {
    it(`요약에서 ${name}를 제거한다`, () => {
      expect(plainExcerpt(`가${ch}나 ${ch}다`)).toBe("가나 다");
    });
    it(`제목에서 ${name}를 제거한다`, () => {
      expect(publicTitle(`${ch}공지${ch} 제목${ch}`)).toBe("공지 제목");
    });
  }

  it("RLO·isolate로 표시 방향을 바꾸는 제목 스푸핑 문자를 제거하고 공백을 정리한다", () => {
    expect(publicTitle("  invoice‮exe.pdf  ")).toBe("invoiceexe.pdf");
    expect(publicTitle("⁧악성⁩\t\n 제목؜‏")).toBe("악성 제목");
    expect(publicTitle("<b>제목</b> & \"따옴표\"")).toBe("<b>제목</b> & \"따옴표\""); // HTML은 문자 그대로
  });

  it("정리 후 보이는 글자가 없으면 제목은 null", () => {
    for (const t of ["", "   ", "‮⁦⁩", "​­⁠﻿", "\u{e0001}\u{e0067}\u{e007f}", " ‍ ", "‌‍", "\t\n\u0085"]) {
      expect(publicTitle(t)).toBeNull();
    }
  });

  it("요약도 보이지 않는 문자만 있으면 null", () => {
    expect(plainExcerpt("؜᠎­⁠\u{e0020}‍")).toBeNull();
  });

  it("ZWNJ(아랍 문자·페르시아어)와 ZWJ(결합 이모지)는 보존한다", () => {
    const persian = "می‌خواهم"; // می‌خواهم
    const family = "\u{1f468}‍\u{1f469}‍\u{1f467}"; // 👨‍👩‍👧
    const rainbow = "\u{1f3f3}️‍\u{1f308}"; // 🏳️‍🌈 (변이 선택자도 보존)
    for (const s of [persian, family, rainbow]) {
      expect(plainExcerpt(s)).toBe(s);
      expect(publicTitle(s)).toBe(s);
    }
    expect(plainExcerpt(`${family} 가족 ${persian}`)).toBe(`${family} 가족 ${persian}`);
    expect(publicTitle(`‮${family}⁦ ${persian}­`)).toBe(`${family} ${persian}`);
  });

  it("단어 경계에 홀로 남은 ZWNJ·ZWJ는 뺀다", () => {
    expect(publicTitle("‍제목‌")).toBe("제목");
    expect(plainExcerpt("a ‍‌ b")).toBe("a b");
  });

  it("코드포인트 기준 자르기를 유지하고 끝에 결합 문자만 남기지 않는다", () => {
    const family = "\u{1f468}‍\u{1f469}";
    const out = plainExcerpt(`${"a".repeat(8)}${family}${"b".repeat(10)}`, 11)!;
    // 앞 10 코드포인트 = a×8 + 👨 + ZWJ → 끝의 ZWJ를 떼고 …
    expect(out).toBe(`${"a".repeat(8)}\u{1f468}…`);
    expect(Array.from(out).length).toBeLessThanOrEqual(11);
    const long = plainExcerpt(`‮${"가­".repeat(PUBLIC_SUMMARY_MAX + 10)}`)!;
    expect(long).not.toMatch(UNSAFE_RE);
    expect(Array.from(long)).toHaveLength(PUBLIC_SUMMARY_MAX);
  });

  it("공개 피드 DTO의 제목·요약에 적용되고 DTO 모양은 그대로다", async () => {
    const { ids, tables } = eligiblePost(1);
    find(tables, "distribution_content_versions", ids.version).title = "‮공지⁦ ؜제목\u{e0041}­";
    find(tables, "distribution_draft_revisions", ids.revision).body = "본문⁠ ᠎요약\u{e0001}";
    const post = first(blogPosts(await load(tables)));
    expect(post.title).toBe("공지 제목");
    expect(post.summary).toBe("본문 요약");
    expect(Object.keys(post).sort()).toEqual(["channel", "id", "publishedAt", "summary", "title", "url"]);
  });

  it("정리 후 빈 제목은 게시물을 빼지 않고 title=null로 넘긴다", async () => {
    const { ids, tables } = eligiblePost(1);
    find(tables, "distribution_content_versions", ids.version).title = "‮​⁦⁩";
    const d = await load(tables);
    expect(blogPosts(d)).toHaveLength(1);
    expect(first(blogPosts(d)).title).toBeNull();
    expect(d.excluded).toEqual({});
  });
});

describe("publishedAtOf", () => {
  it("유효한 과거·현재 시각만 UTC ISO로 정규화한다", () => {
    expect(publishedAtOf("2026-11-18T12:00:00+09:00", NOW)).toBe("2026-11-18T03:00:00.000Z");
    expect(publishedAtOf("2026-11-18T12:00:01+09:00", NOW)).toBeNull();
    expect(publishedAtOf("garbage", NOW)).toBeNull();
    expect(publishedAtOf(undefined, NOW)).toBeNull();
    expect(publishedAtOf(1_700_000_000_000, NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------- 표현 단계 방어선
describe("visiblePosts(표현 단계)", () => {
  const post = (over: Record<string, unknown> = {}) => ({
    id: "p1", channel: "blog" as const, title: "t", summary: "s", publishedAt: "2026-11-17T00:00:00.000Z", url: "https://blog.naver.com/v/1", ...over,
  });
  const feed = (posts: unknown[], channel: PublicChannelFeed["channel"] = "blog"): PublicChannelFeed => ({ channel, posts: posts as PublicChannelFeed["posts"] });

  it("안전하지 않은 URL은 숨긴다", () => {
    const bad = ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "http://blog.naver.com/v/1", "//evil.com/x", "vbscript:x", "not a url", ""];
    expect(visiblePosts(feed(bad.map((url, i) => post({ id: `b${i}`, url }))), NOW)).toEqual([]);
  });
  it("블로그 내부 경로와 https만 남긴다", () => {
    const out = visiblePosts(feed([post({ id: "a", url: "/stories/x" }), post({ id: "b" })]), NOW);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("Threads·Instagram은 내부 경로를 허용하지 않는다", () => {
    expect(visiblePosts(feed([post({ channel: "threads", url: "/stories/x" })], "threads"), NOW)).toEqual([]);
  });
  it("미래·형식 오류 게시일은 숨긴다", () => {
    const out = visiblePosts(feed([
      post({ id: "future", publishedAt: new Date(NOW.getTime() + 1000).toISOString() }),
      post({ id: "bad", publishedAt: "nope" }),
      post({ id: "ok" }),
    ]), NOW);
    expect(out.map((p) => p.id)).toEqual(["ok"]);
  });
  it("다른 채널 게시물이 섞이면 숨기고, 최대 3건만 보인다", () => {
    const out = visiblePosts(feed([post({ id: "x", channel: "threads" }), ...[1, 2, 3, 4].map((n) => post({ id: `p${n}` }))]), NOW);
    expect(out.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });
  it("렌더 결과에 스크립트 URL이 href로 나가지 않고 HTML은 이스케이프된다", () => {
    const html = renderToStaticMarkup(createElement(PublicChannelFeedGrid, {
      feeds: [feed([post({ id: "x", url: "javascript:alert(1)" }), post({ id: "y", title: "<img src=x onerror=alert(1)>", summary: "<b>s</b>" })])],
      now: NOW,
    }));
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

// ---------------------------------------------------------------- index.ts 소스 검토(실행 아님)
describe("index.ts 서버 전용 격리(정적 검사)", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");
  const index = read("src/server/public-feed/index.ts");
  const code = index.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it('첫 import가 "server-only"다', () => {
    expect(first(code.trim().split("\n")).trim()).toBe('import "server-only";');
  });
  it("select만 쓰고 쓰기·RPC를 호출하지 않는다", () => {
    expect(code).toMatch(/\.select\(q\.columns\.join\(","\)\)/);
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(code).not.toMatch(/select\(\s*["'`]\*/);
  });
  it("오류 메시지를 넘기지 않고 code만 넘긴다", () => {
    expect(code).toMatch(/return \{ error: \{ code: error\.code \} \}/);
    expect(code).not.toMatch(/error\.message/);
  });
  it("core.ts는 server-only·Supabase 클라이언트·env를 직접 쓰지 않는다", () => {
    const core = read("src/server/public-feed/core.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(core).not.toMatch(/process\.env|createSupabase|@supabase\//);
  });
  it("공개 컴포넌트는 서버 모듈을 import하지 않고 'use client'가 아니다", () => {
    const comp = read("src/components/public-channel-feed.tsx");
    expect(comp).not.toMatch(/@\/server|server\/public-feed|use client/);
    const page = read("src/app/page.tsx");
    expect(page).not.toMatch(/["']use client["']/);
    expect(page).toMatch(/from "@\/server\/public-feed"/);
  });
});
