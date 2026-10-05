import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { DEV_S3 } from "../testing/devS3";

/**
 * Creates the buckets used in local development on the S3-compatible server
 * from infra/docker-compose.dev.yml. Run automatically by `pnpm infra:up`.
 * In production you create real buckets and type their details into the admin panel.
 */
const main = async () => {
  const client = new S3Client({
    region: DEV_S3.region,
    endpoint: DEV_S3.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: DEV_S3.accessKeyId, secretAccessKey: DEV_S3.secretAccessKey },
  });

  // The storage server may still be starting.
  for (let attempt = 1; ; attempt++) {
    try {
      for (const bucket of [DEV_S3.platformBucket, DEV_S3.tenantBucket]) {
        try {
          await client.send(new HeadBucketCommand({ Bucket: bucket }));
          console.log(`bucket exists:  ${bucket}`);
        } catch {
          await client.send(new CreateBucketCommand({ Bucket: bucket }));
          console.log(`bucket created: ${bucket}`);
        }
      }
      break;
    } catch (err) {
      if (attempt >= 20) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  client.destroy();
};

main().catch((err) => {
  console.error("Could not create development buckets:", (err as Error).message);
  process.exit(1);
});
