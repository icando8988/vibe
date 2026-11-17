/**
 * AUTOPOST-M4-MEDIA-022 — 미디어 서비스 → RPC 왕복(PGlite 대역 + 메모리 mock Storage + 실제 sharp).
 * `PGLITE_PROJECT`가 있을 때만 실행(평소 npm test에서는 건너뜀 — 통과로 세지 않음).
 * 실행: node web/scripts/distribution-local-verify/media-run.mjs --pglite-project <dir>
 * 한계: Storage는 메모리 mock이다(실제 Supabase Storage·bucket 정책·서명 URL 만료 동작 미검증). PGlite는 단일 연결(동시성 증명 아님).
 */
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { appendDraftRevision, createChannelDraft, createContent } from "@/server/distribution/content-service";
import { archiveAsset, createAndProcessFromBytes, decideRights, issuePublishUrl, listAssets, type MediaAssetDto, type PinnedMediaRef } from "@/server/distribution/media/service";
import type { MediaStorage } from "@/server/distribution/media/storage";
import { getContentDetail } from "@/server/distribution/read";
import type { RpcClient } from "@/server/distribution/write-runner";
import { inTx, openDb, readSourceOf, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const U = { admin: "00000000-0000-4000-8000-00000000000a", admin2: "00000000-0000-4000-8000-00000000000b", pending: "00000000-0000-4000-8000-0000000000c1" };
let db: Db;
let rpc: RpcClient;
const objects = new Map<string, Buffer>();
const signer = vi.fn(async (_b: string, p: string, ttl: number) => ({ ok: true as const, value: `https://storage.local/sign/${p}?ttl=${ttl}&token=${randomBytes(8).toString("hex")}` }));
const storage: MediaStorage = {
  upload: async (_b, p, bytes) => (objects.set(p, bytes), { ok: true, value: true }),
  download: async (_b, p) => (objects.has(p) ? { ok: true, value: objects.get(p) as Buffer } : { ok: false, code: "not_found" }),
  remove: async (_b, ps) => (ps.forEach((p) => objects.delete(p)), { ok: true, value: true }),
  createSignedUrl: signer,
};
const as = (id: string) => async (): Promise<ActorResult> => ({ ok: true, actorId: id });
const deps = (id = U.admin) => ({ resolveActor: as(id), getClient: () => rpc, storage });
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
const img = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#4488cc" } }).png().toBuffer();

async function owner<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("set role supa_owner");
  try {
    return (await db.query(sql, params)).rows as T[];
  } finally {
    await db.exec("reset role");
  }
}
async function ready(id = U.admin): Promise<MediaAssetDto> {
  const out = await createAndProcessFromBytes(deps(id), { source: "own_creation", bytes: await img(1080, 1080) });
  if (out.status !== "ready") throw new Error(`ready ${JSON.stringify(out)}`);
  return out.asset;
}
const pinOf = (a: MediaAssetDto): PinnedMediaRef => {
  if (!a.variant) throw new Error("variant");
  return { assetId: a.id, variantId: a.variant.id, sha256: a.variant.sha256, width: a.variant.width, height: a.variant.height, byteSize: a.variant.byteSize };
};

