/**
 * BE-MEDIA-024 — 미디어 런타임: Supabase Storage 어댑터(SDK mock) · 세션 배선(모듈 mock) · M4 오류 사유 · 서비스 왕복.
 * 실제 Storage·DB·env·네트워크 없음. env는 가짜 값만 stub한다. 서명 URL 값은 단언 출력하지 않는다.
 */
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapDistributionDbError, MEDIA_ERROR_REASONS, mediaErrorReason } from "@/server/distribution/errors";
import { MEDIA_BUCKET } from "@/server/distribution/media/policy";
import { createAndProcessFromBytes, decideRights, issuePublishUrl, listAssets, processControlledUpload } from "@/server/distribution/media/service";
import {
  createSupabaseMediaStorage,
  sanitizeStorageError,
  VARIANT_MAX_BYTES,
  type StorageBucketApi,
  type StorageClientLike,
} from "@/server/distribution/media/storage-supabase";
import { writeNoticeOf } from "@/server/distribution/write-notice";
import type { RpcClient } from "@/server/distribution/write-runner";

const ORIGIN = "https://proj-fake.supabase.co";
const OWNER = "11111111-2222-4333-8444-555555555555";
const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VARIANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VPATH = `variants/${ASSET}/feed_jpeg.jpg`;
const UPATH = `uploads/${OWNER}/${ASSET}/original`;
const SECRET_TOKEN = randomBytes(12).toString("hex");

type Calls = { from: string[]; upload: unknown[][]; download: string[]; remove: string[][]; sign: unknown[][] };
function mockSdk(over: Partial<Record<keyof StorageBucketApi, (...a: never[]) => unknown>> = {}) {
  const calls: Calls = { from: [], upload: [], download: [], remove: [], sign: [] };
  const api: StorageBucketApi = {
    upload: async (path, body, options) => {
      calls.upload.push([path, body.length, options]);
      return (over.upload as ((...a: unknown[]) => never) | undefined)?.(path, body, options) ?? { data: { path }, error: null };
    },
    download: async (path) => {
      calls.download.push(path);
      return (over.download as ((...a: unknown[]) => never) | undefined)?.(path) ?? { data: new Blob([Buffer.from("abc")]), error: null };
    },
    remove: async (paths) => {
      calls.remove.push(paths);
      return (over.remove as ((...a: unknown[]) => never) | undefined)?.(paths) ?? { data: paths.map((name) => ({ name })), error: null };
    },
    createSignedUrl: async (path, ttl) => {
      calls.sign.push([path, ttl]);
      return (over.createSignedUrl as ((...a: unknown[]) => never) | undefined)?.(path, ttl)
        ?? { data: { signedUrl: `${ORIGIN}/storage/v1/object/sign/${MEDIA_BUCKET}/${path}?token=${SECRET_TOKEN}` }, error: null };
    },
  };
  const client: StorageClientLike = { from: (b) => (calls.from.push(b), api) };
  return { client, calls };
}
const apiErr = (status: number | undefined, code?: string, statusCode?: string) =>
  Object.assign(new Error(`secret detail ${SECRET_TOKEN} ${UPATH}`), { status, code, statusCode });

describe("Storage 오류 정제", () => {
  it("상태·서비스 코드만으로 판정, 메시지는 보지 않음", () => {
    expect(sanitizeStorageError(apiErr(404, "NoSuchKey"))).toBe("not_found");
    expect(sanitizeStorageError(apiErr(400, undefined, "404"))).toBe("not_found");
    expect(sanitizeStorageError(apiErr(409, "ResourceAlreadyExists"))).toBe("already_exists");
    expect(sanitizeStorageError(apiErr(400, "Duplicate", "409"))).toBe("already_exists");
    expect(sanitizeStorageError(apiErr(403, "AccessDenied"))).toBe("storage_error");
    expect(sanitizeStorageError(apiErr(400, "InvalidMimeType"))).toBe("storage_error");
    expect(sanitizeStorageError(apiErr(503))).toBe("storage_unavailable");
    expect(sanitizeStorageError(apiErr(undefined))).toBe("storage_unavailable"); // StorageUnknownError(네트워크)
    expect(sanitizeStorageError(null)).toBe("storage_unavailable");
  });
});

