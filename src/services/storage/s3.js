const fs = require("fs");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} = require("@aws-sdk/client-s3");

// Works with any S3-compatible provider: AWS S3, Cloudflare R2, Backblaze B2,
// MinIO, Supabase Storage, etc.
module.exports = (opts) => {
  if (!opts.bucket || !opts.accessKeyId || !opts.secretAccessKey) {
    throw new Error("S3 storage requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  }
  const client = new S3Client({
    endpoint: opts.endpoint,
    region: opts.region,
    forcePathStyle: opts.forcePathStyle,
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
  });
  const fullKey = (key) => (opts.prefix ? `${opts.prefix}/${key}` : key);

  return {
    name: "s3",

    async put(localFile, key) {
      const { size } = await fs.promises.stat(localFile);
      await client.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: fullKey(key),
          Body: fs.createReadStream(localFile),
          ContentLength: size,
          ContentType: "application/gzip",
        })
      );
      await fs.promises.rm(localFile, { force: true });
    },

    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: opts.bucket, Key: fullKey(key) }));
      return { stream: res.Body, size: res.ContentLength };
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: fullKey(key) }));
    },

    async check() {
      await client.send(new HeadBucketCommand({ Bucket: opts.bucket }));
      return `S3 bucket "${opts.bucket}"`;
    },
  };
};
