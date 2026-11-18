/**
 * 글감 후보 목록 조회(세션 + RLS, D1 정책). TOPIC-COLLECT-131.
 * 조회 실패·schema 없음·0건을 구분한다(기존 read.run 규칙). 열은 authenticated GRANT 열만 요청한다(dedupe_key·converted_by 제외).
 */
import { rows, run, type Filter, type ReadOutcome, type ReadSource } from "../read";
import { TOPIC_LIMITS, TOPIC_STATUSES, type TopicCandidateDto, type TopicStatus } from "./types";

export const TOPIC_COLS = [
  "id", "title", "memo", "source_url", "source_name", "category", "source_date", "status",
  "converted_content_id", "converted_at", "collected_by", "collected_at", "row_version", "updated_at",
] as const;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function toTopicCandidate(r: Record<string, unknown>): TopicCandidateDto | null {
  const status = r.status;
  if (
    typeof r.id !== "string" || typeof r.title !== "string" || typeof r.memo !== "string" ||
    typeof status !== "string" || !(TOPIC_STATUSES as readonly string[]).includes(status) ||
    typeof r.collected_by !== "string" || typeof r.collected_at !== "string" || typeof r.updated_at !== "string" ||
    typeof r.row_version !== "number" || !Number.isInteger(r.row_version)
  ) {
    return null;
  }
  const sourceDate = str(r.source_date);
  return {
    id: r.id,
    title: r.title,
    memo: r.memo,
    sourceUrl: str(r.source_url),
    sourceName: str(r.source_name),
    category: str(r.category),
    sourceDate: sourceDate ? sourceDate.slice(0, 10) : null,
    status: status as TopicStatus,
    convertedContentId: str(r.converted_content_id),
    convertedAt: str(r.converted_at),
    collectedBy: r.collected_by,
    collectedAt: r.collected_at,
    rowVersion: r.row_version,
    updatedAt: r.updated_at,
  };
}

/** 최신 수집 순, 최대 100건. status를 주면 그 상태만. 형식이 다른 행은 버리지 않고 오류로 본다(조용한 누락 방지). */
export function listTopicCandidates(src: ReadSource | null, filter: { status?: TopicStatus } = {}): Promise<ReadOutcome<TopicCandidateDto[]>> {
  return run(src, async (s) => {
    const filters: Filter[] = filter.status ? [{ col: "status", op: "eq", value: filter.status }] : [];
    const raw = await rows(s, {
      table: "distribution_topic_candidates",
      columns: TOPIC_COLS,
      filters,
      order: [{ col: "collected_at", ascending: false }],
      limit: TOPIC_LIMITS.listMax,
    });
    return raw.map((r) => {
      const dto = toTopicCandidate(r);
      if (!dto) throw new Error("bad topic candidate row");
      return dto;
    });
  });
}
