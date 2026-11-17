/**
 * 원문·채널 초안 쓰기(A1~A4) — 의존성 주입(테스트 대상). AUTOPOST-CONTENT-CONNECT-014, 명세 §4.1.
 * 절차는 write-runner: 검증된 세션 actor + D1 → 입력 검증 → service 클라이언트(없으면 not_ready) → RPC 1회.
 * 기대값(expected_version_no / expected_revision_no / expected_content_version_id)은 **폼에 렌더된 값 그대로** 보낸다.
 * 서버에서 최신값을 다시 읽어 채우지 않는다(충돌을 숨기지 않기 위해). 응답 유실은 자동 재전송하지 않는다.
 */
import type { ActorResult } from "./actor-core";
import { appendContentVersionParams, appendDraftRevisionParams, createChannelDraftParams, createContentParams, parseContentVersionResult, RPC, type ContentVersionResult } from "./rpc-params";
import { isUuid, LIMITS, parseExpectedInt, parseOptionalHttpsUrl, validateContentInput, validateUtm, type FieldError, type Validated } from "./validation";
import { runDistributionWrite, type RpcClient, type WriteOutcome } from "./write-runner";

export type WriteDeps = { resolveActor: () => Promise<ActorResult>; getClient: () => RpcClient | null };
export type Form = { get(name: string): unknown };

const CHANNELS = ["blog", "threads", "instagram"] as const;
type Channel = (typeof CHANNELS)[number];

/** 0 이상 정수(첫 리비전의 expected_revision_no는 0). */
export function parseExpectedNonNegative(v: unknown): number | null {
  if (typeof v !== "string" || !/^(0|[1-9][0-9]{0,8})$/.test(v)) return null;
  return Number(v);
}

// A1 원문 생성
export function createContent(deps: WriteDeps, form: Form): Promise<WriteOutcome<ContentVersionResult>> {
  return runDistributionWrite({
    ...deps,
    validate: () => validateContentInput({ title: form.get("title"), body: form.get("body"), targetPath: form.get("targetPath"), changeSummary: form.get("changeSummary") }),
    fn: RPC.createContent,
    params: createContentParams,
    parse: parseContentVersionResult,
  });
}

// A2 새 버전(기대 버전 = 렌더 시점 current_version_no)
export function appendContentVersion(deps: WriteDeps, form: Form): Promise<WriteOutcome<ContentVersionResult>> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const base = validateContentInput({ title: form.get("title"), body: form.get("body"), targetPath: form.get("targetPath"), changeSummary: form.get("changeSummary") });
      const errors: FieldError[] = base.ok ? [] : [...base.errors];
      const contentId = form.get("contentId");
      const expectedVersionNo = parseExpectedInt(form.get("expectedVersionNo"));
      if (!isUuid(contentId)) errors.push({ field: "contentId", rule: "uuid" });
      if (expectedVersionNo === null) errors.push({ field: "expectedVersionNo", rule: "expected" });
      if (errors.length || !base.ok || !isUuid(contentId) || expectedVersionNo === null) return { ok: false, errors };
      return { ok: true, value: { ...base.value, contentId, expectedVersionNo } };
    },
    fn: RPC.appendContentVersion,
    params: appendContentVersionParams,
    parse: parseContentVersionResult,
  });
}

// A3 채널 초안 만들기
export type DraftCreated = { draftId: string; contentId: string; channel: Channel };
export function createChannelDraft(deps: WriteDeps, form: Form): Promise<WriteOutcome<DraftCreated>> {
  return runDistributionWrite({
    ...deps,
    validate: (): Validated<{ contentId: string; channel: Channel }> => {
      const contentId = form.get("contentId");
      const channel = form.get("channel");
      const errors: FieldError[] = [];
      if (!isUuid(contentId)) errors.push({ field: "contentId", rule: "uuid" });
      if (typeof channel !== "string" || !(CHANNELS as readonly string[]).includes(channel)) errors.push({ field: "channel", rule: "channel" });
      if (errors.length) return { ok: false, errors };
      return { ok: true, value: { contentId: contentId as string, channel: channel as Channel } };
    },
    fn: RPC.createChannelDraft,
    params: createChannelDraftParams,
    parse: (data) => {
      const d = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
      if (!d || !isUuid(d.draft_id) || !isUuid(d.content_id) || typeof d.channel !== "string" || !(CHANNELS as readonly string[]).includes(d.channel)) return null;
      return { draftId: d.draft_id, contentId: d.content_id, channel: d.channel as Channel };
    },
  });
}

type Preserved = {
  utm: Record<string, string>;
  targetConnectionId: string | null;
  targetExternalAccountId: string | null;
  media: Array<{ asset_id: string; variant_id: string | null; alt_text: string | null }>;
};

