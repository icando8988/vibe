/**
 * FE-REVISION-MEDIA-038 — 초안 저장 action의 첨부 거절 세부 사유 전달(REVISION_MEDIA_CONTRACT §3·§4). 서비스는 대역.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock("@/server/distribution/actor", () => ({ requireDistributionActor: async () => ({ ok: true }) }));
vi.mock("@/server/distribution/blog/service", () => ({ getServiceRpcClient: () => null }));
const outcome: { value: unknown } = { value: null };
vi.mock("@/server/distribution/content-service", () => ({
  appendDraftRevision: async () => outcome.value,
  appendContentVersion: async () => null,
  createChannelDraft: async () => null,
  createContent: async () => null,
}));

const { appendDraftRevisionAction } = await import("@/app/admin/distribution/contents/actions");
const { MEDIA_REASON_FIELD_LABELS } = await import("@/components/distribution-console/media-labels");
const PREV = { notice: null, fields: [], seq: 0 };

beforeEach(() => {
  outcome.value = null;
});

describe("appendDraftRevisionAction 첨부 거절 사유", () => {
  for (const [token, reason] of [["MEDIA_NOT_OWNED", "media_not_owned"], ["MEDIA_DUPLICATE", "media_duplicate"], ["MEDIA_NOT_READY", "media_not_ready"], ["VARIANT_MISMATCH", "variant_mismatch"]] as const) {
    it(`${token} → invalid 안내 + reason:${reason} 필드, 라벨 있음`, async () => {
      outcome.value = { status: "db_error", error: { code: "invalid_input", token, sqlstate: "23514" } };
      const st = await appendDraftRevisionAction(PREV, new FormData());
      expect(st.notice).toBe("invalid");
      expect(st.fields).toContain(`reason:${reason}`);
      expect(MEDIA_REASON_FIELD_LABELS[`reason:${reason}`]).toBeTruthy();
      expect(st.seq).toBe(1);
    });
  }
  it("버전 충돌·형식 오류는 사유 필드를 붙이지 않음(기존 안내 그대로)", async () => {
    outcome.value = { status: "db_error", error: { code: "conflict", token: "REVISION_CONFLICT", sqlstate: "40001" } };
    const st = await appendDraftRevisionAction(PREV, new FormData());
    expect(st.fields.some((f) => f.startsWith("reason:"))).toBe(false);
    outcome.value = { status: "invalid", errors: [{ field: "preserved", rule: "format" }] };
    const inv = await appendDraftRevisionAction(PREV, new FormData());
    expect(inv.notice).toBe("invalid");
    expect(inv.fields).toEqual(["preserved"]);
  });
});
