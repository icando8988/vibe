/**
 * 콘텐츠·승인 DTO와 유효 승인 판정 — 순수 함수(테스트 대상). AUTOPOST-CONTENT-CONNECT-014, 명세 §3.4(N2).
 *
 * 유효 승인 판정은 M2 `public.distribution_effective_approval_id(subject_type, subject_id)`와 같다:
 *   - 대상의 approved·rejected 결정(철회 행 'revoked' 제외)을 created_at desc, id desc로 정렬해 **가장 최근 1건**만 본다.
 *   - 그 1건이 approved이고 그것을 가리키는 철회 행이 없을 때만 유효 승인(그 id). 그 밖에는 유효 승인 없음.
 *   - 따라서 "최근 결정이 철회된 승인"이면 더 이전 승인이 있어도 유효 승인이 없다(SQL과 동일).
 * 화면 표시는 참고용이다. 실제 판정은 쓰기 RPC(decide_approval·create_job)가 다시 한다.
 */

export type ApprovalRow = {
  id: string;
  subject_type: "content_version" | "draft_revision";
  content_version_id: string | null;
  draft_revision_id: string | null;
  subject_hash: string;
  decision: "approved" | "rejected" | "revoked";
  revokes_approval_id: string | null;
  reason: string | null;
  actor_id: string;
  created_at: string;
};

export type ApprovalState =
  | { state: "approved"; approvalId: string; subjectHash: string; decidedAt: string }
  | { state: "rejected"; approvalId: string; reason: string | null; decidedAt: string }
  | { state: "revoked"; approvalId: string; decidedAt: string }
  | { state: "none" };

/** created_at desc, id desc (PostgreSQL uuid 정렬 = 소문자 hex 문자열 정렬). */
function newerFirst(a: ApprovalRow, b: ApprovalRow): number {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (ta !== tb) return tb - ta;
  const ia = a.id.toLowerCase();
  const ib = b.id.toLowerCase();
  return ia < ib ? 1 : ia > ib ? -1 : 0;
}

export function effectiveApproval(
  rows: readonly ApprovalRow[],
  subject: { type: "content_version" | "draft_revision"; id: string },
): ApprovalState {
  const forSubject = rows.filter((r) =>
    subject.type === "content_version" ? r.content_version_id === subject.id : r.draft_revision_id === subject.id,
  );
  const decisions = forSubject.filter((r) => r.decision === "approved" || r.decision === "rejected").sort(newerFirst);
  const latest = decisions[0];
  if (!latest) return { state: "none" };
  if (latest.decision === "rejected") return { state: "rejected", approvalId: latest.id, reason: latest.reason, decidedAt: latest.created_at };
  const revoked = rows.some((r) => r.decision === "revoked" && r.revokes_approval_id === latest.id);
  if (revoked) return { state: "revoked", approvalId: latest.id, decidedAt: latest.created_at };
  return { state: "approved", approvalId: latest.id, subjectHash: latest.subject_hash, decidedAt: latest.created_at };
}

export const APPROVAL_LABEL: Record<ApprovalState["state"], string> = {
  approved: "승인됨",
  rejected: "반려됨",
  revoked: "승인 철회됨",
  none: "검토 전",
};

/** 승인 체크리스트(키는 050000 assert_checklist 규칙: snake_case, boolean). 승인은 전부 true여야 한다. */
export const CHECKLIST: Record<"content_version" | "draft_revision", ReadonlyArray<{ key: string; label: string }>> = {
  content_version: [
    { key: "facts_checked", label: "확인되지 않은 사실·실적·약속이 없다" },
    { key: "sources_checked", label: "출처·근거를 확인했다" },
    { key: "public_ok", label: "공개해도 되는 내용이다(개인정보·권리)" },
  ],
  draft_revision: [
    { key: "matches_content", label: "현재 원문 버전을 기준으로 한 초안이다" },
    { key: "facts_checked", label: "확인되지 않은 사실·실적·약속이 없다" },
    { key: "links_checked", label: "링크가 의도한 주소다" },
    { key: "media_rights_checked", label: "첨부 미디어가 있다면 권리를 확인했다" },
  ],
};

