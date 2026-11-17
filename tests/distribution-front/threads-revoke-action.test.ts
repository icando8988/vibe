/**
 * BE-THREADS-REVOKE-GUARD-059: Threads 연결 해제 Server Action 사전 확인.
 * 확인 체크 → id/버전 형식 → 본인 범위 listConnections → channel=threads·rowVersion 일치 → revokeConnection 1회.
 * 대역(mock)만 사용 — 실제 DB·공급자·브라우저 없음.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  listed: { status: "ok", connections: [] as unknown[] } as Record<string, unknown>,
  list: vi.fn(),
  revoke: vi.fn(),
  redirect: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => env.revalidate(p) }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    env.redirect(u);
    throw new Error(`REDIRECT:${u}`);
  },
}));
vi.mock("@/server/distribution/actor", () => ({ requireDistributionActor: async () => ({ ok: true }) }));
vi.mock("@/server/distribution/blog/service", () => ({ getServiceRpcClient: () => null }));
vi.mock("@/server/distribution/connections/service", () => ({
  listConnections: async () => {
    env.list();
    return env.listed;
  },
  revokeConnection: async (_deps: unknown, input: unknown) => env.revoke(input),
}));

const { revokeThreadsConnectionAction } = await import("@/app/admin/distribution/connections/threads/actions");

const TH1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const IG1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const conn = (o: Record<string, unknown> = {}) => ({
  id: TH1, channel: "threads", providerAccountId: "TH-1", accountLabel: null, scopes: ["threads_basic", "threads_content_publish"],
  status: "connected", reauthReason: null, expiresAt: "2027-01-16T00:00:00Z", expired: false, keyVersion: 1, hasCredential: true, rowVersion: 3,
  createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z", revokedAt: null, ...o,
});
const PREV = { notice: null, fields: [], seq: 0 };
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
const ok = (o: Record<string, string> = {}) => fd({ connectionId: TH1, expectedVersion: "3", confirmRevoke: "on", ...o });

beforeEach(() => {
  env.listed = { status: "ok", connections: [conn(), conn({ id: IG1, channel: "instagram", providerAccountId: "17841400000000001" })] };
  env.list.mockReset();
  env.revoke.mockReset();
  env.redirect.mockReset();
  env.revalidate.mockReset();
});

const expectNoRevoke = () => {
  expect(env.revoke).not.toHaveBeenCalled();
  expect(env.redirect).not.toHaveBeenCalled();
  expect(env.revalidate).not.toHaveBeenCalled();
};

describe("revokeThreadsConnectionAction 사전 확인", () => {
  it("유효한 Threads 대상: revokeConnection 정확히 1회, 성공 시 기존과 같은 saved redirect", async () => {
    env.revoke.mockResolvedValue({ status: "ok", value: {} });
    await expect(revokeThreadsConnectionAction(PREV, ok({ reason: "교체" }))).rejects.toThrow("REDIRECT:/admin/distribution/connections/threads?notice=saved");
    expect(env.list).toHaveBeenCalledTimes(1);
    expect(env.revoke).toHaveBeenCalledTimes(1);
    expect(env.revoke).toHaveBeenCalledWith({ connectionId: TH1, expectedVersion: 3, reason: "교체" });
    expect(env.revalidate).toHaveBeenCalledWith("/admin/distribution/connections/threads");
  });

  it("사유가 비면 reason=null로 전달", async () => {
    env.revoke.mockResolvedValue({ status: "ok", value: {} });
    await expect(revokeThreadsConnectionAction(PREV, ok({ reason: "" }))).rejects.toThrow("REDIRECT:");
    expect(env.revoke).toHaveBeenCalledWith({ connectionId: TH1, expectedVersion: 3, reason: null });
  });

  it("확인 체크 없음·다른 값이면 조회·해제 없이 invalid(confirmRevoke)", async () => {
    for (const f of [fd({ connectionId: TH1, expectedVersion: "3" }), fd({ connectionId: TH1, expectedVersion: "3", confirmRevoke: "yes" })]) {
      const st = await revokeThreadsConnectionAction(PREV, f);
      expect(st).toMatchObject({ notice: "invalid", fields: ["confirmRevoke"] });
    }
    expect(env.list).not.toHaveBeenCalled();
    expectNoRevoke();
  });

  it("Instagram 연결 id·목록에 없는 id는 RPC 0회로 거절(invalid connectionId)", async () => {
    for (const id of [IG1, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"]) {
      const st = await revokeThreadsConnectionAction(PREV, ok({ connectionId: id }));
      expect(st).toMatchObject({ notice: "invalid", fields: ["connectionId"] });
    }
    expectNoRevoke();
  });

  it("목록 조회 실패(db_error·not_ready·denied·bad_response)면 해제 시도 없이 실패 안내", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ status: "db_error", error: { code: "unavailable", token: null, sqlstate: null } }, "uncertain"],
      [{ status: "not_ready" }, "not_ready"],
      [{ status: "denied" }, "denied"],
      [{ status: "bad_response" }, "uncertain"],
    ];
    for (const [listed, notice] of cases) {
      env.listed = listed;
      expect((await revokeThreadsConnectionAction(PREV, ok())).notice).toBe(notice);
    }
    expectNoRevoke();
  });

  it("렌더 버전과 현재 rowVersion이 다르면 RPC 0회 conflict_version", async () => {
    for (const v of ["2", "4"]) {
      const st = await revokeThreadsConnectionAction(PREV, ok({ expectedVersion: v }));
      expect(st).toMatchObject({ notice: "conflict_version", fields: [] });
    }
    expectNoRevoke();
  });

  it("잘못된 id·버전 형식은 목록 조회 전에 거절", async () => {
    for (const v of ["abc", "0", "03", "-1", "1.5", "1234567890", " 3", ""]) {
      expect((await revokeThreadsConnectionAction(PREV, ok({ expectedVersion: v }))).fields).toEqual(["expectedVersion"]);
    }
    expect((await revokeThreadsConnectionAction(PREV, fd({ connectionId: TH1, confirmRevoke: "on" }))).fields).toEqual(["expectedVersion"]);
    expect((await revokeThreadsConnectionAction(PREV, fd({ expectedVersion: "3", confirmRevoke: "on" }))).fields).toEqual(["connectionId"]);
    expect((await revokeThreadsConnectionAction(PREV, ok({ connectionId: "" }))).fields).toEqual(["connectionId"]);
    const file = new FormData();
    file.append("connectionId", new Blob([TH1]), "id.txt");
    file.append("expectedVersion", "3");
    file.append("confirmRevoke", "on");
    expect((await revokeThreadsConnectionAction(PREV, file)).fields).toEqual(["connectionId"]);
    expect(env.list).not.toHaveBeenCalled();
    expectNoRevoke();
  });

  it("사전 확인 통과 뒤 서버 실패는 그대로 실패 상태(1회, 재전송·redirect 없음), seq 증가", async () => {
    env.revoke.mockResolvedValue({ status: "db_error", error: { code: "conflict_version", token: null, sqlstate: "40001" } });
    const st = await revokeThreadsConnectionAction({ notice: null, fields: [], seq: 4 }, ok());
    expect(env.revoke).toHaveBeenCalledTimes(1);
    expect(st).toEqual({ notice: "conflict_version", fields: [], seq: 5 });
    expect(env.redirect).not.toHaveBeenCalled();
  });
});
