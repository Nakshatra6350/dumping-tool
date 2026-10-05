import { actorFromSession, badRequest, type Core } from "@dbrb/core";
import {
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  describeSetting,
  isSettingKey,
  isStorageMode,
  s3TargetInputSchema,
  settingValueSchema,
  storageModeSchema,
  type AuditEntryView,
} from "@dbrb/shared";
import { Router, type Request, type Response } from "express";
import type { Limiters } from "../app";
import { parse, rateLimit, requireActiveTenant, requirePermission, sessionOf } from "../http/middleware";

const csvCell = (value: unknown): string => {
  const text =
    value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  // Neutralise spreadsheet formulas, then quote.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Resolves when the response can take more data, or when the reader has gone away. */
const readyForMore = (res: Response): Promise<void> =>
  new Promise((resolve) => {
    const done = () => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.on("drain", done);
    res.on("close", done);
  });

/** Everything a signed-in member does inside their own workspace. */
export const workspaceRoutes = (core: Core, limiters: Limiters): Router => {
  const router = Router();
  const actor = (req: Request) => actorFromSession(sessionOf(req), req.meta);
  const tenantOf = (req: Request) => sessionOf(req).tenant;
  const byTenant = (req: Request) => sessionOf(req).tenant.id;

  // -- Storage ----------------------------------------------------------------

  router.get("/storage", requirePermission("storage.read"), async (req, res) => {
    res.json(await core.storage.tenantView(tenantOf(req)));
  });

  router.put("/storage/mode", requirePermission("storage.manage"), requireActiveTenant, async (req, res) => {
    const { mode } = parse(storageModeSchema, req.body);
    await core.storage.setTenantMode(tenantOf(req), mode, actor(req));
    res.json(await core.storage.tenantView(tenantOf(req)));
  });

  /** Saves the workspace's own S3 bucket. The details are tested first and only saved if they work. */
  router.put(
    "/storage/own-s3",
    requirePermission("storage.manage"),
    requireActiveTenant,
    rateLimit(limiters.storageCheck, byTenant),
    async (req, res) => {
      const input = parse(s3TargetInputSchema, req.body);
      const result = await core.storage.saveTarget(
        { kind: "tenant", tenant: tenantOf(req) },
        input,
        actor(req),
      );
      res.json({ ...result, storage: await core.storage.tenantView(tenantOf(req)) });
    },
  );

  router.post(
    "/storage/own-s3/check",
    requirePermission("storage.manage"),
    rateLimit(limiters.storageCheck, byTenant),
    async (req, res) => {
      const check = await core.storage.recheckTarget({ kind: "tenant", tenant: tenantOf(req) }, actor(req));
      res.json({ check, storage: await core.storage.tenantView(tenantOf(req)) });
    },
  );

  // -- Settings the workspace may choose for itself ---------------------------

  router.get("/settings", requirePermission("settings.read"), async (req, res) => {
    const keys = SETTING_KEYS.filter((key) => SETTING_DEFINITIONS[key].tenantEditable);
    const settings = await Promise.all(
      keys.map(async (key) => ({
        ...describeSetting(key),
        ...(await core.settings.resolve(tenantOf(req), key)),
      })),
    );
    res.json({ settings });
  });

  router.put(
    "/settings/:key",
    requirePermission("settings.manage"),
    requireActiveTenant,
    async (req, res) => {
      const key = String(req.params.key);
      if (!isSettingKey(key)) throw badRequest("unknown_setting", "Unknown setting");
      const { value } = parse(settingValueSchema, req.body);
      if (key === "storage.mode") {
        // Storage has extra rules (allowed modes, a tested bucket), so it goes through the storage service.
        if (!isStorageMode(value)) throw badRequest("invalid_setting", "Unknown storage mode");
        await core.storage.setTenantMode(tenantOf(req), value, actor(req));
      } else {
        await core.settings.setTenant(tenantOf(req), key, value, actor(req));
      }
      res.json({ ...describeSetting(key), ...(await core.settings.resolve(tenantOf(req), key)) });
    },
  );

  router.delete(
    "/settings/:key",
    requirePermission("settings.manage"),
    requireActiveTenant,
    async (req, res) => {
      const key = String(req.params.key);
      if (!isSettingKey(key)) throw badRequest("unknown_setting", "Unknown setting");
      await core.settings.clearTenant(tenantOf(req), key, actor(req));
      res.json({ ...describeSetting(key), ...(await core.settings.resolve(tenantOf(req), key)) });
    },
  );

  // -- Audit trail ------------------------------------------------------------

  router.get("/audit", requirePermission("audit.read"), async (req, res) => {
    const db = await core.tenants.db(tenantOf(req));
    res.json(
      await core.audit.list(db, {
        before: req.query.before ? Number(req.query.before) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        actionPrefix: typeof req.query.action === "string" ? req.query.action : undefined,
      }),
    );
  });

  router.get("/audit/verify", requirePermission("audit.read"), async (req, res) => {
    res.json(await core.audit.verify(await core.tenants.db(tenantOf(req))));
  });

  router.get("/audit/export", requirePermission("audit.export"), async (req, res) => {
    const db = await core.tenants.db(tenantOf(req));
    await core.audit.record(db, { actor: actor(req), action: "audit.exported" });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="dbrb-audit-${tenantOf(req).slug}.csv"`);
    res.write("seq,time_utc,actor_type,actor,action,target_type,target_id,ip,details,hash\n");

    // The whole record, however long: an export that silently stopped early would
    // be worse than none. Pages are written as they are read, and the loop waits
    // whenever the reader is slower than the database, so memory use stays flat.
    let before: number | undefined;
    while (!res.destroyed) {
      const page = await core.audit.list(db, { before, limit: 200 });
      const rows = (page.entries as AuditEntryView[])
        .map((e) =>
          [
            e.seq,
            e.ts,
            e.actorType,
            e.actorLabel,
            e.action,
            e.targetType,
            e.targetId,
            e.ip,
            e.metadata,
            e.hash,
          ]
            .map(csvCell)
            .join(","),
        )
        .join("\n");
      if (rows && !res.write(rows + "\n")) await readyForMore(res);
      if (!page.nextBefore) break;
      before = page.nextBefore;
    }
    res.end();
  });

  return router;
};
