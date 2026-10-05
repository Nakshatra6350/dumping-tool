export { createCore, type Core } from "./core";
export { RATE_LIMIT_KEY_PREFIX, loadConfig, findWorkspaceRoot, type AppConfig } from "./config";
export * from "./errors";
export { createLogger, type Logger } from "./logger";
export { newId } from "./ids";

export { AuditService, SYSTEM_ACTOR, type Actor, type AuditInput } from "./audit/service";
export { GENESIS_HASH, canonicalJson, computeEntryHash } from "./audit/hash";

export {
  AuthService,
  actorFromSession,
  platformActor,
  toSessionView,
  toUserView,
  type RequestMeta,
  type SessionContext,
  type UserRecord,
} from "./auth/service";

export { LocalKeyProvider, generateDataKey, type KeyProvider } from "./crypto/keys";
export { hashPassword, verifyPassword, needsRehash } from "./crypto/passwords";
export { open, openJson, seal, sealJson } from "./crypto/seal";
export { randomToken, sha256Hex, signPayload, verifyPayload } from "./crypto/tokens";

export { SettingsService } from "./settings/service";

export { StorageService, type ResolvedStorage, type TargetScope } from "./storage/service";
export { LocalDriver } from "./storage/local";
export { S3Driver, describeStorageError } from "./storage/s3";
export { LocalUrlSigner } from "./storage/signing";
export { runStorageCheck } from "./storage/check";
export { assertPublicHost, assertSafeEndpoint, isPrivateAddress } from "./storage/netguard";
export { attachmentDisposition, type StorageDriver } from "./storage/types";

export { TenantService, toTenantView, type TenantRecord } from "./tenancy/tenants";
export type { Db, DbHandle } from "./db/mysql";
