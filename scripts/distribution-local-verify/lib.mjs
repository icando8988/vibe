/**
 * distribution-local-verify 공용 헬퍼 (AUTOPOST-M2-VERIFY-003).
 * run.mjs(M1+050000 회귀 203개)는 독립 실행 그대로 두고, m2-run.mjs가 이 모듈을 쓴다.
 * 실제 Supabase가 아니라 PGlite + supabase-local-standin.sql 대역이다. 비밀값·네트워크 없음.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HERE = fileURLToPath(new URL(".", import.meta.url));
export const WEB = resolve(HERE, "..", "..");
export const MIGRATIONS_DIR = join(WEB, "supabase", "migrations");

export function argOf(name) {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function loadPGlite(pgliteProject) {
  try {
    if (pgliteProject) {
      if (!existsSync(join(resolve(pgliteProject), "node_modules", "@electric-sql", "pglite", "package.json"))) {
        throw Object.assign(new Error("not installed in --pglite-project"), { code: "MODULE_NOT_FOUND" });
      }
      const req = createRequire(join(resolve(pgliteProject), "package.json"));
      return (await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href)).PGlite;
    }
    return (await import("@electric-sql/pglite")).PGlite;
  } catch (e) {
    console.log(`NOT RUN: @electric-sql/pglite을 찾지 못했다 (${e && e.code ? e.code : "load error"}).`);
    console.log("  임시 디렉터리에 설치 후 --pglite-project <dir>로 넘긴다. web/에는 설치하지 않는다.");
    process.exit(3);
  }
}

export function errInfo(e) {
  const code = e && typeof e === "object" && typeof e.code === "string" ? e.code : "UNKNOWN";
  const msg = e && typeof e.message === "string" ? e.message : String(e);
  const m = msg.match(/^([A-Z][A-Z_]{3,}):/);
  return { code, prefix: m ? m[1] : undefined, message: msg };
}

export function createHarness(db) {
  const results = [];
  let currentGroup = "";
  const group = (name) => { currentGroup = name; console.log(`\n## ${name}`); };
  const record = (name, pass, detail) => {
    results.push({ group: currentGroup, name, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  };
  const fmt = (r) => (r.ok ? `ok rows=${r.rowCount}` : `ERR ${r.code} ${r.prefix ?? ""}`.trim());

  /** 한 트랜잭션. statements = [[sql, params], ...]. 오류 시 rollback, 성공 시 commit(opts.rollback이면 rollback). */
  async function tx(role, sub, statements, opts = {}) {
    await db.exec("begin");
    let out;
    try {
      if (sub) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
      if (role) await db.exec(`set local role ${role}`);
      let last;
      for (const s of statements) {
        const [sql, params] = Array.isArray(s) ? s : [s, []];
        last = await db.query(sql, params);
      }
      const affected = typeof last.affectedRows === "number" ? last.affectedRows : 0;
      out = { ok: true, rows: last.rows, rowCount: last.rows.length > 0 ? last.rows.length : affected };
      await db.exec(opts.rollback ? "rollback" : "commit");
    } catch (e) {
      await db.exec("rollback");
      out = { ok: false, rows: [], rowCount: 0, ...errInfo(e) };
    }
    return out;
  }
  const svc = (sql, params = [], opts) => tx("service_role", null, [[sql, params]], opts);
  const su = (sql, params = []) => tx(null, null, [[sql, params]]);
  async function scalar(sql, params = []) {
    const r = await su(sql, params);
    if (!r.ok) throw new Error(`fixture query failed: ${r.code} ${r.message}`);
    const row = r.rows[0];
    return row ? Object.values(row)[0] : undefined;
  }
  async function must(label, p) {
    const r = await p;
    if (!r.ok) throw new Error(`setup step failed (${label}): ${r.code} ${r.message}`);
    return r;
  }
  const expectOk = (name, r, extra) => { record(name, r.ok, fmt(r) + (extra ? ` ${extra}` : "")); return r; };
  const expectErr = (name, r, code, prefix) => {
    const pass = !r.ok && r.code === code && (prefix === undefined || r.prefix === prefix);
    record(name, pass, `${fmt(r)} (기대 ${code}${prefix ? ` ${prefix}` : ""})${pass ? "" : ` msg=${(r.message ?? "").slice(0, 160)}`}`);
    return r;
  };
  const expectEq = (name, actual, expected) => {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    record(name, pass, `실제=${JSON.stringify(actual)} 기대=${JSON.stringify(expected)}`);
  };

  function finish(engine, jsonOut, forceCode) {
    const failed = results.filter((r) => !r.pass);
    const groups = [...new Set(results.map((r) => r.group))];
    console.log("\n## 요약");
    for (const g of groups) {
      const rs = results.filter((r) => r.group === g);
      console.log(`${rs.every((r) => r.pass) ? "PASS" : "FAIL"}  ${g}: ${rs.filter((r) => r.pass).length}/${rs.length}`);
    }
    console.log(`전체 ${results.length - failed.length}/${results.length} 통과, 실패 ${failed.length}`);
    for (const f of failed) console.log(`  실패: [${f.group}] ${f.name}`);
    const code = forceCode ?? (failed.length ? 1 : 0);
    if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ engine, at: new Date().toISOString(), exitCode: code, results }, null, 2));
    console.log(`exit ${code}`);
    process.exit(code);
  }

  return { results, group, record, fmt, tx, svc, su, scalar, must, expectOk, expectErr, expectEq, finish };
}

/** 대역 + migration 6개를 비superuser supa_owner로 적용. 실패 시 throw. */
export async function applyStandinAndMigrations(db) {
  await db.exec(readFileSync(join(HERE, "supabase-local-standin.sql"), "utf8"));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const applied = [];
  for (const f of files) {
    const t0 = Date.now();
    try {
      await db.exec(`set role supa_owner;\n${readFileSync(join(MIGRATIONS_DIR, f), "utf8")}\n;reset role;`);
    } catch (e) {
      try { await db.exec("rollback; reset role;"); } catch { /* ignore */ }
      throw Object.assign(new Error(`migration ${f} failed: ${errInfo(e).code} ${errInfo(e).message}`), { file: f });
    }
    applied.push({ file: f, ms: Date.now() - t0 });
  }
  return applied;
}
