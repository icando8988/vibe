/**
 * GRANT 매트릭스·함수 보안 속성·TS↔DB 불변식 일치·종료 상태 보호 (DEV-003).
 * 대상: Supabase 대체 스텁 위 PostgreSQL(PGlite).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkInvariants,
  FULFILLMENT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  type BookFormat,
  type OrderState,
} from "@/lib/domain/order-states";
import { exec, freshDb, run, type Db } from "./harness.mjs";

let db: Db;

const TABLES = [
  "profiles",
  "role_assignments",
  "projects",
  "books",
  "campaigns",
  "orders",
  "payment_records",
  "refunds",
  "audit_events",
] as const;
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;

/** 기대 열 권한: 여기 없는 (역할, 테이블, 열, 권한) 조합은 모두 false여야 한다. */
const EXPECTED_COLUMN_GRANTS: Record<"anon" | "authenticated", Record<string, { SELECT?: string[]; UPDATE?: string[] }>> = {
  anon: {
    projects: { SELECT: ["id", "slug", "title", "summary", "planned_departure", "publication_status", "created_at", "updated_at"] },
    books: { SELECT: ["id", "project_id", "slug", "title", "format", "description", "publication_status", "created_at", "updated_at"] },
    campaigns: {
      SELECT: ["id", "book_id", "channel", "external_url", "unit_price_krw", "shipping_fee_krw", "min_goal_qty", "max_qty",
        "goal_basis", "per_user_limit", "payment_deadline_at", "opens_at", "closes_at",
        "review_status", "recruitment_status", "goal_first_reached_at"],
    },
  },
  authenticated: {
    projects: { SELECT: ["id", "slug", "title", "summary", "planned_departure", "publication_status", "created_at", "updated_at"] },
    books: { SELECT: ["id", "project_id", "slug", "title", "format", "description", "publication_status", "created_at", "updated_at"] },
    campaigns: {
      SELECT: ["id", "book_id", "channel", "external_url", "unit_price_krw", "shipping_fee_krw", "min_goal_qty", "max_qty",
        "goal_basis", "per_user_limit", "payment_deadline_at", "opens_at", "closes_at",
        "review_status", "recruitment_status", "goal_first_reached_at"],
    },
    profiles: { SELECT: ["id", "display_name", "approval_status", "approval_changed_at", "created_at", "updated_at"], UPDATE: ["display_name"] },
    role_assignments: { SELECT: ["user_id", "role", "granted_at"] },
    orders: {
      SELECT: ["id", "campaign_id", "user_id", "book_format", "quantity", "unit_price_krw", "subtotal_krw", "shipping_fee_krw",
        "discount_krw", "total_krw", "idempotency_key", "policy_version",
        "order_status", "payment_status", "fulfillment_status", "refund_status",
        "expires_at", "version", "created_at", "updated_at"],
    },
    payment_records: { SELECT: ["id", "order_id", "expected_krw", "received_krw", "status", "member_note", "verified_at", "created_at"] },
    refunds: { SELECT: ["id", "order_id", "amount_krw", "status", "member_reason", "processed_at", "created_at"] },
  },
};

