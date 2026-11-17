/**
 * AUTOPOST-INSTAGRAM-PORT-021 — Instagram 단일 이미지 게시 부품 단위 검증(mock fetch). 실제 Meta 호출 없음.
 * 토큰·이미지 서명 URL은 단언 값으로 출력하지 않는다(includes → boolean).
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as client from "@/server/distribution/instagram/client";
import {
  canRequestPublish,
  combinePublishOutcome,
  createImageContainer,
  getContainerStatus,
  getPermalink,
  isAcceptableImageUrl,
  publishContainer,
} from "@/server/distribution/instagram/client";
import type { IgHttpDeps } from "@/server/distribution/instagram/types";

const TOKEN = `IGtest_${randomBytes(18).toString("hex")}`;
const SIG = randomBytes(12).toString("hex");
const IMAGE = `https://media.example.com/assets/a.jpg?sig=${SIG}&exp=1`;
const IG = "17841400000000001";
const CONTAINER = "17889455560051444";
const MEDIA = "17895695668004550";
const BASE = "https://graph.instagram.com/v27.0";

type Call = { url: string; init: RequestInit };
function mock(responses: Array<{ status: number; body?: unknown } | "timeout" | "network">) {
  const calls: Call[] = [];
  let i = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (!r) throw new Error("no response");
    if (r === "network") throw new TypeError(`fetch failed ${url}`);
    if (r === "timeout") return new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  });
  return { deps: { fetch, timeoutMs: 30 } as IgHttpDeps, calls, fetch };
}
const at = (calls: Call[], i = 0): Call => {
  const c = calls[i];
  if (!c) throw new Error("no call");
  return c;
};
const leaks = (x: unknown) => JSON.stringify(x).includes(TOKEN) || JSON.stringify(x).includes(SIG);

describe("경계", () => {
  it("일괄 publish helper 없음(단계 분리), 공개 함수 목록 고정", () => {
    expect(Object.keys(client).sort()).toEqual(
      ["IG_ALT_TEXT_MAX", "IG_CAPTION_MAX", "IG_GRAPH_HOST", "IG_GRAPH_VERSION", "canRequestPublish", "combinePublishOutcome", "createImageContainer", "getContainerStatus", "getPermalink", "isAcceptableImageUrl", "isInstagramPermalink", "publishContainer"].sort(),
    );
    expect("publishInstagramPost" in client || "publishInstagramCarousel" in client).toBe(false);
  });
  it("이미지 URL 형식 검사(다운로드 안 함): https·호스트·자격정보·fragment·길이·제어문자", () => {
    expect(isAcceptableImageUrl(IMAGE)).toBe(true);
    for (const bad of ["http://media.example.com/a.jpg", "https://u:p@media.example.com/a.jpg", "https://media.example.com/a.jpg#x", "https://localhost/a.jpg", "file:///etc/passwd", "javascript:alert(1)", `https://media.example.com/${"a".repeat(2100)}.jpg`, "https://media.example.com/a b.jpg", 42]) {
      expect(isAcceptableImageUrl(bad)).toBe(false);
    }
  });
});

describe("컨테이너 생성", () => {
  it("POST 1회, 공식 호스트·버전, Bearer 헤더 + JSON 본문(URL·본문에 토큰 없음), publish 미호출", async () => {
    const { deps, calls } = mock([{ status: 200, body: { id: CONTAINER } }]);
    const r = await createImageContainer(deps, { accessToken: TOKEN, igUserId: IG, imageUrl: IMAGE, caption: "캡션\n둘째 줄", altText: "대체 텍스트" });
    expect(r).toEqual({ ok: true, containerId: CONTAINER });
    expect(calls).toHaveLength(1);
    const c = at(calls);
    expect(c.url).toBe(`${BASE}/${IG}/media`);
    expect(c.init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect((c.init.headers as Record<string, string>).Authorization === `Bearer ${TOKEN}`).toBe(true);
    expect(c.url.includes(TOKEN) || String(c.init.body).includes(TOKEN)).toBe(false);
    expect(JSON.parse(String(c.init.body))).toEqual({ image_url: IMAGE, caption: "캡션\n둘째 줄", alt_text: "대체 텍스트" });
    expect(calls.some((x) => x.url.includes("media_publish"))).toBe(false);
  });
  it("잘못된 입력 → 요청 0회", async () => {
    const { deps, fetch } = mock([{ status: 200, body: { id: CONTAINER } }]);
    expect((await createImageContainer(deps, { accessToken: TOKEN, igUserId: IG, imageUrl: "http://x.example.com/a.jpg" })).ok).toBe(false);
    expect((await createImageContainer(deps, { accessToken: TOKEN, igUserId: "../me", imageUrl: IMAGE })).ok).toBe(false);
    expect((await createImageContainer(deps, { accessToken: TOKEN, igUserId: IG, imageUrl: IMAGE, caption: "가".repeat(2201) })).ok).toBe(false);
    expect((await createImageContainer(deps, { accessToken: "short", igUserId: IG, imageUrl: IMAGE })).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("timeout·유실 → definite=false(재시도 없음), 4xx → definite=true, 결과에 토큰·서명 없음", async () => {
    const t = mock(["timeout"]);
    const r1 = await createImageContainer(t.deps, { accessToken: TOKEN, igUserId: IG, imageUrl: IMAGE });
    expect(r1).toEqual({ ok: false, definite: false, error: { code: "timeout", httpStatus: null, providerCode: null } });
    expect(t.fetch).toHaveBeenCalledTimes(1);
    const r2 = await createImageContainer(mock([{ status: 400, body: { error: { message: `bad image ${IMAGE} ${TOKEN}`, code: 36003 } } }]).deps, { accessToken: TOKEN, igUserId: IG, imageUrl: IMAGE });
    expect(r2).toEqual({ ok: false, definite: true, error: { code: "rejected", httpStatus: 400, providerCode: 36003 } });
    expect(leaks(r1) || leaks(r2)).toBe(false);
  });
  it("redirect 응답은 fetch 거부(redirect:error) → network 분류", async () => {
    const { deps, calls } = mock(["network"]);
    expect((await createImageContainer(deps, { accessToken: TOKEN, igUserId: IG, imageUrl: IMAGE })).ok).toBe(false);
    expect(at(calls).init.redirect).toBe("error");
  });
});

describe("상태 조회", () => {
  it("GET 1회(문서 규격 access_token 쿼리), 공식 5개 값만 수용, 결과에 URL·토큰 없음", async () => {
    for (const s of ["EXPIRED", "ERROR", "FINISHED", "IN_PROGRESS", "PUBLISHED"]) {
      const { deps, calls } = mock([{ status: 200, body: { status_code: s, id: CONTAINER } }]);
      const r = await getContainerStatus(deps, { accessToken: TOKEN, containerId: CONTAINER });
      expect(r).toEqual({ ok: true, status: s });
      expect(leaks(r)).toBe(false);
      const u = new URL(at(calls).url);
      expect([`${u.origin}${u.pathname}`, u.searchParams.get("fields")]).toEqual([`${BASE}/${CONTAINER}`, "status_code"]);
      expect(at(calls).init.method).toBe("GET");
    }
    expect((await getContainerStatus(mock([{ status: 200, body: { status_code: "DONE" } }]).deps, { accessToken: TOKEN, containerId: CONTAINER })).ok).toBe(false);
    expect((await getContainerStatus(mock([]).deps, { accessToken: TOKEN, containerId: "x/y" })).ok).toBe(false);
  });
  it("게시 요청은 FINISHED에서만(FINISHED ≠ 게시됨, PUBLISHED도 요청 대상 아님)", () => {
    expect(canRequestPublish("FINISHED")).toBe(true);
    for (const s of ["IN_PROGRESS", "ERROR", "EXPIRED", "PUBLISHED"] as const) expect(canRequestPublish(s)).toBe(false);
  });
});

describe("media_publish", () => {
  it("성공: POST 1회, Bearer + creation_id, config_issue는 부분 성공 표시", async () => {
    const { deps, calls } = mock([{ status: 200, body: { id: MEDIA } }]);
    expect(await publishContainer(deps, { accessToken: TOKEN, igUserId: IG, containerId: CONTAINER })).toEqual({ kind: "published", mediaId: MEDIA, hasConfigIssue: false });
    expect(calls).toHaveLength(1);
    expect(at(calls).url).toBe(`${BASE}/${IG}/media_publish`);
    expect(JSON.parse(String(at(calls).init.body))).toEqual({ creation_id: CONTAINER });
    expect(await publishContainer(mock([{ status: 200, body: { id: MEDIA, config_issue: "CAPTION_NOT_ATTACHED" } }]).deps, { accessToken: TOKEN, igUserId: IG, containerId: CONTAINER })).toEqual({ kind: "published", mediaId: MEDIA, hasConfigIssue: true });
  });
  it("timeout·응답 유실·5xx·2xx 무ID → unknown, 자동 재전송 0회(원본 Timeout 재시도 제거)", async () => {
    for (const r of ["timeout", "network", { status: 500, body: { error: { message: "Timeout", code: 2 } } }, { status: 200, body: {} }] as const) {
      const m = mock([r, { status: 200, body: { id: MEDIA } }]);
      const out = await publishContainer(m.deps, { accessToken: TOKEN, igUserId: IG, containerId: CONTAINER });
      expect(out.kind).toBe("unknown");
      expect(m.fetch).toHaveBeenCalledTimes(1);
      expect(leaks(out)).toBe(false);
    }
  });
  it("4xx 명시 거절 → rejected(공급자 메시지 폐기), 190 → auth, 한도 → rate_limited", async () => {
    const r = await publishContainer(mock([{ status: 400, body: { error: { message: `Media ID is not available ${TOKEN}`, code: 9007 } } }]).deps, { accessToken: TOKEN, igUserId: IG, containerId: CONTAINER });
    expect(r).toEqual({ kind: "rejected", error: { code: "rejected", httpStatus: 400, providerCode: 9007 } });
    expect(leaks(r)).toBe(false);
    expect(await publishContainer(mock([{ status: 400, body: { error: { code: 190 } } }]).deps, { accessToken: TOKEN, igUserId: IG, containerId: CONTAINER })).toMatchObject({ kind: "rejected", error: { code: "auth" } });
    expect(await publishContainer(mock([{ status: 429, body: { error: { code: 4 } } }]).deps, { accessToken: TOKEN, igUserId: IG, containerId: CONTAINER })).toMatchObject({ kind: "rejected", error: { code: "rate_limited" } });
  });
});

describe("permalink", () => {
  it("게시 확인 뒤 permalink 실패 → 게시 확인 + URL 미확인(실패 아님), 다른 호스트 거절", async () => {
    const pub = await publishContainer(mock([{ status: 200, body: { id: MEDIA } }]).deps, { accessToken: TOKEN, igUserId: IG, containerId: CONTAINER });
    const fail = await getPermalink(mock(["timeout"]).deps, { accessToken: TOKEN, mediaId: MEDIA });
    expect(combinePublishOutcome(pub, fail)).toEqual({ kind: "published", mediaId: MEDIA, permalink: null, urlConfirmed: false });
    const okM = mock([{ status: 200, body: { permalink: "https://www.instagram.com/p/abc/" } }]);
    const ok = await getPermalink(okM.deps, { accessToken: TOKEN, mediaId: MEDIA });
    expect(combinePublishOutcome(pub, ok)).toMatchObject({ kind: "published", urlConfirmed: true, permalink: "https://www.instagram.com/p/abc/" });
    expect(new URL(at(okM.calls).url).searchParams.get("fields")).toBe("permalink");
    expect((await getPermalink(mock([{ status: 200, body: { permalink: "https://evil.example/p" } }]).deps, { accessToken: TOKEN, mediaId: MEDIA })).ok).toBe(false);
    expect(combinePublishOutcome({ kind: "unknown", error: { code: "timeout", httpStatus: null, providerCode: null } }, null).kind).toBe("unknown");
  });
});
