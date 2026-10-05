import type { Readable } from "node:stream";

/**
 * A place backups can be written to. Everything above this interface (backup
 * jobs, restores, downloads) is identical for local disk and S3; a new kind of
 * storage is added by implementing this interface, nothing else changes.
 */
export interface StorageDriver {
  readonly kind: "local" | "s3";

  /** Writes an object. Streams are uploaded without buffering the whole file in memory. */
  put(key: string, body: Readable | Buffer, options?: { contentType?: string }): Promise<{ size: number }>;

  read(key: string): Promise<{ stream: Readable; size: number | null }>;

  exists(key: string): Promise<boolean>;

  delete(key: string): Promise<void>;

  /**
   * A time-limited link that downloads the object directly, without a session.
   * For S3 this is a presigned URL; for local disk it is a signed link served by the API.
   */
  signedDownloadUrl(key: string, options: { expiresInSeconds: number; fileName: string }): Promise<string>;
}

/** Safe value for a Content-Disposition header. */
export const attachmentDisposition = (fileName: string): string =>
  `attachment; filename="${fileName.replace(/[^\w.-]+/g, "_").slice(0, 180) || "download"}"`;
