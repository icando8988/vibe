/**
 * 글감 수집 화면 회귀(FE task_e3081d32118a, 계약 TOPIC-COLLECT-131 §3).
 * 서버 렌더 문자열 + 순수 판정으로 본다(브라우저 실측 아님). 액션·조회는 vi.mock — 실제 DB·외부 주소·AI 호출 없음.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TopicCandidateDto, TopicListOutcome } from "@/server/distribution/topics/types";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/admin/distribution/topics" }));
const st = vi.hoisted(() => ({
  denied: false,
  writeConfigured: true,
  list: { status: "ok", data: [] } as unknown,
  listCalls: [] as unknown[],
  actions: { create: vi.fn(), status: vi.fn(), convert: vi.fn() },
}));
vi.mock("@/components/distribution-console/guard", () => ({
  denyUnlessDistributionAdmin: async () => (st.denied ? "DENIED-SCREEN" : null),
}));
vi.mock("@/server/distribution/content-page", () => ({ isWriteConfigured: () => st.writeConfigured }));
vi.mock("@/server/distribution/topics/runtime", () => ({
  getTopicCandidates: async (filter: unknown) => {
    st.listCalls.push(filter);
    return st.list;
  },
}));
vi.mock("@/app/admin/distribution/topic-actions", () => ({
  createTopicCandidateAction: st.actions.create,
  setTopicCandidateStatusAction: st.actions.status,
  convertTopicCandidateAction: st.actions.convert,
}));

const Page = (await import("@/app/admin/distribution/topics/page")).default;
const ui = await import("@/components/distribution-console/topic-collector");
const labels = await import("@/components/distribution-console/topic-labels");

const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const CONTENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const cand = (n: number, o: Partial<TopicCandidateDto> = {}): TopicCandidateDto => ({
  id: ID(n),
  title: `글감 ${n}`,
  memo: `메모 ${n}`,
  sourceUrl: null,
  sourceName: null,
  category: null,
  sourceDate: null,
  status: "new",
  convertedContentId: null,
  convertedAt: null,
  collectedBy: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  collectedAt: "2026-11-18T03:00:00Z",
  rowVersion: 1,
  updatedAt: "2026-11-18T03:00:00Z",
  ...o,
});

async function render(status?: string): Promise<string> {
  const el = await Page({ searchParams: Promise.resolve(status === undefined ? {} : { status }) });
  return typeof el === "string" ? el : renderToStaticMarkup(el as ReactElement);
}
/** 후보 id의 li 조각(다음 li 전까지) */
function itemHtml(html: string, id: string): string {
  const start = html.indexOf(`id="topic-${id}"`);
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf("<li id=\"topic-", start + 10);
  return html.slice(start, end === -1 ? undefined : end);
}

beforeEach(() => {
  st.denied = false;
  st.writeConfigured = true;
  st.list = { status: "ok", data: [] };
  st.listCalls = [];
  for (const f of Object.values(st.actions)) f.mockReset();
});

describe("화면 권한·조회 배선", () => {
  it("관리자 가드가 거부하면 목록을 조회하지 않고 거부 화면만 돌려준다", async () => {
    st.denied = true;
    expect(await render()).toBe("DENIED-SCREEN");
    expect(st.listCalls).toEqual([]);
  });

  it("상태 필터는 계약 상태만 전달하고, 모르는 값은 전체로 조회한다", async () => {
    await render("selected");
    await render("hacked");
    await render();
    expect(st.listCalls).toEqual([{ status: "selected" }, {}, {}]);
  });

  it("렌더만으로 쓰기 액션을 호출하지 않는다", async () => {
    st.list = { status: "ok", data: [cand(1), cand(2, { status: "selected" })] };
    await render();
    expect(st.actions.create).not.toHaveBeenCalled();
    expect(st.actions.status).not.toHaveBeenCalled();
    expect(st.actions.convert).not.toHaveBeenCalled();
  });
});

