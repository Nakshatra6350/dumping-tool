import { defineConfig } from "drizzle-kit";

// Generates SQL migrations for the platform database from its schema:
//   pnpm db:generate
export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/platform/schema.ts",
  out: "./drizzle/platform",
});
