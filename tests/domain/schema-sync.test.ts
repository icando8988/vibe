/**
 * DB 없이 실행되는 정적 동기화 시험: migration의 상태 CHECK 목록이 TS 도메인 상수와 같은지 확인한다.
 * (실제 CHECK 동작 대조는 tests/db의 PGlite 시험이 담당)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPAIGN_RECRUITMENT_STATUSES, CAMPAIGN_REVIEW_STATUSES } from "@/lib/domain/campaign";
import { FULFILLMENT_STATUSES, ORDER_STATUSES, PAYMENT_STATUSES, REFUND_STATUSES } from "@/lib/domain/order-states";

const dir = join(process.cwd(), "supabase", "migrations");
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("\n");

function checkList(column: string): string[] {
  const m = sql.match(new RegExp(`check \\(${column} in \\(([^)]*)\\)\\)`));
  if (!m?.[1]) throw new Error(`CHECK for ${column} not found`);
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

describe("migration CHECK ↔ TS 상수", () => {
  it.each([
    ["order_status", ORDER_STATUSES],
    ["payment_status", PAYMENT_STATUSES],
    ["fulfillment_status", FULFILLMENT_STATUSES],
    ["refund_status", REFUND_STATUSES],
    ["review_status", CAMPAIGN_REVIEW_STATUSES],
    ["recruitment_status", CAMPAIGN_RECRUITMENT_STATUSES],
  ] as const)("%s", (column, values) => {
    expect(checkList(column)).toEqual([...values]);
  });

  it("클라이언트 역할 기본 권한 회수가 GRANT보다 먼저 있다(열 권한이 실제로 유효하려면 필수)", () => {
    const revokeAt = sql.indexOf("from public, anon, authenticated;");
    const firstGrant = sql.search(/grant select \(/);
    expect(revokeAt).toBeGreaterThan(0);
    expect(firstGrant).toBeGreaterThan(revokeAt);
    expect(sql).not.toMatch(/grant select on (table )?public\.\w+ to (anon|authenticated)/i);
  });
});
