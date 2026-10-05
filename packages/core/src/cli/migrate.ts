import { createCore } from "../core";
import { loadConfig } from "../config";

/**
 * Applies pending migrations to the platform database and to every tenant
 * database:  pnpm db:migrate
 */
const main = async () => {
  const core = createCore({ ...loadConfig(), autoMigrate: true });
  try {
    await core.init();
    const tenants = await core.tenants.list();
    console.log(`Migrations applied: platform database + ${tenants.length} tenant database(s).`);
  } finally {
    await core.close();
  }
};

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
