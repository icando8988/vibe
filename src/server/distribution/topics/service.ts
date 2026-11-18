/**
 * 글감 후보 쓰기 서비스(의존성 주입, 테스트 대상). TOPIC-COLLECT-131.
 * 매 호출: 검증된 세션 actor + D1 → 입력 검증 → service RPC 1회(runDistributionWrite). DB가 D1·중복·버전을 다시 검사한다.
 * 이 모듈은 네트워크 요청을 하지 않는다(sourceUrl은 형식만 검사해 그대로 저장).
 */
import { isUuid, parseExpectedInt, parseOptionalHttpsUrl, validateContentInput, type FieldError } from "../validation";
import { runDistributionWrite, type RpcClient } from "../write-runner";
import type { ActorResult } from "../actor-core";
import {
  TOPIC_LIMITS,
  TOPIC_SETTABLE_STATUSES,
  TOPIC_STATUSES,
  type TopicConvertOutcome,
  type TopicCreateOutcome,
  type TopicSettableStatus,
  type TopicStatus,
  type TopicStatusOutcome,
} from "./types";

export const TOPIC_RPC = Object.freeze({
  create: "distribution_create_topic_candidate",
  setStatus: "distribution_set_topic_candidate_status",
  convert: "distribution_convert_topic_candidate",
} as const);

export type TopicWriteDeps = { resolveActor: () => Promise<ActorResult>; getClient: () => RpcClient | null };
type Form = { get(name: string): unknown };

const CONTROL_RE = /[\u0000-\u001f\u007f]/; // 한 줄 필드
const MEMO_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/; // 메모는 줄바꿈·탭 허용
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isStatus = (v: unknown): v is TopicStatus => typeof v === "string" && (TOPIC_STATUSES as readonly string[]).includes(v);

/** 한 줄 선택 필드: 빈 값은 null, 길이·제어문자 검사 */
function optionalLine(v: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false };
  const t = v.trim();
  if (t === "") return { ok: true, value: null };
  if ([...t].length > max || CONTROL_RE.test(t)) return { ok: false };
  return { ok: true, value: t };
}

