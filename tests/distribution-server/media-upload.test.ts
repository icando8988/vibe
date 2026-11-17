/**
 * BE-UPLOAD-025 — 직접 업로드 흐름(mock RPC·mock intake/Storage) · intake 어댑터(SDK mock) · 라우트 HTTP 조립.
 * 실제 Storage·DB·네트워크 없음. 서명 URL 값은 단언 출력하지 않는다.
 */
import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { MEDIA_BUCKET, MEDIA_INTAKE_BUCKET, UPLOAD_POLICY } from "@/server/distribution/media/policy";
import { SignedUrl, type MediaIntakeStorage, type MediaStorage, type StorageResult } from "@/server/distribution/media/storage";
import { createSupabaseIntakeStorage, type IntakeBucketApi } from "@/server/distribution/media/storage-supabase";
import { cancelUpload, completeUpload, issueUploadGrant, nonceHash, UPLOAD_RPC, type UploadDeps } from "@/server/distribution/media/upload";
import { completeResponse, issueResponse, readJsonBody, UPLOAD_BODY_MAX_BYTES } from "@/server/distribution/media/upload-http";
import type { RpcClient } from "@/server/distribution/write-runner";

const ORIGIN = "https://proj-fake.supabase.co";
const OWNER = "11111111-2222-4333-8444-555555555555";
const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GRANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VARIANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UPATH = `uploads/${OWNER}/${ASSET}/original`;
const NONCE = "N".repeat(43);
const TOKEN = randomBytes(12).toString("hex");
const SIGNED = `${ORIGIN}/storage/v1/object/upload/sign/${MEDIA_INTAKE_BUCKET}/${UPATH}?token=${TOKEN}`;
const allowed = async () => ({ ok: true as const, actorId: OWNER });

const meta = (over: Record<string, unknown> = {}) => ({
  id: ASSET, status: "pending_upload", source: "own_creation", source_note: null, original_format: null, original_byte_size: null,
  original_width: null, original_height: null, failure_code: null, rights_state: "unreviewed", allowed_channels: null,
  rights_valid_until: null, archived_at: null, row_version: 1, created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z", variant: null, ...over,
});
const grantJson = (over: Record<string, unknown> = {}, assetOver: Record<string, unknown> = {}) => ({
  grant_id: GRANT, status: "issued", expires_at: "2026-11-17T00:15:00Z", declared_content_type: "image/png", declared_byte_size: 0,
  object_path: UPATH, asset: meta(assetOver), ...over,
});
const variant = { id: VARIANT, kind: "feed_jpeg", byte_size: 100, width: 800, height: 800, sha256: "c".repeat(64) };
const dbErr = (message: string, code = "23514") => ({ data: null, error: { code, message } });

type RpcMap = Record<string, (p: Record<string, unknown>) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>>;
function rpcMock(map: RpcMap) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const client: RpcClient = {
    rpc: async (fn, p) => {
      calls.push([fn, p]);
      const h = map[fn];
      if (!h) return { data: null, error: { code: "XX000", message: "unexpected" } };
      return h(p);
    },
  };
  return { client, calls, names: () => calls.map(([n]) => n) };
}
function intakeMock(over: Partial<{ sign: () => StorageResult<SignedUrl>; download: () => StorageResult<Buffer>; remove: () => StorageResult<true> }> = {}) {
  const calls = { sign: [] as string[][], download: [] as string[][], remove: [] as Array<[string, string[]]> };
  const intake: MediaIntakeStorage = {
    createSignedUploadUrl: async (b, p) => (calls.sign.push([b, p]), over.sign?.() ?? { ok: true, value: new SignedUrl(SIGNED) }),
    download: async (b, p) => (calls.download.push([b, p]), over.download?.() ?? { ok: false, code: "not_found" }),
    remove: async (b, ps) => (calls.remove.push([b, ps]), over.remove?.() ?? { ok: true, value: true }),
  };
  return { intake, calls };
}
const storageMock = () => {
  const uploads: string[] = [];
  const storage: MediaStorage = {
    upload: async (_b, p) => (uploads.push(p), { ok: true, value: true }),
    download: async () => ({ ok: false, code: "not_found" }),
    remove: async () => ({ ok: true, value: true }),
    createSignedUrl: async () => ({ ok: false, code: "storage_error" }),
  };
  return { storage, uploads };
};
const deps = (client: RpcClient, intake: MediaIntakeStorage, storage: MediaStorage = storageMock().storage): UploadDeps =>
  ({ resolveActor: allowed, getClient: () => client, storage, intake, newNonce: () => NONCE });
