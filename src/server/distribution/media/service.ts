/**
 * 미디어 자산 서비스(서버 내부) — AUTOPOST-M4-MEDIA-022. 의존성 주입 순수 함수(시험 대상).
 *
 * 흐름(모두 검증된 세션 actor + D1 → service_role RPC, expected row_version):
 *   createAndProcessFromBytes: create(pending_upload) → 바이트 검사·변환(sharp) → mark_received(processing, 원본 sha256)
 *     → 변형 업로드(Storage, DB 생성 경로) → complete(ready, 변형 sha256·크기) / 실패 시 fail(failed, 코드)
 *   processControlledUpload: 이미 통제된 업로드 경로(uploads/<owner>/<asset>/original)에 올라간 바이트를 Storage에서 읽어 같은 처리.
 *     임의 URL·외부 주소는 받지 않는다(SSRF 없음).
 *   decideRights / archiveAsset / listAssets: 권리 결정 이력, 참조 자산 보관 거부, 경로·서명 없는 metadata.
 *   issuePublishUrl: 권리 approved·ready·유효·허용 채널·변형 소속·고정 sha256·D1을 DB가 재검사한 뒤에만 짧은 TTL 서명 URL.
 *     서명 실패면 URL 없이 signing_failed — 공급자(Meta) 결과와 무관하며 성공을 주장하지 않는다.
 * 원본 바이트는 저장하지 않는다(개인 metadata 보호). 변형 업로드 후 DB 완료가 실패하면 고아 객체가 남을 수 있다(정리 작업 미구현 — 결과에 표시).
 */
import type { ActorResult } from "../actor-core";
import { mapDistributionDbError, unavailableError, type MappedDbError } from "../errors";
import { isUuid } from "../validation";
import type { RpcClient } from "../write-runner";
import { APP_MEDIA_POLICY, MEDIA_BUCKET } from "./policy";
import { processImageBytes, type ProcessFailure } from "./process";
import { isUploadObjectPath, isVariantObjectPath, SignedUrl, type MediaStorage } from "./storage";

export const MEDIA_RPC = Object.freeze({
  create: "distribution_create_media_asset",
  received: "distribution_mark_media_received",
  complete: "distribution_complete_media_processing",
  fail: "distribution_fail_media_processing",
  rights: "distribution_decide_media_rights",
  archive: "distribution_archive_media_asset",
  list: "distribution_list_media_assets",
  authorize: "distribution_authorize_media_signing",
} as const);

export type MediaDeps = {
  resolveActor: () => Promise<ActorResult>;
  getClient: () => RpcClient | null;
  storage: MediaStorage | null;
};

export type MediaVariantDto = { id: string; kind: "feed_jpeg"; byteSize: number; width: number; height: number; sha256: string };
export type MediaAssetDto = {
  id: string;
  status: "pending_upload" | "processing" | "ready" | "failed";
  source: string;
  sourceNote: string | null;
  originalFormat: string | null;
  originalByteSize: number | null;
  originalWidth: number | null;
  originalHeight: number | null;
  failureCode: string | null;
  rightsState: "unreviewed" | "approved" | "rejected" | "revoked";
  allowedChannels: string[] | null;
  rightsValidUntil: string | null;
  archivedAt: string | null;
  rowVersion: number;
  variant: MediaVariantDto | null;
};

/** 공급자 실행기가 자산과 같은 변형을 고정하는 계약(작업·시도에 기록 → 서명 때 sha256 대조). */
export type PinnedMediaRef = { assetId: string; variantId: string; sha256: string; width: number; height: number; byteSize: number };

export type MediaFail =
  | { status: "denied" }
  | { status: "not_ready" }
  | { status: "invalid"; field: string }
  | { status: "db_error"; error: MappedDbError }
  | { status: "bad_response" };

const META_KEYS = new Set([
  "id", "status", "source", "source_note", "original_format", "original_byte_size", "original_width", "original_height", "failure_code",
  "rights_state", "allowed_channels", "rights_valid_until", "archived_at", "row_version", "created_at", "updated_at", "variant", "upload_object_path",
]);
const FORBIDDEN = ["object_path", "signed_url", "url", "token"];

