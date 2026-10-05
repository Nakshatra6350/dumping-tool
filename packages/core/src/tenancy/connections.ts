import type { AppConfig } from "../config";
import type { KeyProvider } from "../crypto/keys";
import { createHandle, parseMysqlUrl, type Db, type DbHandle } from "../db/mysql";
import type { TenantRecord } from "./tenants";

/** Context strings bind each wrapped secret to its purpose and tenant. */
export const tenantDbPasswordContext = (tenantId: string) => `tenant-db-password:${tenantId}`;
export const tenantDataKeyContext = (tenantId: string) => `tenant-data-key:${tenantId}`;

interface Entry {
  handle: DbHandle;
  lastUsed: number;
}

/**
 * Hands out a database handle for a tenant, connecting AS THAT TENANT'S OWN
 * MySQL USER. Because the credentials themselves cannot see other tenants'
 * databases, a bug in a query can never leak across tenants.
 *
 * Pools are small and cached; idle ones are closed so thousands of tenants do
 * not hold thousands of open connections.
 */
export class TenantConnections {
  private readonly entries = new Map<string, Entry>();
  private readonly dataKeys = new Map<string, Buffer>();
  private readonly endpoint: { host: string; port: number };
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    config: Pick<AppConfig, "database">,
    private readonly keys: KeyProvider,
    private readonly options = { maxPools: 200, idleMs: 5 * 60_000, poolSize: 4 },
  ) {
    const { host, port } = parseMysqlUrl(config.database.url);
    this.endpoint = { host, port };
    this.sweeper = setInterval(() => void this.closeIdle(), 60_000);
    this.sweeper.unref();
  }

  async db(tenant: TenantRecord): Promise<Db> {
    const existing = this.entries.get(tenant.id);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.handle.db;
    }
    const password = await this.keys.unwrap(tenant.dbPasswordEnc, tenantDbPasswordContext(tenant.id));
    const handle = createHandle({
      ...this.endpoint,
      user: tenant.dbUser,
      password: password.toString("utf8"),
      database: tenant.dbName,
      connectionLimit: this.options.poolSize,
      idleTimeout: 60_000,
    });
    this.entries.set(tenant.id, { handle, lastUsed: Date.now() });
    if (this.entries.size > this.options.maxPools) await this.closeLeastRecentlyUsed();
    return handle.db;
  }

  /** The tenant's data key, unwrapped. Encrypts that tenant's secrets. */
  async dataKey(tenant: TenantRecord): Promise<Buffer> {
    const cached = this.dataKeys.get(tenant.id);
    if (cached) return cached;
    const key = await this.keys.unwrap(tenant.dataKeyEnc, tenantDataKeyContext(tenant.id));
    this.dataKeys.set(tenant.id, key);
    return key;
  }

  async close(tenantId: string): Promise<void> {
    const entry = this.entries.get(tenantId);
    this.entries.delete(tenantId);
    this.dataKeys.delete(tenantId);
    await entry?.handle.pool.end().catch(() => {});
  }

  async closeAll(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all([...this.entries.keys()].map((id) => this.close(id)));
  }

  private async closeIdle(): Promise<void> {
    const cutoff = Date.now() - this.options.idleMs;
    for (const [id, entry] of this.entries) {
      if (entry.lastUsed < cutoff) await this.close(id);
    }
  }

  private async closeLeastRecentlyUsed(): Promise<void> {
    let oldest: [string, Entry] | undefined;
    for (const pair of this.entries) {
      if (!oldest || pair[1].lastUsed < oldest[1].lastUsed) oldest = pair;
    }
    if (oldest) await this.close(oldest[0]);
  }
}