const png = (w = 800, h = 800) => sharp({ create: { width: w, height: h, channels: 3, background: "#225588" } }).png().toBuffer();

describe("발급(issueUploadGrant)", () => {
  const input = { source: "own_creation", contentType: "image/png", byteSize: 1234 };

  it("DB에 nonce 해시만 넘기고 기록 뒤 intake 경로에 서명 업로드 URL 발급, URL은 SignedUrl로 가려짐", async () => {
    const rpc = rpcMock({ [UPLOAD_RPC.issue]: () => ({ data: grantJson({ declared_byte_size: 1234 }), error: null }) });
    const { intake, calls } = intakeMock();
    const r = await issueUploadGrant(deps(rpc.client, intake), input);
    expect(r.status).toBe("issued");
    if (r.status !== "issued") return;
    const p = rpc.calls[0]?.[1] ?? {};
    expect([p.p_nonce_hash, p.p_content_type, p.p_byte_size, p.p_ttl_seconds]).toEqual([nonceHash(NONCE), "image/png", 1234, UPLOAD_POLICY.grantTtlSeconds]);
    expect(JSON.stringify(rpc.calls)).not.toContain(NONCE);
    expect(rpc.names()).toEqual([UPLOAD_RPC.issue]); // 기록이 서명보다 먼저
    expect(calls.sign).toEqual([[MEDIA_INTAKE_BUCKET, UPATH]]);
    expect(r.grant).toMatchObject({ grantId: GRANT, assetId: ASSET, rowVersion: 1, nonce: NONCE, grantExpiresAt: "2026-11-17T00:15:00Z" });
    expect(r.grant.upload).toMatchObject({ method: "PUT", headers: { "content-type": "image/png", "x-upsert": "false" }, storageTokenDocumentedTtlSeconds: 7200 });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(inspect(r, { depth: 9 })).not.toContain(TOKEN);
  });

  it("입력·준비·D1 실패는 RPC 0회", async () => {
    const rpc = rpcMock({});
    const { intake } = intakeMock();
    for (const [bad, field] of [
      [{ ...input, source: "stolen" }, "source"], [{ ...input, contentType: "image/gif" }, "contentType"], [{ ...input, contentType: "image/svg+xml" }, "contentType"],
      [{ ...input, byteSize: 0 }, "byteSize"], [{ ...input, byteSize: UPLOAD_POLICY.maxBytes + 1 }, "byteSize"], [{ ...input, byteSize: "1" }, "byteSize"],
      [{ ...input, sourceNote: "x".repeat(501) }, "sourceNote"], [{ ...input, sourceNote: "a\u0000b" }, "sourceNote"],
    ] as const) {
      expect(await issueUploadGrant(deps(rpc.client, intake), bad as typeof input)).toEqual({ status: "invalid", field });
    }
    expect(await issueUploadGrant({ ...deps(rpc.client, intake), intake: null }, input)).toEqual({ status: "not_ready" });
    expect(await issueUploadGrant({ ...deps(rpc.client, intake), storage: null }, input)).toEqual({ status: "not_ready" });
    expect(await issueUploadGrant({ ...deps(rpc.client, intake), resolveActor: async () => ({ ok: false, reason: "unauthenticated" }) as never }, input)).toEqual({ status: "denied" });
    expect(rpc.calls).toEqual([]);
  });

  it("한도·응답 유실·형식 오류 응답 → 서명 0회", async () => {
    const { intake, calls } = intakeMock();
    const cases: Array<[RpcMap[string], unknown]> = [
      [() => dbErr("UPLOAD_GRANT_LIMIT: x"), { status: "limit", reason: "grant_limit" }],
      [() => dbErr("MEDIA_PENDING_LIMIT: x"), { status: "limit", reason: "pending_limit" }],
      [() => dbErr("denied", "42501"), { status: "denied" }],
      [() => { throw new Error("socket"); }, { status: "uncertain" }],
      [() => ({ data: grantJson({ object_path: "uploads/../x" }), error: null }), { status: "uncertain" }],
    ];
    for (const [h, expected] of cases) expect(await issueUploadGrant(deps(rpcMock({ [UPLOAD_RPC.issue]: h }).client, intake), input)).toEqual(expected);
    expect(calls.sign).toEqual([]);
  });

  it("서명 실패 → grant 취소 1회 시도 → signing_failed(URL 없음), 재발급 없음", async () => {
    const rpc = rpcMock({ [UPLOAD_RPC.issue]: () => ({ data: grantJson(), error: null }), [UPLOAD_RPC.cancel]: () => ({ data: grantJson({ status: "cancelled" }), error: null }) });
    const { intake } = intakeMock({ sign: () => ({ ok: false, code: "storage_unavailable" }) });
    expect(await issueUploadGrant(deps(rpc.client, intake), input)).toEqual({ status: "signing_failed" });
    expect(rpc.names()).toEqual([UPLOAD_RPC.issue, UPLOAD_RPC.cancel]);
    expect(rpc.calls[1]?.[1]).toMatchObject({ p_grant_id: GRANT, p_nonce_hash: nonceHash(NONCE) });
  });
});

