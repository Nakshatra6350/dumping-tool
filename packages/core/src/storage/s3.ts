import { Transform, type Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { S3PublicConfig, S3Secrets } from "@dbrb/shared";
import { attachmentDisposition, type StorageDriver } from "./types";

const PART_SIZE = 8 * 1024 * 1024;

/**
 * Amazon S3 and any S3-compatible service (Backblaze B2, Cloudflare R2, MinIO,
 * RustFS...). Only standard S3 calls are used.
 */
export class S3Driver implements StorageDriver {
  readonly kind = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: S3PublicConfig, secrets: S3Secrets) {
    this.bucket = config.bucket;
    this.prefix = config.prefix;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: secrets.accessKeyId, secretAccessKey: secrets.secretAccessKey },
      maxAttempts: 2,
      // Newer SDKs add checksums by default, which several S3-compatible services reject.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      requestHandler: { connectionTimeout: 6_000, requestTimeout: 120_000 },
    });
  }

  private fullKey(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  async put(
    key: string,
    body: Readable | Buffer,
    options: { contentType?: string } = {},
  ): Promise<{ size: number }> {
    const params = { Bucket: this.bucket, Key: this.fullKey(key), ContentType: options.contentType };
    if (Buffer.isBuffer(body)) {
      await this.client.send(new PutObjectCommand({ ...params, Body: body }));
      return { size: body.length };
    }

    // Count bytes as they pass, since the size of a stream is not known up front.
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(null, chunk);
      },
    });
    body.on("error", (err) => counter.destroy(err));

    // Multipart upload: constant memory use however large the backup is.
    const upload = new Upload({
      client: this.client,
      params: { ...params, Body: body.pipe(counter) },
      partSize: PART_SIZE,
      queueSize: 4,
      leavePartsOnError: false,
    });
    await upload.done();
    return { size };
  }

  async read(key: string): Promise<{ stream: Readable; size: number | null }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }));
    return { stream: res.Body as Readable, size: res.ContentLength ?? null };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }));
      return true;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (err as Error).name === "NotFound") return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }));
  }

  async signedDownloadUrl(
    key: string,
    options: { expiresInSeconds: number; fileName: string },
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.fullKey(key),
      ResponseContentDisposition: attachmentDisposition(options.fileName),
    });
    return getSignedUrl(this.client, command, { expiresIn: options.expiresInSeconds });
  }

  destroy(): void {
    this.client.destroy();
  }
}

/** Turns SDK and network errors into a sentence an admin can act on. Never includes secrets. */
export const describeStorageError = (err: unknown): string => {
  const e = err as {
    name?: string;
    code?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const name = e?.name ?? "";
  const code = e?.code ?? "";
  const status = e?.$metadata?.httpStatusCode;

  if (name === "NoSuchBucket" || (name === "NotFound" && status === 404)) return "The bucket does not exist.";
  if (name === "InvalidAccessKeyId") return "The access key ID was not recognised.";
  if (name === "SignatureDoesNotMatch") return "The secret access key is incorrect.";
  if (name === "AccessDenied" || status === 403) {
    return "Access denied. Check that the key is allowed to read, write and delete in this bucket.";
  }
  if (name === "PermanentRedirect" || name === "AuthorizationHeaderMalformed" || status === 301) {
    return "The bucket is in a different region. Check the region.";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "The endpoint host could not be found.";
  if (code === "ECONNREFUSED") return "The endpoint refused the connection.";
  if (name === "TimeoutError" || code === "ETIMEDOUT" || code === "ECONNRESET") {
    return "The storage service did not respond in time.";
  }
  if (code === "EACCES" || code === "EPERM") return "The server is not allowed to write to this location.";
  if (code === "ENOSPC") return "The disk is full.";
  return (e?.message ?? "Unknown storage error").slice(0, 300);
};
