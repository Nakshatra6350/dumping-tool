import type { Locale } from "./locales";
import type { Permission, Role } from "./permissions";
import type { S3TargetView, StorageMode, StorageModeSource } from "./storage";

/** API response shapes shared by the server and the web app. Dates are ISO strings. */

export interface UserView {
  id: string;
  email: string;
  name: string;
  locale: Locale;
  timezone: string;
  isPlatformAdmin: boolean;
  createdAt: string;
}

export type TenantStatus = "provisioning" | "active" | "suspended" | "pending_deletion" | "deleted";

export interface TenantView {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: string;
  createdAt: string;
}

export interface SessionView {
  user: UserView;
  tenant: TenantView;
  role: Role;
  permissions: Permission[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level problems for form errors: { "email": "Enter a valid email address" } */
    fields?: Record<string, string>;
  };
}

/** A tenant's view of its own storage: what is in effect, and what it may choose. */
export interface TenantStorageView {
  effective: {
    mode: StorageMode;
    source: StorageModeSource;
    /** True when the platform owner pinned this tenant's storage. */
    locked: boolean;
  };
  /** What this tenant's admin picked, if anything. */
  choice: StorageMode | null;
  platformDefault: StorageMode;
  options: Array<{
    mode: StorageMode;
    /** Permitted by the platform's rules. */
    allowed: boolean;
    /** Configured and usable right now. */
    ready: boolean;
    /** Why it can't be selected, when it can't. */
    reason: "not_allowed" | "platform_s3_not_configured" | "own_s3_not_configured" | null;
  }>;
  ownS3: S3TargetView | null;
  downloadUrlTtlSeconds: number;
}

/** The platform owner's view: rules, the managed bucket, and every tenant's state. */
export interface PlatformStorageView {
  defaultMode: StorageMode;
  allowedModes: StorageMode[];
  platformS3: S3TargetView | null;
  localDirectory: string;
  tenants: Array<{
    tenant: TenantView;
    effectiveMode: StorageMode;
    source: StorageModeSource;
    forcedMode: StorageMode | null;
    choice: StorageMode | null;
  }>;
}

export interface AuditEntryView {
  seq: number;
  id: string;
  ts: string;
  actorType: "user" | "system" | "platform";
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  hash: string;
}

export interface AuditPage {
  entries: AuditEntryView[];
  /** Pass as `before` to load older entries; null when there are none. */
  nextBefore: number | null;
}

export interface AuditVerification {
  ok: boolean;
  entries: number;
  /** The first entry whose hash does not match, when the chain is broken. */
  brokenAtSeq: number | null;
}
