#!/usr/bin/env node
/**
 * AUTOPOST-THREADS-OAUTH-019 — Threads OAuth state·callback → M3 암호화 저장 → RPC 왕복 검증 러너(독립).
 * 앱 TS 모듈(@/ 별칭)을 그대로 쓰기 위해 vitest로 tests/distribution-server/threads-oauth.pglite.test.ts를 실행한다.
 *   node web/scripts/distribution-local-verify/oauth-run.mjs --pglite-project <dir>
 * 종료 코드: vitest 종료 코드(0 통과 · 1 실패) · 3 NOT RUN(PGlite 없음 또는 대상 테스트·모듈 파일 없음)
 * 공개 저장소에는 대상 테스트·connections 모듈이 없을 수 있다(키트 유래 범위라 비공개 전환 전 미커밋) → 성공으로 세지 않고 NOT RUN.
 * 실제 Supabase가 아니다. 키·env·네트워크를 쓰지 않는다. 기존 러너는 수정하지 않는다.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { argOf, WEB } from "./lib.mjs";

const REQUIRED = [
  "tests/distribution-server/threads-oauth.pglite.test.ts",
  "tests/distribution-server/pglite-harness.ts",
  "src/server/distribution/connections/crypto.ts",
  "src/server/distribution/threads/oauth/flow.ts",
  "supabase/migrations/20261116100000_distribution_oauth_states.sql",
  "src/server/distribution/connections/service.ts",
  "supabase/migrations/20261116090000_distribution_channel_connections.sql",
];
const missing = REQUIRED.filter((f) => !existsSync(join(WEB, f)));
if (missing.length) {
  console.log(`NOT RUN: 검증 대상 파일이 없다 — ${missing.join(", ")}`);
  console.log("준비: 비공개 작업 트리(키트 유래 connections·threads/oauth 모듈·테스트 포함)에서 실행하거나 해당 파일을 복원한 뒤 다시 실행한다. 없는 검증을 통과로 세지 않는다.");
  process.exit(3);
}

const project = argOf("--pglite-project");
if (!project || !existsSync(join(resolve(project), "node_modules", "@electric-sql", "pglite", "package.json"))) {
  console.log("NOT RUN: --pglite-project <dir>에 @electric-sql/pglite가 설치돼 있어야 한다. web/에는 설치하지 않는다.");
  process.exit(3);
}
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const r = spawnSync(npx, ["vitest", "run", "tests/distribution-server/threads-oauth.pglite.test.ts", "--reporter=verbose"], {
  cwd: WEB,
  env: { ...process.env, PGLITE_PROJECT: resolve(project) },
  stdio: "inherit",
  shell: process.platform === "win32",
});
console.log(`exit ${r.status}`);
process.exit(r.status ?? 1);