describe("Supabase Storage 어댑터(SDK mock)", () => {
  it("origin은 https만", () => {
    const { client } = mockSdk();
    expect(() => createSupabaseMediaStorage(client, { origin: "http://x.supabase.co" })).toThrow();
    expect(() => createSupabaseMediaStorage(client, { origin: "not a url" })).toThrow();
  });

  it("upload: 변형 경로·image/jpeg·upsert:false(덮어쓰기 금지)만, 그 외 SDK 호출 0회", async () => {
    const { client, calls } = mockSdk();
    const s = createSupabaseMediaStorage(client, { origin: ORIGIN });
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 1, 2]);
    expect(await s.upload(MEDIA_BUCKET, VPATH, jpg, "image/jpeg")).toEqual({ ok: true, value: true });
    expect(calls.from).toEqual([MEDIA_BUCKET]);
    expect(calls.upload[0]).toEqual([VPATH, jpg.length, expect.objectContaining({ contentType: "image/jpeg", upsert: false })]);
    for (const [bucket, path, body] of [
      ["public-bucket", VPATH, jpg],
      [MEDIA_BUCKET, UPATH, jpg], // 원본 경로에는 서버가 쓰지 않음
      [MEDIA_BUCKET, `variants/${ASSET}/../x.jpg`, jpg],
      [MEDIA_BUCKET, "https://evil.example/x.jpg", jpg],
      [MEDIA_BUCKET, VPATH, Buffer.alloc(0)],
      [MEDIA_BUCKET, VPATH, Buffer.alloc(VARIANT_MAX_BYTES + 1)],
    ] as const) {
      expect(await s.upload(bucket, path, body as Buffer, "image/jpeg")).toEqual({ ok: false, code: "storage_error" });
    }
    expect(await s.upload(MEDIA_BUCKET, VPATH, jpg, "image/png" as "image/jpeg")).toEqual({ ok: false, code: "storage_error" });
    expect(calls.upload).toHaveLength(1);
  });

  it("upload: 이미 있음 → already_exists, 5xx·예외 → storage_unavailable(결과 불명), 재시도 0", async () => {
    const exists = mockSdk({ upload: () => ({ data: null, error: apiErr(400, "Duplicate", "409") }) as never });
    expect(await createSupabaseMediaStorage(exists.client, { origin: ORIGIN }).upload(MEDIA_BUCKET, VPATH, Buffer.from([1]), "image/jpeg"))
      .toEqual({ ok: false, code: "already_exists" });
    const down = mockSdk({ upload: () => ({ data: null, error: apiErr(502) }) as never });
    expect(await createSupabaseMediaStorage(down.client, { origin: ORIGIN }).upload(MEDIA_BUCKET, VPATH, Buffer.from([1]), "image/jpeg"))
      .toEqual({ ok: false, code: "storage_unavailable" });
    const thrown = mockSdk({ upload: () => { throw new TypeError(`fetch failed ${SECRET_TOKEN}`); } });
    const r = await createSupabaseMediaStorage(thrown.client, { origin: ORIGIN }).upload(MEDIA_BUCKET, VPATH, Buffer.from([1]), "image/jpeg");
    expect(r).toEqual({ ok: false, code: "storage_unavailable" });
    expect([exists.calls.upload.length, down.calls.upload.length, thrown.calls.upload.length]).toEqual([1, 1, 1]);
    expect(JSON.stringify(r)).not.toContain(SECRET_TOKEN);
  });

  it("download: 통제된 업로드 경로만, 크기 상한, 없음 → not_found", async () => {
    const { client, calls } = mockSdk();
    const s = createSupabaseMediaStorage(client, { origin: ORIGIN, maxDownloadBytes: 10 });
    const ok = await s.download(MEDIA_BUCKET, UPATH);
    expect(ok.ok && ok.value.toString()).toBe("abc");
    expect(await s.download(MEDIA_BUCKET, VPATH)).toEqual({ ok: false, code: "storage_error" });
    expect(await s.download(MEDIA_BUCKET, `uploads/${OWNER}/${ASSET}/original?x=1`)).toEqual({ ok: false, code: "storage_error" });
    expect(calls.download).toEqual([UPATH]);
    const big = mockSdk({ download: () => ({ data: new Blob([Buffer.alloc(11)]), error: null }) as never });
    expect(await createSupabaseMediaStorage(big.client, { origin: ORIGIN, maxDownloadBytes: 10 }).download(MEDIA_BUCKET, UPATH))
      .toEqual({ ok: false, code: "storage_error" });
    const missing = mockSdk({ download: () => ({ data: null, error: apiErr(400, "NoSuchKey", "404") }) as never });
    expect(await createSupabaseMediaStorage(missing.client, { origin: ORIGIN }).download(MEDIA_BUCKET, UPATH))
      .toEqual({ ok: false, code: "not_found" });
  });

  it("remove: 업로드 원본 경로만(변형 삭제 불가), 지운 것 없음 → not_found", async () => {
    const { client, calls } = mockSdk();
    const s = createSupabaseMediaStorage(client, { origin: ORIGIN });
    expect(await s.remove(MEDIA_BUCKET, [UPATH])).toEqual({ ok: true, value: true });
    expect(await s.remove(MEDIA_BUCKET, [VPATH])).toEqual({ ok: false, code: "storage_error" });
    expect(await s.remove(MEDIA_BUCKET, [])).toEqual({ ok: false, code: "storage_error" });
    expect(await s.remove(MEDIA_BUCKET, Array.from({ length: 11 }, () => UPATH))).toEqual({ ok: false, code: "storage_error" });
    expect(calls.remove).toEqual([[UPATH]]);
    const none = mockSdk({ remove: () => ({ data: [], error: null }) as never });
    expect(await createSupabaseMediaStorage(none.client, { origin: ORIGIN }).remove(MEDIA_BUCKET, [UPATH])).toEqual({ ok: false, code: "not_found" });
  });

  it("createSignedUrl: 변형 경로·TTL 60~900만, 설정 origin의 https URL만 신뢰", async () => {
    const { client, calls } = mockSdk();
    const s = createSupabaseMediaStorage(client, { origin: ORIGIN });
    const ok = await s.createSignedUrl(MEDIA_BUCKET, VPATH, 600);
    expect(ok.ok && new URL(ok.value).origin).toBe(ORIGIN);
    expect(await s.createSignedUrl(MEDIA_BUCKET, UPATH, 600)).toEqual({ ok: false, code: "storage_error" });
    expect(await s.createSignedUrl(MEDIA_BUCKET, VPATH, 59)).toEqual({ ok: false, code: "storage_error" });
    expect(await s.createSignedUrl(MEDIA_BUCKET, VPATH, 901)).toEqual({ ok: false, code: "storage_error" });
    expect(calls.sign).toEqual([[VPATH, 600]]);
    for (const bad of ["https://evil.example/sign?x=1", `http://proj-fake.supabase.co/sign`, "javascript:alert(1)", 42]) {
      const m = mockSdk({ createSignedUrl: () => ({ data: { signedUrl: bad }, error: null }) as never });
      expect(await createSupabaseMediaStorage(m.client, { origin: ORIGIN }).createSignedUrl(MEDIA_BUCKET, VPATH, 600))
        .toEqual({ ok: false, code: "storage_error" });
    }
  });
});

