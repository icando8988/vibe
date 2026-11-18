/**
 * 주제로 바로 만들기 패널 회귀(FE task_52b03a6cdb5c — QA-SNS-QUICK-129-130 R2·R3 후속).
 * - 주제 길이: 화면 판정(topicStatus)이 서버 generateOriginal과 같은 규칙(trim 후 코드포인트, 500자)인지 경계값으로 대조한다.
 * - 준비 전 비활성: 생성 설정 누락·저장 불가면 주제 폼 fieldset이 잠기고 사유가 보인다.
 * - 미리보기 이전에는 원문 저장 폼(제목·본문·"원문 저장")이 렌더되지 않는다.
 * 액션은 vi.mock으로 대체하고 호출되지 않았음을 확인한다(실제 AI·DB 호출 없음).
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ gen: vi.fn(), save: vi.fn() }));
vi.mock("@/app/admin/distribution/original-generation-action", () => ({ generateOriginalAction: h.gen }));
vi.mock("@/app/admin/distribution/contents/actions", () => ({ createContentAction: h.save }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

import { QUICK_TOPIC_MAX, QuickOriginalPanel, missingText, quickOutcomeCopy, topicStatus } from "@/components/distribution-console/quick-original-panel";
import { ORIGINAL_TOPIC_MAX, generateOriginal } from "@/server/distribution/generation/original";

/** 서버 판정: 주제가 통과하면 설정 단계(not_configured)에서 멈추고, 아니면 topic 오류를 돌려준다. 공급자 호출 없음. */
async function serverTopicRule(topic: string): Promise<string | null> {
  const http = { fetch: vi.fn(), timeoutMs: 1 };
  const out = await generateOriginal(
    {
      resolveActor: async () => ({ ok: true, actorId: "00000000-0000-4000-8000-000000000001" }) as never,
      getConfig: () => ({ status: "not_configured", missing: ["enabled_flag"] }),
      http,
      acquireQuota: null,
    } as never,
    new Map<string, unknown>([["topic", topic], ["confirmGenerate", "on"]]),
  );
  expect(http.fetch).not.toHaveBeenCalled();
  if (out.status === "not_configured") return null;
  if (out.status === "invalid") return out.errors.find((e) => e.field === "topic")?.rule ?? null;
  throw new Error(`예상하지 못한 상태: ${out.status}`);
}

const render = (props: { generationMissing: string[]; saveDisabledReason: string | null }) => renderToStaticMarkup(createElement(QuickOriginalPanel, props));

describe("주제 길이 판정 — 서버와 같은 규칙", () => {
  it("상한 값이 서버와 같다", () => {
    expect(QUICK_TOPIC_MAX).toBe(ORIGINAL_TOPIC_MAX);
    expect(QUICK_TOPIC_MAX).toBe(500);
  });

  const cases: Array<{ name: string; topic: string; length: number; empty: boolean; tooLong: boolean }> = [
    { name: "한글 500자", topic: "가".repeat(500), length: 500, empty: false, tooLong: false },
    { name: "한글 501자", topic: "가".repeat(501), length: 501, empty: false, tooLong: true },
    { name: "앞뒤 공백·줄바꿈 + 500자", topic: `  \n\t${"가".repeat(500)}  \n`, length: 500, empty: false, tooLong: false },
    { name: "앞뒤 공백 + 501자", topic: ` ${"a".repeat(501)} `, length: 501, empty: false, tooLong: true },
    { name: "전각 공백(U+3000)으로 감싼 500자", topic: `　${"나".repeat(500)}　`, length: 500, empty: false, tooLong: false },
    { name: "가운데 공백은 센다(250+공백+249)", topic: `${"a".repeat(250)} ${"b".repeat(249)}`, length: 500, empty: false, tooLong: false },
    { name: "이모지 500개(UTF-16 1000)", topic: "😀".repeat(500), length: 500, empty: false, tooLong: false },
    { name: "이모지 501개", topic: "😀".repeat(501), length: 501, empty: false, tooLong: true },
    { name: "결합 문자 e+U+0301 ×250(코드포인트 500)", topic: "é".repeat(250), length: 500, empty: false, tooLong: false },
    { name: "결합 문자 ×250 + 1자", topic: `${"é".repeat(250)}x`, length: 501, empty: false, tooLong: true },
    { name: "공백만", topic: "  \n\t　 ", length: 0, empty: true, tooLong: false },
    { name: "빈 문자열", topic: "", length: 0, empty: true, tooLong: false },
  ];

  for (const c of cases) {
    it(`${c.name}: 화면 판정 = 서버 판정`, async () => {
      expect(topicStatus(c.topic)).toEqual({ length: c.length, empty: c.empty, tooLong: c.tooLong });
      const rule = await serverTopicRule(c.topic);
      expect(rule).toBe(c.empty ? "required" : c.tooLong ? "max_length" : null);
    });
  }
});

