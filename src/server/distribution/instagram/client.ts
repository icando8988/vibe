/**
 * Instagram 단일 이미지 게시 부품(Instagram 로그인 경로) — AUTOPOST-INSTAGRAM-PORT-021.
 * 출처: Insta_Auto_Posting_Kit_v1.11/insta_auto_poster/src/lib/instagram/publish.ts
 *       (createImageContainer · waitForContainerReady 1회분 · publishContainer · getPermalink, © BUYLIFE — 같은 폴더 NOTICE).
 *
 * 공식 문서 대조(2026-11-17, 문서 읽기만):
 *   - https://developers.facebook.com/docs/instagram-platform/overview — Instagram 로그인 앱은 graph.instagram.com 호스트
 *   - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media — 최신 v27.0,
 *     POST /<IG_ID>/media, image_url(필수·공개 서버), caption(≤2200), alt_text(≤1000), 응답 id. 이미지: JPEG만, ≤8MB,
 *     4:5~1.91:1, 폭 320~1440, sRGB. 컨테이너 24시간 후 만료, 24시간 400개 한도.
 *   - .../ig-container — status_code: EXPIRED·ERROR·FINISHED("ready to be published")·IN_PROGRESS·PUBLISHED. 1분에 1번, 5분 이내 조회 권장.
 *   - .../ig-user/media_publish — POST /<IG_ID>/media_publish creation_id → id. config_issue가 있어도 게시는 성공(부분 성공).
 *   - .../content-publishing — POST 예시가 `Authorization: Bearer <ACCESS_TOKEN>` + JSON 본문.
 *   - .../ig-media — permalink 필드(앨범 하위 사진 제외).
 * 원본과 다른 점:
 *   - 버전: 원본 v25.0 → 문서 현재 v27.0으로 고정.
 *   - POST(컨테이너·게시): 문서 예시대로 Bearer 헤더 + JSON 본문(토큰을 URL·본문에 넣지 않음). 원본은 form 본문 access_token.
 *   - GET(상태·permalink): 문서 예시는 access_token 쿼리뿐(GET에 Bearer 헤더 예시 없음) → 문서 규격(쿼리)을 따르고, 그 URL은
 *     요청 함수 밖으로 내보내지 않는다. GET Bearer 지원은 미검증.
 *   - 원본 postGraphWithRetry는 media_publish의 "Timeout"도 재시도해 중복 게시 위험(K4) → **어떤 요청도 재시도하지 않는다.**
 *   - 원본 일괄 publishInstagramPost(create→poll→publish→permalink)는 이식하지 않음. 단계를 분리해 워커가 컨테이너 ID를 DB에
 *     먼저 기록한 뒤 publish를 부르게 한다. 폴링 반복도 호출자(워커) 몫 — 여기서는 1회 조회만.
 *   - fetch 주입·timeout·redirect 거부·no-store. 예외 대신 정제 결과. 공급자 메시지·토큰·요청 URL·이미지 URL은 결과·로그에 없음.
 * 서버 내부 계약: image_url은 **미디어 계층(M4)이 이미 검증한 공개 HTTPS URL**만 받는다. 이 모듈은 그 URL을 다운로드·검사하지
 *   않는다(형식·자격정보·길이만 확인). 이미지 권리·JPEG 규격·서명 URL 수명 확인은 M4 의존성이며 현재 지원하지 않는다.
 * 컨테이너 FINISHED = 게시 준비됨(게시 아님). PUBLISHED 상태를 받아도 media_publish 결과·대사 없이 게시 확정으로 쓰지 않는다.
 */
import { IG_CONTAINER_STATUSES, type IgContainerStatus, type IgContainerStatusResult, type IgCreateContainerResult, type IgError, type IgHttpDeps, type IgPermalinkResult, type IgPublishOutcome, type IgPublishResult } from "./types";

export const IG_GRAPH_HOST = "https://graph.instagram.com";
export const IG_GRAPH_VERSION = "v27.0";
export const IG_CAPTION_MAX = 2200;
export const IG_ALT_TEXT_MAX = 1000;
const IMAGE_URL_MAX = 2048;
const DEFAULT_TIMEOUT_MS = 15_000;
const ID_RE = /^[0-9]{1,32}$/;

