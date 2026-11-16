/**
 * DB 시험 하네스: Supabase 대체 스텁 + migration을 새 인메모리 PostgreSQL(PGlite)에 적용한다.
 * 시험 로그에는 행 내용(개인정보·증빙 원문)을 출력하지 않고 건수와 SQLSTATE만 다룬다.
 *
 * .mjs인 이유: @electric-sql/pglite 미설치 상태에서도 프로젝트 `tsc --noEmit`이 깨지지 않게
 * 타입 검사 대상(tsconfig include: ts/tsx/mts)에서 뺀다. 실행은 vitest가 담당한다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** @returns {string[]} */
export function migrationFiles() {
  const dir = join(ROOT, "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(dir, f));
}

export async function freshDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = await PGlite.create();
  await db.exec(readFileSync(join(ROOT, "tests", "db", "supabase-stub.sql"), "utf8"));
  for (const file of migrationFiles()) {
    await db.exec(readFileSync(file, "utf8"));
  }
  return db;
}

function errCode(e) {
  return e && typeof e === "object" && typeof e.code === "string" ? e.code : "UNKNOWN";
}

/**
 * 지정 역할·JWT sub로 한 문장을 실행하고 항상 롤백한다(시험 간 간섭 없음).
 * role=null이면 소유자(superuser) 권한.
 * @returns {Promise<{ok: boolean, rowCount: number, rows: Record<string, unknown>[], code?: string}>}
 */
export async function run(db, role, sub, sql, params = []) {
  let outcome = { ok: false, rowCount: 0, rows: [] };
  await db.exec("begin");
  try {
    if (sub) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
    if (role) await db.exec(`set local role ${role}`);
    const res = await db.query(sql, params);
    const affected = typeof res.affectedRows === "number" ? res.affectedRows : 0;
    outcome = { ok: true, rows: res.rows, rowCount: res.rows.length > 0 ? res.rows.length : affected };
  } catch (e) {
    outcome = { ok: false, rowCount: 0, rows: [], code: errCode(e) };
  } finally {
    await db.exec("rollback");
  }
  return outcome;
}

/** 소유자 권한으로 영구 실행(픽스처 구성용) */
export async function exec(db, sql, params = []) {
  if (params.length === 0) await db.exec(sql);
  else await db.query(sql, params);
}
