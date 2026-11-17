/**
 * 미디어 직접 업로드(private intake) 흐름 — BE-UPLOAD-025. 의존성 주입 순수 함수(시험 대상). 계약: docs/contracts/MEDIA_UPLOAD_CONTRACT.md
 *
 *   issueUploadGrant  : actor·D1 → 입력 → 준비 → nonce(서버 생성) → DB에 자산+grant 원자 기록 → intake 서명 업로드 URL(upsert 없음)
 *                       서명 실패면 grant 취소 시도 → signing_failed(URL 없음). DB 응답 유실 → uncertain(재요청 없음).
 *   completeUpload    : grant 조회(actor·nonce·만료·상태, 변경 없음) → intake 원본 다운로드(≤20MB)
 *                       → 없으면 not_uploaded(grant·nonce·rowVersion 그대로 — 같은 grant로 사용자가 다시 완료 확인 가능)
 *                       → grant 1회 소비(원자, 중복·동시 완료는 grant_used) → 신고 형식·크기 대조 → M4 검사·sharp → 변형 저장 → ready/failed → 원본 삭제
 *   cancelUpload      : grant cancelled + 자산 failed(UPLOAD_CANCELLED) → intake 원본 삭제 시도(없어도 됨)
 * 어떤 단계도 자동 재요청하지 않는다. 서명 URL은 issued 결과의 SignedUrl로만 다루고 로그·DTO에 넣지 않는다.
 * 앱 grant 기한(grantExpiresAt)은 Storage 토큰 수명(공식 문서 2시간·철회 불가)을 줄이지 않는다.
 */
import { createHash, randomBytes } from "node:crypto";
import type { ActorResult } from "../actor-core";
import { mapDistributionDbError, unavailableError, type MappedDbError } from "../errors";
import { isUuid } from "../validation";
import type { RpcClient } from "../write-runner";
import { MEDIA_INTAKE_BUCKET, UPLOAD_POLICY, type UploadContentType } from "./policy";
import { sniffFormat } from "./process";
import { ingestAssetBytes, toMediaAssetDto, type MediaAssetDto } from "./service";
import { isUploadObjectPath, type MediaIntakeStorage, type MediaStorage, type SignedUrl } from "./storage";

export const UPLOAD_RPC = Object.freeze({
  issue: "distribution_issue_media_upload_grant",
  get: "distribution_get_media_upload_grant",
  consume: "distribution_consume_media_upload_grant",
  cancel: "distribution_cancel_media_upload_grant",
  fail: "distribution_fail_media_processing",
} as const);

export type UploadDeps = {
  resolveActor: () => Promise<ActorResult>;
  getClient: () => RpcClient | null;
  storage: MediaStorage | null;
  intake: MediaIntakeStorage | null;
  /** 시험 주입용. 기본 crypto 256bit base64url. */
  newNonce?: () => string;
};

const SOURCES = ["own_creation", "licensed", "public_domain", "other"];
const NONCE_RE = /^[A-Za-z0-9_-]{43}$/;
const FORMAT_TYPE: Record<string, UploadContentType> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const nonceHash = (nonce: string) => createHash("sha256").update(nonce, "utf8").digest("hex");

type Common = { status: "denied" } | { status: "not_ready" } | { status: "invalid"; field: string } | { status: "error" };
type GrantState = { status: "grant_invalid" } | { status: "grant_used" } | { status: "grant_expired" } | { status: "grant_cancelled" };

async function call(client: RpcClient, fn: string, params: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: MappedDbError }> {
  try {
    const r = await client.rpc(fn, params);
    return r.error ? { ok: false, error: mapDistributionDbError(r.error) } : { ok: true, data: r.data };
  } catch {
    return { ok: false, error: unavailableError() };
  }
}

function grantStateOf(e: MappedDbError): GrantState | null {
  switch (e.token) {
    case "UPLOAD_GRANT_INVALID":
      return { status: "grant_invalid" };
    case "UPLOAD_GRANT_USED":
    case "INVALID_TRANSITION": // 자산이 이미 pending_upload가 아님(처리됨·만료 정리됨)
      return { status: "grant_used" };
    case "UPLOAD_GRANT_EXPIRED":
      return { status: "grant_expired" };
    case "UPLOAD_GRANT_CANCELLED":
      return { status: "grant_cancelled" };
    default:
      return null;
  }
}

