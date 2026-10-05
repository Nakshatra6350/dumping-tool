import { hkdfSync, randomBytes } from "node:crypto";
import { open, seal } from "./seal";

/**
 * Envelope encryption.
 *
 * A KeyProvider protects ("wraps") small secrets with a root key that never
 * leaves it. Each tenant gets its own random 32-byte data key; the data key is
 * stored wrapped, and is what actually encrypts that tenant's secrets. Deleting
 * a tenant's wrapped data key makes everything it protected unrecoverable.
 *
 * LocalKeyProvider keeps the root key in the MASTER_KEY environment variable.
 * A KmsKeyProvider (AWS KMS) can replace it at deploy time without touching
 * any calling code.
 */
export interface KeyProvider {
  wrap(plaintext: Buffer, context: string): Promise<string>;
  unwrap(wrapped: string, context: string): Promise<Buffer>;
}

export class LocalKeyProvider implements KeyProvider {
  private readonly key: Buffer;

  constructor(masterKey: string) {
    this.key = Buffer.from(hkdfSync("sha256", masterKey, "dbrb", "master-key-v1", 32));
  }

  async wrap(plaintext: Buffer, context: string): Promise<string> {
    return seal(this.key, plaintext, context);
  }

  async unwrap(wrapped: string, context: string): Promise<Buffer> {
    return open(this.key, wrapped, context);
  }
}

export const generateDataKey = (): Buffer => randomBytes(32);
