#!/usr/bin/env node
/**
 * BE-UPLOAD-025 / BE-UPLOAD-RESUME-026 — 미디어 직접 업로드(grant → PUT 모사 → complete/cancel) → 130000 RPC 왕복 검증 러너(독립).
 * 앱 TS 모듈(@/ 별칭)을 그대로 쓰기 위해 vitest로 tests/distribution-server/media-upload.pglite.test.ts를 실행한다.
 *   node scripts/distribution-local-verify/upload-run.mjs --pglite-project <dir>
 * 종료 코드: vitest 종료 코드(0 통과 · 1 실패) · 3 NOT RUN(PGlite 없음 또는 대상 테스트·모듈·migration 파일 없음)
 * 실제 Supabase가 아니다. Storage는 메모리 mock(서명 업로드 실전송·bucket 정책·토큰 수명 미검증). 키·env·네트워크를 쓰지 않는다.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { argOf, WEB } from "./lib.mjs";

const REQUIRED = [
  "tests/distribution-server/media-upload.pglite.test.ts",
  "tests/distribution-server/pglite-harness.ts",
  "src/server/distribution/media/upload.ts",
  "src/server/distribution/media/service.ts",
  "src/server/distribution/media/process.ts",
  "supabase/migrations/20261116120000_distribution_media_assets.sql",
  "supabase/migrations/20261116130000_distribution_media_upload_grants.sql",
];
// BE-UPLOAD-RECOVERY-030: 140000 복구 시험은 파일이 있을 때 함께 실행한다(없으면 기존 범위만).
const OPTIONAL = [
  ["tests/distribution-server/media-upload-recovery.pglite.test.ts", "supabase/migrations/20261116140000_distribution_media_upload_stall_recovery.sql"],
];
const missing = REQUIRED.filter((f) => !existsSync(join(WEB, f)));
if (missing.length) {
  console.log(`NOT RUN: 검증 대상 파일이 없다 — ${missing.join(", ")}`);
  console.log("준비: 업로드 모듈·대상 테스트·migration 120000/130000·sharp이 있는 작업 트리에서 실행한다. 없는 검증을 통과로 세지 않는다.");
  process.exit(3);
}

const project = argOf("--pglite-project");
if (!project || !existsSync(join(resolve(project), "node_modules", "@electric-sql", "pglite", "package.json"))) {
  console.log("NOT RUN: --pglite-project <dir>에 @electric-sql/pglite가 설치돼 있어야 한다. 앱 루트에는 설치하지 않는다.");
  process.exit(3);
}
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const targets = ["tests/distribution-server/media-upload.pglite.test.ts"];
for (const files of OPTIONAL) if (files.every((f) => existsSync(join(WEB, f)))) targets.push(files[0]);
console.log(`대상: ${targets.join(", ")}`);
const r = spawnSync(npx, ["vitest", "run", ...targets, "--reporter=verbose"], {
  cwd: WEB,
  env: { ...process.env, PGLITE_PROJECT: resolve(project) },
  stdio: "inherit",
  shell: process.platform === "win32",
});
console.log(`exit ${r.status}`);
process.exit(r.status ?? 1);
