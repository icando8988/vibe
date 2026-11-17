import { describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { decideApproval, revokeApproval } from "@/server/distribution/approval-service";
import { appendContentVersion, appendDraftRevision, createChannelDraft, createContent, parseExpectedNonNegative } from "@/server/distribution/content-service";
import { effectiveApproval, type ApprovalRow } from "@/server/distribution/dto";
import { COLS, getContentDetail, listContents, type Query, type ReadResult, type ReadSource } from "@/server/distribution/read";
import { parseWriteNotice, writeNoticeOf } from "@/server/distribution/write-notice";
import type { RpcClient } from "@/server/distribution/write-runner";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const V1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const V2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const R1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const H = "a".repeat(64);

const allowed = async (): Promise<ActorResult> => ({ ok: true, actorId: ADMIN });
const denied = async (): Promise<ActorResult> => ({ ok: false, reason: "not_approved" });
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
function client(r: { data: unknown; error: unknown } | Error) {
  const rpc = vi.fn(async () => {
    if (r instanceof Error) throw r;
    return r;
  });
  return { c: { rpc } as unknown as RpcClient, rpc };
}
const callsOf = (rpc: ReturnType<typeof vi.fn>) => rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>;

// ---------------------------------------------------------------- 유효 승인(SQL distribution_effective_approval_id와 동일)
const ap = (o: Partial<ApprovalRow> & Pick<ApprovalRow, "id" | "decision" | "created_at">): ApprovalRow => ({
  subject_type: "draft_revision",
  content_version_id: null,
  draft_revision_id: R1,
  subject_hash: H,
  revokes_approval_id: null,
  reason: null,
  actor_id: ADMIN,
  ...o,
});
const SUBJ = { type: "draft_revision" as const, id: R1 };

describe("effectiveApproval", () => {
  it("결정 없음 → none", () => expect(effectiveApproval([], SUBJ)).toEqual({ state: "none" }));
  it("최근 승인·철회 없음 → approved", () => {
    expect(effectiveApproval([ap({ id: "1", decision: "approved", created_at: "2026-11-17T00:00:00Z" })], SUBJ).state).toBe("approved");
  });
  it("최근 결정이 반려 → rejected(이전 승인이 있어도)", () => {
    const rows = [ap({ id: "1", decision: "approved", created_at: "2026-11-17T00:00:00Z" }), ap({ id: "2", decision: "rejected", reason: "x", created_at: "2026-11-17T01:00:00Z" })];
    expect(effectiveApproval(rows, SUBJ)).toMatchObject({ state: "rejected", reason: "x" });
  });
  it("최근 승인이 철회됨 → revoked(더 이전 승인이 있어도 유효 승인 없음, SQL과 동일)", () => {
    const rows = [
      ap({ id: "1", decision: "approved", created_at: "2026-11-17T00:00:00Z" }),
      ap({ id: "2", decision: "approved", created_at: "2026-11-17T01:00:00Z" }),
      ap({ id: "3", decision: "revoked", revokes_approval_id: "2", reason: "r", created_at: "2026-11-17T02:00:00Z" }),
    ];
    expect(effectiveApproval(rows, SUBJ).state).toBe("revoked");
  });
  it("철회 뒤 재승인 → approved", () => {
    const rows = [
      ap({ id: "1", decision: "approved", created_at: "2026-11-17T00:00:00Z" }),
      ap({ id: "2", decision: "revoked", revokes_approval_id: "1", reason: "r", created_at: "2026-11-17T01:00:00Z" }),
      ap({ id: "3", decision: "approved", created_at: "2026-11-17T02:00:00Z" }),
    ];
    expect(effectiveApproval(rows, SUBJ)).toMatchObject({ state: "approved", approvalId: "3" });
  });
  it("같은 시각이면 id 내림차순으로 최근을 정함", () => {
    const t = "2026-11-17T00:00:00Z";
    const rows = [ap({ id: "aaaa", decision: "rejected", reason: "x", created_at: t }), ap({ id: "bbbb", decision: "approved", created_at: t })];
    expect(effectiveApproval(rows, SUBJ)).toMatchObject({ state: "approved", approvalId: "bbbb" });
  });
  it("다른 대상의 결정은 무시", () => {
    expect(effectiveApproval([ap({ id: "1", decision: "approved", draft_revision_id: OTHER, created_at: "2026-11-17T00:00:00Z" })], SUBJ).state).toBe("none");
  });
});

// ---------------------------------------------------------------- 조회 상태 분리
function source(handler: (q: Query) => ReadResult | Promise<ReadResult>) {
  const queries: Query[] = [];
  const src: ReadSource = {
    async select(q) {
      queries.push(q);
      return handler(q);
    },
  };
  return { src, queries };
}

describe("read 상태", () => {
  it("클라이언트 없음 → not_configured", async () => {
    expect(await listContents(null)).toEqual({ status: "not_configured" });
  });
  it.each(["42P01", "PGRST205", "42703"])("표·열 없음(%s) → schema_missing", async (code) => {
    expect(await listContents(source(() => ({ error: { code, message: "x" } })).src)).toEqual({ status: "schema_missing" });
  });
  it("그 밖의 오류·예외 → error(0건으로 바꾸지 않음)", async () => {
    expect(await listContents(source(() => ({ error: { code: "57014", message: "timeout" } })).src)).toEqual({ status: "error" });
    expect(await listContents(source(() => { throw new Error("net"); }).src)).toEqual({ status: "error" });
  });
  it("조회 성공 0건 → ok []", async () => {
    expect(await listContents(source(() => ({ rows: [] })).src)).toEqual({ status: "ok", data: [] });
  });
  it("명시 열만 요청(select * 금지, GRANT 밖 열 없음)", async () => {
    const { src, queries } = source((q) => {
      if (q.table === "distribution_contents") return { rows: [{ id: C1, current_version_id: V1, current_version_no: 1, archived_at: null, updated_at: "2026-11-17T00:00:00Z" }] };
      if (q.table === "distribution_content_versions") return { rows: [{ id: V1, title: "제목" }] };
      return { rows: [] };
    });
    expect(await listContents(src)).toEqual({ status: "ok", data: [{ id: C1, title: "제목", versionNo: 1, archived: false, updatedAt: "2026-11-17T00:00:00Z" }] });
    for (const q of queries) {
      expect(q.columns).not.toContain("*");
      expect(q.columns).not.toContain("created_xact_id");
    }
  });
  it("상세: 버전·초안·리비전·유효 승인을 조립, 원문 변경이면 basedOnLatest=false", async () => {
    const { src } = source((q) => {
      switch (q.table) {
        case "distribution_contents":
          return { rows: [{ id: C1, current_version_id: V2, current_version_no: 2, archived_at: null, updated_at: "2026-11-17T00:00:00Z" }] };
        case "distribution_content_versions":
          return {
            rows: [
              { id: V2, content_id: C1, version_no: 2, title: "새 제목", body: "새 본문", target_path: null, content_hash: "b".repeat(64), change_summary: null, created_at: "2026-11-17T01:00:00Z" },
              { id: V1, content_id: C1, version_no: 1, title: "제목", body: "본문", target_path: null, content_hash: H, change_summary: null, created_at: "2026-11-17T00:00:00Z" },
            ],
          };
        case "distribution_channel_drafts":
          return { rows: [{ id: D1, content_id: C1, channel: "blog", current_revision_id: R1, current_revision_no: 1, archived_at: null }] };
        case "distribution_draft_revisions":
          return { rows: [{ id: R1, draft_id: D1, content_id: C1, revision_no: 1, content_version_id: V1, body: "초안", link_url: null, revision_hash: H, created_at: "2026-11-17T00:30:00Z" }] };
        case "distribution_approvals":
          return q.filters?.[0]?.col === "draft_revision_id"
            ? { rows: [{ id: "ap1", subject_type: "draft_revision", content_version_id: null, draft_revision_id: R1, subject_hash: H, decision: "approved", revokes_approval_id: null, reason: null, actor_id: ADMIN, created_at: "2026-11-17T00:40:00Z" }] }
            : { rows: [] };
      }
      return { rows: [] };
    });
    const out = await getContentDetail(src, C1);
    expect(out.status).toBe("ok");
    if (out.status !== "ok" || !out.data) throw new Error("no data");
    expect(out.data.current?.title).toBe("새 제목");
    expect(out.data.versions.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(out.data.contentApproval.state).toBe("none");
    expect(out.data.drafts.blog).toMatchObject({ basedOnLatest: false, approval: { state: "approved" } });
  });
  it("상세: 없거나 RLS로 안 보이면 ok null", async () => {
    expect(await getContentDetail(source(() => ({ rows: [] })).src, C1)).toEqual({ status: "ok", data: null });
  });
  it("COLS는 030000 GRANT 열의 부분집합", () => {
    expect(COLS.revisions).not.toContain("created_xact_id");
    expect(COLS.contents).not.toContain("owner_id");
  });
});

// ---------------------------------------------------------------- 쓰기 서비스
const verOk = { data: { content_id: C1, version_id: V2, version_no: 2, content_hash: H }, error: null };

describe("원문·초안 쓰기(A1~A4)", () => {
  it("D1 거부 → RPC 0회", async () => {
    const { c, rpc } = client(verOk);
    expect((await createContent({ resolveActor: denied, getClient: () => c }, form({ title: "t", body: "b" }))).status).toBe("denied");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("키 없음 → not_ready", async () => {
    expect((await createContent({ resolveActor: allowed, getClient: () => null }, form({ title: "t", body: "b" }))).status).toBe("not_ready");
  });
  it("A2: 렌더된 기대 버전을 그대로 전달(서버가 최신값으로 덮지 않음), actor는 세션", async () => {
    const { c, rpc } = client(verOk);
    await appendContentVersion({ resolveActor: allowed, getClient: () => c }, form({ contentId: C1, expectedVersionNo: "1", title: "t", body: "b", p_actor_id: OTHER }));
    expect(callsOf(rpc)[0]?.[1]).toMatchObject({ p_actor_id: ADMIN, p_content_id: C1, p_expected_version_no: 1 });
  });
  it("A2: 기대 버전 누락·0은 입력 오류", async () => {
    const { c, rpc } = client(verOk);
    expect((await appendContentVersion({ resolveActor: allowed, getClient: () => c }, form({ contentId: C1, title: "t", body: "b" }))).status).toBe("invalid");
    expect((await appendContentVersion({ resolveActor: allowed, getClient: () => c }, form({ contentId: C1, expectedVersionNo: "0", title: "t", body: "b" }))).status).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("A2 충돌: VERSION_CONFLICT → conflict_version 안내(재전송 없음)", async () => {
    const { c, rpc } = client({ data: null, error: { code: "P0001", message: "VERSION_CONFLICT: content x is at version 3 (expected 1)" } });
    const out = await appendContentVersion({ resolveActor: allowed, getClient: () => c }, form({ contentId: C1, expectedVersionNo: "1", title: "t", body: "b" }));
    expect(writeNoticeOf(out)).toBe("conflict_version");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("A3: 채널 허용 목록", async () => {
    const { c, rpc } = client({ data: { draft_id: D1, content_id: C1, channel: "blog" }, error: null });
    expect((await createChannelDraft({ resolveActor: allowed, getClient: () => c }, form({ contentId: C1, channel: "tiktok" }))).status).toBe("invalid");
    expect(await createChannelDraft({ resolveActor: allowed, getClient: () => c }, form({ contentId: C1, channel: "blog" }))).toEqual({ status: "ok", data: { draftId: D1, contentId: C1, channel: "blog" } });
    expect(callsOf(rpc)[0]?.[1]).toEqual({ p_actor_id: ADMIN, p_content_id: C1, p_channel: "blog" });
  });
  it("A4: 첫 리비전 expected 0 허용, 기대 원문 버전은 렌더 값 그대로, stale은 안내", async () => {
    expect(parseExpectedNonNegative("0")).toBe(0);
    expect(parseExpectedNonNegative("-1")).toBeNull();
    const { c, rpc } = client({ data: null, error: { code: "23514", message: "STALE_CONTENT_VERSION: latest content version is y (expected x)" } });
    const out = await appendDraftRevision({ resolveActor: allowed, getClient: () => c }, form({ draftId: D1, expectedRevisionNo: "0", expectedContentVersionId: V1, body: "초안" }));
    expect(callsOf(rpc)[0]?.[1]).toMatchObject({ p_draft_id: D1, p_expected_revision_no: 0, p_expected_content_version_id: V1, p_body: "초안", p_media: [], p_target_connection_id: null });
    expect(writeNoticeOf(out)).toBe("stale_content");
  });
  it("A4: 링크는 https만", async () => {
    const { c } = client({ data: null, error: null });
    expect((await appendDraftRevision({ resolveActor: allowed, getClient: () => c }, form({ draftId: D1, expectedRevisionNo: "0", expectedContentVersionId: V1, body: "b", linkUrl: "http://x" }))).status).toBe("invalid");
  });
});

describe("승인·반려·철회(A5~A7)", () => {
  const decOk = { data: { approval_id: "f".repeat(8) + "-ffff-4fff-8fff-ffffffffffff", subject_type: "draft_revision", subject_id: R1, decision: "approved", subject_hash: H }, error: null };
  const allChecks = { check_matches_content: "on", check_facts_checked: "on", check_links_checked: "on", check_media_rights_checked: "on" };
  it("승인은 체크리스트 전부 필요(RPC 0회)", async () => {
    const { c, rpc } = client(decOk);
    const out = await decideApproval({ resolveActor: allowed, getClient: () => c }, form({ subjectType: "draft_revision", subjectId: R1, decision: "approved", expectedSubjectHash: H, check_facts_checked: "on" }));
    expect(out.status).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("승인: 렌더된 해시·고정 키 체크리스트 전달", async () => {
    const { c, rpc } = client(decOk);
    const out = await decideApproval({ resolveActor: allowed, getClient: () => c }, form({ subjectType: "draft_revision", subjectId: R1, decision: "approved", expectedSubjectHash: H, ...allChecks, check_evil: "on" }));
    expect(out.status).toBe("ok");
    expect(callsOf(rpc)[0]?.[1]).toEqual({
      p_actor_id: ADMIN,
      p_subject_type: "draft_revision",
      p_subject_id: R1,
      p_decision: "approved",
      p_expected_subject_hash: H,
      p_checklist: { matches_content: true, facts_checked: true, links_checked: true, media_rights_checked: true },
      p_reason: null,
    });
  });
  it("반려는 사유 필수, 체크리스트는 일부여도 됨", async () => {
    const { c, rpc } = client({ ...decOk, data: { ...decOk.data, decision: "rejected" } });
    expect((await decideApproval({ resolveActor: allowed, getClient: () => c }, form({ subjectType: "draft_revision", subjectId: R1, decision: "rejected", expectedSubjectHash: H }))).status).toBe("invalid");
    expect((await decideApproval({ resolveActor: allowed, getClient: () => c }, form({ subjectType: "draft_revision", subjectId: R1, decision: "rejected", expectedSubjectHash: H, reason: "사실 확인 필요" }))).status).toBe("ok");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("해시 변경 → subject_changed, 응답 유실 → uncertain", async () => {
    const changed = client({ data: null, error: { code: "P0001", message: "SUBJECT_CHANGED: reviewed hash does not match the subject" } });
    expect(writeNoticeOf(await decideApproval({ resolveActor: allowed, getClient: () => changed.c }, form({ subjectType: "content_version", subjectId: V1, decision: "approved", expectedSubjectHash: H, check_facts_checked: "on", check_sources_checked: "on", check_public_ok: "on" })))).toBe("subject_changed");
    const lost = client(new Error("socket"));
    expect(writeNoticeOf(await decideApproval({ resolveActor: allowed, getClient: () => lost.c }, form({ subjectType: "draft_revision", subjectId: R1, decision: "rejected", expectedSubjectHash: H, reason: "x" })))).toBe("uncertain");
    expect(lost.rpc).toHaveBeenCalledTimes(1);
  });
  it("보관·권한 철회 분기", async () => {
    const arch = client({ data: null, error: { code: "23514", message: "ARCHIVED: content x is archived" } });
    expect(writeNoticeOf(await revokeApproval({ resolveActor: allowed, getClient: () => arch.c }, form({ approvalId: R1, reason: "r" })))).toBe("archived");
    const perm = client({ data: null, error: { code: "42501", message: "actor is not an approved distribution admin" } });
    expect(writeNoticeOf(await revokeApproval({ resolveActor: allowed, getClient: () => perm.c }, form({ approvalId: R1, reason: "r" })))).toBe("denied");
  });
  it("철회는 사유 필수", async () => {
    const { c, rpc } = client({ data: null, error: null });
    expect((await revokeApproval({ resolveActor: allowed, getClient: () => c }, form({ approvalId: R1 }))).status).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("write-notice", () => {
  it("식별 못 한 DB 오류·형식 오류는 uncertain, 허용 목록 파싱", () => {
    expect(writeNoticeOf({ status: "db_error", error: { code: "unexpected", token: null, sqlstate: "XX000" } })).toBe("uncertain");
    expect(writeNoticeOf({ status: "bad_response" })).toBe("uncertain");
    expect(parseWriteNotice("saved")).toBe("saved");
    expect(parseWriteNotice("<script>")).toBeNull();
  });
});
