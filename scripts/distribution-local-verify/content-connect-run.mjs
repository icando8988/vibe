#!/usr/bin/env node
/**
 * AUTOPOST-CONTENT-CONNECT-014 — 원문·초안·승인 서비스 → RPC 왕복 검증 러너(독립).
 * 앱 TS 모듈(@/ 별칭)을 그대로 쓰기 위해 vitest로 tests/distribution-server/content-connect.pglite.test.ts를 실행한다.
 *   node web/scripts/distribution-local-verify/content-connect-run.mjs --pglite-project <dir>
 * 종료 코드: vitest 종료 코드(0 통과 · 1 실패) · 3 PGlite 없음(NOT RUN)
 * 실제 Supabase가 아니다. 키·env·네트워크를 쓰지 않는다. 기존 러너는 수정하지 않는다.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { argOf, WEB } from "./lib.mjs";

const project = argOf("--pglite-project");
if (!project || !existsSync(join(resolve(project), "node_modules", "@electric-sql", "pglite", "package.json"))) {
  console.log("NOT RUN: --pglite-project <dir>에 @electric-sql/pglite가 설치돼 있어야 한다. web/에는 설치하지 않는다.");
  process.exit(3);
}
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const r = spawnSync(npx, ["vitest", "run", "tests/distribution-server/content-connect.pglite.test.ts", "--reporter=verbose"], {
  cwd: WEB,
  env: { ...process.env, PGLITE_PROJECT: resolve(project) },
  stdio: "inherit",
  shell: process.platform === "win32",
});
console.log(`exit ${r.status}`);
process.exit(r.status ?? 1);
