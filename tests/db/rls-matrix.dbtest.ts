/**
 * 권한 매트릭스 실행 시험 (DEV-003).
 * 대상: Supabase 대체 스텁 위 PostgreSQL(PGlite). 실제 Supabase(GoTrue/PostgREST) 통합 시험이 아니다.
 * 고정 UUID는 시험용 가짜 식별자이며 실제 사용자와 무관하다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exec, freshDb, run, type Db, type Role } from "./harness.mjs";

const U = {
  A: "00000000-0000-4000-8000-00000000000a", // 승인 회원 A
  B: "00000000-0000-4000-8000-00000000000b", // 승인 회원 B
  P: "00000000-0000-4000-8000-00000000000c", // 승인 대기 회원
  ADM: "00000000-0000-4000-8000-0000000000ad", // 관리자
} as const;

const ID = {
  projPub: "10000000-0000-4000-8000-000000000001",
  projDraft: "10000000-0000-4000-8000-000000000002",
  bookPub: "20000000-0000-4000-8000-000000000001",
  bookDraft: "20000000-0000-4000-8000-000000000002", // 게시 프로젝트 아래 비공개 책
  bookOrphan: "20000000-0000-4000-8000-000000000003", // 비공개 프로젝트 아래 '게시' 책
  campPub: "30000000-0000-4000-8000-000000000001",
  campPending: "30000000-0000-4000-8000-000000000002",
  campOrphan: "30000000-0000-4000-8000-000000000003", // 승인됐지만 상위가 비공개
  campDraftBook: "30000000-0000-4000-8000-000000000004", // 승인됐지만 책이 비공개
  orderA: "40000000-0000-4000-8000-00000000000a",
  orderB: "40000000-0000-4000-8000-00000000000b",
} as const;

let db: Db;

async function as(role: Role, sub: string | null, sql: string, params: unknown[] = []) {
  return run(db, role, sub, sql, params);
}
const member = (sub: string, sql: string, params: unknown[] = []) => as("authenticated", sub, sql, params);
const anon = (sql: string, params: unknown[] = []) => as("anon", null, sql, params);

beforeAll(async () => {
  db = await freshDb();
  await exec(
    db,
    `insert into auth.users (id) values ('${U.A}'), ('${U.B}'), ('${U.P}'), ('${U.ADM}');
     insert into public.profiles (id, display_name, approval_status) values
       ('${U.A}', 'tester-a', 'approved'), ('${U.B}', 'tester-b', 'approved'),
       ('${U.P}', 'tester-p', 'pending'), ('${U.ADM}', 'tester-admin', 'approved');
     insert into public.role_assignments (user_id, role, granted_by) values ('${U.ADM}', 'admin', '${U.ADM}');

     insert into public.projects (id, slug, title, publication_status) values
       ('${ID.projPub}', 'pub', 'published project', 'published'),
       ('${ID.projDraft}', 'draft', 'draft project', 'draft');
     insert into public.books (id, project_id, slug, title, format, publication_status) values
       ('${ID.bookPub}', '${ID.projPub}', 'book-pub', 'b1', 'print', 'published'),
       ('${ID.bookDraft}', '${ID.projPub}', 'book-draft', 'b2', 'print', 'draft'),
       ('${ID.bookOrphan}', '${ID.projDraft}', 'book-orphan', 'b3', 'ebook', 'published');
     insert into public.campaigns (id, book_id, owner_id, channel, external_url, unit_price_krw, opens_at, closes_at, review_status, reservation_ttl) values
       ('${ID.campPub}', '${ID.bookPub}', '${U.ADM}', 'direct', null, 1000, now(), now() + interval '7 days', 'approved', interval '2 days'),
       ('${ID.campPending}', '${ID.bookPub}', '${U.ADM}', 'direct', null, 1000, now(), now() + interval '7 days', 'pending_review', null),
       ('${ID.campOrphan}', '${ID.bookOrphan}', '${U.ADM}', 'external', 'https://example.invalid/x', null, null, null, 'approved', null),
       ('${ID.campDraftBook}', '${ID.bookDraft}', '${U.ADM}', 'external', 'https://example.invalid/y', null, null, null, 'approved', null);

     insert into public.orders (id, campaign_id, user_id, book_format, quantity, unit_price_krw, subtotal_krw, total_krw,
                                idempotency_key, order_status, payment_status, refund_status) values
       ('${ID.orderA}', '${ID.campPub}', '${U.A}', 'print', 1, 1000, 1000, 1000, 'key-aaaaaaaaaaaaaaaa', 'cancellation_requested', 'verified', 'requested'),
       ('${ID.orderB}', '${ID.campPub}', '${U.B}', 'print', 1, 1000, 1000, 1000, 'key-bbbbbbbbbbbbbbbb', 'active', 'reported', 'none');
     insert into public.payment_records (order_id, expected_krw, received_krw, status, reconciliation_ref, verified_by, verified_at) values
       ('${ID.orderA}', 1000, 1000, 'verified', 'INTERNAL-REF-A', '${U.ADM}', now()),
       ('${ID.orderB}', 1000, null, 'reported', null, null, null);
     insert into public.refunds (order_id, amount_krw, status, member_reason, internal_note) values
       ('${ID.orderA}', 1000, 'requested', 'member reason', 'internal ops note');
     insert into public.audit_events (actor_id, actor_kind, action, target_type, target_id) values
       ('${U.ADM}', 'admin', 'payment.verify', 'order', '${ID.orderA}');`,
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const DENIED = "42501";

describe("공개 콘텐츠 (anon / authenticated)", () => {
  it("anon: 게시 프로젝트만", async () => {
    const r = await anon("select id from public.projects");
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => x.id)).toEqual([ID.projPub]);
  });

  it("anon: 비공개 책·비공개 프로젝트 아래 게시 책은 숨김", async () => {
    const r = await anon("select id from public.books");
    expect(r.rows.map((x) => x.id)).toEqual([ID.bookPub]);
  });

  it("anon: 승인 + 상위(책·프로젝트) 모두 게시된 캠페인만", async () => {
    const r = await anon("select id from public.campaigns");
    expect(r.rows.map((x) => x.id)).toEqual([ID.campPub]);
  });

  it("member: 공개 범위는 anon과 같다(관리자 아님)", async () => {
    const r = await member(U.A, "select id from public.campaigns");
    expect(r.rows.map((x) => x.id)).toEqual([ID.campPub]);
  });

  it("공개 열은 조회 가능, 내부 열(owner_id·reservation_ttl)과 select * 는 거절", async () => {
    expect((await anon("select id, unit_price_krw, per_user_limit, payment_deadline_at, goal_basis from public.campaigns")).ok).toBe(true);
    expect((await anon("select owner_id from public.campaigns")).code).toBe(DENIED);
    expect((await anon("select reservation_ttl from public.campaigns")).code).toBe(DENIED);
    expect((await anon("select * from public.campaigns")).code).toBe(DENIED);
    expect((await member(U.A, "select owner_id from public.campaigns")).code).toBe(DENIED);
  });

  it("anon: 공개 콘텐츠 쓰기 거절", async () => {
    expect((await anon(`update public.projects set title = 'x' where id = '${ID.projPub}'`)).code).toBe(DENIED);
    expect((await anon(`insert into public.projects (slug, title) values ('x', 'x')`)).code).toBe(DENIED);
    expect((await member(U.A, `delete from public.books where id = '${ID.bookPub}'`)).code).toBe(DENIED);
  });
});

describe("회원 데이터 — anon은 전부 거절", () => {
  it.each(["profiles", "role_assignments", "orders", "payment_records", "refunds", "audit_events"])(
    "anon select %s → 42501",
    async (table) => {
      expect((await anon(`select 1 from public.${table}`)).code).toBe(DENIED);
    },
  );
  it("anon: 역할 함수 실행 불가, auth.users 조회 불가", async () => {
    expect((await anon("select public.is_admin()")).code).toBe(DENIED);
    expect((await anon("select 1 from auth.users")).code).toBe(DENIED);
  });
});

describe("프로필 — 자기 승인·승격 불가, display_name만 수정", () => {
  it("본인 행만 보인다", async () => {
    const r = await member(U.A, "select id from public.profiles");
    expect(r.rows.map((x) => x.id)).toEqual([U.A]);
    const p = await member(U.P, "select id, approval_status from public.profiles");
    expect(p.rows).toEqual([{ id: U.P, approval_status: "pending" }]);
  });

  it("내부 열 approval_changed_by 는 본인도 조회 불가", async () => {
    expect((await member(U.A, "select approval_changed_by from public.profiles")).code).toBe(DENIED);
  });

  it("display_name 본인 수정 가능, 타인 행은 0건", async () => {
    const own = await member(U.A, `update public.profiles set display_name = 'renamed' where id = '${U.A}' returning id`);
    expect(own.ok).toBe(true);
    expect(own.rowCount).toBe(1);
    const other = await member(U.A, `update public.profiles set display_name = 'hijack' where id = '${U.B}' returning id`);
    expect(other.ok).toBe(true);
    expect(other.rowCount).toBe(0);
  });

  it("승인 대기 회원의 자기 승인 거절", async () => {
    const r = await member(U.P, `update public.profiles set approval_status = 'approved' where id = '${U.P}'`);
    expect(r.code).toBe(DENIED);
  });

  it("프로필 생성·삭제 거절", async () => {
    expect((await member(U.A, `delete from public.profiles where id = '${U.A}'`)).code).toBe(DENIED);
    expect((await member(U.A, `insert into public.profiles (id) values ('${U.A}')`)).code).toBe(DENIED);
  });

  it("역할 자기 부여 거절, 본인 역할은 내부 열 없이 조회", async () => {
    expect((await member(U.A, `insert into public.role_assignments (user_id, role) values ('${U.A}', 'admin')`)).code).toBe(DENIED);
    expect((await member(U.ADM, "select user_id, role from public.role_assignments")).rows).toEqual([{ user_id: U.ADM, role: "admin" }]);
    expect((await member(U.A, "select user_id from public.role_assignments")).rowCount).toBe(0);
    expect((await member(U.ADM, "select granted_by from public.role_assignments")).code).toBe(DENIED);
  });

  it("역할 함수: 호출자 본인만 판정", async () => {
    expect((await member(U.A, "select public.is_admin() as v")).rows[0]?.v).toBe(false);
    expect((await member(U.ADM, "select public.is_admin() as v")).rows[0]?.v).toBe(true);
    expect((await member(U.P, "select public.is_approved_member() as v")).rows[0]?.v).toBe(false);
    expect((await member(U.A, "select public.is_approved_member() as v")).rows[0]?.v).toBe(true);
  });
});

const ORDER_COLS = "id, user_id, order_status, payment_status, total_krw";

describe("주문·입금·환불 — 본인 행, 공개 열만", () => {
  it("본인 주문만, 타인 주문 id로 조회 0건", async () => {
    expect((await member(U.A, `select ${ORDER_COLS} from public.orders`)).rows.map((x) => x.id)).toEqual([ID.orderA]);
    expect((await member(U.B, `select id from public.orders where id = '${ID.orderA}'`)).rowCount).toBe(0);
    expect((await member(U.P, "select id from public.orders")).rowCount).toBe(0);
  });

  it("주문 내부 열·select * 거절", async () => {
    expect((await member(U.A, "select inventory_released_at from public.orders")).code).toBe(DENIED);
    expect((await member(U.A, "select * from public.orders")).code).toBe(DENIED);
  });

  it("입금 기록: 본인 것만, 대사 참조·확인자는 거절", async () => {
    const r = await member(U.A, "select id, order_id, expected_krw, received_krw, status, verified_at from public.payment_records");
    expect(r.rows.map((x) => x.order_id)).toEqual([ID.orderA]);
    expect((await member(U.B, `select id from public.payment_records where order_id = '${ID.orderA}'`)).rowCount).toBe(0);
    expect((await member(U.A, "select reconciliation_ref from public.payment_records")).code).toBe(DENIED);
    expect((await member(U.A, "select verified_by from public.payment_records")).code).toBe(DENIED);
  });

  it("환불: 본인 것만, 내부 메모·지급 참조·처리자는 거절", async () => {
    const r = await member(U.A, "select id, order_id, amount_krw, status, member_reason from public.refunds");
    expect(r.rows.map((x) => x.order_id)).toEqual([ID.orderA]);
    expect((await member(U.B, "select id from public.refunds")).rowCount).toBe(0);
    for (const col of ["internal_note", "payout_ref", "processed_by"]) {
      expect((await member(U.A, `select ${col} from public.refunds`)).code).toBe(DENIED);
    }
  });

  it("클라이언트 거래 쓰기 전부 거절(본인 행 포함)", async () => {
    const writes = [
      `insert into public.orders (campaign_id, user_id, book_format, quantity, unit_price_krw, subtotal_krw, total_krw, idempotency_key)
         values ('${ID.campPub}', '${U.A}', 'print', 1, 0, 0, 0, 'key-cccccccccccccccc')`,
      `update public.orders set payment_status = 'verified' where id = '${ID.orderA}'`,
      `update public.orders set total_krw = 0 where id = '${ID.orderA}'`,
      `delete from public.orders where id = '${ID.orderA}'`,
      `insert into public.payment_records (order_id, expected_krw, status) values ('${ID.orderA}', 1000, 'reported')`,
      `update public.payment_records set status = 'verified' where order_id = '${ID.orderA}'`,
      `insert into public.refunds (order_id, amount_krw) values ('${ID.orderA}', 1000)`,
      `update public.refunds set status = 'completed' where order_id = '${ID.orderA}'`,
      `insert into public.audit_events (actor_kind, action, target_type, target_id) values ('member', 'x', 'x', 'x')`,
    ];
    for (const sql of writes) {
      expect((await member(U.A, sql)).code, sql.slice(0, 60)).toBe(DENIED);
      expect((await member(U.ADM, sql)).code, `admin: ${sql.slice(0, 60)}`).toBe(DENIED);
    }
  });
});

describe("관리자(클라이언트 역할) — 허용 열 범위 읽기만", () => {
  it("모든 주문·캠페인 읽기(공개 열)", async () => {
    expect((await member(U.ADM, "select id from public.orders")).rowCount).toBe(2);
    expect((await member(U.ADM, "select id from public.campaigns")).rowCount).toBe(4);
    expect((await member(U.ADM, "select id from public.profiles")).rowCount).toBe(4);
  });
  it("관리자도 클라이언트 경로로는 내부 열·감사 기록 불가(서버 service_role 경로 전용)", async () => {
    expect((await member(U.ADM, "select reconciliation_ref from public.payment_records")).code).toBe(DENIED);
    expect((await member(U.ADM, "select internal_note from public.refunds")).code).toBe(DENIED);
    expect((await member(U.ADM, "select 1 from public.audit_events")).code).toBe(DENIED);
  });
  it("service_role은 RLS 우회·내부 열 조회 가능(서버 전용 역할임을 확인)", async () => {
    const r = await as("service_role", null, "select reconciliation_ref from public.payment_records where reconciliation_ref is not null");
    expect(r.ok).toBe(true);
    expect(r.rowCount).toBe(1);
  });
});
