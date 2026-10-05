import { defineConfig } from "vitest/config";

// Unit tests: no external services needed.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.int.test.ts", "node_modules/**"],
  },
});