describe("준비 전 비활성 상태", () => {
  it("준비 완료면 주제 폼이 열리고, 빈 주제에서는 요청 버튼이 잠긴다", () => {
    const html = render({ generationMissing: [], saveDisabledReason: null });
    expect(html).not.toContain("<fieldset disabled");
    expect(html).toContain('name="topic"');
    expect(html).toMatch(/name="confirmGenerate"[^>]*value="on"|value="on"[^>]*name="confirmGenerate"/);
    expect(html).toContain("0 / 500자(앞뒤 공백 제외)");
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>제목·본문 제안 받기/);
  });

  it("생성 설정이 빠지면 fieldset이 잠기고 누락 항목을 한국어로 보여 준다", () => {
    const html = render({ generationMissing: ["enabled_flag", "api_key", "rate_limit"], saveDisabledReason: null });
    expect(html).toContain("<fieldset disabled");
    expect(html).toContain("생성 기능 켜기 설정, 생성 서비스 키, 사용량 한도 장치");
    expect(html).toContain("지금은 요청할 수 없습니다");
  });

  it("원문을 저장할 수 없으면 비용이 드는 생성도 잠근다", () => {
    const html = render({ generationMissing: [], saveDisabledReason: "서버 저장 연결이 설정되지 않아 제안을 받아도 저장할 수 없습니다." });
    expect(html).toContain("<fieldset disabled");
    expect(html).toContain("서버 저장 연결이 설정되지 않아");
  });

  it("모르는 누락 코드·프로토타입 키는 일반 문구로 보인다", () => {
    expect(missingText(["toString", "__proto__"])).toBe("기타 설정, 기타 설정");
    expect(missingText([])).toBe("확인 필요");
  });
});

describe("미리보기 이전에는 원문 저장을 노출하지 않는다", () => {
  const states = [
    { generationMissing: [], saveDisabledReason: null },
    { generationMissing: ["enabled_flag"], saveDisabledReason: null },
    { generationMissing: [], saveDisabledReason: "저장 불가" },
  ];
  for (const props of states) {
    it(`초기 렌더(${JSON.stringify(props)})에 저장 폼·미리보기·편집란 넣기가 없다`, () => {
      const html = render(props);
      expect(html).not.toContain('name="title"');
      expect(html).not.toContain('name="body"');
      expect(html).not.toContain("원문 저장");
      expect(html).not.toContain("편집란에 넣기");
      expect(html).not.toContain('id="quick-preview"');
      expect(html).not.toContain('id="quick-edit"');
    });
  }

  it("렌더만으로 생성·저장 액션을 호출하지 않는다", () => {
    render({ generationMissing: [], saveDisabledReason: null });
    expect(h.gen).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe("상태별 안내 문구", () => {
  it("호출 전 거절은 '보내지 않았습니다', 호출 후 실패는 비용 가능성을 알린다", () => {
    expect(quickOutcomeCopy({ status: "quota_exceeded", retryAfterSeconds: 90 }).body).toContain("약 2분 뒤");
    const quotaNull = quickOutcomeCopy({ status: "quota_exceeded", retryAfterSeconds: null }).body;
    expect(quotaNull).toContain("보내지 않았습니다");
    expect(quotaNull).not.toContain("비용");
    expect(quickOutcomeCopy({ status: "invalid", errors: [{ field: "topic", rule: "max_length" }] }).body).toContain("500자");
    expect(quickOutcomeCopy({ status: "invalid", errors: [{ field: "confirmGenerate", rule: "required" }] }).title).toContain("확인");
    expect(quickOutcomeCopy({ status: "not_configured", missing: ["api_key"] }).body).toContain("생성 서비스 키");
    expect(quickOutcomeCopy({ status: "provider_error", code: "timeout", httpStatus: 504 }).body).toContain("비용이 발생했을 수");
    expect(quickOutcomeCopy({ status: "provider_error", code: "timeout", httpStatus: 504 }).body).not.toContain("504");
    expect(quickOutcomeCopy({ status: "output_invalid" }).body).toContain("편집란은 바뀌지 않았습니다");
    expect(quickOutcomeCopy({ status: "request_failed" }).body).toContain("비용");
  });
});
