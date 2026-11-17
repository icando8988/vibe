/**
 * 작업 조회 — 사용자 세션 + RLS, M2 authenticated GRANT 열만(AUTOPOST-BLOG-FLOW-015).
 * 상태 분리는 read.ts와 같다(not_configured / schema_missing / error / ok·0건).
 */
import { rows, run, type ReadOutcome, type ReadSource } from "./read";
import { toEvent, toEvidence, toJob, toReconciliation, type EventDto, type EvidenceDto, type JobDto, type ReconciliationDto } from "./jobs-dto";

export const JOB_COLS = {
  jobs: [
    "id", "content_id", "content_version_id", "content_version_no", "draft_id", "draft_revision_id", "channel", "mode", "status",
    "hold_reason", "retry_policy", "last_error", "reconciliation_required", "has_issues", "external_id", "external_url", "version",
    "created_at", "updated_at",
  ],
  evidence: ["id", "job_id", "source", "status", "external_post_id", "external_url", "observed_at", "method_note", "created_at"],
  reconciliations: ["id", "job_id", "method", "finding", "observed_at", "observation", "created_at"],
  events: ["id", "job_id", "seq", "from_status", "to_status", "reason_code", "created_at"],
} as const;

const ATTENTION: Record<string, number> = { unknown: 0, failed: 1, awaiting_evidence: 2, manual_ready: 3, scheduled: 4, dispatching: 5 };

/** 조치 필요 우선(대사 필요 → 결과 불명 → 실패 → 증거 대기 → 수동 준비 → 예약) 후 최근 수정순. */
export function sortForAttention(jobs: JobDto[]): JobDto[] {
  return [...jobs].sort((a, b) => {
    if (a.reconciliationRequired !== b.reconciliationRequired) return a.reconciliationRequired ? -1 : 1;
    const ra = ATTENTION[a.rawStatus] ?? 9;
    const rb = ATTENTION[b.rawStatus] ?? 9;
    if (ra !== rb) return ra - rb;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

export function listJobs(src: ReadSource | null, filter: { contentId?: string } = {}): Promise<ReadOutcome<JobDto[]>> {
  return run(src, async (s) => {
    const list = await rows(s, {
      table: "distribution_jobs",
      columns: JOB_COLS.jobs,
      filters: filter.contentId ? [{ col: "content_id", op: "eq", value: filter.contentId }] : [],
      order: [{ col: "updated_at", ascending: false }],
      limit: 100,
    });
    return sortForAttention(list.map(toJob).filter((j): j is JobDto => j !== null));
  });
}

export type JobDetail = {
  job: JobDto;
  evidence: EvidenceDto[];
  reconciliations: ReconciliationDto[];
  events: EventDto[];
  /** 수동 게시용 승인본(원문 버전 title + 승인 리비전 body). 작업에 고정된 ID로 읽는다. */
  approvedText: { title: string; body: string } | null;
};

export function getJobDetail(src: ReadSource | null, jobId: string): Promise<ReadOutcome<JobDetail | null>> {
  return run(src, async (s) => {
    const row = (await rows(s, { table: "distribution_jobs", columns: JOB_COLS.jobs, filters: [{ col: "id", op: "eq", value: jobId }], limit: 1 }))[0];
    const job = row ? toJob(row) : null;
    if (!job) return null;
    const [ev, rc, evts, ver, rev] = await Promise.all([
      rows(s, { table: "distribution_publication_evidence", columns: JOB_COLS.evidence, filters: [{ col: "job_id", op: "eq", value: jobId }], order: [{ col: "created_at", ascending: false }], limit: 50 }),
      rows(s, { table: "distribution_reconciliations", columns: JOB_COLS.reconciliations, filters: [{ col: "job_id", op: "eq", value: jobId }], order: [{ col: "created_at", ascending: false }], limit: 50 }),
      rows(s, { table: "distribution_job_events", columns: JOB_COLS.events, filters: [{ col: "job_id", op: "eq", value: jobId }], order: [{ col: "seq", ascending: true }], limit: 200 }),
      job.contentVersionId ? rows(s, { table: "distribution_content_versions", columns: ["id", "title"], filters: [{ col: "id", op: "eq", value: job.contentVersionId }], limit: 1 }) : Promise.resolve([]),
      rows(s, { table: "distribution_draft_revisions", columns: ["id", "body"], filters: [{ col: "id", op: "eq", value: job.draftRevisionId }], limit: 1 }),
    ]);
    const title = typeof ver[0]?.title === "string" ? (ver[0].title as string) : null;
    const body = typeof rev[0]?.body === "string" ? (rev[0].body as string) : null;
    return {
      job,
      evidence: ev.map(toEvidence).filter((e): e is EvidenceDto => e !== null),
      reconciliations: rc.map(toReconciliation).filter((r): r is ReconciliationDto => r !== null),
      events: evts.map(toEvent).filter((e): e is EventDto => e !== null),
      approvedText: title !== null && body !== null ? { title, body } : null,
    };
  });
}
