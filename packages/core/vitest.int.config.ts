import { defineConfig } from "vitest/config";

// Integration tests: run against the local stack (pnpm infra:up).
// Each test file gets its own throwaway platform database.
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
