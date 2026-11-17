/**
 * BE-UPLOAD-025 — 직접 업로드 흐름 → 130000 RPC 왕복(PGlite 대역 + 메모리 intake/Storage mock + 실제 sharp).
 * `PGLITE_PROJECT`가 있을 때만 실행(평소에는 건너뜀 — 통과로 세지 않음). 실행: node scripts/distribution-local-verify/upload-run.mjs --pglite-project <dir>
 * 한계: Storage는 메모리 mock(실제 서명 업로드·bucket 정책·토큰 2시간 수명 미검증). PGlite는 단일 연결 — 동시 시험은 직렬화된 행 잠금 논리 확인일 뿐.
 */
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { MEDIA_INTAKE_BUCKET } from "@/server/distribution/media/policy";
import { listAssets } from "@/server/distribution/media/service";
import { SignedUrl, type MediaIntakeStorage, type MediaStorage } from "@/server/distribution/media/storage";
import { cancelUpload, completeUpload, issueUploadGrant, type IssuedGrant, type UploadDeps } from "@/server/distribution/media/upload";
import type { RpcClient } from "@/server/distribution/write-runner";
import { inTx, openDb, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const U = { admin: "00000000-0000-4000-8000-00000000000a", admin2: "00000000-0000-4000-8000-00000000000b", pending: "00000000-0000-4000-8000-0000000000c1" };
let db: Db;
let rpc: RpcClient;
const intakeObjects = new Map<string, Buffer>();
const variants = new Map<string, Buffer>();
const signedPaths: string[] = [];
let failSigning = false;
const intake: MediaIntakeStorage = {
  createSignedUploadUrl: async (b, p) => {
    if (b !== MEDIA_INTAKE_BUCKET) return { ok: false, code: "storage_error" };
    if (failSigning) return { ok: false, code: "storage_unavailable" };
    signedPaths.push(p);
    return { ok: true, value: new SignedUrl(`https://intake.local/upload/sign/${b}/${p}?token=t${signedPaths.length}`) };
  },
  download: async (_b, p) => (intakeObjects.has(p) ? { ok: true, value: intakeObjects.get(p) as Buffer } : { ok: false, code: "not_found" }),
  remove: async (_b, ps) => {
    const hit = ps.filter((p) => intakeObjects.delete(p));
    return hit.length ? { ok: true, value: true } : { ok: false, code: "not_found" };
  },
};
const storage: MediaStorage = {
  upload: async (_b, p, bytes) => (variants.has(p) ? { ok: false, code: "already_exists" } : (variants.set(p, bytes), { ok: true, value: true })),
  download: async () => ({ ok: false, code: "not_found" }),
  remove: async () => ({ ok: true, value: true }),
  createSignedUrl: async () => ({ ok: false, code: "storage_error" }),
};
const as = (id: string) => async (): Promise<ActorResult> => ({ ok: true, actorId: id });
const deps = (id = U.admin): UploadDeps => ({ resolveActor: as(id), getClient: () => rpc, storage, intake });
const png = (w = 900, h = 900) => sharp({ create: { width: w, height: h, channels: 3, background: "#3366aa" } }).png().toBuffer();
/** 브라우저 PUT 모사: 서명 URL에 묶인 경로에만 쓴다(upsert 없음 → 있으면 거절). */
function put(g: IssuedGrant, bytes: Buffer): boolean {
  const path = new URL(g.upload.url.reveal()).pathname.split(`/${MEDIA_INTAKE_BUCKET}/`)[1] as string;
  if (intakeObjects.has(path)) return false;
  intakeObjects.set(path, bytes);
  return true;
}
const pathOf = (g: IssuedGrant) => `uploads/${U.admin}/${g.assetId}/original`;

async function owner<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("set role supa_owner");
  try {
    return (await db.query(sql, params)).rows as T[];
  } finally {
    await db.exec("reset role");
  }
}
async function issue(bytes: Buffer, id = U.admin, contentType = "image/png"): Promise<IssuedGrant> {
  const r = await issueUploadGrant(deps(id), { source: "own_creation", contentType, byteSize: bytes.length });
  if (r.status !== "issued") throw new Error(`issue ${JSON.stringify(r)}`);
  return r.grant;
}
const keyOf = (g: IssuedGrant) => ({ grantId: g.grantId, nonce: g.nonce, expectedVersion: g.rowVersion });
const grantRow = async (id: string) => (await owner<{ status: string; nonce_hash: string }>("select status, nonce_hash from public.distribution_media_upload_grants where id = $1::uuid", [id]))[0];
const assetRow = async (id: string) => (await owner<{ status: string; row_version: number; failure_code: string | null }>("select status, row_version, failure_code from public.distribution_media_assets where id = $1::uuid", [id]))[0];

