import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated encryption (AES-256-GCM) for small secrets stored in the database:
 * database passwords, S3 keys, wrapped data keys.
 *
 * `context` is bound into the ciphertext as additional authenticated data, so a
 * value encrypted for one purpose ("storage-target:01ABC") cannot be swapped into
 * another row and still decrypt.
 *
 * Format: v1.<iv>.<auth tag>.<ciphertext>, each part base64url.
 */
const VERSION = "v1";

const assertKey = (key: Buffer) => {
  if (key.length !== 32) throw new Error("Encryption key must be exactly 32 bytes");
};

export const seal = (key: Buffer, plaintext: Buffer | string, context: string): string => {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const input = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const data = Buffer.concat([cipher.update(input), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
};

export const open = (key: Buffer, sealed: string, context: string): Buffer => {
  assertKey(key);
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error("Unrecognised encrypted value");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]);
};

export const sealJson = (key: Buffer, value: unknown, context: string): string =>
  seal(key, JSON.stringify(value), context);

export const openJson = <T>(key: Buffer, sealed: string, context: string): T =>
  JSON.parse(open(key, sealed, context).toString("utf8")) as T;