describe("M4 오류 사유(허용 목록)", () => {
  const db = (message: string, code = "23514") => mapDistributionDbError({ code, message: `${message} ${SECRET_TOKEN}` });
  it("M4 token은 code=invalid_input 유지 + 세부 사유, write-notice는 확정 거절(invalid)로 남음", () => {
    const pairs: Array<[string, string]> = [
      ["MEDIA_PENDING_LIMIT: x", "pending_limit"], ["ASSET_REFERENCED: x", "asset_referenced"], ["MEDIA_NOT_READY: x", "media_not_ready"],
      ["VARIANT_MISMATCH: x", "variant_mismatch"], ["RIGHTS_NOT_APPROVED: x", "rights_not_approved"], ["RIGHTS_EXPIRED: x", "rights_expired"],
      ["CHANNEL_NOT_ALLOWED: x", "channel_not_allowed"],
      ["MEDIA_NOT_OWNED: x", "media_not_owned"], ["MEDIA_DUPLICATE: x", "media_duplicate"], // BE-REVISION-MEDIA-037(150000)
    ];
    for (const [msg, reason] of pairs) {
      const e = db(msg);
      expect(e.code).toBe("invalid_input");
      expect(mediaErrorReason(e)).toBe(reason);
      expect(writeNoticeOf({ status: "db_error", error: e })).toBe("invalid");
      expect(JSON.stringify(e)).not.toContain(SECRET_TOKEN);
    }
    expect([...MEDIA_ERROR_REASONS].sort()).toEqual(pairs.map(([, r]) => r).sort());
  });
  it("허용 목록 밖·다른 SQLSTATE·응답 유실은 사유 없음(null)", () => {
    expect(mediaErrorReason(db("SOMETHING_ELSE: x"))).toBeNull();
    expect(mediaErrorReason(db("MEDIA_NOT_READY: x", "P0001"))).toBeNull();
    expect(mediaErrorReason(db("VERSION_CONFLICT: x", "P0001"))).toBeNull();
    expect(mediaErrorReason(db("toString: x"))).toBeNull();
    expect(mediaErrorReason({ code: "unavailable", token: null, sqlstate: null })).toBeNull();
    expect(mediaErrorReason(null)).toBeNull();
    expect(db("VERSION_CONFLICT: x", "P0001").code).toBe("conflict_version"); // 기존 매핑 불변
    expect(db("ARCHIVED: x").code).toBe("archived");
  });
});

