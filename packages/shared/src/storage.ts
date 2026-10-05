import { z } from "zod";

/**
 * Where a workspace's backups are written.
 *
 *   local        the server's own disk (managed by the platform)
 *   platform_s3  the platform's S3 bucket ("managed S3")
 *   own_s3       the workspace's own S3 bucket (bring your own storage)
 */
export const STORAGE_MODES = ["local", "platform_s3", "own_s3"] as const;

export type StorageMode = (typeof STORAGE_MODES)[number];

export const isStorageMode = (value: unknown): value is StorageMode =>
  STORAGE_MODES.includes(value as StorageMode);

/** Who decided the effective storage mode for a workspace (tenant). */
export type StorageModeSource =
  | "forced" // the platform owner pinned this tenant to a mode
  | "tenant" // the tenant's admin chose it
  | "platform_default" // inherited from the platform default
  | "fallback"; // the chosen mode is no longer available, so local disk is used

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const PREFIX_RE = /^[A-Za-z0-9!_.*'()/-]*$/;

/** Non-secret S3 settings. Safe to return to the browser. */
export const s3PublicConfigSchema = z.object({
  bucket: z.string().trim().regex(BUCKET_RE, "Use 3-63 lowercase letters, numbers, dots or hyphens"),
  region: z.string().trim().min(1, "Region is required").max(64),
  /** Empty for Amazon S3. Set for S3-compatible services (Backblaze B2, Cloudflare R2, MinIO...). */
  endpoint: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || /^https?:\/\//i.test(v), "Must start with http:// or https://")
    .default(""),
  /** Required by most S3-compatible services; Amazon S3 does not need it. */
  forcePathStyle: z.boolean().default(false),
  /** Optional folder inside the bucket, e.g. "dbrb/production". */
  prefix: z
    .string()
    .trim()
    .max(200)
    .regex(PREFIX_RE, "Only letters, numbers and / - _ . are allowed")
    .transform((v) => v.replace(/^\/+|\/+$/g, ""))
    .default(""),
});

export type S3PublicConfig = z.infer<typeof s3PublicConfigSchema>;

export const s3SecretsSchema = z.object({
  accessKeyId: z.string().trim().min(1, "Access key ID is required").max(256),
  secretAccessKey: z.string().min(1, "Secret access key is required").max(512),
});

export type S3Secrets = z.infer<typeof s3SecretsSchema>;

/**
 * Payload for saving S3 details from the admin panel. Secrets may be omitted
 * when editing an existing target, meaning "keep the saved keys".
 */
export const s3TargetInputSchema = s3PublicConfigSchema.extend({
  accessKeyId: z.string().trim().max(256).optional(),
  secretAccessKey: z.string().max(512).optional(),
});

export type S3TargetInput = z.infer<typeof s3TargetInputSchema>;

/** What the API returns for a saved S3 target. The secret key never leaves the server. */
export interface S3TargetView extends S3PublicConfig {
  id: string;
  /** Last four characters only, so admins can recognise which key is saved. */
  accessKeyIdHint: string;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckDetail: string | null;
  updatedAt: string;
}

/** One step of the storage self-test (write, read, signed download, delete). */
export interface StorageCheckStep {
  step: "write" | "read" | "signed_url" | "delete";
  ok: boolean;
  ms: number;
  detail?: string;
}

export interface StorageCheckResult {
  ok: boolean;
  steps: StorageCheckStep[];
}

/** Where one stored object lives. Saved with every backup so it stays usable after a switch. */
export interface StorageLocation {
  /** Whose storage: the platform's, or the tenant's own bucket. */
  scope: "platform" | "tenant";
  kind: "local" | "s3";
  /** The S3 target row; null for local disk. */
  targetId: string | null;
  key: string;
}
