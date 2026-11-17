/**
 * AUTOPOST-M4-MEDIA-022 — 이미지 처리(sharp 실제 합성 fixture)·서비스(mock RPC·mock Storage) 단위 검증.
 * 외부 URL·네트워크·실제 Storage 없음. 서명 URL은 단언 값으로 출력하지 않는다.
 */
import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { APP_MEDIA_POLICY, PLATFORM_LIMITS } from "@/server/distribution/media/policy";
import { processImageBytes, sha256Hex, sniffFormat } from "@/server/distribution/media/process";
import { createAndProcessFromBytes, issuePublishUrl, processControlledUpload, type MediaAssetDto } from "@/server/distribution/media/service";
import { SignedUrl, type MediaStorage } from "@/server/distribution/media/storage";
import type { RpcClient } from "@/server/distribution/write-runner";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VARIANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SIGNED = `https://storage.example.com/sign/x?token=${randomBytes(16).toString("hex")}`;
const allowed = async (): Promise<ActorResult> => ({ ok: true, actorId: ADMIN });

const png = (w: number, h: number, alpha = false) =>
  sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 255, g: 0, b: 0, alpha: 0.3 } : "#336699" } }).png().toBuffer();
const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#228844" } }).jpeg().toBuffer();

describe("바이트 검사(magic)", () => {
  it("JPEG·PNG·WEBP만, 확장자·이름이 아니라 바이트로", async () => {
    expect(sniffFormat(await jpeg(10, 10))).toBe("jpeg");
    expect(sniffFormat(await png(10, 10))).toBe("png");
    expect(sniffFormat(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).webp().toBuffer())).toBe("webp");
    expect(sniffFormat(Buffer.from("GIF89a....."))).toBeNull();
    expect(sniffFormat(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
  });
});

describe("sharp 변환(실제 합성 fixture)", () => {
  it("투명 PNG → 흰 배경 sRGB JPEG, metadata 없음, 크기·sha256 기록", async () => {
    const input = await png(800, 800, true);
    const r = await processImageBytes(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.original).toMatchObject({ format: "png", width: 800, height: 800, byteSize: input.length, sha256: sha256Hex(input) });
    const m = await sharp(r.variant.bytes).metadata();
    expect([m.format, m.width, m.height, m.space, m.hasAlpha, !!m.exif, !!m.icc, !!m.xmp]).toEqual(["jpeg", 800, 800, "srgb", false, false, false, false]);
    expect(r.variant.sha256).toBe(sha256Hex(r.variant.bytes));
    expect(r.variant.byteSize).toBe(r.variant.bytes.length);
  });
  it("EXIF 방향 6 적용(가로·세로 교체) + EXIF 제거(개인 metadata 포함)", async () => {
    const input = await sharp({ create: { width: 900, height: 800, channels: 3, background: "#0f0" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Artist: "개인 이름", Copyright: "private" } })
      .toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);
    const r = await processImageBytes(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = await sharp(r.variant.bytes).metadata();
    expect([m.width, m.height, m.orientation ?? 1, !!m.exif]).toEqual([800, 900, 1, false]);
    expect(r.variant.bytes.includes(Buffer.from("private"))).toBe(false);
  });
  it("큰 이미지는 폭 1440으로 축소(앱 정책), 플랫폼 상한과 구분", async () => {
    const r = await processImageBytes(await jpeg(3000, 2000));
    expect(r.ok && [r.variant.width, r.variant.height]).toEqual([1440, 960]);
    expect(APP_MEDIA_POLICY.maxOutputBytes).toBeLessThan(PLATFORM_LIMITS.instagram.maxBytes);
    expect(APP_MEDIA_POLICY.outputMaxWidth).toBe(PLATFORM_LIMITS.instagram.maxWidth);
  });
  it("거부: 빈 입력·과대·미지원·손상·형식 불일치·애니메이션·픽셀 상한·너무 작음·비율", async () => {
    expect(await processImageBytes(Buffer.alloc(0))).toMatchObject({ ok: false, code: "EMPTY_INPUT" });
    expect(await processImageBytes(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(APP_MEDIA_POLICY.maxInputBytes)]))).toMatchObject({ ok: false, code: "INPUT_TOO_LARGE" });
    expect(await processImageBytes(Buffer.from("not an image at all"))).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
    const good = await jpeg(800, 800);
    expect(await processImageBytes(Buffer.concat([good.subarray(0, 40), randomBytes(200)]))).toMatchObject({ ok: false, code: "DECODE_FAILED" });
    expect(await processImageBytes(Buffer.concat([Buffer.from("RIFF0000WEBP"), randomBytes(64)]))).toMatchObject({ ok: false, code: "DECODE_FAILED" });
    const anim = await sharp([await png(400, 400), await png(400, 400, true)], { join: { animated: true } }).webp().toBuffer();
    expect(await processImageBytes(anim)).toMatchObject({ ok: false, code: "ANIMATED_IMAGE" });
    expect(await processImageBytes(await png(7000, 7000))).toMatchObject({ ok: false, code: "PIXEL_LIMIT" });
    expect(await processImageBytes(await jpeg(200, 200))).toMatchObject({ ok: false, code: "TOO_SMALL" });
    expect(await processImageBytes(await jpeg(1000, 300))).toMatchObject({ ok: false, code: "ASPECT_OUT_OF_RANGE" });
    expect(await processImageBytes(await jpeg(600, 1000))).toMatchObject({ ok: false, code: "ASPECT_OUT_OF_RANGE" });
  }, 60_000);
});