describe.skipIf(!PROJECT)("PGlite 왕복: 직접 업로드 grant", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [U.admin, U.admin2, U.pending], [U.pending], [U.admin, U.admin2, U.pending]);
    db = opened.db;
    rpc = rpcClientOf(db, new Set(["distribution_list_media_assets"]));
    expect(opened.applied).toContain("20261116130000_distribution_media_upload_grants.sql");
  }, 120_000);

  it("ACL: grant 테이블 직접 접근 차단, RPC 5개 service_role 전용, 내부 helper 회수", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await expect(inTx(db, role, null, () => db.query("select * from public.distribution_media_upload_grants"))).rejects.toMatchObject({ code: "42501" });
    }
    const acl = await owner<{ n: string; a: boolean; u: boolean; s: boolean; d: boolean }>(
      `select p.proname n, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u,
              has_function_privilege('service_role', p.oid, 'EXECUTE') s, p.prosecdef d
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname like '%upload_grant%' order by 1`);
    expect(acl.filter((f) => f.d).map((f) => f.n)).toEqual([
      "distribution_cancel_media_upload_grant", "distribution_consume_media_upload_grant", "distribution_expire_media_upload_grants",
      "distribution_get_media_upload_grant", "distribution_issue_media_upload_grant",
    ]);
    expect(acl.filter((f) => f.d).every((f) => !f.a && !f.u && f.s)).toBe(true);
    expect(acl.filter((f) => !f.d).every((f) => !f.a && !f.u && !f.s)).toBe(true);
  });

  it("발급 → PUT → 완료 → ready, 원본 삭제, grant consumed, DB에 nonce·URL 원문 없음, 업로드됨≠권리 승인", async () => {
    const bytes = await png();
    const g = await issue(bytes);
    expect(signedPaths.at(-1)).toBe(pathOf(g));
    expect(await assetRow(g.assetId)).toMatchObject({ status: "pending_upload", row_version: 1 });
    expect(put(g, bytes)).toBe(true);
    const r = await completeUpload(deps(), keyOf(g));
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    expect(r.asset).toMatchObject({ status: "ready", rightsState: "unreviewed", originalFormat: "png" });
    expect(intakeObjects.has(pathOf(g))).toBe(false);
    expect((await grantRow(g.grantId))?.status).toBe("consumed");
    const dump = JSON.stringify(await owner("select * from public.distribution_media_upload_grants"));
    expect(dump).not.toContain(g.nonce);
    expect(dump).not.toContain("token=");
    expect(dump).not.toContain("intake.local");
  });

  it("not_uploaded는 grant·nonce·rowVersion을 바꾸지 않음 → 뒤늦게 PUT 후 같은 grant로 ready, 그 뒤 중복 완료는 grant_used", async () => {
    const bytes = await png();
    const g = await issue(bytes);
    const before = { grant: await grantRow(g.grantId), asset: await assetRow(g.assetId) };
    expect(await completeUpload(deps(), keyOf(g))).toEqual({ status: "not_uploaded" });
    expect(await completeUpload(deps(), keyOf(g))).toEqual({ status: "not_uploaded" });
    expect({ grant: await grantRow(g.grantId), asset: await assetRow(g.assetId) }).toEqual(before);
    put(g, bytes);
    expect((await completeUpload(deps(), keyOf(g))).status).toBe("ready");
    expect(await completeUpload(deps(), keyOf(g))).toEqual({ status: "grant_used" });
  });

  it("동시 완료 2건 → ready 1 + grant_used 1, 변형 1개", async () => {
    const bytes = await png();
    const g = await issue(bytes);
    put(g, bytes);
    const out = await Promise.all([completeUpload(deps(), keyOf(g)), completeUpload(deps(), keyOf(g))]);
    expect(out.map((o) => o.status).sort()).toEqual(["grant_used", "ready"]);
    expect((await owner<{ n: number }>("select count(*)::int n from public.distribution_media_variants where asset_id = $1::uuid", [g.assetId]))[0]?.n).toBe(1);
  });

  it("취소 경합: 취소 후 완료 → grant_cancelled, 취소 뒤 들어온 바이트는 완료 불가(고아 — 토큰 미철회 한계), 완료 후 취소 → grant_used", async () => {
    const bytes = await png();
    const g = await issue(bytes);
    expect(await cancelUpload(deps(), { grantId: g.grantId, nonce: g.nonce })).toMatchObject({ status: "cancelled", asset: { status: "failed", failureCode: "UPLOAD_CANCELLED" } });
    expect(put(g, bytes)).toBe(true); // Storage 토큰은 여전히 유효(문서상 2시간)
    expect(await completeUpload(deps(), keyOf(g))).toEqual({ status: "grant_cancelled" });
    expect(intakeObjects.has(pathOf(g))).toBe(true); // 고아 — sweep 미구현
    intakeObjects.delete(pathOf(g));
    expect(await cancelUpload(deps(), { grantId: g.grantId, nonce: g.nonce })).toEqual({ status: "grant_cancelled" });

    const g2 = await issue(bytes);
    put(g2, bytes);
    const [a, b] = await Promise.all([completeUpload(deps(), keyOf(g2)), cancelUpload(deps(), { grantId: g2.grantId, nonce: g2.nonce })]);
    const pair = [a.status, b.status].sort();
    expect([["cancelled", "grant_cancelled"], ["grant_used", "ready"]]).toContainEqual(pair);
  });

  it("타 actor·잘못된 nonce → grant_invalid(구분 없음), 버전 불일치 → conflict_version, 모두 grant 불변", async () => {
    const bytes = await png();
    const g = await issue(bytes);
    put(g, bytes);
    expect(await completeUpload(deps(U.admin2), keyOf(g))).toEqual({ status: "grant_invalid" });
    expect(await completeUpload(deps(), { ...keyOf(g), nonce: "x".repeat(43) })).toEqual({ status: "grant_invalid" });
    expect(await cancelUpload(deps(U.admin2), { grantId: g.grantId, nonce: g.nonce })).toEqual({ status: "grant_invalid" });
    expect(await completeUpload(deps(), { ...keyOf(g), expectedVersion: 2 })).toEqual({ status: "conflict_version" });
    expect((await grantRow(g.grantId))?.status).toBe("issued");
    expect(await completeUpload(deps(U.pending), keyOf(g))).toEqual({ status: "denied" });
    expect((await completeUpload(deps(), keyOf(g))).status).toBe("ready");
  });

  it("만료: 완료 거부(grant_expired) → 정리 RPC가 expired + 자산 failed(UPLOAD_EXPIRED)", async () => {
    const bytes = await png();
    const g = await issue(bytes);
    await owner("alter table public.distribution_media_upload_grants disable trigger distribution_media_upload_grants_guard");
    await owner("alter table public.distribution_media_upload_grants drop constraint distribution_media_upload_grants_ttl");
    await owner("update public.distribution_media_upload_grants set expires_at = now() - interval '1 second' where id = $1::uuid", [g.grantId]);
    await owner("alter table public.distribution_media_upload_grants enable trigger distribution_media_upload_grants_guard");
    put(g, bytes);
    expect(await completeUpload(deps(), keyOf(g))).toEqual({ status: "grant_expired" });
    const n = await rpc.rpc("distribution_expire_media_upload_grants", { p_limit: 50 });
    expect(n.data).toBe(1);
    expect((await grantRow(g.grantId))?.status).toBe("expired");
    expect(await assetRow(g.assetId)).toMatchObject({ status: "failed", failure_code: "UPLOAD_EXPIRED" });
    expect(await completeUpload(deps(), keyOf(g))).toEqual({ status: "grant_expired" });
    intakeObjects.delete(pathOf(g));
  });

  it("RESUME-026 공백 재현: 소비 뒤 처리 유실 → uncertain, grant consumed·자산 pending_upload로 남고 만료 정리 RPC도 닫지 않음(원본 보존)", async () => {
    const bytes = await png();
    const g = await issue(bytes);
    put(g, bytes);
    const lossy: RpcClient = {
      rpc: async (fn, p) => {
        if (fn === "distribution_mark_media_received") throw new Error("response lost");
        return rpc.rpc(fn, p);
      },
    };
    expect(await completeUpload({ ...deps(), getClient: () => lossy }, keyOf(g))).toEqual({ status: "uncertain" });
    expect((await grantRow(g.grantId))?.status).toBe("consumed");
    expect(await assetRow(g.assetId)).toMatchObject({ status: "pending_upload", failure_code: null });
    expect(intakeObjects.has(pathOf(g))).toBe(true);
    expect(await completeUpload(deps(), keyOf(g))).toEqual({ status: "grant_used" }); // 같은 grant 재완료 불가
    // 앱 기한이 지나도 만료 정리 RPC(130000)는 issued만 본다 → 이 자산은 pending_upload로 남는다(대기 상한 20을 계속 점유).
    // 복구는 별도 RPC(140000 distribution_recover_stalled_media_uploads) — media-upload-recovery.pglite.test.ts.
    await owner("alter table public.distribution_media_upload_grants disable trigger distribution_media_upload_grants_guard");
    await owner("alter table public.distribution_media_upload_grants drop constraint if exists distribution_media_upload_grants_ttl");
    await owner("update public.distribution_media_upload_grants set expires_at = now() - interval '1 second' where id = $1::uuid", [g.grantId]);
    await owner("alter table public.distribution_media_upload_grants enable trigger distribution_media_upload_grants_guard");
    await rpc.rpc("distribution_expire_media_upload_grants", { p_limit: 50 });
    expect((await grantRow(g.grantId))?.status).toBe("consumed");
    expect((await assetRow(g.assetId))?.status).toBe("pending_upload");
    intakeObjects.delete(pathOf(g));
  });

  it("신고 불일치·M4 검사 실패 → failed + 원본 삭제, grant 재사용 불가", async () => {
    const bytes = await png();
    const g = await issue(bytes, U.admin, "image/jpeg"); // PNG 바이트인데 JPEG로 신고
    put(g, bytes);
    expect(await completeUpload(deps(), keyOf(g))).toMatchObject({ status: "failed", code: "DECLARED_MISMATCH" });
    expect(intakeObjects.has(pathOf(g))).toBe(false);
    expect(await assetRow(g.assetId)).toMatchObject({ status: "failed", failure_code: "DECLARED_MISMATCH" });
    const small = await png(200, 200);
    const g2 = await issue(small);
    put(g2, small);
    expect(await completeUpload(deps(), keyOf(g2))).toMatchObject({ status: "failed", code: "TOO_SMALL" });
    expect(await completeUpload(deps(), keyOf(g2))).toEqual({ status: "grant_used" });
  });

  it("서명 실패 → grant 취소·자산 failed, 재발급은 새 자산·새 경로(덮어쓰기 없음)", async () => {
    const bytes = await png();
    failSigning = true;
    expect(await issueUploadGrant(deps(), { source: "own_creation", contentType: "image/png", byteSize: bytes.length })).toEqual({ status: "signing_failed" });
    failSigning = false;
    const last = (await owner<{ id: string; status: string; asset_id: string }>("select id, status, asset_id::text from public.distribution_media_upload_grants order by created_at desc, id desc limit 1"))[0];
    expect(last?.status).toBe("cancelled");
    expect((await assetRow(last?.asset_id as string))?.failure_code).toBe("UPLOAD_CANCELLED");
    const g = await issue(bytes);
    expect(g.assetId).not.toBe(last?.asset_id);
    expect(new Set(signedPaths).size).toBe(signedPaths.length); // 모든 발급 경로가 서로 다름
  });

  it("열린 grant 상한 5 → limit(grant_limit), 목록 조회(metadata)는 영향 없음", async () => {
    const admin2 = (n: number) => issueUploadGrant(deps(U.admin2), { source: "own_creation", contentType: "image/png", byteSize: 100 + n });
    for (let i = 0; i < 5; i++) expect((await admin2(i)).status).toBe("issued");
    expect(await admin2(9)).toEqual({ status: "limit", reason: "grant_limit" });
    const list = await listAssets({ resolveActor: as(U.admin2), getClient: () => rpc });
    expect(list.status === "ok" && list.assets.filter((a) => a.status === "pending_upload").length).toBe(5);
    expect(JSON.stringify(list)).not.toMatch(/uploads\/|token|nonce/);
  });
});