beforeAll(async () => {
  db = await freshDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("GRANT 매트릭스 (실제 권한 카탈로그)", () => {
  it("대조군: 스텁의 Supabase식 기본 권한은 새 테이블에 anon ALL을 준다 → migration의 REVOKE가 필요함을 증명", async () => {
    await exec(db, "create table public.zz_control (id int)");
    const r = await run(
      db,
      null,
      null,
      `select has_table_privilege('anon', 'public.zz_control', 'SELECT') s, has_table_privilege('anon', 'public.zz_control', 'INSERT') i,
              has_table_privilege('authenticated', 'public.zz_control', 'DELETE') d`,
    );
    expect(r.rows[0]).toEqual({ s: true, i: true, d: true });
    await exec(db, "drop table public.zz_control");
  });

  it.each(["anon", "authenticated"] as const)("%s: 모든 대상 테이블에 테이블 단위 권한 없음", async (role) => {
    for (const t of TABLES) {
      for (const p of TABLE_PRIVS) {
        const r = await run(db, null, null, `select has_table_privilege($1, $2, $3) v`, [role, `public.${t}`, p]);
        expect(r.rows[0]?.v, `${role} ${p} ${t}`).toBe(false);
      }
    }
  });

  it.each(["anon", "authenticated"] as const)("%s: 열 권한이 기대 목록과 정확히 일치", async (role) => {
    const cols = await run(
      db,
      null,
      null,
      `select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name = any($1)
       order by table_name, ordinal_position`,
      [TABLES as unknown as string[]],
    );
    const mismatches: string[] = [];
    for (const row of cols.rows) {
      const t = String(row.table_name);
      const c = String(row.column_name);
      for (const p of ["SELECT", "INSERT", "UPDATE", "REFERENCES"] as const) {
        const r = await run(db, null, null, `select has_column_privilege($1, $2, $3, $4) v`, [role, `public.${t}`, c, p]);
        const expected = p === "SELECT" || p === "UPDATE" ? (EXPECTED_COLUMN_GRANTS[role][t]?.[p]?.includes(c) ?? false) : false;
        if (r.rows[0]?.v !== expected) mismatches.push(`${role} ${p} ${t}.${c} = ${String(r.rows[0]?.v)} (expected ${expected})`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("시퀀스 권한 없음(audit_events id)", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await run(db, null, null, `select has_sequence_privilege($1, 'public.audit_events_id_seq', 'USAGE') v`, [role]);
      expect(r.rows[0]?.v).toBe(false);
    }
  });

  it("모든 대상 테이블 RLS 활성", async () => {
    const r = await run(
      db,
      null,
      null,
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`,
      [TABLES as unknown as string[]],
    );
    expect(r.rows).toHaveLength(TABLES.length);
    for (const row of r.rows) expect(row.relrowsecurity, String(row.relname)).toBe(true);
  });
});

describe("함수 보안 속성", () => {
  it("역할 함수: security definer + search_path 고정('') + authenticated만 실행", async () => {
    for (const fn of ["is_admin", "is_approved_member"]) {
      const meta = await run(
        db,
        null,
        null,
        `select prosecdef, proconfig from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`,
        [fn],
      );
      expect(meta.rows[0]?.prosecdef, fn).toBe(true);
      expect(meta.rows[0]?.proconfig, fn).toEqual(['search_path=""']);
      const sig = `public.${fn}()`;
      const priv = await run(
        db,
        null,
        null,
        `select has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u,
                has_function_privilege('public', $1, 'EXECUTE') p`,
        [sig],
      );
      expect(priv.rows[0], fn).toEqual({ a: false, u: true, p: false });
    }
  });

  it("트리거 함수: 클라이언트 실행 권한 없음, search_path 고정", async () => {
    for (const fn of ["set_updated_at", "orders_guard_update"]) {
      const meta = await run(db, null, null, `select prosecdef, proconfig from pg_proc where proname = $1`, [fn]);
      expect(meta.rows[0]?.prosecdef).toBe(false);
      expect(meta.rows[0]?.proconfig).toEqual(['search_path=""']);
      const priv = await run(
        db,
        null,
        null,
        `select has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u`,
        [`public.${fn}()`],
      );
      expect(priv.rows[0]).toEqual({ a: false, u: false });
    }
  });
});

const USER = "00000000-0000-4000-8000-000000000001";
const CAMP = "30000000-0000-4000-8000-000000000001";

async function fixture() {
  await exec(
    db,
    `insert into auth.users (id) values ('${USER}') on conflict do nothing;
     insert into public.projects (id, slug, title) values ('10000000-0000-4000-8000-000000000001', 'p', 'p') on conflict do nothing;
     insert into public.books (id, project_id, slug, title, format) values
       ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'b', 'b', 'print') on conflict do nothing;
     insert into public.campaigns (id, book_id, channel, unit_price_krw) values
       ('${CAMP}', '20000000-0000-4000-8000-000000000001', 'direct', 1000) on conflict do nothing;`,
  );
}

function insertSql(s: OrderState, format: BookFormat, key: string) {
  return {
    sql: `insert into public.orders (campaign_id, user_id, book_format, quantity, unit_price_krw, subtotal_krw, total_krw,
            idempotency_key, order_status, payment_status, fulfillment_status, refund_status)
          values ($1, $2, $3, 1, 1000, 1000, 1000, $4, $5, $6, $7, $8) returning id`,
    params: [CAMP, USER, format, key, s.order, s.payment, s.fulfillment, s.refund],
  };
}

describe("TS checkInvariants ↔ DB CHECK 전 조합 일치", () => {
  beforeAll(fixture);

  it("4축 × 형식 1,200개 조합의 허용/거절이 같다", async () => {
    const diffs: string[] = [];
    let n = 0;
    let accepted = 0;
    for (const format of ["print", "ebook"] as const) {
      for (const order of ORDER_STATUSES)
        for (const payment of PAYMENT_STATUSES)
          for (const fulfillment of FULFILLMENT_STATUSES)
            for (const refund of REFUND_STATUSES) {
              const s: OrderState = { order, payment, fulfillment, refund };
              const ts = checkInvariants(s, { format }).ok;
              const { sql, params } = insertSql(s, format, `combo-key-${String(n).padStart(8, "0")}`);
              const r = await run(db, null, null, sql, params);
              if (r.ok !== ts) diffs.push(`${format} ${order}/${payment}/${fulfillment}/${refund}: ts=${ts} db=${r.ok}(${r.code ?? ""})`);
              if (r.ok) accepted++;
              else if (r.code !== "23514") diffs.push(`unexpected SQLSTATE ${r.code} for ${format} ${order}/${payment}/${fulfillment}/${refund}`);
              n++;
            }
    }
    expect(n).toBe(1200);
    expect(accepted).toBeGreaterThan(0);
    expect(diffs).toEqual([]);
  });
});

describe("종료 상태 보호 트리거 (service_role 직접 갱신 포함)", () => {
  beforeAll(fixture);

  let seq = 0;
  /** 소유자로 주문을 넣고 service_role로 갱신을 시도한 뒤 롤백한다. 성공 시 갱신 후 version을 돌려준다. */
  async function withOrder(state: Partial<OrderState>, format: BookFormat, update: string) {
    const s: OrderState = { order: "active", payment: "unpaid", fulfillment: "not_ready", refund: "none", ...state };
    const key = `guard-key-${String(seq++).padStart(8, "0")}`;
    const ins = insertSql(s, format, key);
    await exec(db, "begin");
    try {
      await db.query(ins.sql, ins.params);
      await db.exec("set local role service_role");
      const res = await db.query(`${update} returning version`, [key]);
      return { ok: true as const, version: res.rows[0]?.version };
    } catch (e) {
      return { ok: false as const, code: (e as { code?: string }).code };
    } finally {
      await exec(db, "rollback");
    }
  }

  it("취소·만료·완료 주문은 다시 열 수 없다", async () => {
    for (const order of ["cancelled", "expired"] as const) {
      const r = await withOrder({ order }, "print", `update public.orders set order_status = 'active' where idempotency_key = $1`);
      expect(r.ok, order).toBe(false);
    }
    const done = await withOrder(
      { order: "completed", payment: "verified", fulfillment: "delivered" },
      "print",
      `update public.orders set order_status = 'active' where idempotency_key = $1`,
    );
    expect(done.ok).toBe(false);
  });

  it("만료 주문의 늦은 입금은 verified 불가, mismatch만", async () => {
    const v = await withOrder({ order: "expired" }, "print", `update public.orders set payment_status = 'verified' where idempotency_key = $1`);
    expect(v.ok).toBe(false);
    const m = await withOrder({ order: "expired" }, "print", `update public.orders set payment_status = 'mismatch' where idempotency_key = $1`);
    expect(m.ok).toBe(true);
  });

  it("verified 입금·완료/반려 환불·전달 완료는 되돌릴 수 없다", async () => {
    expect((await withOrder({ payment: "verified" }, "print", `update public.orders set payment_status = 'unpaid' where idempotency_key = $1`)).ok).toBe(false);
    expect(
      (await withOrder({ order: "cancellation_requested", payment: "verified", refund: "completed" }, "print",
        `update public.orders set refund_status = 'processing' where idempotency_key = $1`)).ok,
    ).toBe(false);
    expect(
      (await withOrder({ payment: "verified", fulfillment: "released" }, "ebook",
        `update public.orders set fulfillment_status = 'ready' where idempotency_key = $1`)).ok,
    ).toBe(false);
  });

  it("금액·소유자 스냅샷은 바꿀 수 없고, 정상 갱신은 version을 올린다", async () => {
    expect((await withOrder({}, "print", `update public.orders set total_krw = 0, subtotal_krw = 0, unit_price_krw = 0 where idempotency_key = $1`)).ok).toBe(false);
    expect((await withOrder({}, "print", `update public.orders set user_id = gen_random_uuid() where idempotency_key = $1`)).ok).toBe(false);
    const ok = await withOrder({}, "print", `update public.orders set payment_status = 'reported' where idempotency_key = $1`);
    expect(ok).toEqual({ ok: true, version: 2 });
  });
});