describe("완료(completeUpload)", () => {
  const key = { grantId: GRANT, nonce: NONCE, expectedVersion: 1 };

  it("객체 없음 → not_uploaded: 조회만, 소비·실패·삭제 0회(grant·nonce·rowVersion 그대로) → 뒤늦게 올라오면 같은 grant로 ready", async () => {
    const bytes = await png();
    let uploaded: Buffer | null = null;
    const rpc = rpcMock({
      [UPLOAD_RPC.get]: () => ({ data: grantJson({ declared_byte_size: bytes.length }), error: null }),
      [UPLOAD_RPC.consume]: () => ({ data: grantJson({ status: "consumed", declared_byte_size: bytes.length }), error: null }),
      distribution_mark_media_received: () => ({ data: meta({ status: "processing", original_format: "png", original_byte_size: bytes.length, row_version: 2 }), error: null }),
      distribution_complete_media_processing: () => ({ data: meta({ status: "ready", original_format: "png", original_byte_size: bytes.length, row_version: 3, variant }), error: null }),
    });
    const { intake, calls } = intakeMock({ download: () => (uploaded ? { ok: true, value: uploaded } : { ok: false, code: "not_found" }) });
    const s = storageMock();
    expect(await completeUpload(deps(rpc.client, intake, s.storage), key)).toEqual({ status: "not_uploaded" });
    expect(rpc.names()).toEqual([UPLOAD_RPC.get]);
    expect(calls.remove).toEqual([]);
    uploaded = bytes; // PUT이 뒤늦게 끝남
    const r = await completeUpload(deps(rpc.client, intake, s.storage), key);
    expect(r.status).toBe("ready");
    expect(rpc.names()).toEqual([UPLOAD_RPC.get, UPLOAD_RPC.get, UPLOAD_RPC.consume, "distribution_mark_media_received", "distribution_complete_media_processing"]);
    expect(s.uploads).toEqual([`variants/${ASSET}/feed_jpeg.jpg`]);
    expect(calls.download.every(([b, p]) => b === MEDIA_INTAKE_BUCKET && p === UPATH)).toBe(true);
    expect(calls.remove).toEqual([[MEDIA_INTAKE_BUCKET, [UPATH]]]); // 원본 삭제
  });

  it("grant 상태: 사용됨·만료·취소·무효·버전 충돌 — 다운로드·소비 0회", async () => {
    const { intake, calls } = intakeMock();
    for (const [msg, code, expected] of [
      ["UPLOAD_GRANT_USED: x", "23514", "grant_used"], ["UPLOAD_GRANT_EXPIRED: x", "23514", "grant_expired"],
      ["UPLOAD_GRANT_CANCELLED: x", "23514", "grant_cancelled"], ["UPLOAD_GRANT_INVALID: x", "P0002", "grant_invalid"],
      ["INVALID_TRANSITION: media asset is failed", "23514", "grant_used"],
    ] as const) {
      expect(await completeUpload(deps(rpcMock({ [UPLOAD_RPC.get]: () => dbErr(msg, code) }).client, intake), key)).toEqual({ status: expected });
    }
    expect(await completeUpload(deps(rpcMock({ [UPLOAD_RPC.get]: () => ({ data: grantJson({}, { row_version: 2 }), error: null }) }).client, intake), key))
      .toEqual({ status: "conflict_version" });
    expect(await completeUpload(deps(rpcMock({ [UPLOAD_RPC.get]: () => { throw new Error("lost"); } }).client, intake), key)).toEqual({ status: "unavailable" });
    expect(calls.download).toEqual([]);
  });

  it("중복·동시 완료: 소비 RPC가 UPLOAD_GRANT_USED → grant_used, 처리 0회", async () => {
    const bytes = await png();
    const rpc = rpcMock({
      [UPLOAD_RPC.get]: () => ({ data: grantJson({ declared_byte_size: bytes.length }), error: null }),
      [UPLOAD_RPC.consume]: () => dbErr("UPLOAD_GRANT_USED: x"),
    });
    const { intake, calls } = intakeMock({ download: () => ({ ok: true, value: bytes }) });
    expect(await completeUpload(deps(rpc.client, intake), key)).toEqual({ status: "grant_used" });
    expect(rpc.names()).not.toContain("distribution_mark_media_received");
    expect(calls.remove).toEqual([]);
  });

  it("소비 응답 유실 → uncertain(자동 재시도·처리 0), intake 읽기 오류 → storage_error(소비 0)", async () => {
    const bytes = await png();
    const lost = rpcMock({ [UPLOAD_RPC.get]: () => ({ data: grantJson({ declared_byte_size: bytes.length }), error: null }), [UPLOAD_RPC.consume]: () => { throw new Error("lost"); } });
    expect(await completeUpload(deps(lost.client, intakeMock({ download: () => ({ ok: true, value: bytes }) }).intake), key)).toEqual({ status: "uncertain" });
    expect(lost.names()).toEqual([UPLOAD_RPC.get, UPLOAD_RPC.consume]);
    const se = rpcMock({ [UPLOAD_RPC.get]: () => ({ data: grantJson(), error: null }) });
    expect(await completeUpload(deps(se.client, intakeMock({ download: () => ({ ok: false, code: "storage_unavailable" }) }).intake), key)).toEqual({ status: "storage_error" });
    expect(se.names()).toEqual([UPLOAD_RPC.get]);
  });

  it("신고 형식·크기 불일치 → 소비 후 failed(DECLARED_MISMATCH), 원본 삭제, 변형 0", async () => {
    const bytes = await png();
    for (const g of [grantJson({ declared_byte_size: bytes.length, declared_content_type: "image/jpeg" }), grantJson({ declared_byte_size: bytes.length + 1 })]) {
      const rpc = rpcMock({
        [UPLOAD_RPC.get]: () => ({ data: g, error: null }), [UPLOAD_RPC.consume]: () => ({ data: { ...g, status: "consumed" }, error: null }),
        [UPLOAD_RPC.fail]: (p) => ({ data: meta({ status: "failed", failure_code: p.p_code, row_version: 2 }), error: null }),
      });
      const { intake, calls } = intakeMock({ download: () => ({ ok: true, value: bytes }) });
      const s = storageMock();
      const r = await completeUpload(deps(rpc.client, intake, s.storage), key);
      expect(r).toMatchObject({ status: "failed", code: "DECLARED_MISMATCH" });
      expect(rpc.calls.find(([n]) => n === UPLOAD_RPC.fail)?.[1]).toMatchObject({ p_code: "DECLARED_MISMATCH", p_expected_version: 1 });
      expect(s.uploads).toEqual([]);
      expect(calls.remove).toEqual([[MEDIA_INTAKE_BUCKET, [UPATH]]]);
    }
  });

  it("M4 검사 실패(너무 작음) → failed + 원본 삭제, 변형 저장 후 완료 유실 → uncertain(원본 보존)", async () => {
    const small = await png(200, 200);
    const rpc = rpcMock({
      [UPLOAD_RPC.get]: () => ({ data: grantJson({ declared_byte_size: small.length }), error: null }),
      [UPLOAD_RPC.consume]: () => ({ data: grantJson({ status: "consumed", declared_byte_size: small.length }), error: null }),
      distribution_mark_media_received: () => ({ data: meta({ status: "processing", original_format: "png", original_byte_size: small.length, row_version: 2 }), error: null }),
      distribution_fail_media_processing: () => ({ data: meta({ status: "failed", original_format: "png", original_byte_size: small.length, failure_code: "TOO_SMALL", row_version: 3 }), error: null }),
    });
    const a = intakeMock({ download: () => ({ ok: true, value: small }) });
    expect(await completeUpload(deps(rpc.client, a.intake), key)).toMatchObject({ status: "failed", code: "TOO_SMALL" });
    expect(a.calls.remove).toHaveLength(1);

    const bytes = await png();
    const rpc2 = rpcMock({
      [UPLOAD_RPC.get]: () => ({ data: grantJson({ declared_byte_size: bytes.length }), error: null }),
      [UPLOAD_RPC.consume]: () => ({ data: grantJson({ status: "consumed", declared_byte_size: bytes.length }), error: null }),
      distribution_mark_media_received: () => ({ data: meta({ status: "processing", original_format: "png", original_byte_size: bytes.length, row_version: 2 }), error: null }),
      distribution_complete_media_processing: () => { throw new Error("lost"); },
    });
    const b = intakeMock({ download: () => ({ ok: true, value: bytes }) });
    expect(await completeUpload(deps(rpc2.client, b.intake), key)).toEqual({ status: "uncertain" });
    expect(b.calls.remove).toEqual([]);
  });

  it("입력 검증: grantId·nonce·expectedVersion 형식 — RPC 0회", async () => {
    const rpc = rpcMock({});
    const { intake } = intakeMock();
    expect(await completeUpload(deps(rpc.client, intake), { ...key, grantId: "x" })).toEqual({ status: "invalid", field: "grantId" });
    expect(await completeUpload(deps(rpc.client, intake), { ...key, nonce: "short" })).toEqual({ status: "invalid", field: "nonce" });
    expect(await completeUpload(deps(rpc.client, intake), { ...key, nonce: `${"a".repeat(42)}/` })).toEqual({ status: "invalid", field: "nonce" });
    expect(await completeUpload(deps(rpc.client, intake), { ...key, expectedVersion: 0 })).toEqual({ status: "invalid", field: "expectedVersion" });
    expect(rpc.calls).toEqual([]);
  });
});

