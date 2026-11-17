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
const { MediaArchiveForm, MediaRightsForm, MediaUploadPanel, MediaGateNotice, mediaNoticeOverrides, RIGHTS_INVALID_BODY, ARCHIVE_INVALID_BODY, ARCHIVE_FIELD_LABELS, MEDIA_PAGE_NOTICE_OVERRIDES } = await import("@/components/distribution-console/media-forms");
const { WriteNoticeView } = await import("@/components/distribution-console/write-notice-view");
const { markInvalidControls } = await import("@/components/distribution-console/action-form");
const labels = await import("@/components/distribution-console/media-labels");
const { intOf, kstToIso, mediaFailState, noteFieldError } = await import("@/app/admin/distribution/media/action-state");

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
  it("처리 완료 + 권리 미승인 → 게시에 못 씀 안내, 원본 미표시, sha 앞자리만", () => {
    const h = html(createElement(MediaAssetFacts, { asset: asset(), now: NOW }));
    expect(h).toContain("게시에 쓸 수 없습니다");
    expect(h).toContain("원본은 화면에 표시하지 않음"); // D028-05: 미저장 단정 대신 임시 보관·삭제 시도
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


describe("FE-MEDIA-RESUME-027 metadata 흐름: 실패 구분·입력/버전 보존", () => {
  const prev = { notice: null, fields: [], seq: 2 };
  const db = (code: string, token: string | null = null, sqlstate: string | null = null) =>
    ({ status: "db_error", error: { code, token, sqlstate } }) as Parameters<typeof mediaFailState>[0];

  it("준비 전·권한·입력 오류·형식 이상·응답 유실을 서로 다른 안내로, seq 증가", () => {
    expect(mediaFailState({ status: "not_ready" }, prev)).toEqual({ notice: "not_ready", fields: [], seq: 3 });
    expect(mediaFailState({ status: "denied" }, prev).notice).toBe("denied");
    expect(mediaFailState({ status: "invalid", field: "allowedChannels" }, prev)).toEqual({ notice: "invalid", fields: ["allowedChannels"], seq: 3 });
    expect(mediaFailState({ status: "bad_response" }, prev).notice).toBe("uncertain");
    expect(mediaFailState(db("unavailable"), prev)).toEqual({ notice: "uncertain", fields: [], seq: 3 });
  });

  it("충돌·보관·상태 전이·없음은 notice 코드만(중복 fields 보충 없음 — 문맥은 폼 overrides, D028-02)", () => {
    for (const code of ["conflict_version", "archived", "invalid_transition", "not_found"]) {
      expect(mediaFailState(db(code), prev)).toEqual({ notice: code, fields: [], seq: 3 });
    }
  });

  it("미디어 거절 사유는 mediaErrorReason 우선(확정 거절 invalid), 허용 목록 밖 token은 일반 안내", () => {
    const s = mediaFailState(db("invalid_input", "ASSET_REFERENCED", "23514"), prev);
    expect(s).toEqual({ notice: "invalid", fields: ["reason:asset_referenced"], seq: 3 });
    expect(mediaFailState(db("invalid_input", "SOMETHING_ELSE", "23514"), prev).fields).toEqual([]);
  });

  it("KST 유효기한 변환·expectedVersion 정수 판정", () => {
    expect(kstToIso("2026-12-01T09:00")).toBe("2026-12-01T00:00:00.000Z");
    expect(kstToIso("")).toBeNull();
    expect(kstToIso(null)).toBeNull();
    expect(kstToIso("2026-12-01")).toBeUndefined();
    expect(intOf("4")).toBe(4);
    expect(intOf("0")).toBeNull();
    expect(intOf("4.5")).toBeNull();
    expect(intOf(null)).toBeNull();
  });

  it("조회 오류 종류별 안내, 어느 경우도 0건 문구 없음", () => {
    for (const [kind, text] of [["unavailable", "응답을 받지 못했습니다"], ["bad_response", "형식이 예상과 달라"], ["db", "거절했습니다"]] as const) {
      const out = html(createElement(MediaAssetList, { view: { state: "error", kind }, now: NOW }));
      expect(out).toContain(text);
      expect(out).toContain("자산이 없다는 뜻이 아닙니다");
      expect(out).not.toContain("0건");
    }
  });

  it("폼은 렌더된 rowVersion을 그대로 보내고, 실패해도 바꾸지 않는다(폼 상태에 버전 없음)", () => {
    const out = html(createElement(MediaRightsForm, { asset: asset({ rowVersion: 9 }), action: noop, disabledReason: null }));
    expect(out).toContain('name="expectedVersion" value="9"');
    expect(Object.keys(mediaFailState(db("conflict_version"), prev)).sort()).toEqual(["fields", "notice", "seq"]);
  });

  it("server action 파일은 action-state만 쓰고 세부 판정을 복제하지 않는다(정적)", () => {
    const src = readFileSync(join(process.cwd(), "src", "app", "admin", "distribution", "media", "actions.ts"), "utf8");
    expect(src).toContain('from "./action-state"');
    expect(src).not.toContain("mediaErrorReason");
    expect(src).not.toMatch(/createAndProcessFromBytes|processControlledUpload|upload\/grant/);
  });
});

describe("FE-MEDIA-FIX-029 Design D028 반영", () => {
  const ov = mediaNoticeOverrides(ID, RIGHTS_INVALID_BODY);

  it("D028-01 gate 안내: 조회 성공일 때만 서버 저장, 그 외 저장 약속 없음, 업로드 비활성·게시 gate 닫힘 항상, 공용 '비동작' 문구 없음", () => {
    const ok = html(createElement(MediaGateNotice, { listState: "ok" }));
    expect(ok).toContain("실제 서버에 저장됩니다");
    for (const s of ["not_ready", "denied", "error", "not_loaded"] as const) {
      const out = html(createElement(MediaGateNotice, { listState: s }));
      expect(out).not.toContain("서버에 저장됩니다");
      expect(out).toContain("업로드는");
      expect(out).toContain("게시는 별도 gate로 닫혀");
    }
    expect(ok).not.toContain("동작하지 않으며");
    // 두 미디어 페이지가 gateNotice를 넘긴다(공용 기본 안내 사용 안 함)
    for (const p of ["page.tsx", join("[assetId]", "page.tsx")]) {
      const src = readFileSync(join(process.cwd(), "src", "app", "admin", "distribution", "media", p), "utf8");
      expect((src.match(/gateNotice=\{<MediaGateNotice/g) ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("D028-02 충돌·보관·전이 불가는 자산 문맥 문구, 원문·초안 문구 없음, 입력 복사·새로고침 유실 가능성·새 탭 최신 확인, 자동 재저장 없음", () => {
    const conflict = html(createElement(WriteNoticeView, { notice: "conflict_version", overrides: ov }));
    expect(conflict).toContain("이 자산이 다른 곳에서 먼저 바뀌었습니다");
    expect(conflict).toContain("새로 고치면 사라질 수 있습니다");
    expect(conflict).toContain("복사해 두고");
    expect(conflict).toContain("자동으로 다시 저장하지 않았습니다");
    expect(conflict).toContain(`href="/admin/distribution/media/${ID}"`);
    expect(conflict).toContain('target="_blank"');
    expect(conflict).not.toContain("원문");
    for (const code of ["archived", "invalid_transition", "not_found"]) {
      const out = html(createElement(WriteNoticeView, { notice: code, overrides: ov }));
      expect(out).not.toMatch(/원문|초안|작업 상태/);
      expect(out).toContain("자산");
    }
  });

  it("공용 기본 안내는 overrides 없으면 그대로(다른 페이지 회귀 없음), 덮어쓰지 않은 코드도 그대로", () => {
    expect(html(createElement(WriteNoticeView, { notice: "conflict_version" }))).toContain("원문이 이미 새 버전입니다");
    expect(html(createElement(WriteNoticeView, { notice: "invalid" }))).toContain("반려·철회는 사유가 필요합니다");
    expect(html(createElement(WriteNoticeView, { notice: "uncertain", overrides: ov }))).toContain("자동으로 다시 보내지 않았습니다");
  });

  it("D028-03 미디어 invalid 문구는 실제 규칙(채널 1개 이상·사유 선택)만, 체크리스트·사유 필수 문구 없음", () => {
    const rights = html(createElement(WriteNoticeView, { notice: "invalid", overrides: ov }));
    expect(rights).toContain("허용 채널이 1개 이상");
    expect(rights).toContain("사유는 선택");
    expect(rights).not.toMatch(/모든 확인 항목|사유가 필요/);
    const archive = html(createElement(WriteNoticeView, { notice: "invalid", overrides: mediaNoticeOverrides(ID, ARCHIVE_INVALID_BODY) }));
    expect(archive).toContain("확인할 항목"); // R031-02: 체크 단정 대신 중립(체크 누락은 confirmArchive 라벨이 안내)
    expect(archive).not.toContain("체크해야");
    // 폼의 사유 라벨도 '선택'으로 일치, required 없음
    const form = html(createElement(MediaRightsForm, { asset: asset(), action: noop, disabledReason: null }));
    expect(form).toContain("사유·근거(선택");
    expect(/<textarea[^>]*required/.test(form)).toBe(false);
  });

  it("D028-04 사유 검사: 한 줄·1000자 허용, 줄바꿈·탭·CR·DEL·1001자는 note 오류, 빈 값 허용, 힌트 연결", () => {
    expect(noteFieldError(null)).toBeNull();
    expect(noteFieldError("")).toBeNull();
    expect(noteFieldError("자체 촬영 원본")).toBeNull();
    expect(noteFieldError("가".repeat(1000))).toBeNull();
    expect(noteFieldError("😀".repeat(1000))).toBeNull(); // 코드 포인트 기준(char_length)
    for (const bad of ["첫 줄\n둘째 줄", "a\tb", "a\r\nb", "a\u007fb", "a\u0085b", "가".repeat(1001)]) expect(noteFieldError(bad)).toBe("note");
    const form = html(createElement(MediaRightsForm, { asset: asset(), action: noop, disabledReason: null }));
    expect(form).toMatch(/name="note"[^>]*aria-describedby="mr-[^"]+-note-hint"|aria-describedby="mr-[^"]+-note-hint"[^>]*name="note"/);
    expect(form).toContain("줄바꿈·탭은 저장할 수 없습니다");
  });

  it("D028-05 원본 안내: '저장하지 않음' 단정 없음, 임시 보관·삭제 시도·정리 공백 명시, 업로드는 여전히 비활성", () => {
    const panel = html(createElement(MediaUploadPanel, { reason: "원본 직접 업로드 계약의 최종 인수와 실제 저장소 연결 검증 전입니다." }));
    const facts = html(createElement(MediaAssetFacts, { asset: asset(), now: NOW }));
    for (const out of [panel, facts]) {
      expect(out).not.toMatch(/원본 파일은 저장하지 않/);
      expect(out).toContain("삭제를 시도");
      expect(out).toContain("정리");
    }
    expect(panel).toContain("임시 저장소");
    expect(panel).toMatch(/<button[^>]*disabled/);
    expect(panel).not.toMatch(/type="file"/);
  });

  it("M025-01 대조: 선택지 그룹 CSS는 공용 fieldset 규칙(0,2,1)보다 높은 특정성", () => {
    const css = readFileSync(join(process.cwd(), "src", "components", "distribution-console", "media.module.css"), "utf8");
    expect(css).toContain(".mediaForm fieldset.choiceGroup.choiceGroup {");
  });
});

describe("FE-MEDIA-NOTICE-032 잔존 안내 R031-01/02", () => {
  it("R031-01 페이지 쿼리 notice는 saved만 수락, 그 밖은 렌더 없음(공용 원문·초안·체크리스트 문구 미노출)", () => {
    expect(labels.mediaPageNotice("saved")).toBe("saved");
    expect(labels.mediaPageNotice(["saved", "invalid"])).toBe("saved");
    for (const v of ["conflict_version", "archived", "invalid", "checklist_incomplete", "uncertain", "not_found", "", "SAVED", undefined, ["invalid"], 1]) {
      expect(labels.mediaPageNotice(v)).toBeNull();
      expect(html(createElement(WriteNoticeView, { notice: labels.mediaPageNotice(v), overrides: MEDIA_PAGE_NOTICE_OVERRIDES }))).toBe("");
    }
  });

  it("R031-01 saved 안내는 저장을 단정하지 않고 다시 불러온 상태로 확인하게 하며 자산 링크를 만들지 않는다", () => {
    const out = html(createElement(WriteNoticeView, { notice: labels.mediaPageNotice("saved"), overrides: MEDIA_PAGE_NOTICE_OVERRIDES }));
    expect(out).toContain("다시 불러온 자산 상태로 확인");
    expect(out).not.toContain("서버가 저장을 확인했습니다");
    expect(out).not.toMatch(/<a\b/);
    expect(out).not.toMatch(/원문|초안/);
  });

  it("R031-01 두 미디어 페이지가 필터·미디어 override를 실제로 연결(원 쿼리 직접 전달 없음)", () => {
    for (const p of ["page.tsx", join("[assetId]", "page.tsx")]) {
      const src = readFileSync(join(process.cwd(), "src", "app", "admin", "distribution", "media", p), "utf8");
      expect(src).toContain("<WriteNoticeView notice={mediaPageNotice(sp.notice)} overrides={MEDIA_PAGE_NOTICE_OVERRIDES} />");
      expect(src).not.toContain("notice={sp.notice}");
    }
  });

  it("R031-02 체크 누락과 사용 중 자산 거절은 서로 다른 요약으로, 이미 체크한 거절에 체크 요구 없음", () => {
    const summary = (fields: string[]) => fields.map((f) => ARCHIVE_FIELD_LABELS[f] ?? f).join(", ");
    const start = { notice: null, fields: [], seq: 0 };
    const missing = mediaFailState({ status: "invalid", field: "confirmArchive" }, start);
    const referenced = mediaFailState(
      { status: "db_error", error: { code: "invalid_input", token: "ASSET_REFERENCED", sqlstate: "23514" } } as Parameters<typeof mediaFailState>[0],
      start,
    );
    expect(missing.notice).toBe("invalid");
    expect(referenced.notice).toBe("invalid");
    expect(summary(missing.fields)).toContain("체크 필요");
    expect(summary(referenced.fields)).toContain("채널 초안이 쓰는 자산이라 보관할 수 없음");
    expect(summary(referenced.fields)).not.toContain("체크");
    const body = html(createElement(WriteNoticeView, { notice: "invalid", overrides: mediaNoticeOverrides(ID, ARCHIVE_INVALID_BODY) }));
    expect(body).not.toMatch(/체크해야|체크하세요/);
    expect(readFileSync(join(process.cwd(), "src", "components", "distribution-console", "media-forms.tsx"), "utf8")).toContain("fieldLabels={ARCHIVE_FIELD_LABELS}");
  });
});

describe("FE-MEDIA-STALLED-033 업로드 고착 복구 코드", () => {
  it("UPLOAD_STALLED는 상세 failureText 경로에서 한글 안내, 원문 코드·성공/삭제/승인/재시도 단정 없음, 미지 코드 fallback 유지", () => {
    expect(labels.failureText("UPLOAD_STALLED")).toBe("처리가 제시간에 끝나지 않아 서버가 이 업로드를 닫았습니다.");
    const out = html(createElement(MediaAssetFacts, { asset: asset({ status: "failed", failureCode: "UPLOAD_STALLED", variant: null }), now: NOW }));
    expect(out).toContain("처리가 제시간에 끝나지 않아 서버가 이 업로드를 닫았습니다.");
    expect(out).toContain("업로드가 준비되면 고친 파일로 새 자산을 만드세요");
    expect(out).not.toContain("UPLOAD_STALLED");
    expect(out).not.toMatch(/삭제했|삭제 완료|승인됐|게시할 수 있|다시 시도했|자동으로 다시/);
    // 목록은 처리 상태 열만(실패 코드 원문 비노출)
    const list = html(createElement(MediaAssetList, { view: { state: "ok", assets: [asset({ status: "failed", failureCode: "UPLOAD_STALLED", variant: null })] }, now: NOW }));
    expect(list).toContain("처리 실패");
    expect(list).not.toContain("UPLOAD_STALLED");
    // 미지 코드는 기존 일반 안내 그대로
    expect(labels.failureText("UPLOAD_SOMETHING_NEW")).toBe("알 수 없는 이유로 처리하지 못했습니다.");
    expect(labels.failureText(null)).toBeNull();
  });
  it("업로드는 여전히 비활성", () => {
    const panel = html(createElement(MediaUploadPanel, { reason: "원본 직접 업로드 계약의 최종 인수와 실제 저장소 연결 검증 전입니다." }));
    expect(panel).toMatch(/<button[^>]*disabled/);
    expect(panel).not.toMatch(/type="file"/);
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
