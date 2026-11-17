/**
 * QA-REVISION-MEDIA-040 — 리비전 첨부 소유권·보존 예외·원자 롤백·입력 구별 독립 검증(Tester, CC-TESTER-01).
 * Backend037 시험(revision-media.pglite.test.ts)과 같은 단언을 되풀이하지 않고, 위협모델의 다른 경로를 본다:
 *   다른 초안·두 리비전 전 이어받기, 폼 actor 변조, null 변형 이어받기 후 변형 바꾸기, 혼합 목록 롤백의 DB 행 단위 확인,
 *   낡은 expectedRevisionNo=0 + 미입력의 소실 방지, 형식 경계, 조회 응답 이상, 권리 거절 자산 정책.
 * 공격 fixture는 정식 RPC/서비스로만 만든다(trigger·제약 비활성화 없음). `PGLITE_PROJECT`가 있을 때만 실행(skip은 통과 아님).
 * 한계: 실제 Supabase RLS·PostgREST가 아니다. 단일 연결이라 잠금·경합은 순서 재현일 뿐 다중 연결 동시성 검증이 아니다.
 * 계약: handoff/workspace/docs/contracts/REVISION_MEDIA_CONTRACT.md
 */
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { ActorResult } from "@/server/distribution/actor-core";
import { appendDraftRevision, createChannelDraft, createContent } from "@/server/distribution/content-service";
import { createAndProcessFromBytes, decideRights, type MediaAssetDto } from "@/server/distribution/media/service";
import type { MediaStorage } from "@/server/distribution/media/storage";
import { getContentDetail, type ReadSource } from "@/server/distribution/read";
import type { RpcClient } from "@/server/distribution/write-runner";
import { openDb, readSourceOf, rpcClientOf, type Db } from "./pglite-harness";

const PROJECT = process.env.PGLITE_PROJECT;
const A = "00000000-0000-4000-8000-0000000040a1"; // 승인 admin A
const B = "00000000-0000-4000-8000-0000000040b2"; // 승인 admin B
let db: Db;
let rpc: RpcClient;
const storage: MediaStorage = {
  upload: async () => ({ ok: true, value: true }),
  download: async () => ({ ok: false, code: "not_found" }),
  remove: async () => ({ ok: true, value: true }),
  createSignedUrl: async () => ({ ok: false, code: "storage_error" }),
};
const deps = (id: string) => ({ resolveActor: async (): Promise<ActorResult> => ({ ok: true, actorId: id }), getClient: () => rpc, storage });
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
type M = { asset_id: string; variant_id: string | null; alt_text: string | null };
type Outcome = Awaited<ReturnType<typeof appendDraftRevision>>;

async function ready(owner: string): Promise<MediaAssetDto> {
  const bytes = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#22aa66" } }).png().toBuffer();
  const out = await createAndProcessFromBytes(deps(owner), { source: "own_creation", bytes });
  if (out.status !== "ready" || !out.asset.variant) throw new Error(`ready 실패 ${out.status}`);
  return out.asset;
}
const ref = (a: MediaAssetDto, alt: string | null = null): M => ({ asset_id: a.id, variant_id: a.variant?.id ?? null, alt_text: alt });
const noVariant = (a: MediaAssetDto, alt: string | null = null): M => ({ asset_id: a.id, variant_id: null, alt_text: alt });
const tokenOf = (o: Outcome) => (o.status === "db_error" ? o.error.token : o.status);
const fieldsOf = (o: Outcome) => (o.status === "invalid" ? o.errors.map((e) => e.field) : o.status);

