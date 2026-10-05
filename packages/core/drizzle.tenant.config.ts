import { defineConfig } from "drizzle-kit";

// Generates SQL migrations applied to EVERY tenant database:
//   pnpm db:generate
export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/tenant/schema.ts",
  out: "./drizzle/tenant",
});
