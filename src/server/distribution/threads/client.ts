/**
 * Threads 텍스트 게시 부품. AUTOPOST-THREADS-PORT-016.
 * 출처: Threads_Auto_Posting_Kit_v1.02/threads/src/lib/threads/client.ts (© BUYLIFE, 같은 폴더 NOTICE 참조 — 고지 보존).
 *
 * 이식한 것(텍스트만): createThreadsContainer(TEXT) · 컨테이너 상태 조회 · publishThreadsContainer · getThreadsPostPermalink.
 * 이식하지 않은 것: OAuth URL·코드 교환·장기 토큰·프로필, 이미지/영상/캐러셀, 원본의 일괄 publishThreadsPost
 *   (create→wait→publish→permalink를 한 함수로 자동 실행). 앞으로 워커가 **컨테이너 ID를 DB에 먼저 기록한 뒤** publish를
 *   부르도록 단계를 분리했다. 이 모듈에는 create와 publish를 이어 부르는 helper가 없다.
 * 변경:
 *   - fetch는 의존성 주입(ThreadsHttpDeps). 기본 fetch를 쓰지 않는다 → 실제 Threads 호출 경로는 아직 등록되지 않았다.
 *   - 요청마다 AbortController timeout. 예외 대신 결과 계약(types.ts) — 공급자 메시지·URL·토큰은 결과·로그에 담지 않는다.
 *   - POST(컨테이너 생성·publish)는 원본처럼 access_token을 form body로 보낸다(URL에 넣지 않음).
 *   - GET(상태·permalink)은 원본 규격(access_token 쿼리)을 그대로 유지했다. 헤더 방식은 공식 문서로 확인하지 못해
 *     추측으로 바꾸지 않았다. 대신 URL 조립을 한 함수에 가두고, 그 URL은 반환·오류·로그 어디에도 내보내지 않는다.
 *   - publish 응답 유실·timeout·5xx는 unknown(재시도 금지). permalink 실패는 게시 실패가 아니다(게시 확인 + URL 미확인).
 */
import type {
  ContainerStatusResult,
  CreateContainerResult,
  PermalinkResult,
  PublishContainerResult,
  ThreadsApiError,
  ThreadsContainerResponse,
  ThreadsContainerStatusResponse,
  ThreadsError,
  ThreadsHttpDeps,
  ThreadsPublishOutcome,
  ThreadsPublishResponse,
} from "./types";

const GRAPH_BASE = "https://graph.threads.net";
const API_VERSION = "v1.0";
const DEFAULT_TIMEOUT_MS = 15_000;
/** Threads 텍스트 글자 수 상한(공급자 문서 기준 알려진 값). 이번 작업에서 문서를 재확인하지 못함 — 사전 검사용. */
export const THREADS_TEXT_MAX = 500;

const ID_RE = /^[0-9]{1,32}$/; // Threads 사용자·컨테이너·게시물 ID(숫자 문자열)
const CONTAINER_STATUSES = ["EXPIRED", "ERROR", "FINISHED", "IN_PROGRESS", "PUBLISHED"] as const;

type Raw = { kind: "response"; status: number; body: unknown } | { kind: "timeout" } | { kind: "network" };

function err(code: ThreadsError["code"], httpStatus: number | null = null, providerCode: number | null = null): ThreadsError {
  return { code, httpStatus, providerCode };
}

function validToken(t: unknown): t is string {
  return typeof t === "string" && t.length >= 10 && t.length <= 2048 && !/\s/.test(t);
}

/** 요청 1회. 반환값에 URL·본문·토큰을 남기지 않는다. 재시도하지 않는다. */
async function send(deps: ThreadsHttpDeps, url: string, init: RequestInit): Promise<Raw> {
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

/** 응답 → 정제된 오류(공급자 message는 버리고 숫자 코드만). */
function classify(raw: Raw): ThreadsError {
  if (raw.kind === "timeout") return err("timeout");
  if (raw.kind === "network") return err("network");
  const e = (raw.body as ThreadsApiError | null)?.error;
  const providerCode = typeof e?.code === "number" && Number.isInteger(e.code) ? e.code : null;
  if (raw.status >= 500) return err("http_5xx", raw.status, providerCode);
  if (raw.status === 429 || providerCode === 4 || providerCode === 17 || providerCode === 32 || providerCode === 613) return err("rate_limited", raw.status, providerCode);
  if (raw.status === 401 || providerCode === 190) return err("auth", raw.status, providerCode);
  if (raw.status >= 400 && e && typeof e === "object") return err("rejected", raw.status, providerCode);
  return err("bad_response", raw.status, providerCode);
}

function postForm(fields: Record<string, string>): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() };
}

/** GET URL 조립(원본 규격: access_token 쿼리). 이 문자열은 send에만 전달하고 밖으로 내보내지 않는다. */
function getUrl(objectId: string, fields: string, accessToken: string): string {
  const q = new URLSearchParams({ fields, access_token: accessToken });
  return `${GRAPH_BASE}/${API_VERSION}/${objectId}?${q.toString()}`;
}

/** 텍스트 사전 검사(요청 전). 줄바꿈은 허용, 빈 글·상한 초과·제어문자 거절. */
export function validateThreadsText(text: unknown): text is string {
  if (typeof text !== "string" || text.trim().length === 0) return false;
  if ([...text].length > THREADS_TEXT_MAX) return false;
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text);
}