type GrantRow = { grantId: string; asset: MediaAssetDto; objectPath: string; declaredContentType: UploadContentType; declaredByteSize: number; expiresAt: string };
function parseGrant(raw: unknown): GrantRow | null {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r || !isUuid(r.grant_id) || typeof r.expires_at !== "string") return null;
  const asset = toMediaAssetDto(r.asset);
  if (!asset || !isUploadObjectPath(r.object_path) || !r.object_path.endsWith(`/${asset.id}/original`)) return null;
  if (!(UPLOAD_POLICY.contentTypes as readonly string[]).includes(r.declared_content_type as string)) return null;
  if (!Number.isInteger(r.declared_byte_size)) return null;
  return {
    grantId: r.grant_id, asset, objectPath: r.object_path, declaredContentType: r.declared_content_type as UploadContentType,
    declaredByteSize: r.declared_byte_size as number, expiresAt: r.expires_at,
  };
}

async function begin(deps: UploadDeps): Promise<{ ok: true; actorId: string; client: RpcClient; storage: MediaStorage; intake: MediaIntakeStorage } | { ok: false; fail: Common }> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return { ok: false, fail: { status: "denied" } };
  const client = deps.getClient();
  if (!client || !deps.storage || !deps.intake) return { ok: false, fail: { status: "not_ready" } };
  return { ok: true, actorId: actor.actorId, client, storage: deps.storage, intake: deps.intake };
}

// ---------------------------------------------------------------- 발급
export type IssuedGrant = {
  grantId: string;
  assetId: string;
  rowVersion: number;
  nonce: string;
  /** 앱 grant 기한: 완료·취소 요청을 받는 기한(Storage 토큰 수명 아님). */
  grantExpiresAt: string;
  upload: {
    url: SignedUrl;
    method: "PUT";
    headers: { "content-type": UploadContentType; "x-upsert": "false" };
    /** Supabase 공식 문서상 서명 업로드 토큰 수명(2시간·개별 철회 불가). 앱이 줄이지 못하는 참고값, 실측 아님. */
    storageTokenDocumentedTtlSeconds: number;
  };
};
export type IssueResult =
  | { status: "issued"; grant: IssuedGrant }
  | { status: "limit"; reason: "pending_limit" | "grant_limit" }
  | { status: "signing_failed" }
  | { status: "uncertain" }
  | Common;

