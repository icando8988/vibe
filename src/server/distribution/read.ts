/**
 * 콘텐츠 조회 — 사용자 세션 + RLS(명세 §3). AUTOPOST-CONTENT-CONNECT-014.
 * - service_role을 쓰지 않는다. authenticated 열 GRANT(030000)에 있는 **명시 열만** 요청한다(select * 금지).
 * - 결과 상태를 분리한다: not_configured(로그인·Supabase 미설정) / schema_missing(표·열 없음: migration 미적용) /
 *   error(그 밖의 조회 실패) / ok(성공 — 0건이면 빈 배열·null).
 * - ReadSource는 최소 조회 인터페이스다. 운영은 Supabase 세션 클라이언트 어댑터(read-session.ts),
 *   검증은 PGlite 어댑터(content-connect-run)로 같은 함수를 실행한다.
 */
import { effectiveApproval, toApprovalRow, toRevision, toVersion, type ApprovalRow, type ContentDetailDto, type ContentListItem, type DraftDto } from "./dto";

export type Filter = { col: string; op: "eq" | "in"; value: string | readonly string[] };
export type Query = {
  table: string;
  columns: readonly string[];
  filters?: readonly Filter[];
  order?: ReadonlyArray<{ col: string; ascending: boolean }>;
  limit?: number;
};
export type ReadResult = { rows: Record<string, unknown>[] } | { error: { code?: string; message?: string } };
export type ReadSource = { select(q: Query): Promise<ReadResult> };

export type ReadOutcome<T> =
  | { status: "ok"; data: T }
  | { status: "not_configured" }
  | { status: "schema_missing" }
  | { status: "error" };

// 030000 authenticated GRANT 열(그 밖의 열은 요청하지 않는다)
export const COLS = {
  contents: ["id", "current_version_id", "current_version_no", "archived_at", "updated_at"],
  versions: ["id", "content_id", "version_no", "title", "body", "target_path", "content_hash", "change_summary", "created_at"],
  drafts: ["id", "content_id", "channel", "current_revision_id", "current_revision_no", "archived_at"],
  revisions: ["id", "draft_id", "content_id", "revision_no", "content_version_id", "body", "link_url", "utm", "target_connection_id", "target_external_account_id", "revision_hash", "created_at"],
  media: ["revision_id", "position", "asset_id", "variant_id", "alt_text"],
  approvals: ["id", "subject_type", "content_version_id", "draft_revision_id", "subject_hash", "decision", "revokes_approval_id", "reason", "actor_id", "created_at"],
} as const;

const SCHEMA_CODES = new Set(["42P01", "42703", "PGRST205", "PGRST204", "PGRST200"]);

class ReadFailure extends Error {
  constructor(readonly kind: "schema_missing" | "error") {
    super(kind);
  }
}

export async function rows(src: ReadSource, q: Query): Promise<Record<string, unknown>[]> {
  let res: ReadResult;
  try {
    res = await src.select(q);
  } catch {
    throw new ReadFailure("error");
  }
  if ("error" in res) throw new ReadFailure(res.error.code && SCHEMA_CODES.has(res.error.code) ? "schema_missing" : "error");
  return res.rows;
}