// 1) 텍스트 컨테이너 생성(원본 createThreadsContainer의 TEXT 분기). 게시 아님.
export async function createTextContainer(
  deps: ThreadsHttpDeps,
  input: { accessToken: string; threadsUserId: string; text: string },
): Promise<CreateContainerResult> {
  if (!validToken(input.accessToken) || !ID_RE.test(input.threadsUserId) || !validateThreadsText(input.text)) {
    return { ok: false, definite: true, error: err("invalid_input") };
  }
  const raw = await send(
    deps,
    `${GRAPH_BASE}/${API_VERSION}/${input.threadsUserId}/threads`,
    postForm({ access_token: input.accessToken, text: input.text, media_type: "TEXT" }),
  );
  if (raw.kind === "response" && raw.status >= 200 && raw.status < 300) {
    const id = (raw.body as ThreadsContainerResponse | null)?.id;
    if (typeof id === "string" && ID_RE.test(id)) return { ok: true, containerId: id };
    return { ok: false, definite: false, error: err("bad_response", raw.status) };
  }
  const e = classify(raw);
  // timeout·network·5xx면 컨테이너가 만들어졌는지 모른다(게시는 아님).
  return { ok: false, definite: e.code === "rejected" || e.code === "auth" || e.code === "rate_limited", error: e };
}

// 2) 컨테이너 상태 조회(원본 waitForContainerReady의 1회분 — 반복·대기는 호출자(워커)가 정한다).
export async function getContainerStatus(
  deps: ThreadsHttpDeps,
  input: { accessToken: string; containerId: string },
): Promise<ContainerStatusResult> {
  if (!validToken(input.accessToken) || !ID_RE.test(input.containerId)) return { ok: false, error: err("invalid_input") };
  const raw = await send(deps, getUrl(input.containerId, "status,error_message", input.accessToken), { method: "GET" });
  if (raw.kind === "response" && raw.status >= 200 && raw.status < 300) {
    const b = raw.body as Partial<ThreadsContainerStatusResponse> | null;
    const status = b?.status;
    if (typeof status === "string" && (CONTAINER_STATUSES as readonly string[]).includes(status)) {
      // error_message 원문은 공급자 텍스트라 결과에 싣지 않는다(존재 여부만).
      return { ok: true, status: status as ThreadsContainerStatusResponse["status"], hasErrorMessage: typeof b?.error_message === "string" };
    }
    return { ok: false, error: err("bad_response", raw.status) };
  }
  return { ok: false, error: classify(raw) };
}

// 3) publish(원본 publishThreadsContainer). 1회만 보낸다. 응답 유실은 unknown.
export async function publishContainer(
  deps: ThreadsHttpDeps,
  input: { accessToken: string; threadsUserId: string; containerId: string },
): Promise<PublishContainerResult> {
  if (!validToken(input.accessToken) || !ID_RE.test(input.threadsUserId) || !ID_RE.test(input.containerId)) {
    return { kind: "rejected", error: err("invalid_input") }; // 요청을 보내지 않았으므로 게시 불가가 확정
  }
  const raw = await send(
    deps,
    `${GRAPH_BASE}/${API_VERSION}/${input.threadsUserId}/threads_publish`,
    postForm({ access_token: input.accessToken, creation_id: input.containerId }),
  );
  if (raw.kind === "response" && raw.status >= 200 && raw.status < 300) {
    const id = (raw.body as ThreadsPublishResponse | null)?.id;
    if (typeof id === "string" && ID_RE.test(id)) return { kind: "published", postId: id };
    return { kind: "unknown", error: err("bad_response", raw.status) }; // 2xx인데 ID 없음 → 게시됐을 수 있음
  }
  const e = classify(raw);
  if (e.code === "rejected" || e.code === "auth" || e.code === "rate_limited") return { kind: "rejected", error: e };
  return { kind: "unknown", error: e }; // timeout·network·5xx·형식 오류
}

// 4) permalink 조회(원본 getThreadsPostPermalink). 실패해도 게시 실패가 아니다.
export async function getPermalink(deps: ThreadsHttpDeps, input: { accessToken: string; postId: string }): Promise<PermalinkResult> {
  if (!validToken(input.accessToken) || !ID_RE.test(input.postId)) return { ok: false, error: err("invalid_input") };
  const raw = await send(deps, getUrl(input.postId, "permalink", input.accessToken), { method: "GET" });
  if (raw.kind === "response" && raw.status >= 200 && raw.status < 300) {
    const p = (raw.body as { permalink?: unknown } | null)?.permalink;
    if (typeof p === "string" && isThreadsPermalink(p)) return { ok: true, permalink: p };
    return { ok: false, error: err("bad_response", raw.status) };
  }
  return { ok: false, error: classify(raw) };
}

export function isThreadsPermalink(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && (u.hostname === "www.threads.net" || u.hostname === "threads.net" || u.hostname === "www.threads.com" || u.hostname === "threads.com");
  } catch {
    return false;
  }
}

/** publish 결과 + (published일 때만 따로 부른) permalink 결과 → 최종 판정. 네트워크 호출 없음. */
export function combinePublishOutcome(publish: PublishContainerResult, permalink: PermalinkResult | null): ThreadsPublishOutcome {
  if (publish.kind !== "published") return publish;
  if (permalink?.ok) return { kind: "published", postId: publish.postId, permalink: permalink.permalink, urlConfirmed: true };
  return { kind: "published", postId: publish.postId, permalink: null, urlConfirmed: false };
}
