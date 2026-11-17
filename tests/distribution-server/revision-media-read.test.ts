/**
 * BE-REVISION-MEDIA-HARDEN-041 — 현재 리비전 첨부 조회 fail-closed(대역 ReadSource + PGlite 실제 행).
 * 이상 media 행은 부분 성공·빈 배열 성공이 아니라 detail 전체 error. nullable variant_id·alt_text는 유효.
 * PGlite 부분은 `PGLITE_PROJECT`가 있을 때만(건너뜀은 통과로 세지 않음). 실제 Supabase RLS·PostgREST가 아니다.
 */
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { appendDraftRevision, createChannelDraft, createContent } from "@/server/distribution/content-service";
import { createAndProcessFromBytes } from "@/server/distribution/media/service";
import type { MediaStorage } from "@/server/distribution/media/storage";
import { getContentDetail, revisionMediaOf, type Query, type ReadSource } from "@/server/distribution/read";
import type { RpcClient } from "@/server/distribution/write-runner";
import { openDb, readSourceOf, rpcClientOf, type Db } from "./pglite-harness";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const B = "44444444-4444-4444-8444-444444444444";
const row = (o: Record<string, unknown> = {}) => ({ revision_id: R1, position: 1, asset_id: A, variant_id: B, alt_text: "대체", ...o });

describe("revisionMediaOf — 이상 행 fail-closed", () => {
  it("정상: 순서 보존, nullable variant_id·alt_text는 실제 null 허용, 다른 요청 리비전 행은 건너뜀, 빈 목록은 []", () => {
    const rows = [row(), row({ revision_id: R2, position: 1, asset_id: B }), row({ position: 2, asset_id: B, variant_id: null, alt_text: null }), row({ position: 5, asset_id: R2, variant_id: null, alt_text: "x" })];
    expect(revisionMediaOf(rows, R1, [R1, R2])).toEqual([
      { asset_id: A, variant_id: B, alt_text: "대체" },
      { asset_id: B, variant_id: null, alt_text: null },
      { asset_id: R2, variant_id: null, alt_text: "x" },
    ]);
    expect(revisionMediaOf([], R1, [R1])).toEqual([]);
  });
  it("042: 명시 선택한 nullable 열의 키 누락(undefined)은 SQL NULL이 아니라 이상 행 → throw", () => {
    const without = (k: string) => {
      const r: Record<string, unknown> = row();
      delete r[k];
      return r;
    };
    for (const r of [without("variant_id"), without("alt_text"), row({ variant_id: undefined }), row({ alt_text: undefined })]) {
      expect(() => revisionMediaOf([r], R1, [R1])).toThrow();
    }
    // 행 필드 검사는 그 행의 리비전을 매핑할 때 한다. getContentDetail은 모든 현재 리비전을 매핑하므로 결과는 detail 전체 error(아래 PGlite).
    expect(() => revisionMediaOf([without("alt_text")], R1, [R1, R2])).toThrow();
  });
  it("이상 행은 걸러 내지 않고 throw(ReadFailure): asset_id·revision_id·position·variant_id·alt_text", () => {
    const bad: Array<Record<string, unknown>> = [
      row({ asset_id: null }), row({ asset_id: 7 }), row({ asset_id: "not-a-uuid" }),
      row({ revision_id: null }), row({ revision_id: "99999999-9999-4999-8999-999999999999" }), // 요청하지 않은 리비전
      row({ position: 0 }), row({ position: 1.5 }), row({ position: "1" }), row({ position: null }),
      row({ variant_id: "x" }), row({ variant_id: 3 }), row({ alt_text: 3 }), row({ alt_text: {} }),
    ];
    for (const b of bad) expect(() => revisionMediaOf([b], R1, [R1])).toThrow();
    expect(() => revisionMediaOf([row(), row({ asset_id: B })], R1, [R1])).toThrow(); // position 중복
    expect(() => revisionMediaOf([row({ position: 2 }), row({ position: 1, asset_id: B })], R1, [R1])).toThrow(); // 역순
  });
});

