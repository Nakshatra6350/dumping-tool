import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LocalKeyProvider, generateDataKey } from "./keys";
import { hashPassword, needsRehash, verifyPassword } from "./passwords";
import { open, openJson, seal, sealJson } from "./seal";
import { randomToken, sha256Hex, signPayload, verifyPayload } from "./tokens";

describe("seal / open", () => {
  const key = randomBytes(32);

  it("round-trips and never produces the same ciphertext twice", () => {
    const a = seal(key, "s3-secret-key", "ctx");
    const b = seal(key, "s3-secret-key", "ctx");
    expect(a).not.toBe(b);
    expect(a).not.toContain("s3-secret-key");
    expect(open(key, a, "ctx").toString()).toBe("s3-secret-key");
  });

  it("round-trips JSON", () => {
    const value = { accessKeyId: "AKIA", secretAccessKey: 'p@ss "word" ✓' };
    expect(openJson(key, sealJson(key, value, "ctx"), "ctx")).toEqual(value);
  });

  it("refuses to decrypt under a different context (a value cannot be moved to another row)", () => {
    const sealed = seal(key, "secret", "storage-target:A");
    expect(() => open(key, sealed, "storage-target:B")).toThrow();
  });

  it("refuses a tampered ciphertext and a wrong key", () => {
    const sealed = seal(key, "secret", "ctx");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => open(key, parts.join("."), "ctx")).toThrow();
    expect(() => open(randomBytes(32), sealed, "ctx")).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => seal(randomBytes(16), "x", "ctx")).toThrow(/32 bytes/);
  });
});

describe("LocalKeyProvider", () => {
  it("wraps and unwraps a data key, bound to its context", async () => {
    const provider = new LocalKeyProvider("a-master-key-that-is-long-enough-123");
    const dataKey = generateDataKey();
    const wrapped = await provider.wrap(dataKey, "tenant-data-key:T1");
    expect((await provider.unwrap(wrapped, "tenant-data-key:T1")).equals(dataKey)).toBe(true);
    await expect(provider.unwrap(wrapped, "tenant-data-key:T2")).rejects.toThrow();
  });

  it("cannot unwrap with a different master key", async () => {
    const wrapped = await new LocalKeyProvider("master-key-number-one-xxxxxxxxxxxxx").wrap(
      generateDataKey(),
      "c",
    );
    await expect(
      new LocalKeyProvider("master-key-number-two-xxxxxxxxxxxxx").unwrap(wrapped, "c"),
    ).rejects.toThrow();
  });
});

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const a = await hashPassword("correct horse battery", 12);
    const b = await hashPassword("correct horse battery", 12);
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$12$")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("wrong password", a)).toBe(false);
  });

  it("rejects malformed hashes and flags weak ones for rehash", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    const weak = await hashPassword("pw-pw-pw-pw", 10);
    expect(needsRehash(weak, 12)).toBe(true);
    expect(needsRehash(weak, 10)).toBe(false);
  });
});

describe("tokens", () => {
  it("creates unpredictable tokens and stable hashes", () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("verifies signed payloads and rejects tampering or the wrong key", () => {
    const token = signPayload("key-1", { k: "tenants/a/file.gz", e: 123 });
    expect(verifyPayload("key-1", token)).toEqual({ k: "tenants/a/file.gz", e: 123 });
    expect(verifyPayload("key-2", token)).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ k: "tenants/b/file.gz", e: 123 })).toString("base64url");
    expect(verifyPayload("key-1", `${forged}.${sig}`)).toBeNull();
    expect(verifyPayload("key-1", body!)).toBeNull();
  });
});
