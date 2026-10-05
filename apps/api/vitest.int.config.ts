import { defineConfig } from "vitest/config";

// HTTP-level tests against the real local stack (pnpm infra:up).
export default defineConfig({
  test: {
    include: ["test/**/*.int.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