describe.skipIf(!PROJECT)("PGlite 왕복: 미디어 자산·권리·서명 승인", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [U.admin, U.admin2, U.pending], [U.pending], [U.admin, U.admin2, U.pending]);
    db = opened.db;
    rpc = rpcClientOf(db, new Set(["distribution_list_media_assets"]));
    expect(opened.applied).toContain("20261116120000_distribution_media_assets.sql");
    console.log(`applied: ${opened.applied.map((f) => f.slice(0, 14)).join(", ")}`);
  }, 120_000);

  it("ACL: 4개 테이블 직접 접근 차단, RPC 8개만 service_role, helper 전부 회수", async () => {
    for (const t of ["distribution_media_assets", "distribution_media_variants", "distribution_media_rights_decisions", "distribution_media_signing_grants"]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        await expect(inTx(db, role, null, () => db.query(`select * from public.${t}`))).rejects.toMatchObject({ code: "42501" });
      }
    }
    const acl = await owner<{ n: string; a: boolean; u: boolean; s: boolean; d: boolean }>(
      `select p.proname n, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u,
              has_function_privilege('service_role', p.oid, 'EXECUTE') s, p.prosecdef d
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and (p.proname like '%media%') order by 1`,
    );
    const rpcs = acl.filter((f) => f.d);
    expect(rpcs.map((f) => f.n)).toEqual([
      "distribution_archive_media_asset", "distribution_authorize_media_signing", "distribution_cancel_media_upload_grant", "distribution_complete_media_processing",
      "distribution_consume_media_upload_grant", "distribution_create_media_asset", "distribution_decide_media_rights", "distribution_expire_media_upload_grants",
      "distribution_fail_media_processing", "distribution_get_media_upload_grant", "distribution_issue_media_upload_grant", "distribution_list_media_assets",
      "distribution_mark_media_received", "distribution_recover_stalled_media_uploads",
    ]); // BE-UPLOAD-025: 130000 업로드 grant RPC 5개 추가, BE-UPLOAD-RECOVERY-030: 140000 복구 RPC 1개 추가(같은 service_role 전용 조건)
    expect(rpcs.every((f) => !f.a && !f.u && f.s)).toBe(true);
    expect(acl.filter((f) => !f.d && f.n !== "distribution_draft_revision_media_before_insert").every((f) => !f.a && !f.u && !f.s)).toBe(true);
  });

  it("업로드 → processing → ready, 경로는 DB 생성(사용자 경로 없음), 목록에 경로·서명 없음, D1", async () => {
    expect((await createAndProcessFromBytes(deps(U.pending), { source: "own_creation", bytes: await img(800, 800) })).status).toBe("denied");
    const a = await ready();
    expect([a.status, a.rightsState, a.variant?.width, a.variant?.height]).toEqual(["ready", "unreviewed", 1080, 1080]);
    const row = await owner<{ upload_object_path: string; object_path: string; sha256: string }>(
      "select a.upload_object_path, v.object_path, v.sha256 from public.distribution_media_assets a join public.distribution_media_variants v on v.asset_id = a.id where a.id = $1::uuid", [a.id],
    );
    expect(row[0]).toMatchObject({ upload_object_path: `uploads/${U.admin}/${a.id}/original`, object_path: `variants/${a.id}/feed_jpeg.jpg`, sha256: a.variant?.sha256 });
    expect(objects.has(`variants/${a.id}/feed_jpeg.jpg`)).toBe(true);
    const listed = await listAssets(deps());
    expect(listed.status === "ok" && listed.assets.some((x) => x.id === a.id)).toBe(true);
    const raw = await rpc.rpc("distribution_list_media_assets", { p_actor_id: U.admin });
    expect(JSON.stringify(raw.data).includes("variants/") || JSON.stringify(raw.data).includes("uploads/")).toBe(false);
    // 다른 소유자 목록에는 없음
    const other = await listAssets(deps(U.admin2));
    expect(other.status === "ok" && other.assets.some((x) => x.id === a.id)).toBe(false);
    // 경로 생성 열은 바꿀 수 없음
    await expect(owner("update public.distribution_media_variants set object_path = 'x' where asset_id = $1::uuid", [a.id])).rejects.toBeTruthy();
  });

  it("손상·규격 밖 이미지 → failed(코드), 변형 없음", async () => {
    const bad = await createAndProcessFromBytes(deps(), { source: "own_creation", bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(300)]) });
    expect(bad).toMatchObject({ status: "failed", code: "DECODE_FAILED" });
    const wide = await createAndProcessFromBytes(deps(), { source: "licensed", bytes: await img(1200, 300) });
    expect(wide.status === "failed" && wide.asset).toMatchObject({ status: "failed", failureCode: "ASPECT_OUT_OF_RANGE", originalFormat: "png" });
  });

  it("권리 결정: 불변 이력, 버전 충돌, 소유자만, 서명 승인 조건(채널·유효기한·철회·변형 고정)", async () => {
    const a = await ready();
    const r1 = await decideRights(deps(U.admin2), { assetId: a.id, expectedVersion: a.rowVersion, decision: "approved", allowedChannels: ["instagram"] });
    expect(r1.status === "db_error" && r1.error.code).toBe("not_found");
    const r2 = await decideRights(deps(), { assetId: a.id, expectedVersion: a.rowVersion + 5, decision: "approved", allowedChannels: ["instagram"] });
    expect(r2.status === "db_error" && r2.error.token).toBe("VERSION_CONFLICT");
    // 권리 없음 → 서명 거부(서명 호출 0)
    signer.mockClear();
    const noRights = await issuePublishUrl(deps(), { pinned: pinOf(a), channel: "instagram" });
    expect(noRights.status === "db_error" && noRights.error.token).toBe("RIGHTS_NOT_APPROVED");
    expect(signer).not.toHaveBeenCalled();

    const ap = await decideRights(deps(), { assetId: a.id, expectedVersion: a.rowVersion, decision: "approved", allowedChannels: ["instagram"], validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(), note: "자체 촬영" });
    expect(ap.status === "ok" && [ap.asset.rightsState, ap.asset.allowedChannels]).toEqual(["approved", ["instagram"]]);
    if (ap.status !== "ok") return;

    const ok = await issuePublishUrl(deps(), { pinned: pinOf(a), channel: "instagram" });
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    expect(signer).toHaveBeenCalledTimes(1);
    const grant = await owner<{ j: string }>("select row_to_json(g)::text j from public.distribution_media_signing_grants g where asset_id = $1::uuid", [a.id]);
    expect(grant.length).toBe(1);
    expect(grant[0]?.j.includes(ok.url.reveal()) || grant[0]?.j.includes("token=")).toBe(false); // 서명 URL·토큰은 DB에 없음
    expect(Date.parse(ok.expiresAt) - Date.now()).toBeLessThanOrEqual(600_000);

    const t = await issuePublishUrl(deps(), { pinned: pinOf(a), channel: "threads" });
    expect(t.status === "db_error" && t.error.token).toBe("CHANNEL_NOT_ALLOWED");
    const tampered = await issuePublishUrl(deps(), { pinned: { ...pinOf(a), sha256: "0".repeat(64) }, channel: "instagram" });
    expect(tampered.status === "db_error" && tampered.error.token).toBe("VARIANT_MISMATCH");
    const otherOwner = await issuePublishUrl(deps(U.admin2), { pinned: pinOf(a), channel: "instagram" });
    expect(otherOwner.status === "db_error" && otherOwner.error.code).toBe("not_found");

    // 유효기한이 TTL보다 짧으면 거부
    const b = await ready();
    await decideRights(deps(), { assetId: b.id, expectedVersion: b.rowVersion, decision: "approved", allowedChannels: ["instagram"], validUntil: new Date(Date.now() + 120_000).toISOString() });
    const short = await issuePublishUrl(deps(), { pinned: pinOf(b), channel: "instagram", ttlSeconds: 600 });
    expect(short.status === "db_error" && short.error.token).toBe("RIGHTS_EXPIRED");

    // 철회 → 서명 거부, 결정 이력 3건 불변
    const rv = await decideRights(deps(), { assetId: a.id, expectedVersion: ap.asset.rowVersion, decision: "revoked", note: "권리 재검토" });
    expect(rv.status === "ok" && [rv.asset.rightsState, rv.asset.allowedChannels]).toEqual(["revoked", null]);
    const after = await issuePublishUrl(deps(), { pinned: pinOf(a), channel: "instagram" });
    expect(after.status === "db_error" && after.error.token).toBe("RIGHTS_NOT_APPROVED");
    const hist = await owner<{ decision: string }>("select decision from public.distribution_media_rights_decisions where asset_id = $1::uuid order by created_at", [a.id]);
    expect(hist.map((h) => h.decision)).toEqual(["approved", "revoked"]);
    await expect(owner("update public.distribution_media_rights_decisions set decision = 'approved' where asset_id = $1::uuid", [a.id])).rejects.toBeTruthy();
    await expect(owner("delete from public.distribution_media_assets where id = $1::uuid", [a.id])).rejects.toBeTruthy();

    // 처리 중·실패 자산 권리 승인 거부
    const failed = await createAndProcessFromBytes(deps(), { source: "own_creation", bytes: await img(200, 200) });
    if (failed.status !== "failed" || !failed.asset) throw new Error("failed asset");
    const fx = await decideRights(deps(), { assetId: failed.asset.id, expectedVersion: failed.asset.rowVersion, decision: "approved", allowedChannels: ["instagram"] });
    expect(fx.status === "db_error" && fx.error.token).toBe("INVALID_TRANSITION");
  });

  it("리비전 미디어 호환: ready 자산·같은 자산 변형만, 참조 자산 보관 거부, 미참조 보관 후 서명 거부", async () => {
    const a = await ready();
    const other = await ready();
    const c = await createContent(deps(), form({ title: "미디어 원문", body: "본문" }));
    if (c.status !== "ok") throw new Error("content");
    const d = await getContentDetail(readSourceOf(db, U.admin), c.data.contentId);
    if (d.status !== "ok" || !d.data?.current) throw new Error("detail");
    const dr = await createChannelDraft(deps(), form({ contentId: c.data.contentId, channel: "instagram" }));
    if (dr.status !== "ok") throw new Error("draft");
    const rev = (no: string, media: unknown) =>
      appendDraftRevision(deps(), form({ draftId: dr.data.draftId, expectedRevisionNo: no, expectedContentVersionId: d.data?.current?.id ?? "", body: "캡션", preserveMedia: JSON.stringify(media) }));

    const wrongVariant = await rev("0", [{ asset_id: a.id, variant_id: other.variant?.id, alt_text: null }]);
    expect(wrongVariant.status === "db_error" && wrongVariant.error.token).toBe("VARIANT_MISMATCH");
    const failed = await createAndProcessFromBytes(deps(), { source: "own_creation", bytes: await img(200, 200) });
    if (failed.status !== "failed" || !failed.asset) throw new Error("failed");
    const notReady = await rev("0", [{ asset_id: failed.asset.id, variant_id: null, alt_text: null }]);
    expect(notReady.status === "db_error" && notReady.error.token).toBe("MEDIA_NOT_READY");
    const missing = await rev("0", [{ asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", variant_id: null, alt_text: null }]);
    expect(missing.status === "db_error" && missing.error.token).toBe("MEDIA_NOT_READY");
    const ok = await rev("0", [{ asset_id: a.id, variant_id: a.variant?.id, alt_text: "대체 텍스트" }]);
    expect(ok.status).toBe("ok");

    const ref = await archiveAsset(deps(), { assetId: a.id, expectedVersion: a.rowVersion });
    expect(ref.status === "db_error" && ref.error.token).toBe("ASSET_REFERENCED");
    const arch = await archiveAsset(deps(), { assetId: other.id, expectedVersion: other.rowVersion });
    expect(arch.status === "ok" && arch.asset.archivedAt !== null).toBe(true);
    const sig = await issuePublishUrl(deps(), { pinned: pinOf(other), channel: "instagram" });
    expect(sig.status === "db_error" && sig.error.token).toBe("ARCHIVED");
    const fks = await owner<{ conname: string; convalidated: boolean }>("select conname, convalidated from pg_constraint where conname like 'distribution_draft_revision_media_%_fk' order by conname");
    expect(fks).toEqual([
      { conname: "distribution_draft_revision_media_asset_fk", convalidated: false },
      { conname: "distribution_draft_revision_media_variant_fk", convalidated: false },
    ]);
  });
});
