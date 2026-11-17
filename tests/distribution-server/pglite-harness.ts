/**
 * PGlite 대역 공용 하네스(AUTOPOST-BLOG-FLOW-015). content-connect.pglite.test.ts와 같은 어댑터 계약.
 * service_role RPC 어댑터(앱 RpcClient 계약) + authenticated(RLS) 조회 어댑터(앱 ReadSource 계약).
 * 실제 Supabase가 아니다. 키·env·네트워크 없음.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Query, ReadSource } from "@/server/distribution/read";
import type { RpcClient } from "@/server/distribution/write-runner";

export type Db = {
  exec(sql: string): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);
const normRow = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, norm(v)]));

export async function openDb(project: string, users: string[], pending: string[], admins: string[]): Promise<{ db: Db; applied: string[] }> {
  const web = process.cwd();
  const dir = resolve(project);
  if (!existsSync(join(dir, "node_modules", "@electric-sql", "pglite", "package.json"))) throw new Error("PGlite not installed in PGLITE_PROJECT");
  const req = createRequire(join(dir, "package.json"));
  const { PGlite } = (await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href)) as { PGlite: new () => Db };
  const db = new PGlite();
  await db.exec(readFileSync(join(web, "scripts", "distribution-local-verify", "supabase-local-standin.sql"), "utf8"));
  const migrations = join(web, "supabase", "migrations");
  const applied = readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
  for (const f of applied) await db.exec(`set role supa_owner;\n${readFileSync(join(migrations, f), "utf8")}\n;reset role;`);
  await db.exec(`insert into auth.users (id) values ${users.map((u) => `('${u}')`).join(",")}`);
  await db.exec(`update public.profiles set approval_status = case when id in (${pending.map((p) => `'${p}'`).join(",") || "null"}) then 'pending' else 'approved' end`);
  await db.exec(`insert into public.role_assignments (user_id, role) values ${admins.map((a) => `('${a}','admin')`).join(",")}`);
  return { db, applied };
}

export async function inTx<T>(db: Db, role: string, sub: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    if (sub) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
    await db.exec(`set local role ${role}`);
    const out = await fn();
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}

/** 스칼라·jsonb 반환은 r 하나, setof/table 반환은 행 배열(PostgREST와 같은 모양). */
export function rpcClientOf(db: Db, setReturning: ReadonlySet<string> = new Set()): RpcClient {
  return {
    async rpc(fn, params) {
      if (!/^distribution_[a-z_]+$/.test(fn)) throw new Error("bad fn");
      const keys = Object.keys(params);
      const values: unknown[] = [];
      const args = keys.map((k, i) => {
        const v = params[k];
        let cast: string | null = "text";
        let val: unknown = v;
        if (v === null || v === undefined) {
          cast = null;
          val = null;
        } else if (k.endsWith("_ids")) {
          cast = "uuid[]";
          val = Array.isArray(v) ? `{${v.join(",")}}` : v;
        } else if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) {
          // 문자열 배열(예: p_scopes) → text[] 리터럴(PostgREST는 이름으로 형을 맞춘다)
          cast = "text[]";
          val = `{${(v as string[]).map((x) => `"${x.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
        } else if (typeof v === "object") {
          cast = "jsonb";
          val = JSON.stringify(v);
        } else if (typeof v === "number") cast = "int";
        else if (typeof v === "boolean") cast = "boolean";
        else if (typeof v === "string" && UUID_RE.test(v)) cast = "uuid";
        // PostgREST는 이름으로 형을 맞추지만 여기선 text로 넘기면 timestamptz 인자를 못 찾는다(42883) → ISO 시각만 timestamptz.
        else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) cast = "timestamptz";
        values.push(val);
        return `${k} => $${i + 1}${cast ? `::${cast}` : ""}`;
      });
      try {
        if (setReturning.has(fn)) {
          const r = await inTx(db, "service_role", null, () => db.query(`select * from public.${fn}(${args.join(", ")})`, values));
          return { data: r.rows.map(normRow), error: null };
        }
        const r = await inTx(db, "service_role", null, () => db.query(`select public.${fn}(${args.join(", ")}) as r`, values));
        return { data: norm(r.rows[0]?.r ?? null), error: null };
      } catch (e) {
        const err = e as { code?: string; message?: string };
        return { data: null, error: { code: err.code, message: err.message } };
      }
    },
  };
}

export function readSourceOf(db: Db, sub: string): ReadSource {
  return {
    async select(q: Query) {
      if (!/^distribution_[a-z_]+$/.test(q.table) || q.columns.some((c) => !/^[a-z_]+$/.test(c))) throw new Error("bad query");
      const params: unknown[] = [];
      const where = (q.filters ?? []).map((f) => {
        if (f.op === "eq") {
          params.push(f.value);
          return `${f.col}::text = $${params.length}`;
        }
        const list = f.value as readonly string[];
        if (list.length === 0) return "false";
        const ph = list.map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        return `${f.col}::text in (${ph.join(",")})`;
      });
      const order = (q.order ?? []).map((o) => `${o.col} ${o.ascending ? "asc" : "desc"}`);
      const sql = `select ${q.columns.join(", ")} from public.${q.table}${where.length ? ` where ${where.join(" and ")}` : ""}${order.length ? ` order by ${order.join(", ")}` : ""}${q.limit ? ` limit ${q.limit}` : ""}`;
      try {
        const r = await inTx(db, "authenticated", sub, () => db.query(sql, params));
        return { rows: r.rows.map(normRow) };
      } catch (e) {
        const err = e as { code?: string; message?: string };
        return { error: { code: err.code, message: err.message } };
      }
    },
  };
}