export function toMediaAssetDto(raw: unknown): MediaAssetDto | null {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r || Object.keys(r).some((k) => !META_KEYS.has(k) || FORBIDDEN.includes(k))) return null;
  if (!isUuid(r.id) || typeof r.status !== "string" || typeof r.source !== "string" || typeof r.rights_state !== "string" || !Number.isInteger(r.row_version)) return null;
  let variant: MediaVariantDto | null = null;
  if (r.variant !== null && r.variant !== undefined) {
    const v = r.variant as Record<string, unknown>;
    if (Object.keys(v).some((k) => FORBIDDEN.includes(k))) return null;
    if (!isUuid(v.id) || v.kind !== "feed_jpeg" || typeof v.sha256 !== "string") return null;
    variant = { id: v.id, kind: "feed_jpeg", byteSize: v.byte_size as number, width: v.width as number, height: v.height as number, sha256: v.sha256 };
  }
  const s = (x: unknown) => (typeof x === "string" ? x : null);
  const n = (x: unknown) => (typeof x === "number" ? x : null);
  return {
    id: r.id,
    status: r.status as MediaAssetDto["status"],
    source: r.source,
    sourceNote: s(r.source_note),
    originalFormat: s(r.original_format),
    originalByteSize: n(r.original_byte_size),
    originalWidth: n(r.original_width),
    originalHeight: n(r.original_height),
    failureCode: s(r.failure_code),
    rightsState: r.rights_state as MediaAssetDto["rightsState"],
    allowedChannels: Array.isArray(r.allowed_channels) ? (r.allowed_channels as string[]) : null,
    rightsValidUntil: s(r.rights_valid_until),
    archivedAt: s(r.archived_at),
    rowVersion: r.row_version as number,
    variant,
  };
}

async function call(client: RpcClient, fn: string, params: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: MappedDbError }> {
  try {
    const r = await client.rpc(fn, params);
    return r.error ? { ok: false, error: mapDistributionDbError(r.error) } : { ok: true, data: r.data };
  } catch {
    return { ok: false, error: unavailableError() };
  }
}

async function begin(deps: MediaDeps, needStorage: boolean): Promise<{ ok: true; actorId: string; client: RpcClient; storage: MediaStorage | null } | { ok: false; fail: MediaFail }> {
  const actor = await deps.resolveActor();
  if (!actor.ok) return { ok: false, fail: { status: "denied" } };
  const client = deps.getClient();
  if (!client || (needStorage && !deps.storage)) return { ok: false, fail: { status: "not_ready" } };
  return { ok: true, actorId: actor.actorId, client, storage: deps.storage };
}

const SOURCES = ["own_creation", "licensed", "public_domain", "other"];

// ---------------------------------------------------------------- 업로드 → 처리
export type IngestResult =
  | { status: "ready"; asset: MediaAssetDto }
  | { status: "failed"; asset: MediaAssetDto | null; code: ProcessFailure | "STORAGE_UPLOAD_FAILED" | "STORAGE_READ_FAILED" }
  /** 변형을 올렸지만 DB 완료를 확인 못함 → 고아 객체 가능(정리 미구현), 자산은 processing으로 남을 수 있음 */
  | { status: "uncertain"; assetId: string; stage: "complete" }
  | MediaFail;

/**
 * 바이트 → 검사·변환 → mark_received → 변형 업로드 → complete. 호출자는 actor·D1·자산 소유·expected version을 이미 확인했어야 한다
 * (BE-UPLOAD-025: 직접 업로드 완료가 grant 소비 뒤 재사용 — 서버 내부 전용, 화면에서 부르지 않는다).
 */
export async function ingestAssetBytes(
  ctx: { actorId: string; client: RpcClient; storage: MediaStorage },
  asset: MediaAssetDto,
  bytes: Buffer,
): Promise<IngestResult> {
  return ingest(ctx, asset, bytes);
}

async function ingest(
  ctx: { actorId: string; client: RpcClient; storage: MediaStorage },
  asset: MediaAssetDto,
  bytes: Buffer,
): Promise<IngestResult> {
  const failWith = async (version: number, code: string): Promise<MediaAssetDto | null> => {
    const r = await call(ctx.client, MEDIA_RPC.fail, { p_actor_id: ctx.actorId, p_asset_id: asset.id, p_expected_version: version, p_code: code });
    return r.ok ? toMediaAssetDto(r.data) : null;
  };
  const processed = await processImageBytes(bytes);
  let version = asset.rowVersion;
  if (processed.original) {
    const o = processed.original;
    const rec = await call(ctx.client, MEDIA_RPC.received, {
      p_actor_id: ctx.actorId, p_asset_id: asset.id, p_expected_version: version,
      p_format: o.format, p_byte_size: o.byteSize, p_width: o.width, p_height: o.height, p_sha256: o.sha256,
    });
    if (!rec.ok) return { status: "db_error", error: rec.error };
    const after = toMediaAssetDto(rec.data);
    if (!after) return { status: "bad_response" };
    version = after.rowVersion;
  }
  if (!processed.ok) return { status: "failed", asset: await failWith(version, processed.code), code: processed.code };

  const path = `variants/${asset.id}/feed_jpeg.jpg`; // DB 생성 열과 같은 규칙(완료 시 DB가 같은 값을 만든다)
  if (!isVariantObjectPath(path)) return { status: "invalid", field: "assetId" };
  const up = await ctx.storage.upload(MEDIA_BUCKET, path, processed.variant.bytes, "image/jpeg");
  if (!up.ok) return { status: "failed", asset: await failWith(version, "STORAGE_UPLOAD_FAILED"), code: "STORAGE_UPLOAD_FAILED" };
  const v = processed.variant;
  const done = await call(ctx.client, MEDIA_RPC.complete, {
    p_actor_id: ctx.actorId, p_asset_id: asset.id, p_expected_version: version, p_byte_size: v.byteSize, p_width: v.width, p_height: v.height, p_sha256: v.sha256,
  });
  if (!done.ok) {
    if (done.error.code === "unavailable") return { status: "uncertain", assetId: asset.id, stage: "complete" };
    return { status: "db_error", error: done.error };
  }
  const final = toMediaAssetDto(done.data);
  return final ? { status: "ready", asset: final } : { status: "uncertain", assetId: asset.id, stage: "complete" };
}