export async function run<T>(src: ReadSource | null, fn: (s: ReadSource) => Promise<T>): Promise<ReadOutcome<T>> {
  if (!src) return { status: "not_configured" };
  try {
    return { status: "ok", data: await fn(src) };
  } catch (e) {
    return { status: e instanceof ReadFailure ? e.kind : "error" };
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const nullableStr = (v: unknown) => v === null || typeof v === "string"; // 042: undefined(키 누락)는 SQL NULL이 아니다

/**
 * 현재 리비전 첨부 목록(BE-REVISION-MEDIA-HARDEN-041, 계약 REVISION_MEDIA_CONTRACT §1).
 * ok는 "완전한 목록"이라는 계약이므로 이상 행을 조용히 걸러 내지 않는다(fail closed → ReadFailure("error") → detail 전체 error).
 * 이상 행: 요청하지 않은 revision_id, position이 1 이상 정수가 아님·중복·역순, asset_id uuid 아님, variant_id가 null·uuid 아님,
 * alt_text가 null·문자열 아님. nullable variant_id·alt_text는 실제 null만 유효 — 명시 선택한 열의 키 누락(undefined)은 이상 행(HARDEN-042).
 */
export function revisionMediaOf(media: Record<string, unknown>[], revisionId: string, requested: readonly string[]): Array<{ asset_id: string; variant_id: string | null; alt_text: string | null }> {
  const out: Array<{ asset_id: string; variant_id: string | null; alt_text: string | null }> = [];
  let last = 0;
  for (const m of media) {
    if (!isId(m.revision_id) || !requested.includes(m.revision_id)) throw new ReadFailure("error");
    if (m.revision_id !== revisionId) continue;
    const pos = m.position;
    if (typeof pos !== "number" || !Number.isInteger(pos) || pos < 1 || pos <= last) throw new ReadFailure("error");
    if (!isId(m.asset_id) || !(m.variant_id === null || isId(m.variant_id)) || !nullableStr(m.alt_text)) throw new ReadFailure("error");
    last = pos;
    out.push({ asset_id: m.asset_id, variant_id: str(m.variant_id), alt_text: str(m.alt_text) });
  }
  return out;
}

// ---------------------------------------------------------------- 보관함
export function listContents(src: ReadSource | null): Promise<ReadOutcome<ContentListItem[]>> {
  return run(src, async (s) => {
    const heads = await rows(s, {
      table: "distribution_contents",
      columns: COLS.contents,
      order: [
        { col: "updated_at", ascending: false },
        { col: "id", ascending: false },
      ],
      limit: 50,
    });
    const ids = heads.map((h) => str(h.current_version_id)).filter((v): v is string => v !== null);
    const titles = new Map<string, string>();
    if (ids.length) {
      for (const v of await rows(s, { table: "distribution_content_versions", columns: ["id", "title"], filters: [{ col: "id", op: "in", value: ids }] })) {
        if (str(v.id) && str(v.title) !== null) titles.set(v.id as string, v.title as string);
      }
    }
    return heads.flatMap((h) => {
      const id = str(h.id);
      const updatedAt = str(h.updated_at);
      if (!id || !updatedAt || typeof h.current_version_no !== "number") return [];
      const cv = str(h.current_version_id);
      return [{ id, title: cv ? titles.get(cv) ?? null : null, versionNo: h.current_version_no, archived: h.archived_at != null, updatedAt }];
    });
  });
}

// ---------------------------------------------------------------- 원문 상세(버전 이력·채널 초안·유효 승인)
export function getContentDetail(src: ReadSource | null, contentId: string): Promise<ReadOutcome<ContentDetailDto | null>> {
  return run(src, async (s) => {
    const head = (await rows(s, { table: "distribution_contents", columns: COLS.contents, filters: [{ col: "id", op: "eq", value: contentId }], limit: 1 }))[0];
    if (!head) return null; // 없거나 RLS로 보이지 않음
    const versions = (await rows(s, {
      table: "distribution_content_versions",
      columns: COLS.versions,
      filters: [{ col: "content_id", op: "eq", value: contentId }],
      order: [{ col: "version_no", ascending: false }],
      limit: 20,
    }))
      .map(toVersion)
      .filter((v): v is NonNullable<typeof v> => v !== null);
    const currentVersionId = str(head.current_version_id);
    const current = versions.find((v) => v.id === currentVersionId) ?? null;

    const draftRows = await rows(s, { table: "distribution_channel_drafts", columns: COLS.drafts, filters: [{ col: "content_id", op: "eq", value: contentId }] });
    const revIds = draftRows.map((d) => str(d.current_revision_id)).filter((v): v is string => v !== null);
    const revisions = revIds.length
      ? (await rows(s, { table: "distribution_draft_revisions", columns: COLS.revisions, filters: [{ col: "id", op: "in", value: revIds }] }))
          .map(toRevision)
          .filter((r): r is NonNullable<typeof r> => r !== null)
      : [];
    // 리비전 미디어(다음 리비전 저장 때 그대로 보존하기 위해 읽는다 — BLOG-FLOW-015)
    if (revIds.length) {
      const media = await rows(s, { table: "distribution_draft_revision_media", columns: COLS.media, filters: [{ col: "revision_id", op: "in", value: revIds }], order: [{ col: "position", ascending: true }] });
      for (const r of revisions) r.media = revisionMediaOf(media, r.id, revIds);
    }

    const approvals: ApprovalRow[] = [];
    if (currentVersionId) {
      approvals.push(...(await rows(s, { table: "distribution_approvals", columns: COLS.approvals, filters: [{ col: "content_version_id", op: "eq", value: currentVersionId }] })).map(toApprovalRow).filter((a): a is ApprovalRow => a !== null));
    }
    if (revIds.length) {
      approvals.push(...(await rows(s, { table: "distribution_approvals", columns: COLS.approvals, filters: [{ col: "draft_revision_id", op: "in", value: revIds }] })).map(toApprovalRow).filter((a): a is ApprovalRow => a !== null));
    }

    const drafts: ContentDetailDto["drafts"] = {};
    for (const d of draftRows) {
      const ch = d.channel;
      if ((ch !== "blog" && ch !== "threads" && ch !== "instagram") || !str(d.id) || typeof d.current_revision_no !== "number") continue;
      const revision = revisions.find((r) => r.id === str(d.current_revision_id)) ?? null;
      const dto: DraftDto = {
        id: d.id as string,
        channel: ch,
        archived: d.archived_at != null,
        currentRevisionNo: d.current_revision_no,
        revision,
        basedOnLatest: revision ? revision.contentVersionId === currentVersionId : null,
        approval: revision ? effectiveApproval(approvals, { type: "draft_revision", id: revision.id }) : { state: "none" },
      };
      drafts[ch] = dto;
    }

    return {
      id: contentId,
      archived: head.archived_at != null,
      currentVersionNo: typeof head.current_version_no === "number" ? head.current_version_no : 0,
      current,
      versions,
      contentApproval: current ? effectiveApproval(approvals, { type: "content_version", id: current.id }) : { state: "none" },
      drafts,
    };
  });
}