describe("서비스 ↔ 어댑터 왕복(mock RPC·SDK)", () => {
  const meta = (over: Record<string, unknown> = {}) => ({
    id: ASSET, status: "pending_upload", source: "own_creation", source_note: null, original_format: null, original_byte_size: null,
    original_width: null, original_height: null, failure_code: null, rights_state: "unreviewed", allowed_channels: null,
    rights_valid_until: null, archived_at: null, row_version: 1, created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z", variant: null, ...over,
  });
  const allowed = async () => ({ ok: true as const, actorId: OWNER });
  function rpcMock(map: Record<string, (p: Record<string, unknown>) => { data: unknown; error: unknown }>) {
    const calls: string[] = [];
    const client: RpcClient = { rpc: async (fn, p) => (calls.push(fn), map[fn]?.(p) ?? { data: null, error: { code: "XX000", message: "unexpected" } }) };
    return { client, calls };
  }
  const v = { id: VARIANT, kind: "feed_jpeg", byte_size: 100, width: 800, height: 800, sha256: "c".repeat(64) };

  it("업로드: 변형은 DB 규칙 경로로 upsert:false 업로드, 이미 있으면 failed(STORAGE_UPLOAD_FAILED)·complete 호출 0", async () => {
    const bytes = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#123456" } }).png().toBuffer();
    const rpc = rpcMock({
      distribution_create_media_asset: () => ({ data: meta(), error: null }),
      distribution_mark_media_received: () => ({ data: meta({ status: "processing", original_format: "png", original_byte_size: 1, original_width: 800, original_height: 800, row_version: 2 }), error: null }),
      distribution_complete_media_processing: () => ({ data: meta({ status: "ready", original_format: "png", original_byte_size: 1, row_version: 3, variant: v }), error: null }),
      distribution_fail_media_processing: () => ({ data: meta({ status: "failed", failure_code: "STORAGE_UPLOAD_FAILED", row_version: 3 }), error: null }),
    });
    const ok = mockSdk();
    const r1 = await createAndProcessFromBytes({ resolveActor: allowed, getClient: () => rpc.client, storage: createSupabaseMediaStorage(ok.client, { origin: ORIGIN }) },
      { source: "own_creation", bytes });
    expect(r1.status).toBe("ready");
    expect(ok.calls.upload[0]?.[0]).toBe(VPATH);
    expect(ok.calls.upload[0]?.[2]).toMatchObject({ upsert: false });

    const rpc2 = rpcMock({
      distribution_create_media_asset: () => ({ data: meta(), error: null }),
      distribution_mark_media_received: () => ({ data: meta({ status: "processing", original_format: "png", original_byte_size: 1, row_version: 2 }), error: null }),
      distribution_fail_media_processing: (p) => ({ data: meta({ status: "failed", original_format: "png", original_byte_size: 1, failure_code: String(p.p_code), row_version: 3 }), error: null }),
    });
    const exists = mockSdk({ upload: () => ({ data: null, error: apiErr(400, "Duplicate", "409") }) as never });
    const r2 = await createAndProcessFromBytes({ resolveActor: allowed, getClient: () => rpc2.client, storage: createSupabaseMediaStorage(exists.client, { origin: ORIGIN }) },
      { source: "own_creation", bytes });
    expect(r2).toMatchObject({ status: "failed", code: "STORAGE_UPLOAD_FAILED" });
    expect(rpc2.calls).not.toContain("distribution_complete_media_processing");
  });

  it("통제 업로드: 원본 읽기 실패 → STORAGE_READ_FAILED(처리 RPC 0), 처리 후 원본 삭제 실패해도 결과 불변", async () => {
    const asset = { id: ASSET, status: "pending_upload", source: "own_creation", sourceNote: null, originalFormat: null, originalByteSize: null, originalWidth: null,
      originalHeight: null, failureCode: null, rightsState: "unreviewed", allowedChannels: null, rightsValidUntil: null, archivedAt: null, rowVersion: 1, variant: null } as const;
    const rpc = rpcMock({});
    const lost = mockSdk({ download: () => ({ data: null, error: apiErr(undefined) }) as never });
    expect(await processControlledUpload({ resolveActor: allowed, getClient: () => rpc.client, storage: createSupabaseMediaStorage(lost.client, { origin: ORIGIN }) },
      { asset: { ...asset }, uploadObjectPath: UPATH })).toEqual({ status: "failed", asset: null, code: "STORAGE_READ_FAILED" });
    expect(rpc.calls).toEqual([]);
    expect(lost.calls.remove).toEqual([]); // 읽지 못한 원본은 지우지 않음(유실 아님 — 재처리 판단은 운영)

    const bytes = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#654321" } }).jpeg().toBuffer();
    const rpc2 = rpcMock({
      distribution_mark_media_received: () => ({ data: meta({ status: "processing", original_format: "jpeg", original_byte_size: 1, row_version: 2 }), error: null }),
      distribution_complete_media_processing: () => ({ data: meta({ status: "ready", original_format: "jpeg", original_byte_size: 1, row_version: 3, variant: v }), error: null }),
    });
    const rmFail = mockSdk({ download: () => ({ data: new Blob([bytes]), error: null }) as never, remove: () => ({ data: null, error: apiErr(503) }) as never });
    const r = await processControlledUpload({ resolveActor: allowed, getClient: () => rpc2.client, storage: createSupabaseMediaStorage(rmFail.client, { origin: ORIGIN }) },
      { asset: { ...asset }, uploadObjectPath: UPATH });
    expect(r.status).toBe("ready");
    expect(rmFail.calls.remove).toEqual([[UPATH]]);
  });

  it("목록·권리는 Storage 없이 동작(metadata 의존성만), 서명은 Storage 없으면 not_ready", async () => {
    const rpc = rpcMock({
      distribution_list_media_assets: () => ({ data: [meta({ status: "ready", original_format: "jpeg", original_byte_size: 1, row_version: 3, variant: v })], error: null }),
      distribution_decide_media_rights: () => ({ data: meta({ status: "ready", original_format: "jpeg", original_byte_size: 1, rights_state: "approved", allowed_channels: ["threads"], row_version: 4, variant: v }), error: null }),
    });
    const metaDeps = { resolveActor: allowed, getClient: () => rpc.client };
    expect((await listAssets(metaDeps)).status).toBe("ok");
    expect((await decideRights(metaDeps, { assetId: ASSET, expectedVersion: 3, decision: "approved", allowedChannels: ["threads"] })).status).toBe("ok");
    const pin = { assetId: ASSET, variantId: VARIANT, sha256: "c".repeat(64), width: 800, height: 800, byteSize: 100 };
    expect(await issuePublishUrl({ ...metaDeps, storage: null }, { pinned: pin, channel: "threads" })).toEqual({ status: "not_ready" });
  });
});

