import { badRequest, notFound, platformActor, type Core } from "@dbrb/core";
import {
  SETTING_KEYS,
  STORAGE_MODES,
  describeSetting,
  isSettingKey,
  s3TargetInputSchema,
  settingValueSchema,
  tenantStorageOverrideSchema,
} from "@dbrb/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import type { Limiters } from "../app";
import { parse, rateLimit, requirePlatformAdmin, sessionOf } from "../http/middleware";

const rulesSchema = z.object({
  defaultMode: z.enum(STORAGE_MODES),
  allowedModes: z.array(z.enum(STORAGE_MODES)).min(1),
});

/**
 * The platform console: only for the platform owner. Sets the rules every
 * workspace lives by. Every action here is written to the platform audit log.
 */
export const platformRoutes = (core: Core, limiters: Limiters): Router => {
  const router = Router();
  router.use(requirePlatformAdmin);

  const actor = (req: Request) => platformActor(sessionOf(req), req.meta);
  const byUser = (req: Request) => sessionOf(req).user.id;

  // -- Storage rules and the managed bucket -----------------------------------

  router.get("/storage", async (_req, res) => {
    res.json(await core.storage.platformView());
  });

  router.put("/storage/rules", async (req, res) => {
    const rules = parse(rulesSchema, req.body);
    await core.storage.setPlatformRules(rules, actor(req));
    res.json(await core.storage.platformView());
  });

  router.put("/storage/s3", rateLimit(limiters.storageCheck, byUser), async (req, res) => {
    const input = parse(s3TargetInputSchema, req.body);
    const result = await core.storage.saveTarget({ kind: "platform" }, input, actor(req));
    res.json({ ...result, storage: await core.storage.platformView() });
  });

  router.post("/storage/s3/check", rateLimit(limiters.storageCheck, byUser), async (req, res) => {
    const check = await core.storage.recheckTarget({ kind: "platform" }, actor(req));
    res.json({ check, storage: await core.storage.platformView() });
  });

  router.post("/storage/local/check", rateLimit(limiters.storageCheck, byUser), async (_req, res) => {
    res.json({ check: await core.storage.checkLocal() });
  });

  /** Pins one workspace to a storage mode, or releases it with { mode: null }. */
  router.put("/tenants/:id/storage", async (req, res) => {
    const { mode } = parse(tenantStorageOverrideSchema, req.body);
    const tenant = await core.tenants.findById(String(req.params.id));
    if (!tenant) throw notFound("Workspace");
    await core.storage.forceTenantMode(tenant, mode, actor(req));
    res.json(await core.storage.platformView());
  });

  // -- Platform-wide settings -------------------------------------------------

  router.get("/settings", async (_req, res) => {
    const settings = await Promise.all(
      SETTING_KEYS.map(async (key) => ({
        ...describeSetting(key),
        ...(await core.settings.platformValue(key)),
      })),
    );
    res.json({ settings });
  });

  router.put("/settings/:key", async (req, res) => {
    const key = String(req.params.key);
    if (!isSettingKey(key)) throw badRequest("unknown_setting", "Unknown setting");
    if (key === "storage.mode" || key === "storage.allowed_modes") {
      throw badRequest("use_storage_rules", "Change storage rules from the storage screen");
    }
    const { value } = parse(settingValueSchema, req.body);
    await core.settings.setPlatform(key, value, actor(req));
    res.json({ ...describeSetting(key), ...(await core.settings.platformValue(key)) });
  });

  // -- Platform audit trail ---------------------------------------------------

  router.get("/audit", async (req, res) => {
    res.json(
      await core.audit.list(core.platform.db, {
        before: req.query.before ? Number(req.query.before) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        actionPrefix: typeof req.query.action === "string" ? req.query.action : undefined,
      }),
    );
  });

  router.get("/audit/verify", async (_req, res) => {
    res.json(await core.audit.verify(core.platform.db));
  });

  return router;
};