export async function issueUploadGrant(
  deps: UploadDeps,
  input: { source: unknown; sourceNote?: unknown; contentType: unknown; byteSize: unknown },
): Promise<IssueResult> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return { status: "denied" };
  if (typeof input.source !== "string" || !SOURCES.includes(input.source)) return { status: "invalid", field: "source" };
  const note = input.sourceNote;
  if (note !== undefined && note !== null && (typeof note !== "string" || [...note].length > 500 || /[\u0000-\u001f\u007f]/.test(note))) {
    return { status: "invalid", field: "sourceNote" };
  }
  if (!(UPLOAD_POLICY.contentTypes as readonly string[]).includes(input.contentType as string)) return { status: "invalid", field: "contentType" };
  if (!Number.isInteger(input.byteSize) || (input.byteSize as number) < 1 || (input.byteSize as number) > UPLOAD_POLICY.maxBytes) {
    return { status: "invalid", field: "byteSize" };
  }
  const b = await begin(deps);
  if (!b.ok) return b.fail;
  const nonce = (deps.newNonce ?? (() => randomBytes(32).toString("base64url")))();
  if (!NONCE_RE.test(nonce)) return { status: "error" };

  const issued = await call(b.client, UPLOAD_RPC.issue, {
    p_actor_id: b.actorId, p_source: input.source, p_source_note: typeof note === "string" && note.trim() ? note : null,
    p_content_type: input.contentType, p_byte_size: input.byteSize, p_nonce_hash: nonceHash(nonce), p_ttl_seconds: UPLOAD_POLICY.grantTtlSeconds,
  });
  if (!issued.ok) {
    const e = issued.error;
    if (e.code === "forbidden") return { status: "denied" };
    if (e.code === "unavailable") return { status: "uncertain" };
    if (e.token === "UPLOAD_GRANT_LIMIT") return { status: "limit", reason: "grant_limit" };
    if (e.token === "MEDIA_PENDING_LIMIT") return { status: "limit", reason: "pending_limit" };
    if (e.sqlstate === "22023") return { status: "invalid", field: "input" };
    return { status: "error" };
  }
  const g = parseGrant(issued.data);
  if (!g) return { status: "uncertain" }; // 기록됐을 수 있으나 응답을 믿을 수 없음

  const signed = await b.intake.createSignedUploadUrl(MEDIA_INTAKE_BUCKET, g.objectPath);
  if (!signed.ok) {
    // URL 없이 끝낸다. 취소 실패해도 grant는 앱 기한 뒤 만료 정리 대상(자동 재발급 없음).
    await call(b.client, UPLOAD_RPC.cancel, { p_actor_id: b.actorId, p_grant_id: g.grantId, p_nonce_hash: nonceHash(nonce) });
    return { status: "signing_failed" };
  }
  return {
    status: "issued",
    grant: {
      grantId: g.grantId, assetId: g.asset.id, rowVersion: g.asset.rowVersion, nonce, grantExpiresAt: g.expiresAt,
      upload: {
        url: signed.value, method: "PUT", headers: { "content-type": g.declaredContentType, "x-upsert": "false" },
        storageTokenDocumentedTtlSeconds: UPLOAD_POLICY.storageTokenDocumentedTtlSeconds,
      },
    },
  };
}

// ---------------------------------------------------------------- 완료
export type CompleteFailureCode =
  | "EMPTY_INPUT" | "INPUT_TOO_LARGE" | "UNSUPPORTED_FORMAT" | "FORMAT_MISMATCH" | "DECODE_FAILED" | "PIXEL_LIMIT" | "ANIMATED_IMAGE"
  | "TOO_SMALL" | "ASPECT_OUT_OF_RANGE" | "OUTPUT_TOO_LARGE" | "PROCESSING_TIMEOUT" | "DECLARED_MISMATCH" | "STORAGE_UPLOAD_FAILED";
export type CompleteResult =
  | { status: "ready"; asset: MediaAssetDto }
  | { status: "failed"; code: CompleteFailureCode; asset: MediaAssetDto | null }
  /** intake에 객체 없음. grant·nonce·rowVersion 그대로 — 같은 grant로 사용자가 완료 확인을 다시 보낼 수 있다(재발급·재업로드 아님). */
  | { status: "not_uploaded" }
  | { status: "conflict_version" }
  /** grant 소비 뒤 결과 불명 — 자동 재시도 금지, 목록 확인 */
  | { status: "uncertain" }
  /** intake 읽기 실패(grant 미소비) */
  | { status: "storage_error" }
  /** DB 응답 유실(grant 미소비 — 조회 단계) */
  | { status: "unavailable" }
  | GrantState
  | Common;

