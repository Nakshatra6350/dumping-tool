/**
 * The local S3-compatible server from infra/docker-compose.dev.yml.
 * These are throwaway development credentials, not secrets. Each value can be
 * overridden (for CI) with the environment variable named beside it.
 */
export const DEV_S3 = {
  endpoint: process.env.DEV_S3_ENDPOINT ?? "http://127.0.0.1:9000",
  region: process.env.DEV_S3_REGION ?? "us-east-1",
  accessKeyId: process.env.DEV_S3_ACCESS_KEY_ID ?? "dbrb_s3_dev",
  secretAccessKey: process.env.DEV_S3_SECRET_ACCESS_KEY ?? "dbrb_s3_dev_secret",
  /** Stands in for the platform's own ("managed") bucket. */
  platformBucket: process.env.DEV_S3_PLATFORM_BUCKET ?? "dbrb-platform",
  /** Stands in for a customer's own bucket. */
  tenantBucket: process.env.DEV_S3_TENANT_BUCKET ?? "dbrb-tenant-demo",
} as const;
