import { defineConfig } from "vitest/config";

// Unit tests: no external services needed. The HTTP tests in test/*.int.test.ts
// need the local stack and run with `pnpm test:int`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/*.int.test.ts", "node_modules/**"],
    passWithNoTests: true,
  },
});