/** 원문 + instagram 초안 하나. owner가 원문·초안을 만든다. */
async function draft(owner = A) {
  const c = await createContent(deps(owner), form({ title: "보안 시험 원문", body: "본문" }));
  if (c.status !== "ok") throw new Error("content");
  const d0 = await getContentDetail(readSourceOf(db, owner), c.data.contentId);
  if (d0.status !== "ok" || !d0.data?.current) throw new Error("detail");
  const versionId = d0.data.current.id;
  const dr = await createChannelDraft(deps(owner), form({ contentId: c.data.contentId, channel: "instagram" }));
  if (dr.status !== "ok") throw new Error("draft");
  const draftId = dr.data.draftId;
  const save = (actor: string, expectedNo: number, media: M[] | string | undefined, extra: Record<string, string> = {}) =>
    appendDraftRevision(deps(actor), form({
      draftId, expectedRevisionNo: String(expectedNo), expectedContentVersionId: versionId, body: `캡션 ${expectedNo + 1}`, ...extra,
      ...(media === undefined ? {} : { preserveMedia: typeof media === "string" ? media : JSON.stringify(media) }),
    }));
  const current = async () => {
    const x = await getContentDetail(readSourceOf(db, A), c.data.contentId);
    if (x.status !== "ok") throw new Error(`detail ${x.status}`);
    const d = x.data?.drafts.instagram;
    if (!d) throw new Error("no draft");
    return { no: d.currentRevisionNo, media: d.revision?.media ?? null };
  };
  /** DB 직접 계수(롤백 확인): 이 초안의 리비전 수·첨부 행 수·현재 번호 */
  const counts = async () => {
    const r = await db.query(
      `select (select count(*)::int from public.distribution_draft_revisions where draft_id = $1) as revs,
              (select count(*)::int from public.distribution_draft_revision_media m join public.distribution_draft_revisions r on r.id = m.revision_id where r.draft_id = $1) as media,
              (select current_revision_no from public.distribution_channel_drafts where id = $1) as cur`,
      [draftId],
    );
    return r.rows[0];
  };
  const createdBy = async (no: number) =>
    (await db.query(`select created_by from public.distribution_draft_revisions where draft_id = $1 and revision_no = $2`, [draftId, no])).rows[0]?.created_by;
  return { save, current, counts, createdBy, contentId: c.data.contentId, draftId, versionId };
}