describe("취소(cancelUpload)", () => {
  it("취소 → 원본 삭제 시도(없어도 cancelled), 상태 오류는 그대로", async () => {
    const rpc = rpcMock({ [UPLOAD_RPC.cancel]: () => ({ data: grantJson({ status: "cancelled" }, { status: "failed", failure_code: "UPLOAD_CANCELLED", row_version: 2 }), error: null }) });
    const { intake, calls } = intakeMock({ remove: () => ({ ok: false, code: "not_found" }) });
    const r = await cancelUpload(deps(rpc.client, intake), { grantId: GRANT, nonce: NONCE });
    expect(r).toMatchObject({ status: "cancelled", asset: { status: "failed", failureCode: "UPLOAD_CANCELLED" } });
    expect(calls.remove).toEqual([[MEDIA_INTAKE_BUCKET, [UPATH]]]);
    expect(await cancelUpload(deps(rpcMock({ [UPLOAD_RPC.cancel]: () => dbErr("UPLOAD_GRANT_USED: x") }).client, intake), { grantId: GRANT, nonce: NONCE })).toEqual({ status: "grant_used" });
  });
});

describe("intake 어댑터(SDK mock)", () => {
  function sdk(signedUrl: unknown = SIGNED) {
    const calls: unknown[][] = [];
    const api: IntakeBucketApi = {
      createSignedUploadUrl: async (...a) => (calls.push(["sign", ...a]), { data: { signedUrl: signedUrl as string, token: TOKEN, path: UPATH }, error: null }),
      download: async (p) => (calls.push(["download", p]), { data: new Blob([Buffer.from("x")]), error: null }),
      remove: async (ps) => (calls.push(["remove", ps]), { data: ps.map((name) => ({ name })), error: null }),
    };
    const from = vi.fn(() => api);
    return { client: { from }, calls, from };
  }
  it("intake bucket·업로드 경로만, upsert 옵션 없이 서명, URL은 origin·경로·token 일치만 신뢰", async () => {
    const m = sdk();
    const s = createSupabaseIntakeStorage(m.client, { origin: ORIGIN });
    const ok = await s.createSignedUploadUrl(MEDIA_INTAKE_BUCKET, UPATH);
    expect(ok.ok && ok.value instanceof SignedUrl).toBe(true);
    expect(m.calls[0]).toEqual(["sign", UPATH]); // 옵션 인자 없음(upsert 기본 false)
    expect(m.from).toHaveBeenCalledWith(MEDIA_INTAKE_BUCKET);
    expect(await s.createSignedUploadUrl(MEDIA_BUCKET, UPATH)).toEqual({ ok: false, code: "storage_error" });
    expect(await s.createSignedUploadUrl(MEDIA_INTAKE_BUCKET, `variants/${ASSET}/feed_jpeg.jpg`)).toEqual({ ok: false, code: "storage_error" });
    expect(await s.createSignedUploadUrl(MEDIA_INTAKE_BUCKET, "uploads/x/y/original")).toEqual({ ok: false, code: "storage_error" });
    expect(m.calls).toHaveLength(1);
    for (const bad of [
      `https://evil.example/storage/v1/object/upload/sign/${MEDIA_INTAKE_BUCKET}/${UPATH}?token=t`,
      `${ORIGIN}/storage/v1/object/upload/sign/${MEDIA_BUCKET}/${UPATH}?token=t`,
      `${ORIGIN}/storage/v1/object/upload/sign/${MEDIA_INTAKE_BUCKET}/${UPATH}`,
      `http://proj-fake.supabase.co/storage/v1/object/upload/sign/${MEDIA_INTAKE_BUCKET}/${UPATH}?token=t`,
    ]) {
      expect(await createSupabaseIntakeStorage(sdk(bad).client, { origin: ORIGIN }).createSignedUploadUrl(MEDIA_INTAKE_BUCKET, UPATH)).toEqual({ ok: false, code: "storage_error" });
    }
  });
  it("download 20MB 상한·remove 원본 경로만", async () => {
    const m = sdk();
    const s = createSupabaseIntakeStorage(m.client, { origin: ORIGIN });
    expect((await s.download(MEDIA_INTAKE_BUCKET, UPATH)).ok).toBe(true);
    expect(await s.download(MEDIA_BUCKET, UPATH)).toEqual({ ok: false, code: "storage_error" });
    expect(await s.remove(MEDIA_INTAKE_BUCKET, [`variants/${ASSET}/feed_jpeg.jpg`])).toEqual({ ok: false, code: "storage_error" });
    expect(await s.remove(MEDIA_INTAKE_BUCKET, [UPATH])).toEqual({ ok: true, value: true });
    const big = { from: () => ({ ...sdk().client.from(), download: async () => ({ data: { size: UPLOAD_POLICY.maxBytes + 1, arrayBuffer: async () => new ArrayBuffer(0) }, error: null }) }) };
    expect(await createSupabaseIntakeStorage(big as never, { origin: ORIGIN }).download(MEDIA_INTAKE_BUCKET, UPATH)).toEqual({ ok: false, code: "storage_error" });
  });
});

