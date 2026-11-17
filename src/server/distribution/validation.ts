/**
 * 서버 액션 입력 검증 — 순수 함수(테스트 대상). DB 제약(M1/M2/050000)과 같은 규칙을 앱에서 먼저 확인해
 * 오류 안내를 정확히 한다. DB가 최종 판정이며 이 검사는 그 앞의 1차 거름이다.
 * 텍스트는 정규화하지 않는다(trim·NFC 없음): 해시 v1이 저장 값 그대로를 기준으로 한다(050000 헤더).
 * actor 관련 값은 여기서 다루지 않는다 — actor는 세션에서만 온다.
 */
import { manualEvidenceHostAllowed, isValidExternalId } from "@/lib/distribution/evidence-rules";

export type FieldError = { field: string; rule: string };
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const HTTPS_URL_RE = /^https:\/\/[^/?#@\s]+([/?#]\S*)?$/;
const UTM_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
const CHECKLIST_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

export const LIMITS = Object.freeze({
  titleMax: 200, // M1 distribution_content_versions.title
  bodyMax: 200_000, // M1 body
  changeSummaryMax: 500,
  reasonMax: 1000, // approvals.reason, archive reason
  urlMax: 2048,
  utmMax: 10,
  utmValueMax: 200,
  checklistMax: 50,
  methodNoteMax: 1000,
});

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function isSubjectHash(v: unknown): v is string {
  return typeof v === "string" && HASH_RE.test(v);
}

/** 렌더 시점에 hidden input으로 받은 기대 번호(1 이상 정수). */
export function parseExpectedInt(v: unknown): number | null {
  const s = str(v);
  if (s === null || !/^[1-9][0-9]{0,8}$/.test(s)) return null;
  return Number(s);
}

/** 내부 경로만(M1 target_path 규칙: '/'로 시작, 공백·제어문자·'//' 없음). 빈 값은 null. */
export function parseTargetPath(v: unknown): { ok: true; value: string | null } | { ok: false } {
  const s = str(v);
  if (s === null || s === "") return { ok: true, value: null };
  if (!s.startsWith("/") || s.includes("//") || /[\s\u0000-\u001f\u007f]/.test(s) || s.length > 512) return { ok: false };
  return { ok: true, value: s };
}

export type ContentInput = { title: string; body: string; targetPath: string | null; changeSummary: string | null };

export function validateContentInput(form: { title?: unknown; body?: unknown; targetPath?: unknown; changeSummary?: unknown }): Validated<ContentInput> {
  const errors: FieldError[] = [];
  const title = str(form.title) ?? "";
  const body = str(form.body) ?? "";
  if (title.trim().length === 0) errors.push({ field: "title", rule: "required" });
  else if ([...title].length > LIMITS.titleMax) errors.push({ field: "title", rule: "max_length" });
  if (body.trim().length === 0) errors.push({ field: "body", rule: "required" });
  else if ([...body].length > LIMITS.bodyMax) errors.push({ field: "body", rule: "max_length" });
  const tp = parseTargetPath(form.targetPath);
  if (!tp.ok) errors.push({ field: "targetPath", rule: "internal_path" });
  const cs = str(form.changeSummary);
  const changeSummary = cs && cs.length > 0 ? cs : null;
  if (changeSummary && [...changeSummary].length > LIMITS.changeSummaryMax) errors.push({ field: "changeSummary", rule: "max_length" });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { title, body, targetPath: tp.ok ? tp.value : null, changeSummary } };
}

/** UTM: 객체, 소문자 키 10개 이하, 값 1~200자 문자열(050000 distribution_assert_utm). */
export function validateUtm(v: unknown): Validated<Record<string, string>> {
  if (v === undefined || v === null || v === "") return { ok: true, value: {} };
  if (typeof v !== "object" || Array.isArray(v)) return { ok: false, errors: [{ field: "utm", rule: "object" }] };
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > LIMITS.utmMax) return { ok: false, errors: [{ field: "utm", rule: "max_items" }] };
  for (const [k, val] of entries) {
    if (!UTM_KEY_RE.test(k) || typeof val !== "string" || val.length < 1 || [...val].length > LIMITS.utmValueMax) {
      return { ok: false, errors: [{ field: "utm", rule: "entry" }] };
    }
  }
  return { ok: true, value: Object.fromEntries(entries) as Record<string, string> };
}

