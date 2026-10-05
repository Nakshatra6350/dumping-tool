import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomToken } from "../crypto/tokens";
import type { LocalUrlSigner } from "./signing";
import type { StorageDriver } from "./types";

/** Stores objects as files under one root directory on the server's disk. */
export class LocalDriver implements StorageDriver {
  readonly kind = "local" as const;
  private readonly root: string;

  constructor(
    root: string,
    private readonly signer: LocalUrlSigner,
  ) {
    this.root = path.resolve(root);
  }

  get directory(): string {
    return this.root;
  }

  /** Maps a storage key to a path, refusing anything that would escape the root. */
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, body: Readable | Buffer): Promise<{ size: number }> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    // Write to a temporary name first so a half-written file is never visible.
    const temp = `${target}.part-${randomToken(6)}`;
    try {
      if (Buffer.isBuffer(body)) await writeFile(temp, body);
      else await pipeline(body, createWriteStream(temp));
      await rename(temp, target);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
    return { size: (await stat(target)).size };
  }

  async read(key: string): Promise<{ stream: Readable; size: number | null }> {
    const file = this.resolve(key);
    const { size } = await stat(file);
    return { stream: createReadStream(file), size };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async signedDownloadUrl(
    key: string,
    options: { expiresInSeconds: number; fileName: string },
  ): Promise<string> {
    this.resolve(key);
    return this.signer.url(key, options.expiresInSeconds, options.fileName);
  }
}
