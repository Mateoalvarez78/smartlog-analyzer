import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    // Integration test files share one real PostgreSQL instance (no mocks,
    // see ARCHITECTURE.md §5) and several of them TRUNCATE the same tables
    // between tests. Running files in parallel (Vitest's default) lets one
    // file's TRUNCATE wipe rows another file just inserted. Unit tests pay
    // no real cost here since there are few of them.
    fileParallelism: false,
  },
});
