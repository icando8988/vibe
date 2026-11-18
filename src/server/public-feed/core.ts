/**
 * 방문자 공개 채널 피드 판정 — BE-PUBLIC-CHANNEL-FEED-084. 순수(ReadSource 주입), env·클라이언트 생성 없음.
 * 실제 service_role 연결은 같은 폴더 index.ts(server-only)만 한다. 계약: 같은 폴더 CONTRACT는 결과 파일 §3.
 *
 * 공개 자격(모두 서버에서 확인, 하나라도 아니면 제외 — fail closed):
 *   1. 작업 status = 'published' + accepted_evidence_id 있음. dry_run_succeeded·예약·대기·오류·unknown은 조회 단계에서 제외.
 *   2. 채널 범위: blog(mode='manual')만. Threads·Instagram live 게시 경로는 이 저장소에 없어서(live gate false, 워커 없음)
 *      해당 채널은 "unsupported"로 숨긴다(행이 있어도 노출하지 않음).
 *   3. has_issues = false, reconciliation_required = false.
 *   4. 증거: 작업이 가리키는 행이 같은 job·channel, status='accepted', external_url = 작업 external_url,
 *      manualEvidenceHostAllowed("blog", url)(D7 기본 호스트) 통과. observed_at이 유효하고 현재 이하.
 *   5. 승인: 원문 버전·리비전 각각의 **현재 유효 승인**(dto.effectiveApproval — SQL distribution_effective_approval_id와 동일)이
 *      작업에 스냅샷된 content_approval_id·approval_id와 같고 철회되지 않음. 원문 승인 checklist.public_ok === true.
 *   6. 원문(distribution_contents)이 보관(archived_at)되지 않음. 리비전이 작업의 원문 버전을 기준으로 함.
 * DTO에는 내부 UUID·검토자·증거 출처/사유·계정·토큰·오류를 넣지 않는다. id는 증거 UUID의 단방향 해시(불투명).
 */
import { createHash } from "node:crypto";
import type { PublicChannelFeed, PublicChannelId, PublicChannelPost } from "@/components/public-channel-feed";
import { manualEvidenceHostAllowed } from "@/lib/distribution/evidence-rules";
import { effectiveApproval, type ApprovalRow } from "../distribution/dto";
import { rows, run, type ReadOutcome, type ReadSource } from "../distribution/read";

/** 한 번에 보는 published 작업 수(최신 생성순). 홈은 채널당 3건만 보이므로 여유분. */
export const PUBLIC_FEED_JOB_LIMIT = 50;
/** 채널당 반환 상한(최신 게시순). */
export const PUBLIC_FEED_POST_LIMIT = 10;
/** 요약 최대 길이(코드포인트). */
export const PUBLIC_SUMMARY_MAX = 160;

export type PublicChannelAvailability = "supported" | "unsupported";

export type ExclusionReason =
  | "evidence_missing"
  | "evidence_not_accepted"
  | "evidence_mismatch"
  | "url_not_allowed"
  | "time_invalid_or_future"
  | "has_issues"
  | "reconciliation_pending"
  | "content_archived"
  | "content_approval_not_effective"
  | "public_ok_missing"
  | "revision_approval_not_effective"
  | "approved_text_missing";

export type PublicChannelFeedsData = {
  feeds: PublicChannelFeed[];
  availability: Record<PublicChannelId, PublicChannelAvailability>;
  /** 운영 진단용 제외 건수(이유별). 내부 ID는 담지 않는다. 화면에 그대로 보이지 않는다. */
  excluded: Partial<Record<ExclusionReason, number>>;
};

/**
 * ok(0건 포함) / not_configured(service_role 미설정) / schema_missing(테이블·열 없음) / error(읽기 실패·형식 이상).
 * UI는 ok가 아닐 때 "게시물 없음"이 아니라 "불러오지 못함"으로 다뤄야 한다.
 */
export type PublicChannelFeedsResult = ReadOutcome<PublicChannelFeedsData>;

const AVAILABILITY: Record<PublicChannelId, PublicChannelAvailability> = {
  blog: "supported",
  threads: "unsupported",
  instagram: "unsupported",
};

