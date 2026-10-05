import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt (memory-hard, built into Node, no native add-on).
 * Parameters follow OWASP: N = 2^17, r = 8, p = 1 in production.
 *
 * Stored format: scrypt$<cost exponent>$<r>$<p>$<salt>$<hash>
 * The parameters travel with the hash, so the cost can be raised later and old
 * hashes still verify (see needsRehash).
 */
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

const scrypt = (
  password: string,
  salt: Buffer,
  costExponent: number,
  r: number,
  p: number,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const N = 2 ** costExponent;
    scryptCallback(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N, r, p, maxmem: 256 * N * r },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });

export const hashPassword = async (password: string, costExponent: number): Promise<string> => {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, costExponent, R, P);
  return ["scrypt", costExponent, R, P, salt.toString("base64url"), hash.toString("base64url")].join("$");
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [scheme, cost, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !cost || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), Number(cost), Number(r), Number(p));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

/** True when a stored hash uses a weaker work factor than the current setting. */
export const needsRehash = (stored: string, costExponent: number): boolean => {
  const [scheme, cost] = stored.split("$");
  return scheme !== "scrypt" || Number(cost) < costExponent;
};