export async function createAndProcessFromBytes(deps: MediaDeps, input: { source: unknown; sourceNote?: unknown; bytes: unknown }): Promise<IngestResult> {
  if (typeof input.source !== "string" || !SOURCES.includes(input.source)) return { status: "invalid", field: "source" };
  if (input.sourceNote !== undefined && input.sourceNote !== null && (typeof input.sourceNote !== "string" || [...input.sourceNote].length > 500)) return { status: "invalid", field: "sourceNote" };
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) return { status: "invalid", field: "bytes" };
  if (input.bytes.length > APP_MEDIA_POLICY.maxInputBytes) return { status: "invalid", field: "bytes" };
  const b = await begin(deps, true);
  if (!b.ok) return b.fail;
  const created = await call(b.client, MEDIA_RPC.create, { p_actor_id: b.actorId, p_source: input.source, p_source_note: (input.sourceNote as string | undefined) ?? null });
  if (!created.ok) return created.error.code === "forbidden" ? { status: "denied" } : { status: "db_error", error: created.error };
  const asset = toMediaAssetDto(created.data);
  if (!asset) return { status: "bad_response" };
  return ingest({ actorId: b.actorId, client: b.client, storage: b.storage as MediaStorage }, asset, input.bytes);
}

/** 이미 통제된 업로드 경로에 올라간 객체를 처리(경로는 DB가 만든 값만). */
export async function processControlledUpload(deps: MediaDeps, input: { asset: MediaAssetDto; uploadObjectPath: unknown }): Promise<IngestResult> {
  if (!isUploadObjectPath(input.uploadObjectPath) || !input.uploadObjectPath.includes(`/${input.asset.id}/`)) return { status: "invalid", field: "uploadObjectPath" };
  const b = await begin(deps, true);
  if (!b.ok) return b.fail;
  if (!input.uploadObjectPath.startsWith(`uploads/${b.actorId}/`)) return { status: "invalid", field: "uploadObjectPath" };
  const storage = b.storage as MediaStorage;
  const got = await storage.download(MEDIA_BUCKET, input.uploadObjectPath);
  if (!got.ok) return { status: "failed", asset: null, code: "STORAGE_READ_FAILED" };
  const out = await ingest({ actorId: b.actorId, client: b.client, storage }, input.asset, got.value);
  await storage.remove(MEDIA_BUCKET, [input.uploadObjectPath]); // 원본 보관 안 함(실패해도 결과는 바꾸지 않음 — 고아 정리 한계)
  return out;
}

// ---------------------------------------------------------------- 권리·보관·목록
export async function decideRights(
  deps: Omit<MediaDeps, "storage">,
  input: { assetId: unknown; expectedVersion: unknown; decision: unknown; allowedChannels?: unknown; validUntil?: unknown; note?: unknown },
): Promise<{ status: "ok"; asset: MediaAssetDto } | MediaFail> {
  if (!isUuid(input.assetId)) return { status: "invalid", field: "assetId" };
  if (!Number.isInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) return { status: "invalid", field: "expectedVersion" };
  if (!["approved", "rejected", "revoked"].includes(input.decision as string)) return { status: "invalid", field: "decision" };
  const approved = input.decision === "approved";
  const ch = input.allowedChannels;
  if (approved && (!Array.isArray(ch) || ch.length < 1 || ch.some((c) => !["blog", "threads", "instagram"].includes(c)))) return { status: "invalid", field: "allowedChannels" };
  const vu = input.validUntil;
  if (vu !== undefined && vu !== null && (typeof vu !== "string" || Number.isNaN(Date.parse(vu)))) return { status: "invalid", field: "validUntil" };
  const b = await begin({ ...deps, storage: null }, false);
  if (!b.ok) return b.fail;
  const r = await call(b.client, MEDIA_RPC.rights, {
    p_actor_id: b.actorId, p_asset_id: input.assetId, p_expected_version: input.expectedVersion, p_decision: input.decision,
    p_allowed_channels: approved ? ch : null, p_valid_until: approved && typeof vu === "string" ? new Date(vu).toISOString() : null,
    p_note: typeof input.note === "string" && input.note.trim() ? input.note : null,
  });
  if (!r.ok) return r.error.code === "forbidden" ? { status: "denied" } : { status: "db_error", error: r.error };
  const a = toMediaAssetDto(r.data);
  return a ? { status: "ok", asset: a } : { status: "bad_response" };
}

