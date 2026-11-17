/**
 * FE-MEDIA-024 — 미디어 화면 컴포넌트 렌더 시험(서버 렌더, 브라우저 실측 아님).
 * 계약: docs/contracts/MEDIA_FRONT_CONTRACT.md. 서버 런타임(session.ts)은 아직 없어 페이지는 준비 전만 표시한다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MediaAssetDto } from "@/server/distribution/media/service";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { MediaAssetList } = await import("@/components/distribution-console/media-asset-list");
const { MediaAssetFacts } = await import("@/components/distribution-console/media-asset-detail");
const { MediaArchiveForm, MediaRightsForm, MediaUploadPanel } = await import("@/components/distribution-console/media-forms");
const { markInvalidControls } = await import("@/components/distribution-console/action-form");
const labels = await import("@/components/distribution-console/media-labels");

const NOW = Date.parse("2026-11-17T03:00:00Z");
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const asset = (o: Partial<MediaAssetDto> = {}): MediaAssetDto => ({
  id: ID, status: "ready", source: "own_creation", sourceNote: null, originalFormat: "png", originalByteSize: 2_000_000, originalWidth: 2000,
  originalHeight: 1600, failureCode: null, rightsState: "unreviewed", allowedChannels: null, rightsValidUntil: null, archivedAt: null, rowVersion: 4,
  variant: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind: "feed_jpeg", byteSize: 420_000, width: 1440, height: 1152, sha256: "c".repeat(64) },
  ...o,
});
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const noop = async () => ({ notice: null, fields: [], seq: 0 });

describe("라벨·판정", () => {
  it("권리 결정 선택지: 상태별로 가능한 것만", () => {
    expect(labels.rightsDecisionOptions(asset())).toEqual(["approved", "rejected"]);
    expect(labels.rightsDecisionOptions(asset({ status: "processing" }))).toEqual(["rejected"]);
    expect(labels.rightsDecisionOptions(asset({ rightsState: "approved", allowedChannels: ["instagram"] }))).toEqual(["revoked"]);
    expect(labels.rightsDecisionOptions(asset({ rightsState: "revoked" }))).toEqual(["approved", "rejected"]);
    expect(labels.rightsDecisionOptions(asset({ archivedAt: "2026-11-17T00:00:00Z" }))).toEqual([]);
  });
  it("권리 사용 가능 판정·실패 이유·크기·토큰 안내", () => {
    expect(labels.rightsUsableNow(asset({ rightsState: "approved", allowedChannels: ["instagram"] }), NOW)).toBe(true);
    expect(labels.rightsUsableNow(asset({ rightsState: "approved", allowedChannels: ["instagram"], rightsValidUntil: "2026-11-17T02:00:00Z" }), NOW)).toBe(false);
    expect(labels.rightsUsableNow(asset(), NOW)).toBe(false);
    expect(labels.failureText("ASPECT_OUT_OF_RANGE")).toContain("0.8~1.91");
    expect(labels.failureText("NEW_CODE_X")).toBe("알 수 없는 이유로 처리하지 못했습니다.");
    expect(labels.formatBytes(420_000)).toBe("410.2KB");
    expect(labels.formatKst("2026-11-17T03:00:00Z")).toContain("KST");
    expect(labels.MEDIA_REASON_FIELD_LABELS["reason:asset_referenced"]).toContain("보관할 수 없음");
  });
});

describe("목록: 준비 전·권한·오류·0건·목록 구분", () => {
  it("준비 전은 0건이 아니다", () => {
    const h = html(createElement(MediaAssetList, { view: { state: "not_ready", reason: "배선 전" }, now: NOW }));
    expect(h).toContain("미디어 저장 준비 전");
    expect(h).toContain("실제로 자산이 없다는 뜻이 아닙니다");
    expect(h).not.toContain("0건");
  });
  it("권한 없음·조회 오류·조회 성공 0건", () => {
    expect(html(createElement(MediaAssetList, { view: { state: "denied" }, now: NOW }))).toContain("권한이 없습니다");
    const e = html(createElement(MediaAssetList, { view: { state: "error" }, now: NOW }));
    expect(e).toContain("불러오지 못했습니다");
    expect(e).not.toContain("0건");
    expect(html(createElement(MediaAssetList, { view: { state: "ok", assets: [] }, now: NOW }))).toContain("조회 성공 · 0건");
  });
  it("처리 상태와 권리 상태를 다른 열로, 선택 행 표시, 만료 표시, 미리보기 없음", () => {
    const rows = [
      asset(),
      asset({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "failed", failureCode: "DECODE_FAILED", variant: null }),
      asset({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", rightsState: "approved", allowedChannels: ["instagram"], rightsValidUntil: "2026-11-17T02:00:00Z" }),
    ];
    const h = html(createElement(MediaAssetList, { view: { state: "ok", assets: rows }, now: NOW, selectedId: ID }));
    expect(h).toContain("처리 완료");
    expect(h).toContain("권리 미검토");
    expect(h).toContain("처리 실패");
    expect(h).toContain("유효기한 지남");
    expect(h).toContain('aria-current="true"');
    expect(h).toContain(`/admin/distribution/media/${ID}`);
    expect(h).not.toContain("<img");
  });
});

describe("상세 사실", () => {
  it("처리 완료 + 권리 미승인 → 게시에 못 씀 안내, 원본 미저장, sha 앞자리만", () => {
    const h = html(createElement(MediaAssetFacts, { asset: asset(), now: NOW }));
    expect(h).toContain("게시에 쓸 수 없습니다");
    expect(h).toContain("원본 파일은 저장하지 않음");
    expect(h).toContain("1440×1152px");
    expect(h).not.toContain("c".repeat(64));
    expect(h).not.toContain("<img");
  });
  it("실패 이유·보관 표시", () => {
    expect(html(createElement(MediaAssetFacts, { asset: asset({ status: "failed", failureCode: "TOO_SMALL", variant: null }), now: NOW }))).toContain("320px보다 작습니다");
    expect(html(createElement(MediaAssetFacts, { asset: asset({ archivedAt: "2026-11-17T01:00:00Z" }), now: NOW }))).toContain("되돌릴 수 없음");
  });
});

describe("권리 결정·보관 폼", () => {
  it("액션 없으면 제출 경로 없이 비활성 + 이유(가짜 성공 없음)", () => {
    const h = html(createElement(MediaRightsForm, { asset: asset(), action: null, disabledReason: "서버 연결 준비 전" }));
    expect(h).toContain("<fieldset disabled");
    expect(h).toContain("사용할 수 없음: 서버 연결 준비 전");
    expect(h).not.toContain("<form");
    expect(h).toContain('name="expectedVersion" value="4"');
  });
  it("상태별 선택지: 승인 상태면 철회만, 처리 중이면 반려만 + 안내, 보관이면 폼 없음", () => {
    const ap = html(createElement(MediaRightsForm, { asset: asset({ rightsState: "approved", allowedChannels: ["instagram"] }), action: null, disabledReason: "x" }));
    expect(ap).toContain('value="revoked"');
    expect(ap).not.toContain('value="approved"');
    expect(ap).not.toContain('name="allowedChannels"');
    const pr = html(createElement(MediaRightsForm, { asset: asset({ status: "processing", variant: null }), action: null, disabledReason: "x" }));
    expect(pr).toContain('value="rejected"');
    expect(pr).not.toContain('value="approved"');
    expect(pr).toContain("처리 완료(ready) 전에는 승인할 수 없습니다");
    expect(html(createElement(MediaRightsForm, { asset: asset({ archivedAt: "2026-11-17T01:00:00Z" }), action: null, disabledReason: "x" }))).toContain("권리 결정을 기록할 수 없습니다");
  });
  it("승인 가능하면 채널·유효기한(KST)·사유 입력, 액션이 있으면 실제 폼", () => {
    const h = html(createElement(MediaRightsForm, { asset: asset(), action: noop, disabledReason: null }));
    expect(h).toContain("<form");
    expect(h).toContain('name="allowedChannels" value="instagram"');
    expect(h).toContain('type="datetime-local"');
    expect(h).toContain("KST");
    expect(h).toContain('maxLength="1000"');
  });
  it("보관: 되돌릴 수 없음 확인 필수, 사용 중 거부 안내, 이미 보관이면 폼 없음", () => {
    const h = html(createElement(MediaArchiveForm, { asset: asset(), action: null, disabledReason: "준비 전" }));
    expect(h).toContain('name="confirmArchive"');
    expect(h).toContain("되돌릴 수 없고");
    expect(h).toContain("채널 초안이 쓰고 있는 자산은 서버가 보관을 거부");
    expect(html(createElement(MediaArchiveForm, { asset: asset({ archivedAt: "2026-11-17T01:00:00Z" }), action: null, disabledReason: null }))).toContain("이미 보관된 자산");
  });
  it("업로드: 비활성 + 이유, 파일 입력·외부 URL 입력 없음", () => {
    const h = html(createElement(MediaUploadPanel, { reason: "업로드 계약 확정 전" }));
    expect(h).toContain("disabled");
    expect(h).toContain("사용할 수 없음: 업로드 계약 확정 전");
    expect(h).not.toContain('type="file"');
    expect(h).not.toContain('type="url"');
  });
});

describe("Design 검토 M025 반영", () => {
  it("M025-02 보관 자산은 권리 승인이어도 사용 가능 문구 없음, 보관 안내 우선", () => {
    const h = html(createElement(MediaAssetFacts, { asset: asset({ archivedAt: "2026-11-17T01:00:00Z", rightsState: "approved", allowedChannels: ["instagram"] }), now: NOW }));
    expect(h).toContain("보관된 자산이라 새 초안·게시용으로 선택할 수 없습니다");
    expect(h).not.toContain("권리가 승인된 채널에서만 쓸 수 있습니다");
    expect(html(createElement(MediaAssetFacts, { asset: asset({ rightsState: "approved", allowedChannels: ["instagram"], rightsValidUntil: "2026-11-17T02:00:00Z" }), now: NOW }))).toContain("유효기한이 지나");
    expect(html(createElement(MediaAssetFacts, { asset: asset({ status: "processing", variant: null }), now: NOW }))).toContain("처리가 끝나지 않아");
    expect(html(createElement(MediaAssetFacts, { asset: asset({ rightsState: "approved", allowedChannels: ["instagram"] }), now: NOW }))).toContain("게시 직전에 서버가 다시 확인");
  });
  it("M025-03 모르는 실패 코드·긴 문자열 원문 비노출, 업로드 비활성과 맞는 안내", () => {
    const code = "INTERNAL_" + "X".repeat(80);
    const h = html(createElement(MediaAssetFacts, { asset: asset({ status: "failed", failureCode: code, variant: null }), now: NOW }));
    expect(h).not.toContain(code);
    expect(h).toContain("알 수 없는 이유로 처리하지 못했습니다");
    expect(h).toContain("업로드가 준비되면");
  });
  it("M025-01 체크박스·라디오는 choice 라벨 안, 미디어 폼 범위 클래스, CSS 분리 규칙", () => {
    // vitest의 CSS 모듈 클래스명은 해시되므로 'choice'·'mediaForm' 포함 여부로 본다
    const h = html(createElement(MediaRightsForm, { asset: asset(), action: null, disabledReason: "x" }));
    expect(h).toMatch(/<label class="[^"]*choice[^"]*"><input type="checkbox" name="allowedChannels"/);
    expect(h).toMatch(/<label class="[^"]*choice[^"]*"><input(?=[^>]*type="radio")(?=[^>]*name="decision")[^>]*>/);
    expect(h).toMatch(/class="ds-editor-fields [^"]*mediaForm[^"]*"/);
    expect(html(createElement(MediaArchiveForm, { asset: asset(), action: null, disabledReason: "x" }))).toMatch(/<label class="[^"]*choice[^"]*"><input(?=[^>]*\stype="checkbox")(?=[^>]*\sname="confirmArchive")(?=[^>]*\srequired(?:=""|\s|\/?>))[^>]*>/);
    const css = readFileSync(join(process.cwd(), "src", "components", "distribution-console", "media.module.css"), "utf8");
    expect(css).toContain('.mediaForm .choice input[type="checkbox"]');
    expect(css).toContain("min-height: 44px");
    expect(css).toContain(".mediaForm fieldset.choiceGroup");
  });
  it("M025-04 목록 링크 44px 클래스·전체 ID 접근 이름(같은 접두 구분), 표 스크롤 영역", () => {
    const other = "aaaaaaaa-0000-4000-8000-000000000001";
    const h = html(createElement(MediaAssetList, { view: { state: "ok", assets: [asset(), asset({ id: other })] }, now: NOW }));
    expect(h).toContain('class="dc-action"');
    expect(h).toContain(`aria-label="자산 ${ID} 상세 보기"`);
    expect(h).toContain(`aria-label="자산 ${other} 상세 보기"`);
    expect(h).toContain('role="region"');
    expect(h).toContain('tabindex="0"');
  });
  it("M025-05 비활성 사유를 fieldset에 연결, KST 저장 안내", () => {
    const h = html(createElement(MediaRightsForm, { asset: asset(), action: null, disabledReason: "준비 전" }));
    expect(h).toContain(`<fieldset disabled="" aria-describedby="mr-${ID}-disabled-reason"`);
    expect(h).toContain(`id="mr-${ID}-disabled-reason"`);
    expect(h).toContain("한국 시간(KST)으로 저장");
  });
  it("M025-05 markInvalidControls: 실패 필드에 aria-invalid·요약 연결, hidden·reason·이상한 이름 제외, 다음 결과에서 이전 표시 제거", () => {
    type El = { name: string; type: string; attrs: Map<string, string>; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void; removeAttribute(n: string): void };
    const mk = (name: string, type = "text", describedby?: string): El => {
      const attrs = new Map<string, string>(describedby ? [["aria-describedby", describedby]] : []);
      return { name, type, attrs, getAttribute: (n) => attrs.get(n) ?? null, setAttribute: (n, v) => void attrs.set(n, v), removeAttribute: (n) => void attrs.delete(n) };
    };
    const els = [mk("allowedChannels", "checkbox"), mk("allowedChannels", "checkbox"), mk("validUntil", "datetime-local", "hint-1"), mk("expectedVersion", "hidden")];
    const root = {
      querySelectorAll: (sel: string) => {
        if (sel === "[data-af-invalid]") return els.filter((e) => e.attrs.has("data-af-invalid"));
        const m = /^\[name="(.+)"\]$/.exec(sel);
        return els.filter((e) => e.name === m?.[1]);
      },
    };
    const first = markInvalidControls(root, ["allowedChannels", "validUntil", "expectedVersion", "reason:media_not_ready", 'x"] , [a'], "sum-1");
    expect(first).toBe(els[0]);
    expect(els.slice(0, 3).every((e) => e.attrs.get("aria-invalid") === "true")).toBe(true);
    expect(els[2]?.attrs.get("aria-describedby")).toBe("hint-1 sum-1");
    expect(els[3]?.attrs.has("aria-invalid")).toBe(false);
    markInvalidControls(root, ["validUntil"], "sum-1");
    expect(els[0]?.attrs.has("aria-invalid")).toBe(false);
    expect(els[2]?.attrs.get("aria-describedby")).toBe("hint-1 sum-1");
    markInvalidControls(root, [], "sum-1");
    expect(els[2]?.attrs.get("aria-describedby")).toBe("hint-1");
  });
});


describe("경계(정적)", () => {
  it("Front 미디어 파일은 서버 런타임·서명 URL·session을 부르지 않는다", () => {
    const root = process.cwd();
    const files = [
      ...readdirSync(join(root, "src", "components", "distribution-console")).filter((f) => f.startsWith("media")).map((f) => join(root, "src", "components", "distribution-console", f)),
      join(root, "src", "app", "admin", "distribution", "media", "page.tsx"),
      join(root, "src", "app", "admin", "distribution", "media", "[assetId]", "page.tsx"),
    ];
    for (const f of files) {
      // 주석(설명 문서)은 빼고 실제 코드만 검사
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      expect(src.includes("issuePublishUrl") || src.includes("createSignedUrl") || src.includes("media/session")).toBe(false);
      expect(/import (?!type)[^;]*from "@\/server\/distribution\/media\/service"/.test(src)).toBe(false);
      expect(/<img\b/.test(src)).toBe(false);
    }
  });
});
