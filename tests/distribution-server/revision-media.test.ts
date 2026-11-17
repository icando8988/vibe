/**
 * BE-REVISION-MEDIA-037 — preserveMedia 입력 계약(mock RPC). 계약: handoff/workspace/docs/contracts/REVISION_MEDIA_CONTRACT.md §2
 */
import { describe, expect, it } from "vitest";
import { appendDraftRevision, parsePreserved } from "@/server/distribution/content-service";
import type { RpcClient } from "@/server/distribution/write-runner";

const D = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const B = "44444444-4444-4444-8444-444444444444";
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
const allowed = async () => ({ ok: true as const, actorId: "55555555-5555-4555-8555-555555555555" });
function client() {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const c: RpcClient = { rpc: async (fn, p) => (calls.push([fn, p]), { data: null, error: { code: "XX000", message: "stop" } }) };
  return { c, calls };
}
const save = (c: RpcClient, no: string, extra: Record<string, string>) =>
  appendDraftRevision({ resolveActor: allowed, getClient: () => c }, form({ draftId: D, expectedRevisionNo: no, expectedContentVersionId: V, body: "본문", ...extra }));

describe("preserveMedia 입력 계약(037)", () => {
  it("리비전 ≥1: 미입력·빈 문자열은 invalid(preserved), RPC 0회 — 해제로 해석하지 않음", async () => {
    for (const extra of [{}, { preserveMedia: "" }] as Array<Record<string, string>>) {
      const { c, calls } = client();
      const out = await save(c, "1", extra);
      expect(out.status === "invalid" && out.errors.map((e) => e.field)).toEqual(["preserved"]);
      expect(calls).toEqual([]);
    }
  });
  it("첫 리비전(0)은 미입력 허용 → p_media [], 명시 \"[]\"는 어느 번호에서나 해제로 전달", async () => {
    const first = client();
    await save(first.c, "0", {});
    expect(first.calls[0]?.[1].p_media).toEqual([]);
    const clear = client();
    await save(clear.c, "3", { preserveMedia: "[]" });
    expect(clear.calls[0]?.[1].p_media).toEqual([]);
  });
  it("목록은 순서·variant·alt 그대로 전달, 같은 asset_id 중복은 invalid", async () => {
    const media = [{ asset_id: B, variant_id: null, alt_text: "둘째" }, { asset_id: A, variant_id: A, alt_text: null }];
    const ok = client();
    await save(ok.c, "2", { preserveMedia: JSON.stringify(media) });
    expect(ok.calls[0]?.[1].p_media).toEqual(media);
    expect(parsePreserved(form({ preserveMedia: JSON.stringify([media[1], { ...media[1], alt_text: "x" }]) })).ok).toBe(false);
    expect(parsePreserved(form({}), { requireMedia: true }).ok).toBe(false);
    expect(parsePreserved(form({})).ok).toBe(true); // 기존 호출 후방호환(requireMedia 미지정)
  });
});
