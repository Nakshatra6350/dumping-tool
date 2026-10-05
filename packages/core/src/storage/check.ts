import type { StorageCheckResult, StorageCheckStep } from "@dbrb/shared";
import type { Readable } from "node:stream";
import { randomToken } from "../crypto/tokens";
import { describeStorageError } from "./s3";
import type { StorageDriver } from "./types";

const streamToString = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
};

/**
 * Proves that a storage location really works by doing what backups will do:
 * write a small file, read it back, download it through a signed link, then
 * delete it. Each step is timed and reported, so a failure says exactly which
 * permission is missing.
 *
 * `readSignedUrl` fetches the signed link (over HTTP for S3; in-process for local disk).
 */
export const runStorageCheck = async (
  driver: StorageDriver,
  readSignedUrl: (url: string) => Promise<string>,
): Promise<StorageCheckResult> => {
  const key = `.dbrb-check/${randomToken(9)}.txt`;
  const content = `DBRB storage check ${new Date().toISOString()}`;
  const steps: StorageCheckStep[] = [];

  const run = async (step: StorageCheckStep["step"], action: () => Promise<void>): Promise<boolean> => {
    const started = performance.now();
    try {
      await action();
      steps.push({ step, ok: true, ms: Math.round(performance.now() - started) });
      return true;
    } catch (err) {
      steps.push({
        step,
        ok: false,
        ms: Math.round(performance.now() - started),
        detail: describeStorageError(err),
      });
      return false;
    }
  };

  const written = await run("write", async () => {
    await driver.put(key, Buffer.from(content, "utf8"), { contentType: "text/plain" });
  });

  if (written) {
    await run("read", async () => {
      const { stream } = await driver.read(key);
      if ((await streamToString(stream)) !== content)
        throw new Error("The file read back did not match what was written.");
    });
    await run("signed_url", async () => {
      const url = await driver.signedDownloadUrl(key, { expiresInSeconds: 60, fileName: "dbrb-check.txt" });
      if ((await readSignedUrl(url)) !== content)
        throw new Error("The download link returned unexpected content.");
    });
    await run("delete", async () => {
      await driver.delete(key);
      if (await driver.exists(key)) throw new Error("The test file could not be deleted.");
    });
  }

  return { ok: steps.length === 4 && steps.every((s) => s.ok), steps };
};

export { streamToString };