/** YYYY-MM-DD 실제 달력 날짜, 1990-01-01 ~ 오늘(UTC)+1일 */
export function parseSourceDate(v: unknown, now = new Date()): { ok: true; value: string | null } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false };
  const m = DATE_RE.exec(v.trim());
  if (!m) return { ok: false };
  const d = new Date(`${m[0]}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[0]) return { ok: false };
  if (m[0] < "1990-01-01" || d.getTime() > now.getTime() + 86_400_000) return { ok: false };
  return { ok: true, value: m[0] };
}

// 1) 수집(수동 입력)
export function createTopicCandidate(deps: TopicWriteDeps, form: Form, now = new Date()): Promise<TopicCreateOutcome> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const errors: FieldError[] = [];
      const title = text(form.get("title"));
      const memoRaw = form.get("memo");
      const memo = typeof memoRaw === "string" ? memoRaw.replace(/\r\n/g, "\n").trim() : "";
      if (title === "") errors.push({ field: "title", rule: "required" });
      else if ([...title].length > TOPIC_LIMITS.titleMax) errors.push({ field: "title", rule: "max_length" });
      else if (CONTROL_RE.test(title)) errors.push({ field: "title", rule: "control_chars" });
      if (memoRaw !== null && memoRaw !== undefined && typeof memoRaw !== "string") errors.push({ field: "memo", rule: "format" });
      else if ([...memo].length > TOPIC_LIMITS.memoMax) errors.push({ field: "memo", rule: "max_length" });
      else if (MEMO_CONTROL_RE.test(memo)) errors.push({ field: "memo", rule: "control_chars" });
      const url = parseOptionalHttpsUrl(form.get("sourceUrl"));
      if (!url.ok) errors.push({ field: "sourceUrl", rule: "https_url" });
      const sourceName = optionalLine(form.get("sourceName"), TOPIC_LIMITS.sourceNameMax);
      if (!sourceName.ok) errors.push({ field: "sourceName", rule: "format" });
      const category = optionalLine(form.get("category"), TOPIC_LIMITS.categoryMax);
      if (!category.ok) errors.push({ field: "category", rule: "format" });
      const sourceDate = parseSourceDate(form.get("sourceDate"), now);
      if (!sourceDate.ok) errors.push({ field: "sourceDate", rule: "date" });
      if (errors.length || !url.ok || !sourceName.ok || !category.ok || !sourceDate.ok) return { ok: false, errors };
      return { ok: true, value: { title, memo, sourceUrl: url.value, sourceName: sourceName.value, category: category.value, sourceDate: sourceDate.value } };
    },
    fn: TOPIC_RPC.create,
    params: (actorId, v) => ({
      p_actor_id: actorId,
      p_title: v.title,
      p_memo: v.memo,
      p_source_url: v.sourceUrl,
      p_source_name: v.sourceName,
      p_category: v.category,
      p_source_date: v.sourceDate,
    }),
    parse: (data) => {
      const d = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
      if (d?.created === true && isUuid(d.candidate_id)) return { created: true as const, candidateId: d.candidate_id };
      if (d?.created === false && isUuid(d.duplicate_of) && isStatus(d.duplicate_status)) {
        return { created: false as const, duplicateOf: d.duplicate_of, duplicateStatus: d.duplicate_status };
      }
      return null;
    },
  });
}

// 2) 상태 변경(고르기·되돌리기·제외)
export function setTopicCandidateStatus(deps: TopicWriteDeps, form: Form): Promise<TopicStatusOutcome> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const errors: FieldError[] = [];
      const candidateId = form.get("candidateId");
      const expectedVersion = parseExpectedInt(form.get("expectedVersion"));
      const status = form.get("status");
      if (!isUuid(candidateId)) errors.push({ field: "candidateId", rule: "uuid" });
      if (expectedVersion === null) errors.push({ field: "expectedVersion", rule: "expected" });
      if (typeof status !== "string" || !(TOPIC_SETTABLE_STATUSES as readonly string[]).includes(status)) errors.push({ field: "status", rule: "status" });
      if (errors.length || !isUuid(candidateId) || expectedVersion === null) return { ok: false, errors };
      return { ok: true, value: { candidateId, expectedVersion, status: status as TopicSettableStatus } };
    },
    fn: TOPIC_RPC.setStatus,
    params: (actorId, v) => ({ p_actor_id: actorId, p_candidate_id: v.candidateId, p_expected_version: v.expectedVersion, p_status: v.status }),
    parse: (data) => {
      const d = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
      if (!d || !isUuid(d.candidate_id) || !isStatus(d.status) || !Number.isInteger(d.row_version)) return null;
      return { candidateId: d.candidate_id, status: d.status, rowVersion: d.row_version as number };
    },
  });
}

// 3) 기존 원문으로 변환(원문 1버전 생성 + 후보 연결, DB 한 트랜잭션). 승인·초안·작업 없음.
export function convertTopicCandidate(deps: TopicWriteDeps, form: Form): Promise<TopicConvertOutcome> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const base = validateContentInput({ title: form.get("title"), body: form.get("body"), targetPath: form.get("targetPath") });
      const errors: FieldError[] = base.ok ? [] : [...base.errors];
      const candidateId = form.get("candidateId");
      const expectedVersion = parseExpectedInt(form.get("expectedVersion"));
      if (!isUuid(candidateId)) errors.push({ field: "candidateId", rule: "uuid" });
      if (expectedVersion === null) errors.push({ field: "expectedVersion", rule: "expected" });
      if (form.get("confirmConvert") !== "on") errors.push({ field: "confirmConvert", rule: "required" });
      if (errors.length || !base.ok || !isUuid(candidateId) || expectedVersion === null) return { ok: false, errors };
      return { ok: true, value: { candidateId, expectedVersion, title: base.value.title, body: base.value.body, targetPath: base.value.targetPath } };
    },
    fn: TOPIC_RPC.convert,
    params: (actorId, v) => ({
      p_actor_id: actorId,
      p_candidate_id: v.candidateId,
      p_expected_version: v.expectedVersion,
      p_title: v.title,
      p_body: v.body,
      p_target_path: v.targetPath,
    }),
    parse: (data) => {
      const d = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
      if (!d || !isUuid(d.candidate_id) || !isUuid(d.content_id) || typeof d.already_converted !== "boolean") return null;
      return { candidateId: d.candidate_id, contentId: d.content_id, alreadyConverted: d.already_converted };
    },
  });
}
