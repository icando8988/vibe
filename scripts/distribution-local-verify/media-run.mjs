#!/usr/bin/env node
/**
 * AUTOPOST-M4-MEDIA-022 — 미디어 자산·권리·서명 승인 → RPC 왕복 검증 러너(독립).
 * 앱 TS 모듈(@/ 별칭)을 그대로 쓰기 위해 vitest로 tests/distribution-server/media.pglite.test.ts를 실행한다.
 *   node web/scripts/distribution-local-verify/media-run.mjs --pglite-project <dir>
 * 종료 코드: vitest 종료 코드(0 통과 · 1 실패) · 3 NOT RUN(PGlite 없음 또는 대상 테스트·모듈 파일 없음)
 * 공개 저장소에는 대상 테스트·connections 모듈이 없을 수 있다(키트 유래 범위라 비공개 전환 전 미커밋) → 성공으로 세지 않고 NOT RUN.
 * 실제 Supabase가 아니다. 키·env·네트워크를 쓰지 않는다. 기존 러너는 수정하지 않는다.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { argOf, WEB } from "./lib.mjs";

const REQUIRED = [
  "tests/distribution-server/media.pglite.test.ts",
  "tests/distribution-server/pglite-harness.ts",
  "src/server/distribution/media/service.ts",
  "src/server/distribution/media/process.ts",
  "supabase/migrations/20261116120000_distribution_media_assets.sql",
];
const missing = REQUIRED.filter((f) => !existsSync(join(WEB, f)));
if (missing.length) {
  console.log(`NOT RUN: 검증 대상 파일이 없다 — ${missing.join(", ")}`);
  console.log("준비: 대상 테스트·미디어 모듈·migration 120000·sharp이 있는 작업 트리에서 실행한다. 없는 검증을 통과로 세지 않는다.");
  process.exit(3);
}

const project = argOf("--pglite-project");
if (!project || !existsSync(join(resolve(project), "node_modules", "@electric-sql", "pglite", "package.json"))) {
  console.log("NOT RUN: --pglite-project <dir>에 @electric-sql/pglite가 설치돼 있어야 한다. web/에는 설치하지 않는다.");
  process.exit(3);
}
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const r = spawnSync(npx, ["vitest", "run", "tests/distribution-server/media.pglite.test.ts", "--reporter=verbose"], {
  cwd: WEB,
  env: { ...process.env, PGLITE_PROJECT: resolve(project) },
  stdio: "inherit",
  shell: process.platform === "win32",
});
console.log(`exit ${r.status}`);
process.exit(r.status ?? 1);