describe("서비스(mock RPC·mock Storage)", () => {
  const meta = (o: Record<string, unknown> = {}) => ({
    id: ASSET, status: "pending_upload", source: "own_creation", source_note: null, original_format: null, original_byte_size: null,
    original_width: null, original_height: null, failure_code: null, rights_state: "unreviewed", allowed_channels: null, rights_valid_until: null,
    archived_at: null, row_version: 1, created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z", variant: null, ...o,
  });
  function rpc(over: Record<string, (p: Record<string, unknown>) => { data: unknown; error: unknown } | "throw"> = {}) {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const base: Record<string, (p: Record<string, unknown>) => { data: unknown; error: unknown }> = {
      distribution_create_media_asset: () => ({ data: { ...meta(), upload_object_path: `uploads/${ADMIN}/${ASSET}/original` }, error: null }),
      distribution_mark_media_received: () => ({ data: meta({ status: "processing", row_version: 2, original_format: "png" }), error: null }),
      distribution_complete_media_processing: (p) => ({ data: meta({ status: "ready", row_version: 3, variant: { id: VARIANT, kind: "feed_jpeg", byte_size: p.p_byte_size, width: p.p_width, height: p.p_height, sha256: p.p_sha256 } }), error: null }),
      distribution_fail_media_processing: (p) => ({ data: meta({ status: "failed", failure_code: p.p_code, row_version: 3 }), error: null }),
    };
    const c = {
      rpc: vi.fn(async (fn: string, p: Record<string, unknown>) => {
        calls.push([fn, p]);
        const f = over[fn] ?? base[fn];
        if (!f) return { data: null, error: { code: "42883", message: "x" } };
        const r = f(p);
        if (r === "throw") throw new Error("lost");
        return r;
      }),
    } as unknown as RpcClient;
    return { c, calls };
  }
  function store(o: Partial<Record<keyof MediaStorage, unknown>> = {}) {
    const objects = new Map<string, Buffer>();
    const s: MediaStorage = {
      upload: vi.fn(async (_b, path, bytes) => (o.upload === "fail" ? { ok: false as const, code: "storage_error" as const } : (objects.set(path, bytes), { ok: true as const, value: true as const }))),
      download: vi.fn(async (_b, path) => (objects.has(path) ? { ok: true as const, value: objects.get(path) as Buffer } : { ok: false as const, code: "not_found" as const })),
      remove: vi.fn(async (_b, paths: string[]) => (paths.forEach((p) => objects.delete(p)), { ok: true as const, value: true as const })),
      createSignedUrl: vi.fn(async () => (o.createSignedUrl === "fail" ? { ok: false as const, code: "storage_error" as const } : { ok: true as const, value: SIGNED })),
    };
    return { s, objects };
  }

  it("바이트 → create → received → 변형 업로드(DB 규칙 경로) → complete, 원본은 저장 안 함", async () => {
    const r = rpc();
    const st = store();
    const out = await createAndProcessFromBytes({ resolveActor: allowed, getClient: () => r.c, storage: st.s }, { source: "own_creation", bytes: await png(800, 600) });
    expect(out.status).toBe("ready");
    expect(r.calls.map((c) => c[0])).toEqual(["distribution_create_media_asset", "distribution_mark_media_received", "distribution_complete_media_processing"]);
    expect([...st.objects.keys()]).toEqual([`variants/${ASSET}/feed_jpeg.jpg`]);
    const rec = r.calls[1]?.[1] ?? {};
    expect(rec).toMatchObject({ p_expected_version: 1, p_format: "png", p_width: 800, p_height: 600 });
    expect(r.calls[2]?.[1]).toMatchObject({ p_expected_version: 2, p_width: 800, p_height: 600 });
  });
  it("검사 실패 → fail RPC(코드), Storage 업로드 0", async () => {
    const r = rpc();
    const st = store();
    const out = await createAndProcessFromBytes({ resolveActor: allowed, getClient: () => r.c, storage: st.s }, { source: "own_creation", bytes: await jpeg(1000, 300) });
    expect(out).toMatchObject({ status: "failed", code: "ASPECT_OUT_OF_RANGE" });
    expect(r.calls.map((c) => c[0])).toEqual(["distribution_create_media_asset", "distribution_mark_media_received", "distribution_fail_media_processing"]);
    expect(st.s.upload).not.toHaveBeenCalled();
    const bad = await createAndProcessFromBytes({ resolveActor: allowed, getClient: () => rpc().c, storage: store().s }, { source: "own_creation", bytes: Buffer.from("junk-bytes") });
    expect(bad).toMatchObject({ status: "failed", code: "UNSUPPORTED_FORMAT" });
  });
  it("Storage 업로드 실패 → failed(STORAGE_UPLOAD_FAILED), 완료 응답 유실 → uncertain(고아 객체 가능)", async () => {
    const out = await createAndProcessFromBytes({ resolveActor: allowed, getClient: () => rpc().c, storage: store({ upload: "fail" }).s }, { source: "own_creation", bytes: await png(800, 800) });
    expect(out).toMatchObject({ status: "failed", code: "STORAGE_UPLOAD_FAILED" });
    const lost = rpc({ distribution_complete_media_processing: () => "throw" });
    expect(await createAndProcessFromBytes({ resolveActor: allowed, getClient: () => lost.c, storage: store().s }, { source: "own_creation", bytes: await png(800, 800) })).toEqual({ status: "uncertain", assetId: ASSET, stage: "complete" });
  });
  it("입력 검증·준비 전·D1: RPC 0회", async () => {
    const r = rpc();
    expect(await createAndProcessFromBytes({ resolveActor: allowed, getClient: () => r.c, storage: store().s }, { source: "stolen", bytes: Buffer.from("x") })).toEqual({ status: "invalid", field: "source" });
    expect(await createAndProcessFromBytes({ resolveActor: allowed, getClient: () => r.c, storage: null }, { source: "own_creation", bytes: await png(800, 800) })).toEqual({ status: "not_ready" });
    expect(await createAndProcessFromBytes({ resolveActor: async () => ({ ok: false, reason: "not_approved" }), getClient: () => r.c, storage: store().s }, { source: "own_creation", bytes: await png(800, 800) })).toEqual({ status: "denied" });
    expect(r.calls).toEqual([]);
  });
  it("통제된 업로드 경로만: 다른 소유자·임의 경로·URL 거부, 처리 후 업로드 객체 삭제", async () => {
    const asset = { id: ASSET, rowVersion: 1 } as MediaAssetDto;
    const st = store();
    const path = `uploads/${ADMIN}/${ASSET}/original`;
    st.objects.set(path, await png(800, 800));
    const d = { resolveActor: allowed, getClient: () => rpc().c, storage: st.s };
    for (const bad of ["https://evil.example/a.jpg", `uploads/99999999-8888-4777-8666-555555555555/${ASSET}/original`, `uploads/${ADMIN}/${ASSET}/../x`, `variants/${ASSET}/feed_jpeg.jpg`]) {
      expect((await processControlledUpload(d, { asset, uploadObjectPath: bad })).status).toBe("invalid");
    }
    expect(st.s.download).not.toHaveBeenCalled();
    expect((await processControlledUpload(d, { asset, uploadObjectPath: path })).status).toBe("ready");
    expect(st.objects.has(path)).toBe(false);
  });
  it("서명: DB 승인 뒤에만 Storage 서명, 거부면 서명 0회, 서명 실패면 URL 없음, URL은 가려진다", async () => {
    const pinned = { assetId: ASSET, variantId: VARIANT, sha256: "a".repeat(64), width: 800, height: 800, byteSize: 1000 };
    const ok = { data: { asset_id: ASSET, variant_id: VARIANT, object_path: `variants/${ASSET}/feed_jpeg.jpg`, sha256: "a".repeat(64), byte_size: 1000, width: 800, height: 800, mime_type: "image/jpeg", channel: "instagram", expires_at: "2026-11-17T00:10:00Z", ttl_seconds: 600 }, error: null };
    const st = store();
    const out = await issuePublishUrl({ resolveActor: allowed, getClient: () => rpc({ distribution_authorize_media_signing: () => ok }).c, storage: st.s }, { pinned, channel: "instagram" });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.url.reveal() === SIGNED).toBe(true);
    for (const s of [JSON.stringify(out), String(out.url), inspect(out)]) expect(s.includes(SIGNED)).toBe(false);
    expect(st.s.createSignedUrl).toHaveBeenCalledWith("distribution-media", `variants/${ASSET}/feed_jpeg.jpg`, 600);

    const denied = store();
    const rej = await issuePublishUrl({ resolveActor: allowed, getClient: () => rpc({ distribution_authorize_media_signing: () => ({ data: null, error: { code: "23514", message: "RIGHTS_NOT_APPROVED: x" } }) }).c, storage: denied.s }, { pinned, channel: "instagram" });
    expect(rej.status === "db_error" && rej.error.token).toBe("RIGHTS_NOT_APPROVED");
    expect(denied.s.createSignedUrl).not.toHaveBeenCalled();

    const sf = await issuePublishUrl({ resolveActor: allowed, getClient: () => rpc({ distribution_authorize_media_signing: () => ok }).c, storage: store({ createSignedUrl: "fail" }).s }, { pinned, channel: "instagram" });
    expect(sf).toMatchObject({ status: "signing_failed" });
    expect("url" in sf).toBe(false);

    const weird = await issuePublishUrl({ resolveActor: allowed, getClient: () => rpc({ distribution_authorize_media_signing: () => ({ data: { ...ok.data, object_path: "../../secret" }, error: null }) }).c, storage: store().s }, { pinned, channel: "instagram" });
    expect(weird.status).toBe("bad_response");
    expect((await issuePublishUrl({ resolveActor: allowed, getClient: () => rpc().c, storage: store().s }, { pinned, channel: "instagram", ttlSeconds: 3600 })).status).toBe("invalid");
    expect(new SignedUrl("x").toJSON()).toBe("[signed-url]");
  });
});