describe("준비 전·조회 실패·0건 구분과 쓰기 잠금", () => {
  const cases: Array<[string, TopicListOutcome, boolean, RegExp]> = [
    ["schema_missing", { status: "schema_missing" }, true, /데이터 구조 미적용/],
    ["not_configured", { status: "not_configured" }, true, /조회 연결이 설정되지 않았습니다/],
    ["error", { status: "error" }, true, /조회에 실패한 상태/],
    ["denied", { status: "denied", reason: "forbidden" }, true, /관리자 권한이 확인되지 않아/],
  ];
  for (const [name, list, , msg] of cases) {
    it(`${name}: 조회 불가 안내 + 등록 폼 잠금(0건 문구 아님)`, async () => {
      st.list = list;
      const html = await render();
      expect(html).toMatch(msg);
      expect(html).not.toContain("아직 등록한 글감 후보가 없습니다");
      expect(html).toContain("<fieldset disabled");
    });
  }

  it("ok 0건: 0건 문구, 쓰기 열림", async () => {
    const html = await render();
    expect(html).toContain("아직 등록한 글감 후보가 없습니다");
    expect(html).not.toContain("<fieldset disabled");
  });

  it("필터 0건은 상태 이름으로 안내", async () => {
    expect(await render("dismissed")).toContain("&quot;제외&quot; 상태의 후보가 없습니다");
  });

  it("목록은 되지만 서버 저장 연결이 없으면 쓰기 잠금", async () => {
    st.writeConfigured = false;
    st.list = { status: "ok", data: [cand(1)] };
    const html = await render();
    expect(html).toContain("서버 저장 연결이 설정되지 않아");
    expect(html).toContain("<fieldset disabled");
    expect(itemHtml(html, ID(1))).toMatch(/<button[^>]*disabled=""[^>]*>고르기/);
  });

  it("topicWriteLock: ok+저장 가능만 null", () => {
    expect(labels.topicWriteLock({ status: "ok", data: [] }, true)).toBeNull();
    expect(labels.topicWriteLock({ status: "ok", data: [] }, false)).not.toBeNull();
    expect(labels.topicWriteLock({ status: "schema_missing" }, true)).not.toBeNull();
  });
});

describe("등록 폼", () => {
  it("메모·출처 링크·분류·출처 날짜 필드가 계약 이름 그대로다", async () => {
    const html = await render();
    for (const name of ["title", "memo", "sourceUrl", "sourceName", "category", "sourceDate"]) expect(html).toContain(`name="${name}"`);
    expect(html).toMatch(/name="title"[^>]*required|required[^>]*name="title"/);
  });
});

