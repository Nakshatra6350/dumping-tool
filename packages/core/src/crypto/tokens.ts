import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** A URL-safe random secret (session tokens, generated passwords). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export const sha256Hex = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

/**
 * Signed, self-contained tokens: <payload>.<HMAC-SHA256>.
 * Used for links that must work without a session, such as local download URLs.
 * The payload is readable by anyone who holds the token; it is only tamper-proof.
 */
export const signPayload = (key: string, payload: object): string => {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${signature}`;
};

export const verifyPayload = <T>(key: string, token: string): T | null => {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(signature, "base64url");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
};
