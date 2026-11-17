/**
 * FE-REVISION-MEDIA-038 — 채널 초안 페이지 배선: 서버 렌더 문자열 + 서버 parsePreserved 대조(브라우저 실측 아님).
 * 실제 DB roundtrip(DTO toRevision media 보존)은 Backend037 소관 — 여기서는 렌더된 입력이 서버 파서를 그대로 통과하는지와
 * 다시 불러온 첨부가 화면에 유지 선택으로 나오는지를 본다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAssetDto } from "@/server/distribution/media/service";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/admin/distribution/contents" }));
vi.mock("@/components/distribution-console/guard", () => ({ denyUnlessDistributionAdmin: async () => null }));
const state: { detail: unknown; media: unknown } = { detail: null, media: null };
const mediaLoads = vi.fn();
vi.mock("@/server/distribution/content-page", () => ({ isWriteConfigured: () => true, loadContentDetail: async () => state.detail }));
vi.mock("@/app/admin/distribution/media/load", () => ({
  loadMediaList: async () => {
    mediaLoads();
    return state.media;
  },
}));
vi.mock("@/app/admin/distribution/contents/actions", () => ({ appendDraftRevisionAction: async () => ({}), createChannelDraftAction: async () => ({}) }));

const Page = (await import("@/app/admin/distribution/contents/[contentId]/channels/[channel]/page")).default;
const { parsePreserved } = await import("@/server/distribution/content-service");

const CID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const DID = "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e";
const VID = "2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d2d";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VA = "11111111-1111-4111-8111-111111111111";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VB = "22222222-2222-4222-8222-222222222222";

const asset = (id: string, variantId: string, o: Partial<MediaAssetDto> = {}): MediaAssetDto => ({
  id, status: "ready", source: "own_creation", sourceNote: null, originalFormat: "png", originalByteSize: 1, originalWidth: 1200, originalHeight: 1000,
  failureCode: null, rightsState: "unreviewed", allowedChannels: null, rightsValidUntil: null, archivedAt: null, rowVersion: 2,
  variant: { id: variantId, kind: "feed_jpeg", byteSize: 300_000, width: 1200, height: 1000, sha256: "d".repeat(64) },
  ...o,
});
type Media = Array<{ asset_id: string; variant_id: string | null; alt_text: string | null }>;
function detailWith(channel: "instagram" | "threads" | "blog", media: Media) {
  const version = { id: VID, versionNo: 3, title: "제목", body: "원문", targetPath: null, contentHash: "h", changeSummary: null, createdAt: "2026-11-17T00:00:00Z" };
  return {
    status: "ok",
    data: {
      id: CID, archived: false, currentVersionNo: 3, current: version, versions: [version], contentApproval: { state: "none" },
      drafts: {
        [channel]: {
          id: DID, channel, archived: false, currentRevisionNo: 2, basedOnLatest: true, approval: { state: "none" },
          revision: { id: "r", revisionNo: 2, contentVersionId: VID, body: "캡션 본문", linkUrl: null, revisionHash: "x", createdAt: "2026-11-17T00:00:00Z", utm: { utm_source: "ig" }, targetConnectionId: null, targetExternalAccountId: null, media },
        },
      },
    },
  };
}
async function render(channel: string) {
  const el = (await Page({ params: Promise.resolve({ contentId: CID, channel }), searchParams: Promise.resolve({}) })) as ReactElement;
  return renderToStaticMarkup(el);
}
const decode = (v: string) => v.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
function hiddenAll(out: string, name: string): string[] {
  return [...out.matchAll(new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"`, "g"))].map((m) => decode(m[1]!));
}
/** 렌더된 hidden 입력으로 서버 FormData를 만든다(사용자가 손대지 않은 제출). */
function formOf(out: string): FormData {
  const fd = new FormData();
  for (const m of out.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) fd.append(m[1]!, decode(m[2]!));
  return fd;
}

beforeEach(() => {
  mediaLoads.mockClear();
  state.media = { view: { state: "ok", assets: [asset(A, VA), asset(B, VB, { rightsState: "approved", allowedChannels: ["blog"] })] }, assets: null };
});