// ---------------------------------------------------------------- session.ts(server-only) — 모듈 mock
const adminMock = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseServiceClient: () => adminMock.client }));
vi.mock("@/server/distribution/actor", () => ({ requireDistributionActor: async () => ({ ok: true, actorId: OWNER }) }));

describe("session.ts 배선", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ORIGIN);
    vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"x".repeat(24)}`); // 가짜 형식 값(실제 키 아님)
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    adminMock.client = null;
  });

  it("service client 없음 → metadata·upload 모두 false, deps.getClient() null, storage null", async () => {
    const s = await import("@/server/distribution/media/session");
    expect(s.mediaReadiness()).toEqual({ metadata: false, upload: false, directUpload: false, preview: false, storageVerified: false, missing: ["service_client", "storage_adapter", "intake_bucket"] });
    expect(s.getMediaMetadataDeps().getClient()).toBeNull();
    expect(s.getMediaDeps().storage).toBeNull();
  });

  it("client 있음 → metadata·upload true(검증 아님: storageVerified false), RPC·Storage가 같은 client로 연결", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const { client: storageClient, calls } = mockSdk();
    adminMock.client = { rpc, storage: storageClient };
    const s = await import("@/server/distribution/media/session");
    const ready = s.mediaReadiness();
    expect(ready).toEqual({ metadata: true, upload: true, directUpload: true, preview: false, storageVerified: false, missing: [] });
    expect(JSON.stringify(ready)).not.toMatch(/sb_secret|supabase\.co/);
    const deps = s.getMediaDeps();
    expect((await deps.resolveActor()).ok).toBe(true);
    await deps.getClient()?.rpc("distribution_list_media_assets", { p_actor_id: OWNER });
    expect(rpc).toHaveBeenCalledWith("distribution_list_media_assets", { p_actor_id: OWNER });
    expect(await deps.storage?.createSignedUrl(MEDIA_BUCKET, VPATH, 600)).toMatchObject({ ok: true });
    expect(calls.from).toEqual([MEDIA_BUCKET]);
    expect("storage" in s.getMediaMetadataDeps()).toBe(false);
  });

  it("origin 설정이 형식 오류면 Storage만 빠짐(metadata는 유지)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://insecure.example");
    adminMock.client = { rpc: vi.fn(), storage: mockSdk().client };
    const s = await import("@/server/distribution/media/session");
    expect(s.mediaReadiness()).toMatchObject({ metadata: true, upload: false, directUpload: false, missing: ["storage_adapter", "intake_bucket"] });
  });
});