// ---------------------------------------------------------------- 행 → DTO
export type ContentListItem = {
  id: string;
  title: string | null;
  versionNo: number;
  archived: boolean;
  updatedAt: string;
};

export type ContentVersionDto = {
  id: string;
  versionNo: number;
  title: string;
  body: string;
  targetPath: string | null;
  contentHash: string;
  changeSummary: string | null;
  createdAt: string;
};

export type RevisionDto = {
  id: string;
  revisionNo: number;
  contentVersionId: string;
  body: string;
  linkUrl: string | null;
  revisionHash: string;
  createdAt: string;
  /** 화면이 편집하지 않지만 다음 리비전에 그대로 보존해야 하는 값(BLOG-FLOW-015) */
  utm: Record<string, string>;
  targetConnectionId: string | null;
  targetExternalAccountId: string | null;
  media: Array<{ asset_id: string; variant_id: string | null; alt_text: string | null }>;
};

export type DraftDto = {
  id: string;
  channel: "blog" | "threads" | "instagram";
  archived: boolean;
  currentRevisionNo: number;
  revision: RevisionDto | null;
  /** 현재 리비전이 원문 최신 버전 기준인가(아니면 재작성·재승인 필요) */
  basedOnLatest: boolean | null;
  approval: ApprovalState;
};

export type ContentDetailDto = {
  id: string;
  archived: boolean;
  currentVersionNo: number;
  current: ContentVersionDto | null;
  versions: ContentVersionDto[];
  contentApproval: ApprovalState;
  drafts: Partial<Record<"blog" | "threads" | "instagram", DraftDto>>;
};

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export function toVersion(r: Record<string, unknown>): ContentVersionDto | null {
  if (!isStr(r.id) || !isNum(r.version_no) || !isStr(r.title) || !isStr(r.body) || !isStr(r.content_hash) || !isStr(r.created_at)) return null;
  return {
    id: r.id,
    versionNo: r.version_no,
    title: r.title,
    body: r.body,
    targetPath: isStr(r.target_path) ? r.target_path : null,
    contentHash: r.content_hash,
    changeSummary: isStr(r.change_summary) ? r.change_summary : null,
    createdAt: r.created_at,
  };
}

export function toRevision(r: Record<string, unknown>): RevisionDto | null {
  if (!isStr(r.id) || !isNum(r.revision_no) || !isStr(r.content_version_id) || !isStr(r.body) || !isStr(r.revision_hash) || !isStr(r.created_at)) return null;
  return {
    id: r.id,
    revisionNo: r.revision_no,
    contentVersionId: r.content_version_id,
    body: r.body,
    linkUrl: isStr(r.link_url) ? r.link_url : null,
    revisionHash: r.revision_hash,
    createdAt: r.created_at,
    utm: r.utm && typeof r.utm === "object" && !Array.isArray(r.utm) ? Object.fromEntries(Object.entries(r.utm as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string")) : {},
    targetConnectionId: isStr(r.target_connection_id) ? r.target_connection_id : null,
    targetExternalAccountId: isStr(r.target_external_account_id) ? r.target_external_account_id : null,
    media: [],
  };
}

export function toApprovalRow(r: Record<string, unknown>): ApprovalRow | null {
  const st = r.subject_type;
  const dec = r.decision;
  if (!isStr(r.id) || (st !== "content_version" && st !== "draft_revision") || !isStr(r.subject_hash) || !isStr(r.actor_id) || !isStr(r.created_at)) return null;
  if (dec !== "approved" && dec !== "rejected" && dec !== "revoked") return null;
  return {
    id: r.id,
    subject_type: st,
    content_version_id: isStr(r.content_version_id) ? r.content_version_id : null,
    draft_revision_id: isStr(r.draft_revision_id) ? r.draft_revision_id : null,
    subject_hash: r.subject_hash,
    decision: dec,
    revokes_approval_id: isStr(r.revokes_approval_id) ? r.revokes_approval_id : null,
    reason: isStr(r.reason) ? r.reason : null,
    actor_id: r.actor_id,
    created_at: r.created_at,
  };
}