/**
 * 체크리스트(050000 distribution_assert_checklist): snake_case 키 50개 이하, 값 boolean.
 * 승인(requireAllTrue)이면 비어 있지 않고 모두 true.
 */
export function validateChecklist(v: unknown, requireAllTrue: boolean): Validated<Record<string, boolean>> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, errors: [{ field: "checklist", rule: "object" }] };
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > LIMITS.checklistMax) return { ok: false, errors: [{ field: "checklist", rule: "max_items" }] };
  for (const [k, val] of entries) {
    if (!CHECKLIST_KEY_RE.test(k) || typeof val !== "boolean") return { ok: false, errors: [{ field: "checklist", rule: "entry" }] };
  }
  if (requireAllTrue && (entries.length === 0 || entries.some(([, val]) => val !== true))) {
    return { ok: false, errors: [{ field: "checklist", rule: "incomplete" }] };
  }
  return { ok: true, value: Object.fromEntries(entries) as Record<string, boolean> };
}

/** 선택 https 링크(M1 link_url 규칙). */
export function parseOptionalHttpsUrl(v: unknown): { ok: true; value: string | null } | { ok: false } {
  const s = str(v);
  if (s === null || s === "") return { ok: true, value: null };
  if (s.length > LIMITS.urlMax || !HTTPS_URL_RE.test(s)) return { ok: false };
  return { ok: true, value: s };
}

export type ManualEvidenceInput = {
  externalUrl: string | null;
  externalPostId: string | null;
  externalAccountId: string | null;
  observedAt: string;
  methodNote: string | null;
};

/**
 * Blog 수동 증거(A10). URL 또는 외부 ID 중 하나 이상. URL은 허용 호스트(blog.naver.com 계열)만.
 * ID만이면 확인 방법 메모 필수. observedAt은 시간대가 붙은 ISO 문자열(UTC 변환은 호출부 N7 규칙).
 */
export function validateBlogManualEvidence(form: {
  externalUrl?: unknown;
  externalPostId?: unknown;
  externalAccountId?: unknown;
  observedAt?: unknown;
  methodNote?: unknown;
}): Validated<ManualEvidenceInput> {
  const errors: FieldError[] = [];
  const url = parseOptionalHttpsUrl(form.externalUrl);
  if (!url.ok) errors.push({ field: "externalUrl", rule: "https_url" });
  const externalUrl = url.ok ? url.value : null;
  if (externalUrl && !manualEvidenceHostAllowed("blog", externalUrl)) errors.push({ field: "externalUrl", rule: "host_not_allowed" });
  const pid = str(form.externalPostId);
  const externalPostId = pid && pid.length > 0 ? pid : null;
  if (externalPostId && !isValidExternalId(externalPostId)) errors.push({ field: "externalPostId", rule: "format" });
  const aid = str(form.externalAccountId);
  const externalAccountId = aid && aid.length > 0 ? aid : null;
  if (externalAccountId && !isValidExternalId(externalAccountId)) errors.push({ field: "externalAccountId", rule: "format" });
  if (!externalUrl && !externalPostId) errors.push({ field: "externalUrl", rule: "url_or_id_required" });
  const note = str(form.methodNote);
  const methodNote = note && note.trim().length > 0 ? note : null;
  if (methodNote && [...methodNote].length > LIMITS.methodNoteMax) errors.push({ field: "methodNote", rule: "max_length" });
  if (!externalUrl && externalPostId && !methodNote) errors.push({ field: "methodNote", rule: "required_with_id_only" });
  const observed = str(form.observedAt);
  const observedOk = observed !== null && /(?:Z|[+-]\d{2}:\d{2})$/.test(observed) && !Number.isNaN(Date.parse(observed));
  if (!observedOk) errors.push({ field: "observedAt", rule: "zoned_datetime" });
  else if (Date.parse(observed) > Date.now() + 5 * 60_000) errors.push({ field: "observedAt", rule: "future" });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { externalUrl, externalPostId, externalAccountId, observedAt: new Date(observed as string).toISOString(), methodNote } };
}

/** 사유(반려·철회·보관·중단): 공백 아닌 1~1000자. */
export function parseReason(v: unknown, required: boolean): { ok: true; value: string | null } | { ok: false } {
  const s = str(v);
  if (s === null || s.trim().length === 0) return required ? { ok: false } : { ok: true, value: null };
  if ([...s].length > LIMITS.reasonMax) return { ok: false };
  return { ok: true, value: s };
}