describe("후보 목록 표시", () => {
  it("분류·수집 시각(KST)·출처·상태를 보여 준다", async () => {
    st.list = { status: "ok", data: [cand(1, { category: "여행", sourceName: "동네 신문", sourceDate: "2026-11-17" })] };
    const html = itemHtml(await render(), ID(1));
    expect(html).toContain("여행");
    expect(html).toContain('dateTime="2026-11-18T03:00:00Z"');
    expect(html).toContain("KST");
    expect(html).toContain("동네 신문 · 2026-11-17 기준");
    expect(html).toContain("새 후보");
  });

  it("검증된 https 링크만 새 탭(noopener noreferrer)으로, 나머지는 글자로만", async () => {
    st.list = {
      status: "ok",
      data: [
        cand(1, { sourceUrl: "https://example.com/a?b=1" }),
        cand(2, { sourceUrl: "http://example.com/plain" }),
        cand(3, { sourceUrl: "javascript:alert(1)" }),
        cand(4, { sourceUrl: "https://user:pw@example.com/x" }),
      ],
    };
    const html = await render();
    const ok = itemHtml(html, ID(1));
    expect(ok).toMatch(/<a[^>]*href="https:\/\/example.com\/a\?b=1"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    for (const n of [2, 3, 4]) {
      const bad = itemHtml(html, ID(n));
      expect(bad).not.toContain('target="_blank"');
      expect(bad).toContain("링크로 열지 않습니다");
    }
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="http://example.com');
  });

  it("상태별 버튼: new=고르기·제외, selected=고르기 취소·제외+전환 폼, dismissed=되살리기, converted=원고 링크만", async () => {
    st.list = {
      status: "ok",
      data: [
        cand(1),
        cand(2, { status: "selected", title: "고른 글감", memo: "고른 메모 본문" }),
        cand(3, { status: "dismissed" }),
        cand(4, { status: "converted", convertedContentId: CONTENT, convertedAt: "2026-11-18T05:00:00Z" }),
      ],
    };
    const html = await render();
    const n = itemHtml(html, ID(1));
    expect(n).toContain(">고르기</button>");
    expect(n).toContain(">제외</button>");
    expect(n).not.toContain("공통 원고로 전환");

    const s = itemHtml(html, ID(2));
    expect(s).toContain(">고르기 취소</button>");
    expect(s).toContain("공통 원고로 전환");
    expect(s).toMatch(/name="title"[^>]*value="고른 글감"|value="고른 글감"[^>]*name="title"/);
    expect(s).toContain("고른 메모 본문</textarea>");
    expect(s).toMatch(/name="confirmConvert"[^>]*required|required[^>]*name="confirmConvert"/);
    expect(s).not.toContain('name="candidateId"'); // 렌더 값은 제출 시 붙인다(숨은 입력 없음)

    const d = itemHtml(html, ID(3));
    expect(d).toContain(">되살리기</button>");
    expect(d).not.toContain("공통 원고로 전환");

    const c = itemHtml(html, ID(4));
    expect(c).toContain(`href="/admin/distribution/contents/${CONTENT}"`);
    expect(c).toContain("전환된 원고 열기");
    expect(c).not.toContain("</button>");
    expect(c).not.toContain("공통 원고로 전환");
  });

  it("statusMoves는 계약 전이만 낸다", () => {
    expect(ui.statusMoves("new").map((m) => m.to)).toEqual(["selected", "dismissed"]);
    expect(ui.statusMoves("selected").map((m) => m.to)).toEqual(["new", "dismissed"]);
    expect(ui.statusMoves("dismissed").map((m) => m.to)).toEqual(["new"]);
    expect(ui.statusMoves("converted")).toEqual([]);
  });

  it("safeHttpsHref 경계", () => {
    expect(ui.safeHttpsHref("https://example.com")).toBe("https://example.com/");
    expect(ui.safeHttpsHref("HTTPS://Example.com/A")).toBe("https://example.com/A");
    for (const bad of [null, "", "http://a.com", "ftp://a.com", "https://a b.com", "https://u@a.com", "//a.com", "data:text/html,x", `https://a.com/${"x".repeat(2050)}`]) {
      expect(ui.safeHttpsHref(bad)).toBeNull();
    }
  });
});

describe("결과 안내 — 결과 불명은 성공이 아니고, 재시도는 손실 없이", () => {
  const db = (code: string, token: string | null = null) => ({ status: "db_error" as const, error: { code, token, sqlstate: null } as never });

  it("응답 유실(unavailable)·요청 실패·형식 불명은 성공으로 표시하지 않고 재조회 안내", () => {
    for (const o of [db("unavailable"), { status: "request_failed" as const }, { status: "bad_response" as const }]) {
      for (const what of ["등록", "상태 변경", "전환"] as const) {
        const n = ui.failureNotice(o, what);
        expect(n.tone).toBe("error");
        expect(n.refresh).toBe(true);
        expect(n.title).toContain("확인하지 못했습니다");
        expect(n.contentId).toBeUndefined();
      }
    }
    expect(ui.failureNotice(db("unavailable"), "전환").body).toContain("원고 보관함");
    expect(ui.failureNotice(db("unavailable"), "전환").body).toContain("두 번 만들어지지 않습니다");
    expect(ui.failureNotice(db("unavailable"), "전환").body).toContain("자동으로 다시 보내지 않습니다");
    expect(ui.failureNotice({ status: "request_failed" }, "등록").body).toContain("중복 등록되지 않습니다");
  });

  it("토큰 구분: VERSION_CONFLICT·ALREADY_CONVERTED(code invalid_input)·DUPLICATE·INVALID_TRANSITION", () => {
    expect(ui.failureNotice(db("conflict_version", "VERSION_CONFLICT"), "상태 변경").title).toContain("바뀌었습니다");
    expect(ui.failureNotice(db("invalid_input", "ALREADY_CONVERTED"), "상태 변경").title).toContain("이미 원고로 전환된");
    expect(ui.failureNotice(db("duplicate", "DUPLICATE"), "상태 변경").title).toContain("같은 글감이 이미");
    expect(ui.failureNotice(db("invalid_transition", "INVALID_TRANSITION"), "전환").body).toContain("제외한 후보는 전환할 수 없습니다");
    expect(ui.failureNotice(db("invalid_transition", "INVALID_TRANSITION"), "상태 변경").title).toContain("이미 그 상태");
    expect(ui.failureNotice(db("invalid_input"), "등록").title).toContain("하지 못했습니다");
    expect(ui.failureNotice(db("not_found"), "전환").title).toContain("찾지 못했습니다");
  });

  it("invalid·not_ready는 입력이 남아 있음을 알리고 필드 이름을 한국어로", () => {
    const n = ui.failureNotice({ status: "invalid", errors: [{ field: "sourceUrl", rule: "https_url" }, { field: "body", rule: "required" }, { field: "toString", rule: "constructor" }] }, "등록");
    expect(n.body).toContain("출처 링크(https 주소만)");
    expect(n.body).toContain("본문(필수)");
    expect(n.body).toContain("입력(확인 필요)");
    expect(n.body).toContain("그대로 남아 있습니다");
    expect(ui.failureNotice({ status: "not_ready" }, "등록").body).toContain("그대로 남아 있습니다");
    expect(ui.failureNotice({ status: "denied", reason: "not_approved" }, "전환").body).toContain("승인된 관리자만");
  });

  it("등록: 새 후보는 성공, 중복은 기존 후보로 안내(오류 아님)", () => {
    const created = ui.createNotice({ status: "ok", data: { created: true, candidateId: ID(5) } });
    expect(created.tone).toBe("success");
    const dup = ui.createNotice({ status: "ok", data: { created: false, duplicateOf: ID(6), duplicateStatus: "selected" } });
    expect(dup.tone).toBe("warning");
    expect(dup.candidate).toEqual({ id: ID(6), status: "selected" });
    expect(created.candidate).toEqual({ id: ID(5), status: "new" });
    expect(dup.body).toContain("고름");
  });

  it("전환: 새 전환·이미 전환 모두 원고 링크, 승인·게시 아님 안내", () => {
    const a = ui.convertNotice({ status: "ok", data: { candidateId: ID(1), contentId: CONTENT, alreadyConverted: false } });
    expect(a.contentId).toBe(CONTENT);
    expect(a.body).toContain("아직 승인·게시되지 않았습니다");
    const b = ui.convertNotice({ status: "ok", data: { candidateId: ID(1), contentId: CONTENT, alreadyConverted: true } });
    expect(b.contentId).toBe(CONTENT);
    expect(b.body).toContain("새 원고를 만들지 않았습니다");
  });
});

describe("QA R2 — 전환 결과는 항목 밖에 남고, 실패·결과 불명은 원고로 이동하지 않는다", () => {
  const ok = (alreadyConverted: boolean) => ({ status: "ok" as const, data: { candidateId: ID(1), contentId: CONTENT, alreadyConverted } });

  it("필터 화면의 전환 성공 안내는 원고 링크와 함께 전환됨 목록 위치를 알린다", () => {
    const n = ui.convertNotice(ok(false), "selected", "고른 글감");
    expect(n.contentId).toBe(CONTENT);
    expect(n.body).toContain("\"고른 글감\" 후보");
    expect(n.body).toContain("지금 필터 목록에서 빠지며");
    expect(n.body).toContain("\"원고로 전환됨\" 목록");
    const all = ui.convertNotice(ok(true), null);
    expect(all.contentId).toBe(CONTENT);
    expect(all.body).not.toContain("필터 목록에서 빠지며");
    expect(ui.convertNotice(ok(false), "converted").body).not.toContain("필터 목록에서 빠지며");
  });

  it("실패·결과 불명 전환 안내에는 원고 링크가 없다", () => {
    for (const o of [{ status: "request_failed" as const }, { status: "bad_response" as const }, { status: "db_error" as const, error: { code: "unavailable", token: null, sqlstate: null } as never }, { status: "invalid" as const, errors: [{ field: "body", rule: "required" }] }]) {
      expect(ui.convertNotice(o, "selected").contentId).toBeUndefined();
    }
  });

  it("페이지는 목록 위에 전환 결과 자리를 두고, 초기 렌더에는 비어 있다", async () => {
    st.list = { status: "ok", data: [cand(2, { status: "selected" })] };
    const html = await render("selected");
    expect(html).not.toContain("공통 원고로 전환했습니다");
    const slot = html.indexOf("aria-live=\"polite\"", html.indexOf("후보 상태 필터"));
    expect(slot).toBeGreaterThan(-1);
    expect(slot).toBeLessThan(html.indexOf(`id="topic-${ID(2)}"`));
  });

  it("소스: 성공만 공용 자리에 원고 링크를 올리고, 자동 이동(router.push·replace)은 없다", () => {
    const src = readFileSync(join(process.cwd(), "src/components/distribution-console/topic-collector.tsx"), "utf8");
    expect(src).toMatch(/if \(out\.status === "ok" && ws\) \{[\s\S]{0,200}ws\.setConvertResult\(convertNotice\(out/);
    expect(src).not.toMatch(/router\.(push|replace)\(/);
    expect(src).not.toMatch(/window\.location/);
  });
});

describe("QA R3 — 중복·등록 안내의 후보 링크는 실제 목록에 있을 때만", () => {
  const vis = (...ids: string[]) => new Set(ids);
  it("목록에 있으면 앵커", () => {
    expect(ui.candidateLocator({ id: ID(1), status: "new" }, vis(ID(1)), null)).toEqual({ kind: "anchor", href: `#topic-${ID(1)}`, label: "목록에서 후보 보기" });
  });
  it("현재 필터와 다른 상태면 그 상태 필터로 실제 이동하는 링크(앵커 아님)", () => {
    const l = ui.candidateLocator({ id: ID(1), status: "dismissed" }, vis(ID(2)), "selected");
    expect(l.kind).toBe("filter");
    if (l.kind === "filter") {
      expect(l.href).toBe("/admin/distribution/topics?status=dismissed");
      expect(l.label).toContain("제외");
      expect(l.text).toContain("100건");
    }
  });
  it("전체 보기에서 100건 밖이면 상태 필터 링크", () => {
    const l = ui.candidateLocator({ id: ID(1), status: "converted" }, vis(ID(2)), null);
    expect(l.kind).toBe("filter");
  });
  it("이미 그 상태 필터인데 없으면(100건 밖) 링크 없이 사유만", () => {
    const l = ui.candidateLocator({ id: ID(1), status: "selected" }, vis(ID(2)), "selected");
    expect(l.kind).toBe("text");
    if (l.kind === "text") expect(l.text).toContain("100건");
  });
  it("목록 조회 불가(null)면 링크 없이 사유만", () => {
    expect(ui.candidateLocator({ id: ID(1), status: "new" }, null, null).kind).toBe("text");
  });
  it("소스: 무조건 앵커(#topic-${notice.candidateId})를 다는 코드가 남아 있지 않다", () => {
    const src = readFileSync(join(process.cwd(), "src/components/distribution-console/topic-collector.tsx"), "utf8");
    expect(src).not.toContain("notice.candidateId");
  });
});

describe("소스 경계", () => {
  const src = ["src/components/distribution-console/topic-collector.tsx", "src/components/distribution-console/topic-labels.ts", "src/app/admin/distribution/topics/page.tsx"].map((p) => readFileSync(join(process.cwd(), p), "utf8")).join("\n");
  it("외부 요청·AI·승인·작업·게시 경로를 쓰지 않는다", () => {
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/generation|decideApproval|createJob|publish/i);
    expect(src).not.toContain("process.env");
  });
  it("대시보드에 글감 수집 진입이 있다", () => {
    const ov = readFileSync(join(process.cwd(), "src/app/admin/distribution/page.tsx"), "utf8");
    expect(ov).toContain('topics: "/admin/distribution/topics"');
    expect(ov).toContain("href={routes.topics}");
  });
});
