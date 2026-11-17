/**
 * QA-UPLOAD-PROXY-ROUTES-055 — grant·complete 라우트 수준 reverse proxy Origin 회귀 시험(QA-REVIEW-UPLOAD-PROXY-ORIGIN-054 F1).
 * 대상: src/app/api/distribution/media/upload/grant/route.ts, .../complete/route.ts (계약 MEDIA_UPLOAD_CONTRACT.md §공통 요청 조건)
 * 격리: server-only, 런타임 deps 조립(media/session.getMediaUploadDeps), 서비스(media/upload.issueUploadGrant·completeUpload)만 mock.
 *       route → upload-http(readJsonBody·Origin 판정·HTTP 매핑)는 실제 코드다.
 *       Origin 판정이 서비스·client 작업보다 먼저인지 보려고 deps 조립·서비스 호출 횟수를 센다.
 * 실제 DB·Storage·네트워크 호출 없음. env는 vi.stubEnv로 넣는 가짜 값이다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SITE = "https://vibe.example"; // NEXT_PUBLIC_SITE_URL(공개 사이트 origin)
const INTERNAL = "http://localhost:3000"; // proxy 뒤 Next 서버가 보는 내부 request.url origin
const GRANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NONCE = "N".repeat(43);

const h = vi.hoisted(() => ({
  depsCalls: 0,
  issueCalls: [] as Array<[unknown, Record<string, unknown>]>,
  completeCalls: [] as Array<[unknown, Record<string, unknown>]>,
  deps: { marker: "deps" } as unknown,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/distribution/media/session", () => ({
  getMediaUploadDeps: () => {
    h.depsCalls++;
    return h.deps;
  },
}));
vi.mock("@/server/distribution/media/upload", () => ({
  issueUploadGrant: async (deps: unknown, input: Record<string, unknown>) => {
    h.issueCalls.push([deps, input]);
    return {
      status: "issued",
      grant: {
        grantId: GRANT, assetId: ASSET, rowVersion: 1, nonce: NONCE, grantExpiresAt: "2026-11-17T00:15:00Z",
        upload: { url: { reveal: () => "https://storage.fake/signed" }, method: "PUT", headers: { "content-type": "image/png" }, storageTokenDocumentedTtlSeconds: 7200 },
      },
    };
  },
  completeUpload: async (deps: unknown, input: Record<string, unknown>) => {
    h.completeCalls.push([deps, input]);
    return { status: "ready", asset: { id: ASSET, rowVersion: 2 } };
  },
}));

type RouteName = "grant" | "complete";
const BODY: Record<RouteName, Record<string, unknown>> = {
  grant: { source: "own_creation", contentType: "image/png", byteSize: 1234 },
  complete: { grantId: GRANT, nonce: NONCE, expectedVersion: 1 },
};
const PATH = (r: RouteName) => `/api/distribution/media/upload/${r}`;

function req(r: RouteName, opts: { origin?: string | null; url?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(opts.headers ?? {});
  headers.set("content-type", "application/json");
  const origin = opts.origin === undefined ? SITE : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  return new Request(opts.url ?? `${INTERNAL}${PATH(r)}`, { method: "POST", headers, body: JSON.stringify(BODY[r]) });
}
async function call(r: RouteName, request: Request) {
  const mod = r === "grant" ? await import("@/app/api/distribution/media/upload/grant/route") : await import("@/app/api/distribution/media/upload/complete/route");
  const res = await mod.POST(request);
  const text = await res.text();
  return { res, text, json: JSON.parse(text) as Record<string, unknown> };
}
const serviceCalls = (r: RouteName) => (r === "grant" ? h.issueCalls : h.completeCalls);
function expectSafeHeaders(res: Response) {
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
}
function expectRejectedBeforeWork(r: RouteName, res: Response, json: Record<string, unknown>) {
  expect(res.status).toBe(400);
  expect(json).toEqual({ status: "invalid_request" });
  expectSafeHeaders(res);
  expect(h.depsCalls).toBe(0); // service client·actor·storage 조립 전
  expect(serviceCalls(r)).toHaveLength(0);
  expect(h.issueCalls).toHaveLength(0);
  expect(h.completeCalls).toHaveLength(0);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  h.depsCalls = 0;
  h.issueCalls = [];
  h.completeCalls = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
});

for (const r of ["grant", "complete"] as const) {
  describe(`${r} 라우트 — reverse proxy 뒤 Origin 기준(QA-UPLOAD-PROXY-ROUTES-055)`, () => {
    it("내부 localhost request.url + Origin = NEXT_PUBLIC_SITE_URL → 통과해 서비스 1회 위임", async () => {
      const { res, json } = await call(r, req(r, { headers: { host: "localhost:3000" } }));
      expect(res.status).toBe(200);
      expectSafeHeaders(res);
      expect(json.status).toBe(r === "grant" ? "issued" : "ready");
      expect(h.depsCalls).toBe(1);
      const calls = serviceCalls(r);
      expect(calls).toHaveLength(1);
      const [deps, input] = calls[0] ?? [];
      expect(deps).toBe(h.deps);
      expect(input).toMatchObject(BODY[r]);
    });

    it("내부 127.0.0.1 request.url + 공개 Origin(proxy가 x-forwarded-host로 공개 host 전달) → 통과", async () => {
      const { res } = await call(r, req(r, { url: `http://127.0.0.1:3000${PATH(r)}`, headers: { host: "127.0.0.1:3000", "x-forwarded-host": "vibe.example", "x-forwarded-proto": "https" } }));
      expect(res.status).toBe(200);
      expect(serviceCalls(r)).toHaveLength(1);
    });

    it("request.url이 공개 origin이어도 판정은 같다(설정 Origin → 통과)", async () => {
      const { res } = await call(r, req(r, { url: `${SITE}${PATH(r)}` }));
      expect(res.status).toBe(200);
      expect(serviceCalls(r)).toHaveLength(1);
    });

    const foreign: Array<[string, string | null]> = [
      ["외부 도메인", "https://evil.example"],
      ["내부 request.url과 같은 Origin(설정 아님)", INTERNAL],
      ["같은 host 다른 scheme", "http://vibe.example"],
      ["같은 host 다른 port", "https://vibe.example:8443"],
      ["하위 도메인", "https://www.vibe.example"],
      ["접미 도메인", "https://vibe.example.evil.example"],
      ["끝 슬래시", "https://vibe.example/"],
      ["Origin 'null'", "null"],
      ["Origin 빈 값", ""],
      ["Origin 없음", null],
    ];
    for (const [name, origin] of foreign) {
      it(`불일치 Origin(${name}) → 400 invalid_request, deps·서비스 0회`, async () => {
        const { res, json } = await call(r, req(r, { origin }));
        expectRejectedBeforeWork(r, res, json);
      });
    }

    const spoofs: Array<[string, Record<string, string>]> = [
      ["Host를 공격자 host로", { host: "evil.example" }],
      ["x-forwarded-host·proto를 공격자 값으로", { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" }],
      ["Forwarded를 공격자 값으로", { forwarded: "host=evil.example;proto=https" }],
      ["Host·x-forwarded-host·Forwarded 모두 공격자 값", { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https", forwarded: "host=evil.example;proto=https" }],
    ];
    for (const [name, headers] of spoofs) {
      it(`${name} 위조 + Origin https://evil.example → 거절(우회 불가)`, async () => {
        const { res, json } = await call(r, req(r, { origin: "https://evil.example", headers }));
        expectRejectedBeforeWork(r, res, json);
      });
      it(`${name} 위조 + request.url도 공격자 origin → 여전히 거절`, async () => {
        const { res, json } = await call(r, req(r, { url: `https://evil.example${PATH(r)}`, origin: "https://evil.example", headers }));
        expectRejectedBeforeWork(r, res, json);
      });
    }

    it("x-forwarded-host를 설정 host로 위조해도 공격자 Origin은 거절", async () => {
      const { res, json } = await call(r, req(r, { origin: "https://evil.example", headers: { host: "vibe.example", "x-forwarded-host": "vibe.example", "x-forwarded-proto": "https" } }));
      expectRejectedBeforeWork(r, res, json);
    });

    for (const [name, value] of [["없음", ""], ["형식 오류", "not a url"], ["https 아님", "http://vibe.example"], ["경로 포함", "https://vibe.example/x"]] as const) {
      it(`NEXT_PUBLIC_SITE_URL ${name} → 공개 Origin 요청도 거절(fail closed)`, async () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_URL", value);
        const { res, json } = await call(r, req(r));
        expectRejectedBeforeWork(r, res, json);
      });
    }
  });
}
