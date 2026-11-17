/**
 * BE-REVISION-MEDIA-037 — 초안 리비전 첨부 조회·보존·소유권 → PGlite 왕복(대역 + 메모리 Storage mock + 실제 sharp).
 * `PGLITE_PROJECT`가 있을 때만 실행(평소에는 건너뜀 — 통과로 세지 않음).
 * 한계: 실제 Supabase RLS·PostgREST가 아니다. 단일 연결이라 보관과의 경합은 순서 재현일 뿐 다중 연결 동시성 검증이 아니다.
 * 계약: handoff/workspace/docs/contracts/REVISION_MEDIA_CONTRACT.md
 */
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { appendDraftRevision, createChannelDraft, createContent } from "@/server/distribution/content-service";
import { archiveAsset, createAndProcessFromBytes, type MediaAssetDto } from "@/server/distribution/media/service";
import type { MediaStorage } from "@/server/distribution/media/storage";
import { getContentDetail, type ReadSource } from "@/server/distribution/read";
import type { RpcClient } from "@/server/distribution/write-runner";
import { openDb, readSourceOf, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const U = { admin: "00000000-0000-4000-8000-00000000003a", admin2: "00000000-0000-4000-8000-00000000003b" };
let db: Db;
let rpc: RpcClient;
const objects = new Map<string, Buffer>();
const storage: MediaStorage = {
  upload: async (_b, p, bytes) => (objects.set(p, bytes), { ok: true, value: true }),
  download: async () => ({ ok: false, code: "not_found" }),
  remove: async () => ({ ok: true, value: true }),
  createSignedUrl: async () => ({ ok: false, code: "storage_error" }),
};
const as = (id: string) => async (): Promise<ActorResult> => ({ ok: true, actorId: id });
const deps = (id = U.admin) => ({ resolveActor: as(id), getClient: () => rpc, storage });
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
const img = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#3377bb" } }).png().toBuffer();
type M = { asset_id: string; variant_id: string | null; alt_text: string | null };

async function ready(id = U.admin): Promise<MediaAssetDto> {
  const out = await createAndProcessFromBytes(deps(id), { source: "own_creation", bytes: await img(1080, 1080) });
  if (out.status !== "ready" || !out.asset.variant) throw new Error(`ready ${JSON.stringify(out)}`);
  return out.asset;
}
const ref = (a: MediaAssetDto, alt: string | null = null): M => ({ asset_id: a.id, variant_id: a.variant?.id ?? null, alt_text: alt });

/** 원문 + instagram 초안. 저장 함수 rev(actor, expectedNo, preserveMedia|undefined) */
async function setup() {
  const c = await createContent(deps(), form({ title: "첨부 원문", body: "본문" }));
  if (c.status !== "ok") throw new Error("content");
  const d = await getContentDetail(readSourceOf(db, U.admin), c.data.contentId);
  if (d.status !== "ok" || !d.data?.current) throw new Error("detail");
  const versionId = d.data.current.id;
  const dr = await createChannelDraft(deps(), form({ contentId: c.data.contentId, channel: "instagram" }));
  if (dr.status !== "ok") throw new Error("draft");
  const rev = (actor: string, no: number, media: M[] | string | undefined, body = `캡션 ${no}`) =>
    appendDraftRevision(deps(actor), form({
      draftId: dr.data.draftId, expectedRevisionNo: String(no), expectedContentVersionId: versionId, body,
      ...(media === undefined ? {} : { preserveMedia: typeof media === "string" ? media : JSON.stringify(media) }),
    }));
  const detail = async (src: ReadSource = readSourceOf(db, U.admin)) => getContentDetail(src, c.data.contentId);
  const current = async () => {
    const x = await detail();
    if (x.status !== "ok" || !x.data?.drafts.instagram?.revision) throw new Error("no revision");
    return x.data.drafts.instagram.revision;
  };
  return { rev, detail, current, contentId: c.data.contentId };
}
const tokenOf = (o: Awaited<ReturnType<typeof appendDraftRevision>>) => (o.status === "db_error" ? o.error.token : o.status);

describe.skipIf(!PROJECT)("PGlite 왕복: 리비전 첨부 조회·보존·소유권(037)", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [U.admin, U.admin2], [], [U.admin, U.admin2]);
    db = opened.db;
    rpc = rpcClientOf(db, new Set(["distribution_list_media_assets"]));
  }, 120_000);

  it("비어 있지 않은 첨부 roundtrip: 2개·순서·alt 조회 → 본문만 수정(조회값 그대로 렌더)해도 첨부·순서 보존", async () => {
    const s = await setup();
    const a = await ready();
    const b = await ready();
    expect((await s.rev(U.admin, 0, [ref(b, "둘째를 먼저"), ref(a, "첫째")])).status).toBe("ok");
    const r1 = await s.current();
    expect(r1.media).toEqual([ref(b, "둘째를 먼저"), ref(a, "첫째")]);
    expect((await s.rev(U.admin, 1, r1.media, "본문만 수정")).status).toBe("ok");
    const r2 = await s.current();
    expect([r2.revisionNo, r2.body, r2.media]).toEqual([2, "본문만 수정", r1.media]);
    // 정렬 변경도 명시 입력대로
    expect((await s.rev(U.admin, 2, [r2.media[1] as M, r2.media[0] as M])).status).toBe("ok");
    expect((await s.current()).media.map((m) => m.asset_id)).toEqual([a.id, b.id]);
  });

  it("미입력은 해제가 아니다: 리비전 1 이상에서 preserveMedia 없음·빈 문자열 → invalid(RPC 0), 명시 \"[]\"만 해제", async () => {
    const s = await setup();
    const a = await ready();
    expect((await s.rev(U.admin, 0, undefined)).status).toBe("ok"); // 첫 리비전: 보존할 것이 없어 미입력 허용
    expect((await s.rev(U.admin, 1, [ref(a)])).status).toBe("ok");
    for (const missing of [undefined, ""]) {
      const out = await s.rev(U.admin, 2, missing);
      expect(out.status === "invalid" && out.errors.map((e) => e.field)).toEqual(["preserved"]);
    }
    expect((await s.current()).media).toEqual([ref(a)]); // 그대로
    expect((await s.rev(U.admin, 2, "[]")).status).toBe("ok");
    const r = await s.current();
    expect([r.revisionNo, r.media]).toEqual([3, []]);
  });

  it("조회 실패는 []가 아니다: 리비전 미디어 조회 오류·스키마 없음 → detail 전체 error/schema_missing(부분 ok 없음)", async () => {
    const s = await setup();
    const a = await ready();
    expect((await s.rev(U.admin, 0, [ref(a)])).status).toBe("ok");
    const base = readSourceOf(db, U.admin);
    const failing = (code: string): ReadSource => ({
      select: async (q) => (q.table === "distribution_draft_revision_media" ? { error: { code, message: "boom" } } : base.select(q)),
    });
    expect((await s.detail(failing("XX000"))).status).toBe("error");
    expect((await s.detail(failing("42P01"))).status).toBe("schema_missing");
    const thrown: ReadSource = { select: async (q) => { if (q.table === "distribution_draft_revision_media") throw new Error("net"); return base.select(q); } };
    expect((await s.detail(thrown)).status).toBe("error");
  });

  it("타소유자: 다른 관리자 자산 새 첨부 → MEDIA_NOT_OWNED, 다른 관리자가 본문만 고칠 때 이어받기는 허용, 이어받은 자산 변형 바꾸기는 거부", async () => {
    const s = await setup();
    const mine = await ready(U.admin);
    const theirs = await ready(U.admin2);
    expect(tokenOf(await s.rev(U.admin, 0, [ref(theirs)]))).toBe("MEDIA_NOT_OWNED");
    expect((await s.rev(U.admin, 0, [ref(mine, "관리자1 자산")])).status).toBe("ok");
    // admin2가 admin의 초안 본문만 수정: 직전 리비전 첨부 그대로 → 허용
    expect((await s.rev(U.admin2, 1, (await s.current()).media, "관리자2가 본문 수정")).status).toBe("ok");
    expect((await s.current()).media).toEqual([ref(mine, "관리자1 자산")]);
    // alt_text만 바꾼 이어받기도 같은 asset·variant라 허용(소유권 판정은 asset_id·variant_id)
    expect((await s.rev(U.admin2, 2, [ref(mine, "대체 텍스트 수정")])).status).toBe("ok");
    // admin2가 admin 자산을 직전 리비전에 없던 변형(null)으로 바꾸기 → 이어받기 아님 → 거부
    expect(tokenOf(await s.rev(U.admin2, 3, [{ asset_id: mine.id, variant_id: null, alt_text: null }]))).toBe("MEDIA_NOT_OWNED");
    // admin2가 자기 자산 추가는 허용
    expect((await s.rev(U.admin2, 3, [ref(mine, "대체 텍스트 수정"), ref(theirs)])).status).toBe("ok");
    // 한 번 해제된 타인 자산은 다시 이어받기 불가(직전 리비전 기준)
    expect((await s.rev(U.admin2, 4, [ref(theirs)])).status).toBe("ok");
    expect(tokenOf(await s.rev(U.admin2, 5, [ref(mine)]))).toBe("MEDIA_NOT_OWNED");
  });

  it("변형 불일치·보관·미준비·위조 id 거부, 중복은 서버 입력 검증과 DB 양쪽에서 거부", async () => {
    const s = await setup();
    const a = await ready();
    const other = await ready();
    expect(tokenOf(await s.rev(U.admin, 0, [{ asset_id: a.id, variant_id: other.variant?.id ?? null, alt_text: null }]))).toBe("VARIANT_MISMATCH");
    const failed = await createAndProcessFromBytes(deps(), { source: "own_creation", bytes: await img(200, 200) });
    if (failed.status !== "failed" || !failed.asset) throw new Error("failed asset");
    expect(tokenOf(await s.rev(U.admin, 0, [{ asset_id: failed.asset.id, variant_id: null, alt_text: null }]))).toBe("MEDIA_NOT_READY");
    expect(tokenOf(await s.rev(U.admin, 0, [{ asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", variant_id: null, alt_text: null }]))).toBe("MEDIA_NOT_READY");
    const arch = await ready();
    expect((await archiveAsset(deps(), { assetId: arch.id, expectedVersion: arch.rowVersion })).status).toBe("ok");
    expect(tokenOf(await s.rev(U.admin, 0, [ref(arch)]))).toBe("MEDIA_NOT_READY");
    const dup = await s.rev(U.admin, 0, [ref(a), ref(a, "중복")]);
    expect(dup.status === "invalid" && dup.errors.map((e) => e.field)).toEqual(["preserved"]);
    // 서비스 검증을 우회한 직접 RPC도 DB가 거부
    const d = await s.detail();
    if (d.status !== "ok" || !d.data?.drafts.instagram || !d.data.current) throw new Error("detail");
    const raw = await rpc.rpc("distribution_append_draft_revision", {
      p_actor_id: U.admin, p_draft_id: d.data.drafts.instagram.id, p_expected_revision_no: 0, p_expected_content_version_id: d.data.current.id,
      p_body: "x", p_link_url: null, p_utm: {}, p_target_connection_id: null, p_target_external_account_id: null, p_validation: {}, p_media: [ref(a), ref(a)],
    });
    expect((raw.error as { message?: string } | null)?.message ?? "").toMatch(/^MEDIA_DUPLICATE:/);
    expect((await s.detail()).status).toBe("ok");
    const after = await s.detail();
    expect(after.status === "ok" && after.data?.drafts.instagram?.currentRevisionNo).toBe(0); // 원자적: 리비전도 생기지 않음
  });

  it("권리 정책: 권리 미승인(unreviewed) ready 자산 첨부 허용 — 게시 전 권리 검증은 별도(서명 단계)", async () => {
    const s = await setup();
    const a = await ready();
    expect(a.rightsState).toBe("unreviewed");
    expect((await s.rev(U.admin, 0, [ref(a)])).status).toBe("ok");
  });

  it("버전 충돌: 렌더된 리비전 번호가 낡으면 conflict_revision — 다른 사람이 바꾼 첨부를 덮어쓰지 않음", async () => {
    const s = await setup();
    const a = await ready();
    const b = await ready();
    expect((await s.rev(U.admin, 0, [ref(a)])).status).toBe("ok");
    const rendered = (await s.current()).media;
    expect((await s.rev(U.admin, 1, [ref(b)])).status).toBe("ok"); // 다른 탭에서 교체
    const late = await s.rev(U.admin, 1, rendered, "늦은 본문 저장");
    expect(late.status === "db_error" && late.error.code).toBe("conflict_revision");
    expect((await s.current()).media).toEqual([ref(b)]);
  });

  it("보관 경합 순서: 보관 먼저 → 첨부 MEDIA_NOT_READY, 첨부 먼저 → 보관 ASSET_REFERENCED", async () => {
    const s = await setup();
    const x = await ready();
    expect((await archiveAsset(deps(), { assetId: x.id, expectedVersion: x.rowVersion })).status).toBe("ok");
    expect(tokenOf(await s.rev(U.admin, 0, [ref(x)]))).toBe("MEDIA_NOT_READY");
    const y = await ready();
    expect((await s.rev(U.admin, 0, [ref(y)])).status).toBe("ok");
    const arch = await archiveAsset(deps(), { assetId: y.id, expectedVersion: y.rowVersion });
    expect(arch.status === "db_error" && arch.error.token).toBe("ASSET_REFERENCED");
  });
});
