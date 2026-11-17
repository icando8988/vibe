/**
 * BE-UPLOAD-RECOVERY-030 — 소비 후 고착 복구 RPC(140000) → PGlite 왕복(대역 + 메모리 intake/Storage mock + 실제 sharp).
 * `PGLITE_PROJECT`가 있을 때만 실행(평소에는 건너뜀 — 통과로 세지 않음). 실행: node scripts/distribution-local-verify/upload-run.mjs --pglite-project <dir>
 * 한계: PGlite는 단일 연결이다. "복구 먼저 / 정상 먼저" 두 순서는 호출 사이에 복구를 끼워 넣는 **순서 재현**일 뿐 실제 다중 연결 동시성 검증이 아니다.
 *       시간 경과는 소유자 권한으로 가드를 잠시 끄고 consumed_at·updated_at을 과거로 옮겨 모사한다(이 일회성 DB 안에서만).
 */
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { recoverStalledUploads } from "@/server/distribution/media/recovery";
import { SignedUrl, type MediaIntakeStorage, type MediaStorage } from "@/server/distribution/media/storage";
import { completeUpload, issueUploadGrant, type IssuedGrant, type UploadDeps } from "@/server/distribution/media/upload";
import type { RpcClient } from "@/server/distribution/write-runner";
import { inTx, openDb, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const U = {
  admin: "00000000-0000-4000-8000-00000000001a",
  bulk: "00000000-0000-4000-8000-00000000001b",
};
let db: Db;
let rpc: RpcClient;
const intakeObjects = new Map<string, Buffer>();
const variants = new Map<string, Buffer>();
const intake: MediaIntakeStorage = {
  createSignedUploadUrl: async (b, p) => ({ ok: true, value: new SignedUrl(`https://intake.local/upload/sign/${b}/${p}?token=t`) }),
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
const deps = (id = U.admin, client: () => RpcClient = () => rpc): UploadDeps => ({ resolveActor: as(id), getClient: client, storage, intake });
const png = (w = 900, h = 900) => sharp({ create: { width: w, height: h, channels: 3, background: "#3366aa" } }).png().toBuffer();
const pathOf = (owner: string, g: IssuedGrant) => `uploads/${owner}/${g.assetId}/original`;
const keyOf = (g: IssuedGrant) => ({ grantId: g.grantId, nonce: g.nonce, expectedVersion: g.rowVersion });

async function owner<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("set role supa_owner");
  try {
    return (await db.query(sql, params)).rows as T[];
  } finally {
    await db.exec("reset role");
  }
}
async function issueAndPut(id = U.admin, bytes?: Buffer): Promise<{ g: IssuedGrant; bytes: Buffer }> {
  const b = bytes ?? (await png());
  const r = await issueUploadGrant(deps(id), { source: "own_creation", contentType: "image/png", byteSize: b.length });
  if (r.status !== "issued") throw new Error(`issue ${JSON.stringify(r)}`);
  intakeObjects.set(pathOf(id, r.grant), b);
  return { g: r.grant, bytes: b };
}
/** 지정 RPC 직전에 hook을 실행하거나(before) 그 RPC를 유실시킨다(lose). */
function interposed(fn: string, mode: { lose?: boolean; before?: () => Promise<void> }): RpcClient {
  return {
    rpc: async (name, p) => {
      if (name === fn) {
        if (mode.before) await mode.before();
        if (mode.lose) throw new Error("response lost");
      }
      return rpc.rpc(name, p);
    },
  };
}
/** 시간 경과 모사: 자산·grant의 updated_at/consumed_at을 과거로(가드 일시 비활성 — 이 일회성 DB 안에서만). */
async function age(assetIds: string[], seconds: number) {
  await owner("alter table public.distribution_media_assets disable trigger distribution_media_assets_guard");
  await owner("alter table public.distribution_media_upload_grants disable trigger distribution_media_upload_grants_guard");
  try {
    await owner("update public.distribution_media_assets set updated_at = now() - make_interval(secs => $2) where id = any($1::uuid[])", [assetIds, seconds]);
    await owner("update public.distribution_media_upload_grants set consumed_at = now() - make_interval(secs => $2) where asset_id = any($1::uuid[]) and status = 'consumed'", [assetIds, seconds]);
  } finally {
    await owner("alter table public.distribution_media_assets enable trigger distribution_media_assets_guard");
    await owner("alter table public.distribution_media_upload_grants enable trigger distribution_media_upload_grants_guard");
  }
}
const recover = async (limit = 500, stall = 600) => (await rpc.rpc("distribution_recover_stalled_media_uploads", { p_limit: limit, p_stall_seconds: stall })).data as number;
const assetRow = async (id: string) =>
  (await owner<{ status: string; row_version: number; failure_code: string | null }>("select status, row_version, failure_code from public.distribution_media_assets where id = $1::uuid", [id]))[0];
const grantStatus = async (assetId: string) => (await owner<{ status: string }>("select status from public.distribution_media_upload_grants where asset_id = $1::uuid", [assetId]))[0]?.status;
const variantCount = async (assetId: string) => Number((await owner<{ n: string }>("select count(*)::text n from public.distribution_media_variants where asset_id = $1::uuid", [assetId]))[0]?.n);

/** 소비 후 mark_received 유실 → pending_upload 고착 */
async function stuckPending(id = U.admin, bytes?: Buffer) {
  const { g } = await issueAndPut(id, bytes);
  expect(await completeUpload(deps(id, () => interposed("distribution_mark_media_received", { lose: true })), keyOf(g))).toEqual({ status: "uncertain" });
  return g;
}

describe.skipIf(!PROJECT)("PGlite 왕복: 소비 후 고착 복구(140000)", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [U.admin, U.bulk], [], [U.admin, U.bulk]);
    db = opened.db;
    rpc = rpcClientOf(db);
    expect(opened.applied).toContain("20261116140000_distribution_media_upload_stall_recovery.sql");
  }, 120_000);

  it("ACL·인자: service_role 전용(anon·authenticated 거부), limit 1..500·stall 600..86400 밖은 22023", async () => {
    const acl = await owner<{ a: boolean; u: boolean; s: boolean; d: boolean }>(
      `select has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u,
              has_function_privilege('service_role', p.oid, 'EXECUTE') s, p.prosecdef d
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'distribution_recover_stalled_media_uploads'`);
    expect(acl).toEqual([{ a: false, u: false, s: true, d: true }]);
    for (const role of ["anon", "authenticated"]) {
      await expect(inTx(db, role, null, () => db.query("select public.distribution_recover_stalled_media_uploads(10, 900)"))).rejects.toMatchObject({ code: "42501" });
    }
    for (const [l, s] of [[0, 900], [501, 900], [10, 599], [10, 86401], [null, 900], [10, null]]) {
      const r = await rpc.rpc("distribution_recover_stalled_media_uploads", { p_limit: l, p_stall_seconds: s });
      expect((r.error as { code?: string } | null)?.code).toBe("22023");
    }
  });

  it("pending_upload 고착 → 기준 전에는 비대상, 기준 뒤 failed(UPLOAD_STALLED)·버전+1·grant consumed 유지·원본 보존, 반복 실행 0(멱등)", async () => {
    const g = await stuckPending();
    expect(await recover()).toBe(0); // 방금 소비 — 기준(600초) 전
    const before = await assetRow(g.assetId);
    await age([g.assetId], 601);
    expect(await recover()).toBe(1);
    expect(await assetRow(g.assetId)).toEqual({ status: "failed", row_version: (before?.row_version as number) + 1, failure_code: "UPLOAD_STALLED" });
    expect(await grantStatus(g.assetId)).toBe("consumed");
    expect(intakeObjects.has(pathOf(U.admin, g))).toBe(true); // Storage 삭제 없음(후속 sweep)
    expect(await recover()).toBe(0);
    expect(await completeUpload(deps(), keyOf(g))).toEqual({ status: "grant_used" });
    intakeObjects.delete(pathOf(U.admin, g));
  });

  it("비대상: ready·failed·archived·issued grant·grant 없는 자산·consumed지만 updated_at 최신(진행 중 processing)", async () => {
    const ok = await issueAndPut();
    expect((await completeUpload(deps(), keyOf(ok.g))).status).toBe("ready");
    const small = await issueAndPut(U.admin, await png(200, 200));
    expect(await completeUpload(deps(), keyOf(small.g))).toMatchObject({ status: "failed", code: "TOO_SMALL" });
    const archived = await stuckPending();
    const av = (await assetRow(archived.assetId))?.row_version as number;
    expect((await rpc.rpc("distribution_archive_media_asset", { p_actor_id: U.admin, p_asset_id: archived.assetId, p_expected_version: av })).error).toBeNull();
    const issued = await issueAndPut();
    const noGrant = (await rpc.rpc("distribution_create_media_asset", { p_actor_id: U.admin, p_source: "own_creation", p_source_note: null })).data as { id: string };
    // processing 진행 중: 소비는 오래됐지만 mark_received가 방금 updated_at을 갱신
    const live = await issueAndPut();
    expect(await completeUpload(deps(U.admin, () => interposed("distribution_complete_media_processing", { lose: true })), keyOf(live.g))).toEqual({ status: "uncertain" });
    await age([ok.g.assetId, small.g.assetId, archived.assetId, issued.g.assetId, noGrant.id], 7200);
    await owner("alter table public.distribution_media_upload_grants disable trigger distribution_media_upload_grants_guard");
    await owner("update public.distribution_media_upload_grants set consumed_at = now() - interval '7200 seconds' where asset_id = $1::uuid", [live.g.assetId]);
    await owner("alter table public.distribution_media_upload_grants enable trigger distribution_media_upload_grants_guard");
    const snap = await Promise.all([ok.g, small.g, archived, issued.g, live.g].map((x) => assetRow(x.assetId)));
    expect(await recover()).toBe(0);
    expect(await Promise.all([ok.g, small.g, archived, issued.g, live.g].map((x) => assetRow(x.assetId)))).toEqual(snap);
    expect((await assetRow(noGrant.id))?.status).toBe("pending_upload");
    expect((await assetRow(live.g.assetId))?.status).toBe("processing");
    // 진행 중이던 처리도 이후 갱신 없이 기준을 넘기면 복구 대상
    await age([live.g.assetId], 601);
    expect(await recover()).toBe(1);
    expect((await assetRow(live.g.assetId))?.failure_code).toBe("UPLOAD_STALLED");
    for (const x of [archived, issued.g, live.g]) intakeObjects.delete(pathOf(U.admin, x));
  });

  it("순서 A(복구 먼저): 늦은 complete → VERSION_CONFLICT → uncertain, ready 덮어쓰기 없음·변형 행 0·원본 보존(변형 객체는 Storage 고아)", async () => {
    const { g } = await issueAndPut();
    const late = interposed("distribution_complete_media_processing", {
      before: async () => {
        await age([g.assetId], 601);
        expect(await recover()).toBe(1);
      },
    });
    expect(await completeUpload(deps(U.admin, () => late), keyOf(g))).toEqual({ status: "uncertain" });
    expect(await assetRow(g.assetId)).toMatchObject({ status: "failed", failure_code: "UPLOAD_STALLED" });
    expect(await variantCount(g.assetId)).toBe(0);
    expect(intakeObjects.has(pathOf(U.admin, g))).toBe(true);
    expect(variants.has(`variants/${g.assetId}/feed_jpeg.jpg`)).toBe(true); // 기록 없는 변형 객체 — 후속 sweep 대상
    intakeObjects.delete(pathOf(U.admin, g));
  });

  it("순서 A(복구 먼저): 늦은 fail(M4 검사 실패·신고 불일치) → 실패 기록 못 함 → failed(asset:null), 원본 보존(삭제 오판 없음)", async () => {
    const small = await issueAndPut(U.admin, await png(200, 200));
    const lateFail = interposed("distribution_fail_media_processing", {
      before: async () => {
        await age([small.g.assetId], 601);
        expect(await recover()).toBe(1);
      },
    });
    expect(await completeUpload(deps(U.admin, () => lateFail), keyOf(small.g))).toEqual({ status: "failed", code: "TOO_SMALL", asset: null });
    expect(await assetRow(small.g.assetId)).toMatchObject({ status: "failed", failure_code: "UPLOAD_STALLED" });
    expect(intakeObjects.has(pathOf(U.admin, small.g))).toBe(true);

    const bytes = await png();
    const r = await issueUploadGrant(deps(), { source: "own_creation", contentType: "image/jpeg", byteSize: bytes.length }); // PNG를 JPEG로 신고
    if (r.status !== "issued") throw new Error("issue");
    intakeObjects.set(pathOf(U.admin, r.grant), bytes);
    const lateMismatch = interposed("distribution_fail_media_processing", {
      before: async () => {
        await age([r.grant.assetId], 601);
        expect(await recover()).toBe(1);
      },
    });
    expect(await completeUpload(deps(U.admin, () => lateMismatch), keyOf(r.grant))).toEqual({ status: "failed", code: "DECLARED_MISMATCH", asset: null });
    expect((await assetRow(r.grant.assetId))?.failure_code).toBe("UPLOAD_STALLED");
    expect(intakeObjects.has(pathOf(U.admin, r.grant))).toBe(true);
    intakeObjects.delete(pathOf(U.admin, small.g));
    intakeObjects.delete(pathOf(U.admin, r.grant));
  });

  it("순서 B(정상 먼저): ready·failed 기록 뒤 복구 → 0, 상태·버전 불변, 정상 경로의 원본 삭제는 그대로", async () => {
    const ok = await issueAndPut();
    expect((await completeUpload(deps(), keyOf(ok.g))).status).toBe("ready");
    const bad = await issueAndPut(U.admin, await png(200, 200));
    expect(await completeUpload(deps(), keyOf(bad.g))).toMatchObject({ status: "failed", code: "TOO_SMALL" });
    expect(intakeObjects.has(pathOf(U.admin, ok.g)) || intakeObjects.has(pathOf(U.admin, bad.g))).toBe(false);
    const snap = [await assetRow(ok.g.assetId), await assetRow(bad.g.assetId)];
    await age([ok.g.assetId, bad.g.assetId], 7200);
    expect(await recover()).toBe(0);
    expect([await assetRow(ok.g.assetId), await assetRow(bad.g.assetId)]).toEqual(snap);
  });

  it("대기 상한 회복: 고착 20개 → pending_limit → 복구(limit 7로 나눠 실행) → 새 발급 가능", async () => {
    const stuck: IssuedGrant[] = [];
    const shared = await png(); // 20회 sharp 생성 비용 절감(각 grant 경로는 서로 다름)
    for (let i = 0; i < 20; i++) stuck.push(await stuckPending(U.bulk, shared));
    expect(await issueUploadGrant(deps(U.bulk), { source: "own_creation", contentType: "image/png", byteSize: 100 })).toEqual({ status: "limit", reason: "pending_limit" });
    await age(stuck.map((g) => g.assetId), 601);
    expect([await recover(7), await recover(7), await recover(7), await recover(7)]).toEqual([7, 7, 6, 0]);
    expect((await issueUploadGrant(deps(U.bulk), { source: "own_creation", contentType: "image/png", byteSize: 100 })).status).toBe("issued");
    for (const g of stuck) intakeObjects.delete(pathOf(U.bulk, g));
  }, 60_000); // 20회 완료 흐름(sharp 포함) — 전체 병렬 실행 부하에서 기본 5초 초과 관찰(단독 0.4초)

  it("앱 래퍼: maxDuration 강제 근거 없으면 disabled(RPC 0회), 있으면 RPC 호출·인자 검사", async () => {
    let calls = 0;
    const counting: RpcClient = { rpc: async (f, p) => (calls++, rpc.rpc(f, p)) };
    expect(await recoverStalledUploads({ getClient: () => counting, runtimeEnforcesMaxDuration: false }, { limit: 10 })).toEqual({ status: "disabled" });
    expect(calls).toBe(0);
    expect(await recoverStalledUploads({ getClient: () => counting, runtimeEnforcesMaxDuration: true }, { limit: 10, stallSeconds: 300 })).toEqual({ status: "invalid", field: "stallSeconds" });
    expect(calls).toBe(0);
    expect(await recoverStalledUploads({ getClient: () => counting, runtimeEnforcesMaxDuration: true }, { limit: 10 })).toEqual({ status: "recovered", count: 0 });
    expect(calls).toBe(1);
  });
});