type Raw = { kind: "response"; status: number; body: unknown } | { kind: "timeout" } | { kind: "network" };

function err(code: IgError["code"], httpStatus: number | null = null, providerCode: number | null = null): IgError {
  return { code, httpStatus, providerCode };
}

function validToken(t: unknown): t is string {
  return typeof t === "string" && t.length >= 10 && t.length <= 4096 && /^[\x21-\x7e]+$/.test(t);
}

/** 미디어 계층이 넘긴 이미지 URL의 형식만 확인(다운로드 안 함): https, 호스트 있음, 자격정보·fragment 없음, 길이 제한, 제어문자 없음. */
export function isAcceptableImageUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 12 || v.length > IMAGE_URL_MAX || /[\s\u0000-\u001f\u007f]/.test(v)) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  return u.protocol === "https:" && !!u.hostname && !u.username && !u.password && !u.hash && u.hostname !== "localhost";
}

function validText(v: unknown, max: number, required: boolean): boolean {
  if (v === undefined || v === null || v === "") return !required;
  return typeof v === "string" && [...v].length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v);
}

async function send(deps: IgHttpDeps, url: string, init: RequestInit): Promise<Raw> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, { ...init, signal: ctrl.signal, cache: "no-store", redirect: "error" });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { kind: "response", status: res.status, body };
  } catch {
    return ctrl.signal.aborted ? { kind: "timeout" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

function classify(raw: Raw): IgError {
  if (raw.kind === "timeout") return err("timeout");
  if (raw.kind === "network") return err("network");
  const e = (raw.body as { error?: { code?: unknown } } | null)?.error;
  const providerCode = typeof e?.code === "number" && Number.isInteger(e.code) ? e.code : null;
  if (raw.status >= 500) return err("http_5xx", raw.status, providerCode);
  if (raw.status === 429 || providerCode === 4 || providerCode === 17 || providerCode === 32 || providerCode === 613 || providerCode === 9) return err("rate_limited", raw.status, providerCode);
  if (raw.status === 401 || providerCode === 190) return err("auth", raw.status, providerCode);
  if (raw.status >= 400 && e && typeof e === "object") return err("rejected", raw.status, providerCode);
  return err("bad_response", raw.status, providerCode);
}

function postJson(accessToken: string, body: Record<string, string>): RequestInit {
  return { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** GET URL(문서 규격: access_token 쿼리). send 밖으로 내보내지 않는다. */
function getUrl(objectId: string, fields: string, accessToken: string): string {
  return `${IG_GRAPH_HOST}/${IG_GRAPH_VERSION}/${objectId}?${new URLSearchParams({ fields, access_token: accessToken }).toString()}`;
}

const ok2xx = (raw: Raw): raw is { kind: "response"; status: number; body: unknown } => raw.kind === "response" && raw.status >= 200 && raw.status < 300;

// 1) 이미지 컨테이너 생성(게시 아님)
export async function createImageContainer(
  deps: IgHttpDeps,
  input: { accessToken: string; igUserId: string; imageUrl: string; caption?: string | null; altText?: string | null },
): Promise<IgCreateContainerResult> {
  if (!validToken(input.accessToken) || !ID_RE.test(input.igUserId) || !isAcceptableImageUrl(input.imageUrl) || !validText(input.caption, IG_CAPTION_MAX, false) || !validText(input.altText, IG_ALT_TEXT_MAX, false)) {
    return { ok: false, definite: true, error: err("invalid_input") };
  }
  const body: Record<string, string> = { image_url: input.imageUrl };
  if (input.caption) body.caption = input.caption;
  if (input.altText) body.alt_text = input.altText;
  const raw = await send(deps, `${IG_GRAPH_HOST}/${IG_GRAPH_VERSION}/${input.igUserId}/media`, postJson(input.accessToken, body));
  if (ok2xx(raw)) {
    const id = (raw.body as { id?: unknown } | null)?.id;
    return typeof id === "string" && ID_RE.test(id) ? { ok: true, containerId: id } : { ok: false, definite: false, error: err("bad_response", raw.status) };
  }
  const e = classify(raw);
  return { ok: false, definite: e.code === "rejected" || e.code === "auth" || e.code === "rate_limited", error: e };
}

// 2) 컨테이너 상태 1회 조회(반복·대기는 호출자 — 문서 권장: 1분 1회, 5분 이내)
export async function getContainerStatus(deps: IgHttpDeps, input: { accessToken: string; containerId: string }): Promise<IgContainerStatusResult> {
  if (!validToken(input.accessToken) || !ID_RE.test(input.containerId)) return { ok: false, error: err("invalid_input") };
  const raw = await send(deps, getUrl(input.containerId, "status_code", input.accessToken), { method: "GET" });
  if (ok2xx(raw)) {
    const s = (raw.body as { status_code?: unknown } | null)?.status_code;
    return typeof s === "string" && (IG_CONTAINER_STATUSES as readonly string[]).includes(s) ? { ok: true, status: s as IgContainerStatus } : { ok: false, error: err("bad_response", raw.status) };
  }
  return { ok: false, error: classify(raw) };
}

/** 게시 요청 가능 여부: FINISHED만(게시 준비됨 ≠ 게시됨). 그 밖은 요청하지 않는다. */
export function canRequestPublish(status: IgContainerStatus): boolean {
  return status === "FINISHED";
}

// 3) media_publish(1회, 재시도 없음)
export async function publishContainer(deps: IgHttpDeps, input: { accessToken: string; igUserId: string; containerId: string }): Promise<IgPublishResult> {
  if (!validToken(input.accessToken) || !ID_RE.test(input.igUserId) || !ID_RE.test(input.containerId)) return { kind: "rejected", error: err("invalid_input") };
  const raw = await send(deps, `${IG_GRAPH_HOST}/${IG_GRAPH_VERSION}/${input.igUserId}/media_publish`, postJson(input.accessToken, { creation_id: input.containerId }));
  if (ok2xx(raw)) {
    const b = raw.body as { id?: unknown; config_issue?: unknown } | null;
    if (typeof b?.id === "string" && ID_RE.test(b.id)) return { kind: "published", mediaId: b.id, hasConfigIssue: b.config_issue !== undefined && b.config_issue !== null };
    return { kind: "unknown", error: err("bad_response", raw.status) };
  }
  const e = classify(raw);
  if (e.code === "rejected" || e.code === "auth" || e.code === "rate_limited") return { kind: "rejected", error: e };
  return { kind: "unknown", error: e };
}

// 4) permalink(실패해도 게시 실패 아님)
export async function getPermalink(deps: IgHttpDeps, input: { accessToken: string; mediaId: string }): Promise<IgPermalinkResult> {
  if (!validToken(input.accessToken) || !ID_RE.test(input.mediaId)) return { ok: false, error: err("invalid_input") };
  const raw = await send(deps, getUrl(input.mediaId, "permalink", input.accessToken), { method: "GET" });
  if (ok2xx(raw)) {
    const p = (raw.body as { permalink?: unknown } | null)?.permalink;
    return typeof p === "string" && isInstagramPermalink(p) ? { ok: true, permalink: p } : { ok: false, error: err("bad_response", raw.status) };
  }
  return { ok: false, error: classify(raw) };
}

export function isInstagramPermalink(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && (u.hostname === "www.instagram.com" || u.hostname === "instagram.com") && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** publish 결과 + (published일 때만 따로 부른) permalink 결과 → 최종 판정. 네트워크 없음. */
export function combinePublishOutcome(publish: IgPublishResult, permalink: IgPermalinkResult | null): IgPublishOutcome {
  if (publish.kind !== "published") return publish;
  if (permalink?.ok) return { kind: "published", mediaId: publish.mediaId, permalink: permalink.permalink, urlConfirmed: true };
  return { kind: "published", mediaId: publish.mediaId, permalink: null, urlConfirmed: false };
}
