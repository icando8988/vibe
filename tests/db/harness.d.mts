// harness.mjs 타입 선언. PGlite 타입에 의존하지 않도록 최소 인터페이스만 둔다.
export type Role = "anon" | "authenticated" | "service_role";

export interface Db {
  exec(sql: string): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; affectedRows?: number }>;
  close(): Promise<void>;
}

export interface QueryOutcome {
  ok: boolean;
  rowCount: number;
  rows: Record<string, unknown>[];
  /** SQLSTATE (42501 권한 없음, 23514 check 위반 등) */
  code?: string;
}

export function migrationFiles(): string[];
export function freshDb(): Promise<Db>;
export function run(db: Db, role: Role | null, sub: string | null, sql: string, params?: unknown[]): Promise<QueryOutcome>;
export function exec(db: Db, sql: string, params?: unknown[]): Promise<void>;