/** hidden `preserveUtm`·`preserveMedia`(JSON), `preserveTargetConnectionId`·`preserveTargetAccountId`. 없으면 빈 값. */
export function parsePreserved(form: Form): { ok: true; value: Preserved } | { ok: false } {
  const parseJson = (v: unknown, fallback: unknown) => {
    if (v === null || v === undefined || v === "") return fallback;
    if (typeof v !== "string" || v.length > 20000) return undefined;
    try {
      return JSON.parse(v);
    } catch {
      return undefined;
    }
  };
  const utmRaw = parseJson(form.get("preserveUtm"), {});
  const mediaRaw = parseJson(form.get("preserveMedia"), []);
  if (utmRaw === undefined || mediaRaw === undefined) return { ok: false }; // 파싱 실패를 빈 값으로 취급하지 않음
  const utm = validateUtm(utmRaw);
  if (!utm.ok || !Array.isArray(mediaRaw) || mediaRaw.length > 20) return { ok: false };
  const media: Preserved["media"] = [];
  for (const m of mediaRaw) {
    const o = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
    if (!o || !isUuid(o.asset_id) || (o.variant_id !== null && o.variant_id !== undefined && !isUuid(o.variant_id))) return { ok: false };
    if (o.alt_text !== null && o.alt_text !== undefined && (typeof o.alt_text !== "string" || o.alt_text.length > 1000)) return { ok: false };
    media.push({ asset_id: o.asset_id, variant_id: (o.variant_id as string | null | undefined) ?? null, alt_text: (o.alt_text as string | null | undefined) ?? null });
  }
  const tc = form.get("preserveTargetConnectionId");
  const ta = form.get("preserveTargetAccountId");
  if (tc !== null && tc !== "" && !isUuid(tc)) return { ok: false };
  if (ta !== null && ta !== "" && (typeof ta !== "string" || ta.length > 200)) return { ok: false };
  return {
    ok: true,
    value: { utm: utm.value, media, targetConnectionId: isUuid(tc) ? tc : null, targetExternalAccountId: typeof ta === "string" && ta !== "" ? ta : null },
  };
}

// A4 초안 리비전(기대 리비전 번호 + 기대 원문 버전 ID = 렌더 값)
export type RevisionSaved = { draftId: string; revisionId: string; revisionNo: number; contentVersionId: string; revisionHash: string };
export function appendDraftRevision(deps: WriteDeps, form: Form): Promise<WriteOutcome<RevisionSaved>> {
  return runDistributionWrite({
    ...deps,
    validate: () => {
      const errors: FieldError[] = [];
      const draftId = form.get("draftId");
      const expectedRevisionNo = parseExpectedNonNegative(form.get("expectedRevisionNo"));
      const expectedContentVersionId = form.get("expectedContentVersionId");
      const body = typeof form.get("body") === "string" ? (form.get("body") as string) : "";
      const link = parseOptionalHttpsUrl(form.get("linkUrl"));
      if (!isUuid(draftId)) errors.push({ field: "draftId", rule: "uuid" });
      if (expectedRevisionNo === null) errors.push({ field: "expectedRevisionNo", rule: "expected" });
      if (!isUuid(expectedContentVersionId)) errors.push({ field: "expectedContentVersionId", rule: "uuid" });
      if (body.trim().length === 0) errors.push({ field: "body", rule: "required" });
      else if ([...body].length > LIMITS.bodyMax) errors.push({ field: "body", rule: "max_length" });
      if (!link.ok) errors.push({ field: "linkUrl", rule: "https_url" });
      // 이 화면이 편집하지 않는 값(UTM·대상 계정·미디어)은 직전 리비전에서 렌더된 값을 그대로 보존한다(빈 값으로 소실 방지).
      const kept = parsePreserved(form);
      if (!kept.ok) errors.push({ field: "preserved", rule: "format" });
      if (errors.length || !isUuid(draftId) || expectedRevisionNo === null || !isUuid(expectedContentVersionId) || !link.ok || !kept.ok) return { ok: false, errors };
      return { ok: true, value: { draftId, expectedRevisionNo, expectedContentVersionId, body, linkUrl: link.value, ...kept.value } };
    },
    fn: RPC.appendDraftRevision,
    params: appendDraftRevisionParams,
    parse: (data) => {
      const d = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
      if (!d || !isUuid(d.draft_id) || !isUuid(d.revision_id) || typeof d.revision_no !== "number" || !isUuid(d.content_version_id) || typeof d.revision_hash !== "string" || !/^[0-9a-f]{64}$/.test(d.revision_hash)) return null;
      return { draftId: d.draft_id, revisionId: d.revision_id, revisionNo: d.revision_no, contentVersionId: d.content_version_id, revisionHash: d.revision_hash };
    },
  });
}
