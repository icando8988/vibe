/**
 * FE-MEDIA-024 — 미디어 server action·목록 조회 함수 단위 시험(서버 모듈은 mock, 실제 DB·Storage 없음).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = { decideRights: vi.fn(), archiveAsset: vi.fn(), listAssets: vi.fn() };
const readiness = { value: { metadata: true, upload: false, preview: false, storageVerified: false, missing: ["storage_adapter"] as string[] } };
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});

vi.mock("server-only", () => ({}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
vi.mock("@/server/distribution/media/session", () => ({
  getMediaMetadataDeps: () => ({ tag: "metadata-deps" }),
  mediaReadiness: () => readiness.value,
}));
vi.mock("@/server/distribution/media/service", () => svc);

const { decideMediaRightsAction, archiveMediaAssetAction } = await import("@/app/admin/distribution/media/actions");
const { loadMediaList } = await import("@/app/admin/distribution/media/load");

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const prev = { notice: null, fields: [], seq: 3 };
const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const okAsset = { status: "ok", asset: { id: ID } };

beforeEach(() => {
  svc.decideRights.mockReset();
  svc.archiveAsset.mockReset();
  svc.listAssets.mockReset();
  redirect.mockClear();
  readiness.value = { metadata: true, upload: false, preview: false, storageVerified: false, missing: ["storage_adapter"] };
});

describe("권리 결정 action", () => {
  it("렌더 version·채널·KST 유효기한을 그대로 넘기고 성공 시 redirect", async () => {
    svc.decideRights.mockResolvedValue(okAsset);
    await expect(decideMediaRightsAction(prev, fd({ assetId: ID, expectedVersion: "4", decision: "approved", allowedChannels: ["instagram", "threads"], validUntil: "2026-12-01T09:00", note: "자체 촬영" }))).rejects.toThrow(`REDIRECT /admin/distribution/media/${ID}?notice=saved`);
    expect(svc.decideRights).toHaveBeenCalledWith({ tag: "metadata-deps" }, {
      assetId: ID, expectedVersion: 4, decision: "approved", allowedChannels: ["instagram", "threads"], validUntil: "2026-12-01T00:00:00.000Z", note: "자체 촬영",
    });
  });
  it("철회·반려는 채널·기한을 보내지 않음, 잘못된 KST 형식은 서비스 호출 전 거절", async () => {
    svc.decideRights.mockResolvedValue(okAsset);
    await expect(decideMediaRightsAction(prev, fd({ assetId: ID, expectedVersion: "5", decision: "revoked", allowedChannels: "instagram" }))).rejects.toThrow("REDIRECT");
    expect(svc.decideRights.mock.calls[0]?.[1]).toMatchObject({ decision: "revoked", allowedChannels: undefined, validUntil: undefined });
    svc.decideRights.mockClear();
    expect(await decideMediaRightsAction(prev, fd({ assetId: ID, expectedVersion: "5", decision: "approved", validUntil: "내일" }))).toEqual({ notice: "invalid", fields: ["validUntil"], seq: 4 });
    expect(svc.decideRights).not.toHaveBeenCalled();
  });
  it("실패: 버전 충돌·전이 불가·거절 사유·권한·준비 전·결과 불명(재시도 없음)", async () => {
    const cases: Array<[unknown, { notice: string; fields: string[] }]> = [
      [{ status: "db_error", error: { code: "conflict_version", token: "VERSION_CONFLICT", sqlstate: "P0001" } }, { notice: "conflict_version", fields: [] }],
      [{ status: "db_error", error: { code: "invalid_transition", token: "INVALID_TRANSITION", sqlstate: "23514" } }, { notice: "invalid_transition", fields: [] }],
      [{ status: "db_error", error: { code: "invalid_input", token: "MEDIA_NOT_READY", sqlstate: "23514" } }, { notice: "invalid", fields: ["reason:media_not_ready"] }],
      [{ status: "denied" }, { notice: "denied", fields: [] }],
      [{ status: "not_ready" }, { notice: "not_ready", fields: [] }],
      [{ status: "invalid", field: "allowedChannels" }, { notice: "invalid", fields: ["allowedChannels"] }],
      [{ status: "bad_response" }, { notice: "uncertain", fields: [] }],
      [{ status: "db_error", error: { code: "unavailable", token: null, sqlstate: null } }, { notice: "uncertain", fields: [] }],
    ];
    for (const [r, want] of cases) {
      svc.decideRights.mockReset();
      svc.decideRights.mockResolvedValue(r);
      expect(await decideMediaRightsAction(prev, fd({ assetId: ID, expectedVersion: "4", decision: "approved", allowedChannels: "instagram" }))).toEqual({ ...want, seq: 4 });
      expect(svc.decideRights).toHaveBeenCalledTimes(1);
    }
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("FE-MEDIA-FIX-029 핵심 동작 회귀(실제 action 실행, 서비스 mock)", () => {
  it("승인: 잘못된 기한은 서비스 호출 전 validUntil 오류", async () => {
    for (const bad of ["2026-12-01", "2026-13-40T25:99", "내일"]) {
      svc.decideRights.mockReset();
      expect(await decideMediaRightsAction(prev, fd({ assetId: ID, expectedVersion: "4", decision: "approved", allowedChannels: "blog", validUntil: bad }))).toEqual({ notice: "invalid", fields: ["validUntil"], seq: 4 });
      expect(svc.decideRights).not.toHaveBeenCalled();
    }
  });
  it("반려·철회: 폼에 남은 잘못된 기한·채널은 막지 않고 보내지 않는다", async () => {
    for (const decision of ["rejected", "revoked"]) {
      svc.decideRights.mockReset();
      svc.decideRights.mockResolvedValue(okAsset);
      await expect(decideMediaRightsAction(prev, fd({ assetId: ID, expectedVersion: "6", decision, allowedChannels: "blog", validUntil: "잘못된 값", note: "출처 불명" }))).rejects.toThrow("REDIRECT");
      expect(svc.decideRights).toHaveBeenCalledTimes(1);
      expect(svc.decideRights.mock.calls[0]?.[1]).toEqual({ assetId: ID, expectedVersion: 6, decision, allowedChannels: undefined, validUntil: undefined, note: "출처 불명" });
    }
  });
  it("사유 제어문자·1001자는 서비스 호출 전 note 오류(입력은 폼에 남음), 1000자·빈 사유는 통과", async () => {
    for (const note of ["첫 줄\n둘째 줄", "탭\t포함", "가".repeat(1001)]) {
      svc.decideRights.mockReset();
      expect(await decideMediaRightsAction(prev, fd({ assetId: ID, expectedVersion: "4", decision: "rejected", note }))).toEqual({ notice: "invalid", fields: ["note"], seq: 4 });
      expect(svc.decideRights).not.toHaveBeenCalled();
    }
    for (const note of ["가".repeat(1000), ""]) {
      svc.decideRights.mockReset();
      svc.decideRights.mockResolvedValue(okAsset);
      await expect(decideMediaRightsAction(prev, fd({ assetId: ID, expectedVersion: "4", decision: "rejected", note }))).rejects.toThrow("REDIRECT");
      expect(svc.decideRights.mock.calls[0]?.[1]).toMatchObject({ note });
    }
  });
  it("보관 성공: redirect·revalidate는 제출 ID가 아니라 서버 반환 ID", async () => {
    const SUBMITTED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const SERVER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    revalidatePath.mockClear();
    svc.archiveAsset.mockResolvedValue({ status: "ok", asset: { id: SERVER } });
    await expect(archiveMediaAssetAction(prev, fd({ assetId: SUBMITTED, expectedVersion: "4", confirmArchive: "on" }))).rejects.toThrow(`REDIRECT /admin/distribution/media/${SERVER}?notice=saved`);
    expect(svc.archiveAsset).toHaveBeenCalledWith({ tag: "metadata-deps" }, { assetId: SUBMITTED, expectedVersion: 4 });
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/distribution/media/${SERVER}`);
    expect(revalidatePath).not.toHaveBeenCalledWith(`/admin/distribution/media/${SUBMITTED}`);
  });
  it("권리 결정 성공도 서버 반환 ID로 redirect·revalidate", async () => {
    const SERVER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    revalidatePath.mockClear();
    svc.decideRights.mockResolvedValue({ status: "ok", asset: { id: SERVER } });
    await expect(decideMediaRightsAction(prev, fd({ assetId: ID, expectedVersion: "4", decision: "rejected" }))).rejects.toThrow(`REDIRECT /admin/distribution/media/${SERVER}?notice=saved`);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/distribution/media/${SERVER}`);
    expect(revalidatePath).not.toHaveBeenCalledWith(`/admin/distribution/media/${ID}`);
  });
  it("충돌 실패는 재시도·redirect 없이 한 번만 호출하고 버전을 바꾸지 않는다", async () => {
    svc.decideRights.mockResolvedValue({ status: "db_error", error: { code: "conflict_version", token: "VERSION_CONFLICT", sqlstate: "P0001" } });
    expect(await decideMediaRightsAction(prev, fd({ assetId: ID, expectedVersion: "4", decision: "rejected" }))).toEqual({ notice: "conflict_version", fields: [], seq: 4 });
    expect(svc.decideRights).toHaveBeenCalledTimes(1);
    expect(svc.decideRights.mock.calls[0]?.[1]).toMatchObject({ expectedVersion: 4 });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("보관 action", () => {
  it("확인 체크 없으면 서비스 호출 없음", async () => {
    expect(await archiveMediaAssetAction(prev, fd({ assetId: ID, expectedVersion: "4" }))).toEqual({ notice: "invalid", fields: ["confirmArchive"], seq: 4 });
    expect(svc.archiveAsset).not.toHaveBeenCalled();
  });
  it("사용 중 자산 거부 → 사유 안내, 성공 → redirect", async () => {
    svc.archiveAsset.mockResolvedValue({ status: "db_error", error: { code: "invalid_input", token: "ASSET_REFERENCED", sqlstate: "23514" } });
    expect(await archiveMediaAssetAction(prev, fd({ assetId: ID, expectedVersion: "4", confirmArchive: "on" }))).toEqual({ notice: "invalid", fields: ["reason:asset_referenced"], seq: 4 });
    expect(svc.archiveAsset).toHaveBeenCalledWith({ tag: "metadata-deps" }, { assetId: ID, expectedVersion: 4 });
    svc.archiveAsset.mockResolvedValue(okAsset);
    await expect(archiveMediaAssetAction(prev, fd({ assetId: ID, expectedVersion: "4", confirmArchive: "on" }))).rejects.toThrow("REDIRECT");
  });
});

describe("목록 조회 함수: 설정 신호 ≠ DB 성공", () => {
  it("metadata=false → 서버 호출 없이 준비 전(빠진 설정 이름만)", async () => {
    readiness.value = { metadata: false, upload: false, preview: false, storageVerified: false, missing: ["service_client", "storage_adapter"] };
    const r = await loadMediaList();
    expect(r.view.state).toBe("not_ready");
    expect(r.view.state === "not_ready" && r.view.reason).toContain("서버 저장 연결");
    expect(r.assets).toBeNull();
    expect(svc.listAssets).not.toHaveBeenCalled();
  });
  it("metadata=true여도 조회 실패면 오류(0건 아님), 성공일 때만 목록", async () => {
    svc.listAssets.mockResolvedValue({ status: "db_error", error: { code: "unexpected", token: null, sqlstate: "XX000" } });
    expect(await loadMediaList()).toEqual({ view: { state: "error", kind: "db" }, assets: null });
    svc.listAssets.mockResolvedValue({ status: "db_error", error: { code: "unavailable", token: null, sqlstate: null } });
    expect(await loadMediaList()).toEqual({ view: { state: "error", kind: "unavailable" }, assets: null });
    svc.listAssets.mockResolvedValue({ status: "bad_response" });
    expect(await loadMediaList()).toEqual({ view: { state: "error", kind: "bad_response" }, assets: null });
    svc.listAssets.mockResolvedValue({ status: "denied" });
    expect((await loadMediaList()).view.state).toBe("denied");
    svc.listAssets.mockResolvedValue({ status: "ok", assets: [] });
    expect(await loadMediaList()).toEqual({ view: { state: "ok", assets: [] }, assets: [] });
    expect(svc.listAssets).toHaveBeenCalledWith({ tag: "metadata-deps" });
  });
});
