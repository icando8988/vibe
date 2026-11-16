// DB 격리 시험 전용 설정. 기본 `npm test`(도메인 시험)와 분리한다.
// 실행: npx vitest run --config tests/db/vitest.db.config.mts
// 필요: @electric-sql/pglite (실제 PostgreSQL을 WASM으로 인프로세스 실행, 네트워크·계정 불필요)
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/db/**/*.dbtest.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