export async function archiveAsset(deps: Omit<MediaDeps, "storage">, input: { assetId: unknown; expectedVersion: unknown }): Promise<{ status: "ok"; asset: MediaAssetDto } | MediaFail> {
  if (!isUuid(input.assetId)) return { status: "invalid", field: "assetId" };
  if (!Number.isInteger(input.expectedVersion)) return { status: "invalid", field: "expectedVersion" };
  const b = await begin({ ...deps, storage: null }, false);
  if (!b.ok) return b.fail;
  const r = await call(b.client, MEDIA_RPC.archive, { p_actor_id: b.actorId, p_asset_id: input.assetId, p_expected_version: input.expectedVersion });
  if (!r.ok) return r.error.code === "forbidden" ? { status: "denied" } : { status: "db_error", error: r.error };
  const a = toMediaAssetDto(r.data);
  return a ? { status: "ok", asset: a } : { status: "bad_response" };
}

export async function listAssets(deps: Omit<MediaDeps, "storage">): Promise<{ status: "ok"; assets: MediaAssetDto[] } | MediaFail> {
  const b = await begin({ ...deps, storage: null }, false);
  if (!b.ok) return b.fail;
  const r = await call(b.client, MEDIA_RPC.list, { p_actor_id: b.actorId });
  if (!r.ok) return r.error.code === "forbidden" ? { status: "denied" } : { status: "db_error", error: r.error };
  if (!Array.isArray(r.data)) return { status: "bad_response" };
  const out: MediaAssetDto[] = [];
  for (const row of r.data) {
    const raw = row && typeof row === "object" && "distribution_list_media_assets" in (row as object) ? (row as Record<string, unknown>).distribution_list_media_assets : row;
    const a = toMediaAssetDto(raw);
    if (!a) return { status: "bad_response" };
    out.push(a);
  }
  return { status: "ok", assets: out };
}

// ---------------------------------------------------------------- 게시용 서명 URL
export type PublishUrlResult =
  | { status: "ok"; ref: PinnedMediaRef; channel: string; expiresAt: string; url: SignedUrl }
  /** DB 승인은 됐지만 Storage 서명 실패 — URL 없음. 공급자 결과와 무관(성공 주장 금지). */
  | { status: "signing_failed"; ref: PinnedMediaRef; expiresAt: string }
  | MediaFail;

export async function issuePublishUrl(
  deps: MediaDeps,
  input: { pinned: PinnedMediaRef; channel: unknown; ttlSeconds?: number },
): Promise<PublishUrlResult> {
  const p = input.pinned;
  if (!isUuid(p?.assetId) || !isUuid(p?.variantId) || typeof p.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.sha256)) return { status: "invalid", field: "pinned" };
  if (!["blog", "threads", "instagram"].includes(input.channel as string)) return { status: "invalid", field: "channel" };
  const ttl = input.ttlSeconds ?? APP_MEDIA_POLICY.signedUrlTtlSeconds;
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > APP_MEDIA_POLICY.signedUrlMaxTtlSeconds) return { status: "invalid", field: "ttlSeconds" };
  const b = await begin(deps, true);
  if (!b.ok) return b.fail;
  const r = await call(b.client, MEDIA_RPC.authorize, {
    p_actor_id: b.actorId, p_asset_id: p.assetId, p_variant_id: p.variantId, p_expected_sha256: p.sha256, p_channel: input.channel, p_ttl_seconds: ttl,
  });
  if (!r.ok) return r.error.code === "forbidden" ? { status: "denied" } : { status: "db_error", error: r.error };
  const d = r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : null;
  if (!d || d.asset_id !== p.assetId || d.variant_id !== p.variantId || d.sha256 !== p.sha256 || !isVariantObjectPath(d.object_path) || typeof d.expires_at !== "string") {
    return { status: "bad_response" };
  }
  const ref: PinnedMediaRef = { assetId: p.assetId, variantId: p.variantId, sha256: p.sha256, width: d.width as number, height: d.height as number, byteSize: d.byte_size as number };
  const signed = await (b.storage as MediaStorage).createSignedUrl(MEDIA_BUCKET, d.object_path, ttl);
  if (!signed.ok) return { status: "signing_failed", ref, expiresAt: d.expires_at };
  return { status: "ok", ref, channel: input.channel as string, expiresAt: d.expires_at, url: new SignedUrl(signed.value) };
}