describe("라우트 HTTP 조립", () => {
  const req = (body: string, h: Record<string, string> = {}) =>
    new Request("https://site.example/api/distribution/media/upload/grant", {
      method: "POST", body, headers: { "content-type": "application/json", origin: "https://site.example", ...h },
    });
  it("JSON·같은 origin·4KB 이하만", async () => {
    expect(await readJsonBody(req('{"a":1}'))).toEqual({ ok: true, body: { a: 1 } });
    expect((await readJsonBody(req('{"a":1}', { origin: "https://evil.example" }))).ok).toBe(false);
    expect((await readJsonBody(req('{"a":1}', { origin: "" }))).ok).toBe(false);
    expect((await readJsonBody(req("a=1", { "content-type": "application/x-www-form-urlencoded" }))).ok).toBe(false);
    expect((await readJsonBody(req("[1]"))).ok).toBe(false);
    expect((await readJsonBody(req(JSON.stringify({ a: "x".repeat(UPLOAD_BODY_MAX_BYTES) })))).ok).toBe(false);
  });
  it("URL은 issued 응답에만, 모든 응답 no-store, 상태별 HTTP 코드", async () => {
    const issued = issueResponse({
      status: "issued",
      grant: { grantId: GRANT, assetId: ASSET, rowVersion: 1, nonce: NONCE, grantExpiresAt: "t",
        upload: { url: new SignedUrl(SIGNED), method: "PUT", headers: { "content-type": "image/png", "x-upsert": "false" }, storageTokenDocumentedTtlSeconds: 7200 } },
    });
    expect(issued.status).toBe(200);
    expect(issued.headers.get("cache-control")).toBe("no-store");
    expect(((await issued.json()) as { grant: { upload: { url: string } } }).grant.upload.url).toBe(SIGNED);
    const nu = completeResponse({ status: "not_uploaded" });
    expect([nu.status, nu.headers.get("cache-control"), await nu.text()]).toEqual([409, "no-store", '{"status":"not_uploaded"}']);
    expect(completeResponse({ status: "uncertain" }).status).toBe(503);
    expect(completeResponse({ status: "grant_invalid" }).status).toBe(404);
    expect(issueResponse({ status: "signing_failed" }).status).toBe(502);
  });
});