// ---------------------------------------------------------------- PGlite: 실제 행을 읽은 뒤 대역이 한 행을 변조
const PROJECT = process.env.PGLITE_PROJECT;
const U = "00000000-0000-4000-8000-00000000004a";
let db: Db;
let rpc: RpcClient;
const storage: MediaStorage = {
  upload: async () => ({ ok: true, value: true }),
  download: async () => ({ ok: false, code: "not_found" }),
  remove: async () => ({ ok: true, value: true }),
  createSignedUrl: async () => ({ ok: false, code: "storage_error" }),
};
const deps = { resolveActor: async (): Promise<ActorResult> => ({ ok: true, actorId: U }), getClient: () => rpc, storage };
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
const tamper = (base: ReadSource, edit: (rows: Record<string, unknown>[]) => Record<string, unknown>[]): ReadSource => ({
  select: async (q: Query) => {
    const r = await base.select(q);
    return q.table === "distribution_draft_revision_media" && "rows" in r ? { rows: edit(r.rows.map((x) => ({ ...x }))) } : r;
  },
});

describe.skipIf(!PROJECT)("PGlite: 실제 첨부 행 조회 + 이상 행 fail-closed(041)", () => {
  let contentId = "";
  beforeAll(async () => {
    db = (await openDb(PROJECT as string, [U], [], [U])).db;
    rpc = rpcClientOf(db, new Set(["distribution_list_media_assets"]));
    const asset = async () => {
      const out = await createAndProcessFromBytes(deps, { source: "own_creation", bytes: await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#225588" } }).png().toBuffer() });
      if (out.status !== "ready" || !out.asset.variant) throw new Error("ready");
      return out.asset;
    };
    const a = await asset();
    const b = await asset();
    const c = await createContent(deps, form({ title: "읽기", body: "본문" }));
    if (c.status !== "ok") throw new Error("content");
    contentId = c.data.contentId;
    const d = await getContentDetail(readSourceOf(db, U), contentId);
    if (d.status !== "ok" || !d.data?.current) throw new Error("detail");
    const dr = await createChannelDraft(deps, form({ contentId, channel: "instagram" }));
    if (dr.status !== "ok") throw new Error("draft");
    const media = [{ asset_id: a.id, variant_id: a.variant?.id, alt_text: "첫째" }, { asset_id: b.id, variant_id: null, alt_text: null }];
    const saved = await appendDraftRevision(deps, form({ draftId: dr.data.draftId, expectedRevisionNo: "0", expectedContentVersionId: d.data.current.id, body: "캡션", preserveMedia: JSON.stringify(media) }));
    if (saved.status !== "ok") throw new Error(`rev ${JSON.stringify(saved)}`);
  }, 120_000);

  it("정상 조회: 2개·순서·nullable 보존(변조 없음)", async () => {
    const d = await getContentDetail(readSourceOf(db, U), contentId);
    expect(d.status).toBe("ok");
    const m = d.status === "ok" ? d.data?.drafts.instagram?.revision?.media ?? [] : [];
    expect(m.map((x) => [x.alt_text, x.variant_id === null])).toEqual([["첫째", false], [null, true]]);
  });

  it("이상 행 1개(asset_id null·position 중복·variant 형식·남의 리비전) → detail 전체 error(부분·빈 배열 ok 아님)", async () => {
    const base = readSourceOf(db, U);
    const edits: Array<(r: Record<string, unknown>[]) => Record<string, unknown>[]> = [
      (r) => (r[1] && (r[1].asset_id = null), r),
      (r) => (r[1] && (r[1].position = r[0]?.position), r),
      (r) => (r[0] && (r[0].variant_id = "bad"), r),
      (r) => [...r, { ...r[0], revision_id: "99999999-9999-4999-8999-999999999999", position: 9 }],
      (r) => (r[1] && delete r[1].variant_id, r), // 042: SQL NULL인 열의 키 누락
      (r) => (r[1] && delete r[1].alt_text, r),
    ];
    for (const e of edits) expect((await getContentDetail(tamper(base, e), contentId)).status).toBe("error");
    // 행이 모두 사라진 응답은 "첨부 없음"과 구별할 수 없으므로 ok·[] (조회 계층이 아닌 RLS/DB 보장 범위 — 결과에 한계로 기록)
    const empty = await getContentDetail(tamper(base, () => []), contentId);
    expect(empty.status === "ok" && empty.data?.drafts.instagram?.revision?.media).toEqual([]);
  });
});
