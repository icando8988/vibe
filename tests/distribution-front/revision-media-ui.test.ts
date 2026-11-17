/**
 * FE-REVISION-MEDIA-038 — Instagram 초안 단일 이미지 선택: 순수 판정·서버 렌더 시험(브라우저 실측 아님).
 * 서버 첨부 roundtrip 배선은 Backend037 REVISION_MEDIA_CONTRACT 확정 후(이 시험은 컴포넌트·판정만).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MediaAssetDto } from "@/server/distribution/media/service";

const rm = await import("@/components/distribution-console/revision-media");
const { RevisionMediaSelector } = await import("@/components/distribution-console/revision-media-selector");

const NOW = Date.parse("2026-11-17T03:00:00Z");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VA = "11111111-1111-4111-8111-111111111111";
const VB = "22222222-2222-4222-8222-222222222222";
const asset = (id: string, variantId: string | null, o: Partial<MediaAssetDto> = {}): MediaAssetDto => ({
  id, status: "ready", source: "own_creation", sourceNote: null, originalFormat: "png", originalByteSize: 1, originalWidth: 1200, originalHeight: 1000,
  failureCode: null, rightsState: "unreviewed", allowedChannels: null, rightsValidUntil: null, archivedAt: null, rowVersion: 2,
  variant: variantId ? { id: variantId, kind: "feed_jpeg", byteSize: 300_000, width: 1200, height: 1000, sha256: "d".repeat(64) } : null,
  ...o,
});
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const hiddenValue = (out: string) => {
  const m = out.match(/<input type="hidden" name="media" value="([^"]*)"/);
  return m ? JSON.parse(m[1]!.replace(/&quot;/g, '"')) : undefined;
};

describe("후보·모델 판정", () => {
  it("후보는 ready·미보관·변형 있는 자산만, 권리 미승인 ready 포함(경고 표시용 플래그)", () => {
    const list = [
      asset(A, VA),
      asset(B, VB, { rightsState: "approved", allowedChannels: ["instagram"] }),
      asset(C, null, { status: "processing" }),
      asset("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "33333333-3333-4333-8333-333333333333", { archivedAt: "2026-11-01T00:00:00Z" }),
      asset("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "44444444-4444-4444-8444-444444444444", { status: "failed" }),
    ];
    const c = rm.toCandidates(list, NOW);
    expect(c.map((x) => x.assetId)).toEqual([A, B]);
    expect(c[0]).toMatchObject({ variantId: VA, rightsApprovedNow: false });
    expect(c[1]).toMatchObject({ variantId: VB, rightsApprovedNow: true });
    // 클라이언트 후보에 URL·경로·sha 등 불필요 값 없음
    expect(Object.keys(c[0]!).sort()).toEqual(["assetId", "byteSize", "height", "rights", "rightsApprovedNow", "rightsState", "variantId", "width"]);
  });

  it("Instagram 권리 표시: 만료·채널 제외·미검토/반려/철회 구별, 승인도 '게시 가능'이라 말하지 않음", () => {
    const base = { allowedChannels: null, rightsValidUntil: null };
    expect(rm.instagramRightsNote({ ...base, rightsState: "approved", allowedChannels: ["instagram"] }, NOW)).toBe("approved_instagram");
    expect(rm.instagramRightsNote({ rightsState: "approved", allowedChannels: ["instagram"], rightsValidUntil: "2026-11-01T00:00:00Z" }, NOW)).toBe("expired");
    expect(rm.instagramRightsNote({ ...base, rightsState: "approved", allowedChannels: ["blog", "threads"] }, NOW)).toBe("channel_excluded");
    for (const s of ["unreviewed", "rejected", "revoked"] as const) expect(rm.instagramRightsNote({ ...base, rightsState: s }, NOW)).toBe(s);
    for (const t of Object.values(rm.RIGHTS_NOTE_TEXT)) expect(t).not.toMatch(/게시할 수 있|게시 가능/);
    expect(rm.RIGHTS_NOTE_TEXT.approved_instagram).toContain("게시 전 서버가 다시 확인");
  });

  it("첨부 조회 실패는 attachment_unknown, 목록 실패·미준비·권한 없음은 locked(현재 첨부 유지)", () => {
    const cur = { state: "ok" as const, items: [{ asset_id: A, variant_id: VA, alt_text: "바다" }] };
    expect(rm.selectorModel({ state: "read_error" }, { state: "ok", assets: [] }, NOW)).toEqual({ mode: "attachment_unknown" });
    for (const s of ["not_ready", "denied", "error"] as const) {
      expect(rm.selectorModel(cur, { state: s }, NOW)).toEqual({ mode: "locked", reason: s, current: cur.items });
    }
  });

  it("현재 첨부가 최근 100건 목록에 없으면 currentInList=false(없음으로 단정하지 않음)", () => {
    const cur = { state: "ok" as const, items: [{ asset_id: C, variant_id: VA, alt_text: null }] };
    const m = rm.selectorModel(cur, { state: "ok", assets: [asset(A, VA)] }, NOW);
    expect(m).toMatchObject({ mode: "select", currentInList: false });
    expect(rm.selectorModel({ state: "ok", items: [] }, { state: "ok", assets: [] }, NOW)).toMatchObject({ currentInList: null });
  });
});

describe("직렬화: 유지·해제·선택·변형 고정", () => {
  const cur = { state: "ok" as const, items: [{ asset_id: A, variant_id: VA, alt_text: "바다" }, { asset_id: B, variant_id: VB, alt_text: null }] };
  const model = rm.selectorModel(cur, { state: "ok", assets: [asset(A, VA), asset(B, VB)] }, NOW) as Extract<ReturnType<typeof rm.selectorModel>, { mode: "select" }>;

  it("keep은 현재 첨부를 순서·변형·대체텍스트까지 그대로(본문만 수정 시 보존)", () => {
    expect(rm.serializeChoice({ kind: "keep" }, model, "무시")).toEqual(cur.items);
  });
  it("none은 명시 해제 []", () => {
    expect(rm.serializeChoice({ kind: "none" }, model, "")).toEqual([]);
  });
  it("asset 선택은 후보 변형 ID로 고정, 대체텍스트 trim·빈 값은 null, 모르는 ID는 null(가짜 첨부 없음)", () => {
    expect(rm.serializeChoice({ kind: "asset", assetId: B }, model, "  산  ")).toEqual([{ asset_id: B, variant_id: VB, alt_text: "산" }]);
    expect(rm.serializeChoice({ kind: "asset", assetId: B }, model, "   ")).toEqual([{ asset_id: B, variant_id: VB, alt_text: null }]);
    expect(rm.serializeChoice({ kind: "asset", assetId: C }, model, "")).toBeNull();
  });
  it("locked는 어떤 선택이든 현재 첨부 유지", () => {
    const locked = rm.selectorModel(cur, { state: "error" }, NOW) as Extract<ReturnType<typeof rm.selectorModel>, { mode: "locked" }>;
    expect(rm.serializeChoice({ kind: "none" }, locked, "")).toEqual(cur.items);
  });
  it("대체텍스트 상한은 서버와 같은 1000(UTF-16 길이)", () => {
    expect(rm.altTextError("가".repeat(1000))).toBeNull();
    expect(rm.altTextError("가".repeat(1001))).toBe("too_long");
  });
});

describe("선택 UI 렌더", () => {
  const cur = { state: "ok" as const, items: [{ asset_id: A, variant_id: VA, alt_text: "바다 사진" }] };

  it("기본은 '지금 첨부 유지' 선택, hidden 입력 하나에 현재 첨부 JSON, 대체텍스트 표시, 해제 선택지", () => {
    const m = rm.selectorModel(cur, { state: "ok", assets: [asset(A, VA), asset(B, VB)] }, NOW);
    const out = html(createElement(RevisionMediaSelector, { model: m, fieldName: "media" }));
    expect((out.match(/type="hidden"/g) ?? []).length).toBe(1);
    expect(hiddenValue(out)).toEqual(cur.items);
    expect(out).toContain("지금 첨부 유지");
    expect(out).toContain("첨부 해제(이미지 없음)");
    expect(out).toContain("대체텍스트: 바다 사진");
    expect(out).toContain("<legend>이미지(단일)</legend>");
    expect(out).toContain("게시 전 권리 확인 필요");
  });

  it("권리 미승인 후보를 선택하면 게시 전 승인 경고, 대체텍스트 입력은 label 연결", () => {
    const m = rm.selectorModel({ state: "ok", items: [] }, { state: "ok", assets: [asset(B, VB)] }, NOW);
    const out = html(createElement(RevisionMediaSelector, { model: m, fieldName: "media", initialChoice: { kind: "asset", assetId: B } }));
    expect(hiddenValue(out)).toEqual([{ asset_id: B, variant_id: VB, alt_text: null }]);
    expect(out).toContain("Instagram 권리 승인 전입니다");
    expect(out).toContain("게시 전에 미디어·권리 화면에서 권리를 확인");
    expect(out).toMatch(/<label for="[^"]+-alt">대체텍스트/);
    expect(out).not.toContain("첨부 해제"); // 현재 첨부가 없으면 해제 선택지 없음
  });

  it("현재 첨부가 목록 밖이면 유지 안내, 없음으로 단정하지 않음", () => {
    const m = rm.selectorModel({ state: "ok", items: [{ asset_id: C, variant_id: VA, alt_text: null }] }, { state: "ok", assets: [asset(A, VA)] }, NOW);
    const out = html(createElement(RevisionMediaSelector, { model: m, fieldName: "media" }));
    expect(out).toContain("최근 100건 목록에 없습니다");
    expect(out).toContain("그대로 유지");
    expect(hiddenValue(out)).toEqual([{ asset_id: C, variant_id: VA, alt_text: null }]);
  });

  it("목록 조회 실패·미준비·권한 없음: 선택 잠금·현재 첨부 유지 hidden, 해제 선택지 없음", () => {
    for (const s of ["error", "not_ready", "denied"] as const) {
      const out = html(createElement(RevisionMediaSelector, { model: rm.selectorModel(cur, { state: s }, NOW), fieldName: "media" }));
      expect(out).toContain("사용할 수 없음");
      expect(out).not.toContain("첨부 해제");
      expect(hiddenValue(out)).toEqual(cur.items);
    }
  });

  it("첨부 조회 실패: hidden 입력 없음(빈 배열로 지우지 않음), 비활성 fieldset + 사유", () => {
    const out = html(createElement(RevisionMediaSelector, { model: { mode: "attachment_unknown" }, fieldName: "media" }));
    expect(out).not.toContain('type="hidden"');
    expect(out).toMatch(/<fieldset[^>]*disabled/);
    expect(out).toContain("첨부가 지워지지 않도록");
  });

  it("후보 0건: 조회 성공·0건 안내, 업로드 비활성 명시", () => {
    const out = html(createElement(RevisionMediaSelector, { model: rm.selectorModel({ state: "ok", items: [] }, { state: "ok", assets: [] }, NOW), fieldName: "media" }));
    expect(out).toContain("고를 수 있는 이미지가 없습니다");
    expect(out).toContain("업로드는 아직 열려 있지 않습니다");
    expect(hiddenValue(out)).toEqual([]);
  });
});

describe("경계(정적)", () => {
  it("선택 UI는 서버 런타임·서명 URL·이미지 태그·외부 URL 입력을 쓰지 않는다", () => {
    for (const f of ["revision-media.ts", "revision-media-selector.tsx"]) {
      const src = readFileSync(join(process.cwd(), "src", "components", "distribution-console", f), "utf8");
      expect(/import (?!type)[^;]*from "@\/server\//.test(src)).toBe(false);
      expect(src).not.toMatch(/issuePublishUrl|createSignedUrl|media\/session|<img\b|type="url"|type="file"/);
    }
  });
});