describe("Instagram 초안: 이미지 선택 배선", () => {
  it("현재 첨부를 기본 유지로 렌더, preserveMedia hidden은 셀렉터 하나만(중복 없음), 서버 파서가 그대로 받아 첨부·변형·대체텍스트·순서 보존", async () => {
    const media = [{ asset_id: A, variant_id: VA, alt_text: "바다" }];
    state.detail = detailWith("instagram", media);
    const out = await render("instagram");
    const pm = hiddenAll(out, "preserveMedia");
    expect(pm).toHaveLength(1);
    expect(JSON.parse(pm[0]!)).toEqual(media);
    expect(out).toContain("<legend>이미지(단일)</legend>");
    expect(out).toContain("지금 첨부 유지");
    // 본문만 고쳐 저장(선택 미변경) → 서버 parsePreserved(037 requireMedia 포함)가 같은 첨부·UTM을 돌려준다
    const parsed = parsePreserved(formOf(out), { requireMedia: true });
    expect(parsed).toEqual({ ok: true, value: { utm: { utm_source: "ig" }, media, targetConnectionId: null, targetExternalAccountId: null } });
    // 렌더 기준 기대 버전 그대로(최신 상태를 다시 읽어 덮지 않음)
    expect(hiddenAll(out, "expectedRevisionNo")).toEqual(["2"]);
    expect(hiddenAll(out, "expectedContentVersionId")).toEqual([VID]);
    expect(mediaLoads).toHaveBeenCalledTimes(1);
  });

  it("다시 불러온 새 선택(B)이 유지 선택으로 표시되고 대체텍스트·지금 첨부 표시", async () => {
    state.detail = detailWith("instagram", [{ asset_id: B, variant_id: VB, alt_text: "산" }]);
    const out = await render("instagram");
    expect(out).toContain(`지금 첨부 유지 (자산 ${B.slice(0, 8)}…)`);
    expect(out).toContain("대체텍스트: 산");
    expect(out).toContain(" · 지금 첨부");
  });

  it("첨부 없음 + 후보: 빈 배열 hidden(명시 값), 서버가 [] 로 받음 · 권리 경고는 Instagram 기준(채널 제외 구별, '게시 가능' 문구 없음)", async () => {
    state.detail = detailWith("instagram", []);
    const out = await render("instagram");
    expect(hiddenAll(out, "preserveMedia")).toEqual(["[]"]);
    expect(parsePreserved(formOf(out), { requireMedia: true })).toMatchObject({ ok: true, value: { media: [] } });
    expect(out).toContain("권리 미검토 · 게시 전 권리 확인 필요");
    expect(out).toContain("권리 승인 채널에 Instagram 없음");
    expect(out).not.toMatch(/게시할 수 있|게시 가능/);
  });

  it("목록 조회 실패: 현재 첨부 유지 hidden + 잠금 사유, 해제 선택지 없음", async () => {
    const media = [{ asset_id: A, variant_id: VA, alt_text: null }];
    state.detail = detailWith("instagram", media);
    state.media = { view: { state: "error", kind: "db" }, assets: null };
    const out = await render("instagram");
    expect(JSON.parse(hiddenAll(out, "preserveMedia")[0]!)).toEqual(media);
    expect(out).toContain("사용할 수 없음");
    expect(out).not.toContain("첨부 해제");
  });

  it("상세 조회 실패(첨부 조회 실패 포함): 저장 폼·preserveMedia 없음, 미디어 목록도 읽지 않음", async () => {
    state.detail = { status: "error", error: { code: "db" } };
    const out = await render("instagram");
    expect(out).not.toContain('name="preserveMedia"');
    expect(out).not.toContain("초안 저장");
    expect(mediaLoads).not.toHaveBeenCalled();
  });

  it("안내 문구: 이미지 첨부 화면 없음 단정 제거, 미디어·권리 링크와 업로드 닫힘 유지", async () => {
    state.detail = detailWith("instagram", []);
    const out = await render("instagram");
    expect(out).not.toContain("붙이는 화면은 아직 없습니다");
    expect(out).toContain("1장을 고르고 초안을 저장해야 붙습니다");
    expect(out).toContain('href="/admin/distribution/media"');
    expect(out).toContain("업로드는 아직 닫혀 있음");
  });
});

describe("다른 채널 회귀", () => {
  for (const ch of ["threads", "blog"] as const) {
    it(`${ch}: 셀렉터 없음, 기존 preserveMedia hidden 그대로 1개, 미디어 목록 읽지 않음`, async () => {
      const media = [{ asset_id: A, variant_id: VA, alt_text: null }];
      state.detail = detailWith(ch, media);
      const out = await render(ch);
      expect(out).not.toContain("이미지(단일)");
      const pm = hiddenAll(out, "preserveMedia");
      expect(pm).toHaveLength(1);
      expect(JSON.parse(pm[0]!)).toEqual(media);
      expect(hiddenAll(out, "preserveUtm")).toEqual([JSON.stringify({ utm_source: "ig" })]);
      expect(mediaLoads).not.toHaveBeenCalled();
    });
  }
});

describe("입력 보존·초기화 정책(정적)", () => {
  it("ActionForm은 제출 후 폼을 자동 초기화하지 않고(실패 시 선택·대체텍스트 유지), 셀렉터는 리비전 번호 key로 새 리비전 성공 뒤 초기화", () => {
    const af = readFileSync(join(process.cwd(), "src", "components", "distribution-console", "action-form.tsx"), "utf8");
    expect(af).toContain("onSubmit={onSubmit}");
    expect(af).not.toMatch(/<form[^>]*\saction=\{/);
    const page = readFileSync(join(process.cwd(), "src", "app", "admin", "distribution", "contents", "[contentId]", "channels", "[channel]", "page.tsx"), "utf8");
    expect(page).toContain("<RevisionMediaSelector key={`r${draft.currentRevisionNo}`}");
    expect(page).toContain('fieldName="preserveMedia"');
  });
});