// service_role SELECT 대상 최소 열(040000·030000 GRANT 범위 안).
const JOB_COLS = [
  "id", "content_id", "content_version_id", "draft_revision_id", "approval_id", "content_approval_id",
  "channel", "mode", "status", "accepted_evidence_id", "external_url", "has_issues", "reconciliation_required", "created_at",
] as const;
const EVIDENCE_COLS = ["id", "job_id", "channel", "status", "external_url", "observed_at"] as const;
const CONTENT_COLS = ["id", "archived_at"] as const;
const VERSION_COLS = ["id", "content_id", "title"] as const;
const REVISION_COLS = ["id", "content_version_id", "body"] as const;
const APPROVAL_COLS = [
  "id", "subject_type", "content_version_id", "draft_revision_id", "subject_hash", "decision",
  "revokes_approval_id", "checklist", "created_at",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

class ShapeError extends Error {}
/** 형식 이상 행은 조용히 거르지 않고 전체 error로(fail closed). */
function need(ok: boolean): void {
  if (!ok) throw new ShapeError("shape");
}

type JobRow = {
  id: string; contentId: string; contentVersionId: string; draftRevisionId: string;
  approvalId: string; contentApprovalId: string; acceptedEvidenceId: string; externalUrl: string | null;
  hasIssues: boolean; reconciliationRequired: boolean;
};

function parseJob(r: Record<string, unknown>): JobRow {
  need(isId(r.id) && isId(r.content_id) && isId(r.content_version_id) && isId(r.draft_revision_id));
  need(isId(r.approval_id) && isId(r.content_approval_id) && isId(r.accepted_evidence_id));
  need(r.channel === "blog" && r.mode === "manual" && r.status === "published");
  need(r.external_url === null || typeof r.external_url === "string");
  need(typeof r.has_issues === "boolean" && typeof r.reconciliation_required === "boolean");
  return {
    id: r.id as string, contentId: r.content_id as string, contentVersionId: r.content_version_id as string,
    draftRevisionId: r.draft_revision_id as string, approvalId: r.approval_id as string,
    contentApprovalId: r.content_approval_id as string, acceptedEvidenceId: r.accepted_evidence_id as string,
    externalUrl: r.external_url as string | null, hasIssues: r.has_issues as boolean,
    reconciliationRequired: r.reconciliation_required as boolean,
  };
}

function parseApproval(r: Record<string, unknown>): ApprovalRow & { checklist: Record<string, unknown> } {
  need(isId(r.id) && (r.subject_type === "content_version" || r.subject_type === "draft_revision"));
  need(r.content_version_id === null || isId(r.content_version_id));
  need(r.draft_revision_id === null || isId(r.draft_revision_id));
  need(r.decision === "approved" || r.decision === "rejected" || r.decision === "revoked");
  need(r.revokes_approval_id === null || isId(r.revokes_approval_id));
  need(typeof r.subject_hash === "string" && typeof r.created_at === "string" && !Number.isNaN(Date.parse(r.created_at)));
  need(typeof r.checklist === "object" && r.checklist !== null && !Array.isArray(r.checklist));
  return {
    id: r.id as string,
    subject_type: r.subject_type as ApprovalRow["subject_type"],
    content_version_id: r.content_version_id as string | null,
    draft_revision_id: r.draft_revision_id as string | null,
    subject_hash: r.subject_hash as string,
    decision: r.decision as ApprovalRow["decision"],
    revokes_approval_id: r.revokes_approval_id as string | null,
    reason: null, // 사유는 요청하지 않는다(판정에 불필요, 공개 금지)
    actor_id: "", // 검토자는 요청하지 않는다(판정에 불필요, 공개 금지)
    created_at: r.created_at as string,
    checklist: r.checklist as Record<string, unknown>,
  };
}

/**
 * 화면 표시를 속일 수 있는 보이지 않는 문자(QA-PUBLIC-FEED-SECURITY-098 권고, 099).
 *  - C0(탭·줄바꿈·CR 제외 — 아래 공백 정리로 처리)·DEL·C1 제어문자
 *  - U+00AD soft hyphen, U+061C ARABIC LETTER MARK, U+180E MONGOLIAN VOWEL SEPARATOR
 *  - U+200B ZWSP, U+200E/U+200F LRM·RLM, U+202A–U+202E bidi embedding/override
 *  - U+2060–U+2064 word joiner·보이지 않는 연산자, U+2066–U+2069 bidi isolate, U+206A–U+206F 폐기된 형식 제어
 *  - U+FEFF BOM/ZWNBSP, U+FFF9–U+FFFB interlinear annotation, U+E0000–U+E007F 태그 문자
 * U+200C ZWNJ·U+200D ZWJ는 남긴다(아랍 문자 연결 형태·결합 이모지 보존). 단 단어 경계(공백·양 끝)에 홀로 있으면 뺀다.
 */
const INVISIBLE_CONTROLS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu;

/** 보이지 않는 제어 문자 제거 → 공백 정리 → 경계의 ZWNJ·ZWJ 제거 → trim. HTML·마크다운은 해석하지 않는다(문자 그대로). */
function visibleText(raw: string): string {
  return raw
    .replace(INVISIBLE_CONTROLS, "")
    .replace(/\s+/g, " ")
    .replace(/(^| )[\u200c\u200d]+/g, "$1")
    .replace(/[\u200c\u200d]+(?= |$)/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** 승인된 원문 제목 → 공개 제목. 요약과 같은 정리를 하고, 보이는 글자가 남지 않으면 null. */
export function publicTitle(title: string): string | null {
  return visibleText(title) || null;
}

/** 승인된 리비전 본문 → 일반 텍스트 요약. HTML·마크다운을 해석하지 않고 보이지 않는 문자 제거·공백 정리·길이 제한만 한다. */
export function plainExcerpt(body: string, max = PUBLIC_SUMMARY_MAX): string | null {
  const text = visibleText(body);
  if (!text) return null;
  const chars = Array.from(text); // 코드포인트 기준(서로게이트를 쪼개지 않음)
  if (chars.length <= max) return text;
  const head = chars.slice(0, max - 1).join("").trimEnd().replace(/[\u200c\u200d]+$/, "").trimEnd();
  return head + "…";
}

/** 공개 불투명 id: 증거 UUID의 SHA-256 앞 24 hex(되돌릴 수 없음, 같은 게시물은 같은 값). */
export function opaquePostId(evidenceId: string): string {
  return createHash("sha256").update(`public-channel-post:v1:${evidenceId.toLowerCase()}`).digest("hex").slice(0, 24);
}

/** 수락 증거 시각: 유효한 ISO 시각이고 now 이하일 때만 UTC ISO 문자열. */
export function publishedAtOf(observedAt: unknown, now: Date): string | null {
  if (typeof observedAt !== "string") return null;
  const t = Date.parse(observedAt);
  if (Number.isNaN(t) || t > now.getTime()) return null;
  return new Date(t).toISOString();
}

const uniq = (xs: readonly string[]) => [...new Set(xs)];

export async function loadPublicChannelFeeds(src: ReadSource | null, now: Date = new Date()): Promise<PublicChannelFeedsResult> {
  const outcome = await run(src, async (s): Promise<PublicChannelFeedsData> => {
    const excluded: Partial<Record<ExclusionReason, number>> = {};
    const drop = (r: ExclusionReason) => {
      excluded[r] = (excluded[r] ?? 0) + 1;
    };

    const jobs = (
      await rows(s, {
        table: "distribution_jobs",
        columns: JOB_COLS,
        filters: [
          { col: "status", op: "eq", value: "published" },
          { col: "channel", op: "eq", value: "blog" },
          { col: "mode", op: "eq", value: "manual" },
        ],
        order: [{ col: "created_at", ascending: false }],
        limit: PUBLIC_FEED_JOB_LIMIT,
      })
    ).map(parseJob);

    const eligible: JobRow[] = [];
    for (const j of jobs) {
      if (j.hasIssues) drop("has_issues");
      else if (j.reconciliationRequired) drop("reconciliation_pending");
      else eligible.push(j);
    }
    if (eligible.length === 0) return { feeds: emptyFeeds(), availability: { ...AVAILABILITY }, excluded };

    const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));

    const [evRows, contentRows, versionRows, revisionRows, cvApprovalRows, drApprovalRows] = await Promise.all([
      rows(s, { table: "distribution_publication_evidence", columns: EVIDENCE_COLS, filters: [{ col: "id", op: "in", value: uniq(eligible.map((j) => j.acceptedEvidenceId)) }] }),
      rows(s, { table: "distribution_contents", columns: CONTENT_COLS, filters: [{ col: "id", op: "in", value: uniq(eligible.map((j) => j.contentId)) }] }),
      rows(s, { table: "distribution_content_versions", columns: VERSION_COLS, filters: [{ col: "id", op: "in", value: uniq(eligible.map((j) => j.contentVersionId)) }] }),
      rows(s, { table: "distribution_draft_revisions", columns: REVISION_COLS, filters: [{ col: "id", op: "in", value: uniq(eligible.map((j) => j.draftRevisionId)) }] }),
      rows(s, { table: "distribution_approvals", columns: APPROVAL_COLS, filters: [{ col: "content_version_id", op: "in", value: uniq(eligible.map((j) => j.contentVersionId)) }] }),
      rows(s, { table: "distribution_approvals", columns: APPROVAL_COLS, filters: [{ col: "draft_revision_id", op: "in", value: uniq(eligible.map((j) => j.draftRevisionId)) }] }),
    ]);

    const evidence = byId(evRows.map((r) => {
      need(isId(r.id) && isId(r.job_id) && typeof r.channel === "string" && typeof r.status === "string");
      need(r.external_url === null || typeof r.external_url === "string");
      return { id: r.id as string, jobId: r.job_id as string, channel: r.channel as string, status: r.status as string, externalUrl: r.external_url as string | null, observedAt: r.observed_at };
    }));
    const contents = byId(contentRows.map((r) => {
      need(isId(r.id) && (r.archived_at === null || typeof r.archived_at === "string"));
      return { id: r.id as string, archived: r.archived_at !== null };
    }));
    const versions = byId(versionRows.map((r) => {
      need(isId(r.id) && isId(r.content_id) && typeof r.title === "string");
      return { id: r.id as string, contentId: r.content_id as string, title: r.title as string };
    }));
    const revisions = byId(revisionRows.map((r) => {
      need(isId(r.id) && isId(r.content_version_id) && typeof r.body === "string");
      return { id: r.id as string, contentVersionId: r.content_version_id as string, body: r.body as string };
    }));
    const approvals = [...cvApprovalRows, ...drApprovalRows].map(parseApproval);
    const approvalById = byId(approvals);

    const posts: Array<PublicChannelPost & { sortKey: number }> = [];
    for (const j of eligible) {
      const ev = evidence.get(j.acceptedEvidenceId);
      if (!ev) { drop("evidence_missing"); continue; }
      if (ev.status !== "accepted") { drop("evidence_not_accepted"); continue; }
      if (ev.jobId !== j.id || ev.channel !== "blog" || ev.externalUrl === null || ev.externalUrl !== j.externalUrl) { drop("evidence_mismatch"); continue; }
      if (!manualEvidenceHostAllowed("blog", ev.externalUrl)) { drop("url_not_allowed"); continue; }
      const publishedAt = publishedAtOf(ev.observedAt, now);
      if (!publishedAt) { drop("time_invalid_or_future"); continue; }

      const content = contents.get(j.contentId);
      if (!content || content.archived) { drop("content_archived"); continue; }

      const cv = effectiveApproval(approvals, { type: "content_version", id: j.contentVersionId });
      if (cv.state !== "approved" || cv.approvalId !== j.contentApprovalId) { drop("content_approval_not_effective"); continue; }
      if (approvalById.get(cv.approvalId)?.checklist.public_ok !== true) { drop("public_ok_missing"); continue; }

      const dr = effectiveApproval(approvals, { type: "draft_revision", id: j.draftRevisionId });
      if (dr.state !== "approved" || dr.approvalId !== j.approvalId) { drop("revision_approval_not_effective"); continue; }

      const version = versions.get(j.contentVersionId);
      const revision = revisions.get(j.draftRevisionId);
      if (!version || version.contentId !== j.contentId || !revision || revision.contentVersionId !== j.contentVersionId) {
        drop("approved_text_missing");
        continue;
      }

      const title = publicTitle(version.title);
      posts.push({
        id: opaquePostId(ev.id),
        channel: "blog",
        title,
        summary: plainExcerpt(revision.body),
        publishedAt,
        url: ev.externalUrl,
        sortKey: Date.parse(publishedAt),
      });
    }

    posts.sort((a, b) => b.sortKey - a.sortKey || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const blogPosts: PublicChannelPost[] = posts.slice(0, PUBLIC_FEED_POST_LIMIT).map((p) => ({
      id: p.id, channel: p.channel, title: p.title, summary: p.summary, publishedAt: p.publishedAt, url: p.url,
    }));
    return {
      feeds: emptyFeeds().map((f) => (f.channel === "blog" ? { ...f, posts: blogPosts } : f)),
      availability: { ...AVAILABILITY },
      excluded,
    };
  });
  return outcome;
}

/** 프로필 주소는 검증된 공개 계정 주소가 제공되지 않아 모두 null. */
function emptyFeeds(): PublicChannelFeed[] {
  return (["blog", "threads", "instagram"] as const).map((channel) => ({ channel, profileUrl: null, posts: [] }));
}