describe.skipIf(!PROJECT)("QA-040 리비전 첨부 보안(PGlite)", () => {
  beforeAll(async () => {
    const opened = await openDb(PROJECT as string, [A, B], [], [A, B]);
    db = opened.db;
    rpc = rpcClientOf(db, new Set(["distribution_list_media_assets"]));
  }, 120_000);

  // ------------------------------------------------------------ 1. 소유 검증 우회 시도
  describe("1. A는 B 자산으로 소유 검증을 우회할 수 없다", () => {
    it("다른 초안 이어받기 불가: B가 자기 초안에 첨부한 자산을 A가 다른 초안 첫·후속 리비전에 첨부 → MEDIA_NOT_OWNED, 아무것도 저장 안 됨", async () => {
      const bAsset = await ready(B);
      const bDraft = await draft(B);
      expect((await bDraft.save(B, 0, [ref(bAsset)])).status).toBe("ok");

      const aDraft = await draft(A);
      const before = await aDraft.counts();
      expect(tokenOf(await aDraft.save(A, 0, [ref(bAsset)]))).toBe("MEDIA_NOT_OWNED");
      expect(await aDraft.counts()).toEqual(before);
      expect((await aDraft.save(A, 0, "[]")).status).toBe("ok");
      expect(tokenOf(await aDraft.save(A, 1, [ref(bAsset)]))).toBe("MEDIA_NOT_OWNED");
      expect(await aDraft.current()).toEqual({ no: 1, media: [] });
    });

    it("두 리비전 전 참조 불가: rev1 B 자산 → rev2 A가 자기 자산으로 교체 → rev3 A가 B 자산 다시 추가 → MEDIA_NOT_OWNED(직전 리비전만 예외)", async () => {
      const bAsset = await ready(B);
      const aAsset = await ready(A);
      const d = await draft(B);
      expect((await d.save(B, 0, [ref(bAsset)])).status).toBe("ok");
      expect((await d.save(A, 1, [ref(aAsset)])).status).toBe("ok");
      expect(tokenOf(await d.save(A, 2, [ref(aAsset), ref(bAsset)]))).toBe("MEDIA_NOT_OWNED");
      expect(await d.current()).toEqual({ no: 2, media: [ref(aAsset)] });
    });

    it("폼 actor 변조 무시: A 세션이 폼에 actorId·p_actor_id·created_by=B를 넣어도 B 자산 첨부 거부, 저장된 created_by는 세션 actor", async () => {
      const bAsset = await ready(B);
      const aAsset = await ready(A);
      const d = await draft(A);
      const forged = { actorId: B, p_actor_id: B, created_by: B };
      expect(tokenOf(await d.save(A, 0, [ref(bAsset)], forged))).toBe("MEDIA_NOT_OWNED");
      expect((await d.save(A, 0, [ref(aAsset)], forged)).status).toBe("ok");
      expect(await d.createdBy(1)).toBe(A);
    });

    it("원소에 owner_id 등 추가 키를 넣어도 소유 판정은 DB 자산 소유자 기준(추가 키는 서버 입력 단계에서 버려짐)", async () => {
      const bAsset = await ready(B);
      const d = await draft(A);
      const out = await d.save(A, 0, JSON.stringify([{ ...ref(bAsset), owner_id: A, created_by: A }]));
      expect(tokenOf(out)).toBe("MEDIA_NOT_OWNED");
    });
  });

  // ------------------------------------------------------------ 2. 같은 초안 직전 리비전 예외의 경계
  describe("2. 이어받기 예외는 같은 초안 직전 리비전의 같은 asset·variant만", () => {
    it("null 변형 이어받기: A가 변형 없이 첨부 → B 본문 수정(null 그대로) 허용 → B가 실제 변형으로 바꾸면 거부", async () => {
      const aAsset = await ready(A);
      const d = await draft(A);
      expect((await d.save(A, 0, [noVariant(aAsset, "변형 없음")])).status).toBe("ok");
      expect((await d.save(B, 1, [noVariant(aAsset, "변형 없음")])).status).toBe("ok");
      expect(tokenOf(await d.save(B, 2, [ref(aAsset)]))).toBe("MEDIA_NOT_OWNED");
      expect(await d.current()).toEqual({ no: 2, media: [noVariant(aAsset, "변형 없음")] });
    });

    it("명시 해제 직후 B가 A 자산 재추가(같은 변형·다른 변형 모두) → 거부, A 본인은 재추가 가능", async () => {
      const aAsset = await ready(A);
      const d = await draft(A);
      expect((await d.save(A, 0, [ref(aAsset)])).status).toBe("ok");
      expect((await d.save(B, 1, "[]")).status).toBe("ok");
      expect(tokenOf(await d.save(B, 2, [ref(aAsset)]))).toBe("MEDIA_NOT_OWNED");
      expect(tokenOf(await d.save(B, 2, [noVariant(aAsset)]))).toBe("MEDIA_NOT_OWNED");
      expect(await d.current()).toEqual({ no: 2, media: [] });
      expect((await d.save(A, 2, [ref(aAsset)])).status).toBe("ok");
    });

    it("이어받은 A 자산과 B 자기 자산 혼합·순서 변경은 허용(position·alt는 판정에 쓰지 않음)", async () => {
      const aAsset = await ready(A);
      const bAsset = await ready(B);
      const d = await draft(A);
      expect((await d.save(A, 0, [ref(aAsset, "A")])).status).toBe("ok");
      expect((await d.save(B, 1, [ref(bAsset, "B 먼저"), ref(aAsset, "A 뒤로")])).status).toBe("ok");
      expect((await d.current()).media).toEqual([ref(bAsset, "B 먼저"), ref(aAsset, "A 뒤로")]);
    });
  });

  // ------------------------------------------------------------ 3. 원자 롤백
  describe("3. 한 원소라도 거부되면 새 리비전·현재 번호·첨부 목록 전체가 롤백", () => {
    it("자기 자산 2개 뒤에 타인 자산 1개(마지막 원소만 위반) → MEDIA_NOT_OWNED, DB 행 수·현재 번호·조회 첨부 불변", async () => {
      const a1 = await ready(A);
      const a2 = await ready(A);
      const a3 = await ready(A);
      const bAsset = await ready(B);
      const d = await draft(A);
      expect((await d.save(A, 0, [ref(a3)])).status).toBe("ok");
      const before = await d.counts();
      const shown = await d.current();
      expect(tokenOf(await d.save(A, 1, [ref(a1), ref(a2), ref(bAsset)]))).toBe("MEDIA_NOT_OWNED");
      expect(await d.counts()).toEqual(before);
      expect(await d.current()).toEqual(shown);
    });

    it("소유 자산 + 다른 자산의 변형 혼합(뒤 원소 VARIANT_MISMATCH) → 전체 롤백", async () => {
      const a1 = await ready(A);
      const a2 = await ready(A);
      const d = await draft(A);
      const before = await d.counts();
      const out = await d.save(A, 0, [ref(a1), { asset_id: a2.id, variant_id: a1.variant?.id ?? null, alt_text: null }]);
      expect(tokenOf(out)).toBe("VARIANT_MISMATCH");
      expect(await d.counts()).toEqual(before);
    });

    it("직접 RPC로 [자기 자산, 타인 자산]을 보내도 DB가 거부하고 리비전이 남지 않음(서비스 검증 우회 대비)", async () => {
      const a1 = await ready(A);
      const bAsset = await ready(B);
      const d = await draft(A);
      const before = await d.counts();
      const raw = await rpc.rpc("distribution_append_draft_revision", {
        p_actor_id: A, p_draft_id: d.draftId, p_expected_revision_no: 0, p_expected_content_version_id: d.versionId,
        p_body: "x", p_link_url: null, p_utm: {}, p_target_connection_id: null, p_target_external_account_id: null, p_validation: {},
        p_media: [ref(a1), ref(bAsset)],
      });
      expect((raw.error as { message?: string } | null)?.message ?? "").toMatch(/^MEDIA_NOT_OWNED:/);
      expect(await d.counts()).toEqual(before);
    });
  });

  // ------------------------------------------------------------ 4. 입력 구별·소실 방지
  describe("4. 미입력·빈 문자열·명시 []와 형식 경계", () => {
    it("첫 리비전: 미입력·빈 문자열·\"[]\" 모두 첨부 없음으로 저장", async () => {
      for (const v of [undefined, "", "[]"]) {
        const d = await draft(A);
        expect((await d.save(A, 0, v)).status).toBe("ok");
        expect(await d.current()).toEqual({ no: 1, media: [] });
      }
    });

    it("소실 방지: 첨부가 있는 rev1인데 낡은 expectedRevisionNo=0 + 미입력으로 저장 → conflict_revision, 첨부 보존", async () => {
      const aAsset = await ready(A);
      const d = await draft(A);
      expect((await d.save(A, 0, [ref(aAsset)])).status).toBe("ok");
      const before = await d.counts();
      const out = await d.save(A, 0, undefined);
      expect(out.status === "db_error" && out.error.code).toBe("conflict_revision");
      expect(await d.counts()).toEqual(before);
      expect((await d.current()).media).toEqual([ref(aAsset)]);
    });

    for (const [name, value] of [
      ["공백 문자열", " "],
      ["JSON null", "null"],
      ["JSON 객체", "{}"],
      ["원소가 문자열", JSON.stringify(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"])],
      ["asset_id가 uuid 아님", JSON.stringify([{ asset_id: "not-uuid", variant_id: null, alt_text: null }])],
      ["alt_text 1001자", JSON.stringify([{ asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", variant_id: null, alt_text: "가".repeat(1001) }])],
    ] as const) {
      it(`후속 리비전 형식 오류(${name}) → invalid(preserved), 리비전·첨부 불변`, async () => {
        const aAsset = await ready(A);
        const d = await draft(A);
        expect((await d.save(A, 0, [ref(aAsset)])).status).toBe("ok");
        const before = await d.counts();
        expect(fieldsOf(await d.save(A, 1, value))).toEqual(["preserved"]);
        expect(await d.counts()).toEqual(before);
      });
    }

    it("21개는 invalid, 20개 경계는 서버 입력 단계를 통과(이후 DB 판정)", async () => {
      const d = await draft(A);
      const fake = (i: number): M => ({ asset_id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`, variant_id: null, alt_text: null });
      expect(fieldsOf(await d.save(A, 0, Array.from({ length: 21 }, (_, i) => fake(i))))).toEqual(["preserved"]);
      // 20개는 형식상 통과 → 존재하지 않는 자산이므로 DB가 MEDIA_NOT_READY로 거부(입력 단계 invalid가 아님)
      expect(tokenOf(await d.save(A, 0, Array.from({ length: 20 }, (_, i) => fake(i))))).toBe("MEDIA_NOT_READY");
      expect((await d.counts())?.revs).toBe(0);
    });

    it("조회 응답 이상: 첨부 조회가 rows 없는 응답을 주면 detail 전체 error(빈 배열 ok로 덮지 않음)", async () => {
      const aAsset = await ready(A);
      const d = await draft(A);
      expect((await d.save(A, 0, [ref(aAsset)])).status).toBe("ok");
      const base = readSourceOf(db, A);
      const broken: ReadSource = {
        select: async (q) => (q.table === "distribution_draft_revision_media" ? ({ rows: null } as unknown as { rows: Record<string, unknown>[] }) : base.select(q)),
      };
      const out = await getContentDetail(broken, d.contentId);
      expect(out.status).toBe("error");
    });
  });

  // ------------------------------------------------------------ 5. 권리 정책
  describe("5. 권리·상태 정책", () => {
    it("권리 거절(rejected) ready 자산도 첨부는 허용(게시 직전 서명 단계에서 검사 — 기존 정책)", async () => {
      const aAsset = await ready(A);
      const decided = await decideRights({ resolveActor: deps(A).resolveActor, getClient: () => rpc }, { assetId: aAsset.id, expectedVersion: aAsset.rowVersion, decision: "rejected" });
      expect(decided.status).toBe("ok");
      if (decided.status !== "ok") return;
      expect(decided.asset.rightsState).toBe("rejected");
      const d = await draft(A);
      expect((await d.save(A, 0, [ref(decided.asset)])).status).toBe("ok");
    });
  });
});