export async function completeUpload(deps: UploadDeps, input: { grantId: unknown; nonce: unknown; expectedVersion: unknown }): Promise<CompleteResult> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return { status: "denied" };
  if (!isUuid(input.grantId)) return { status: "invalid", field: "grantId" };
  if (typeof input.nonce !== "string" || !NONCE_RE.test(input.nonce)) return { status: "invalid", field: "nonce" };
  if (!Number.isInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) return { status: "invalid", field: "expectedVersion" };
  const b = await begin(deps);
  if (!b.ok) return b.fail;
  const key = { p_actor_id: b.actorId, p_grant_id: input.grantId, p_nonce_hash: nonceHash(input.nonce) };

  // 1) 조회(변경 없음)
  const got = await call(b.client, UPLOAD_RPC.get, key);
  if (!got.ok) {
    if (got.error.code === "forbidden") return { status: "denied" };
    if (got.error.code === "unavailable") return { status: "unavailable" };
    return grantStateOf(got.error) ?? { status: "error" };
  }
  const g = parseGrant(got.data);
  if (!g) return { status: "error" };
  if (g.asset.rowVersion !== input.expectedVersion) return { status: "conflict_version" };

  // 2) 원본 읽기(grant 미소비)
  const dl = await b.intake.download(MEDIA_INTAKE_BUCKET, g.objectPath);
  if (!dl.ok) return dl.code === "not_found" ? { status: "not_uploaded" } : { status: "storage_error" };
  const bytes = dl.value;

  // 3) 1회 소비(원자)
  const consumed = await call(b.client, UPLOAD_RPC.consume, { ...key, p_expected_version: input.expectedVersion });
  if (!consumed.ok) {
    const e = consumed.error;
    if (e.code === "forbidden") return { status: "denied" };
    if (e.code === "unavailable") return { status: "uncertain" }; // 소비됐을 수 있음
    if (e.token === "VERSION_CONFLICT") return { status: "conflict_version" };
    return grantStateOf(e) ?? { status: "error" };
  }
  const c = parseGrant(consumed.data);
  if (!c || c.asset.id !== g.asset.id) return { status: "uncertain" };
  const removeOriginal = () => b.intake.remove(MEDIA_INTAKE_BUCKET, [c.objectPath]);

  // 4) 신고값 대조(형식은 바이트 magic, 크기는 정확히 일치)
  const sniffed = sniffFormat(bytes);
  if ((sniffed && FORMAT_TYPE[sniffed] !== c.declaredContentType) || bytes.length !== c.declaredByteSize) {
    const f = await call(b.client, UPLOAD_RPC.fail, { p_actor_id: b.actorId, p_asset_id: c.asset.id, p_expected_version: c.asset.rowVersion, p_code: "DECLARED_MISMATCH" });
    await removeOriginal();
    return { status: "failed", code: "DECLARED_MISMATCH", asset: f.ok ? toMediaAssetDto(f.data) : null };
  }

  // 5) M4 검사·변환·변형 저장
  const out = await ingestAssetBytes({ actorId: b.actorId, client: b.client, storage: b.storage }, c.asset, bytes);
  switch (out.status) {
    case "ready":
      await removeOriginal();
      return { status: "ready", asset: out.asset };
    case "failed":
      if (out.code === "STORAGE_READ_FAILED") return { status: "uncertain" }; // 이 흐름에선 나오지 않음
      await removeOriginal();
      return { status: "failed", code: out.code, asset: out.asset };
    case "uncertain":
    case "bad_response":
      return { status: "uncertain" }; // 원본 보존(sweep 대상)
    case "db_error":
      return out.error.code === "unavailable" ? { status: "uncertain" } : { status: "error" };
    default:
      return { status: "error" };
  }
}

// ---------------------------------------------------------------- 취소
export type CancelResult = { status: "cancelled"; asset: MediaAssetDto | null } | { status: "unavailable" } | GrantState | Common;

export async function cancelUpload(deps: UploadDeps, input: { grantId: unknown; nonce: unknown }): Promise<CancelResult> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return { status: "denied" };
  if (!isUuid(input.grantId)) return { status: "invalid", field: "grantId" };
  if (typeof input.nonce !== "string" || !NONCE_RE.test(input.nonce)) return { status: "invalid", field: "nonce" };
  const b = await begin(deps);
  if (!b.ok) return b.fail;
  const r = await call(b.client, UPLOAD_RPC.cancel, { p_actor_id: b.actorId, p_grant_id: input.grantId, p_nonce_hash: nonceHash(input.nonce) });
  if (!r.ok) {
    if (r.error.code === "forbidden") return { status: "denied" };
    if (r.error.code === "unavailable") return { status: "unavailable" };
    return grantStateOf(r.error) ?? { status: "error" };
  }
  const g = parseGrant(r.data);
  if (g) await b.intake.remove(MEDIA_INTAKE_BUCKET, [g.objectPath]); // 없어도 됨. 발급된 토큰은 무효화되지 않는다.
  return { status: "cancelled", asset: g?.asset ?? null };
}
