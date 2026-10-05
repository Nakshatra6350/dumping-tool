import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runStorageCheck, streamToString } from "./check";
import { LocalDriver } from "./local";
import { assertSafeEndpoint, isPrivateAddress } from "./netguard";
import { LocalUrlSigner } from "./signing";

let root: string;
let driver: LocalDriver;
const signer = new LocalUrlSigner("unit-test-signing-key-0123456789abcdef", "http://localhost:4000");

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "dbrb-local-"));
  driver = new LocalDriver(root, signer);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LocalDriver", () => {
  it("writes buffers and streams, reads them back, and deletes", async () => {
    await driver.put("tenants/t1/a.txt", Buffer.from("hello"));
    const { size } = await driver.put(
      "tenants/t1/b.txt",
      Readable.from([Buffer.from("stream"), Buffer.from("ed")]),
    );
    expect(size).toBe(8);

    const read = await driver.read("tenants/t1/b.txt");
    expect(read.size).toBe(8);
    expect(await streamToString(read.stream)).toBe("streamed");

    expect(await driver.exists("tenants/t1/a.txt")).toBe(true);
    await driver.delete("tenants/t1/a.txt");
    expect(await driver.exists("tenants/t1/a.txt")).toBe(false);
    await driver.delete("tenants/t1/a.txt"); // deleting twice is fine
  });

  it("leaves no partial file behind when a stream fails", async () => {
    const failing = new Readable({
      read() {
        this.push(Buffer.from("partial"));
        this.destroy(new Error("source died"));
      },
    });
    await expect(driver.put("tenants/t2/broken.txt", failing)).rejects.toThrow("source died");
    const files = await readdir(path.join(root, "tenants", "t2")).catch(() => []);
    expect(files).toEqual([]);
  });

  it("refuses keys that escape the storage directory", async () => {
    await expect(driver.put("../outside.txt", Buffer.from("x"))).rejects.toThrow("Invalid storage key");
    await expect(driver.read("tenants/../../etc/passwd")).rejects.toThrow("Invalid storage key");
  });

  it("passes the full self-test", async () => {
    const result = await runStorageCheck(driver, async (url) => {
      const claims = signer.verify(signer.tokenFromUrl(url));
      if (!claims) throw new Error("rejected");
      return streamToString((await driver.read(claims.key)).stream);
    });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.step)).toEqual(["write", "read", "signed_url", "delete"]);
  });
});

describe("LocalUrlSigner", () => {
  it("accepts its own links and returns the key and file name", () => {
    const url = signer.url("tenants/t1/dump.sql.gz", 60, "dump.sql.gz");
    expect(url.startsWith("http://localhost:4000/api/v1/storage/local/")).toBe(true);
    expect(signer.verify(signer.tokenFromUrl(url))).toEqual({
      key: "tenants/t1/dump.sql.gz",
      fileName: "dump.sql.gz",
    });
  });

  it("rejects expired links, forged links and links signed with another key", () => {
    expect(signer.verify(signer.tokenFromUrl(signer.url("k", -5, "f")))).toBeNull();

    const token = signer.tokenFromUrl(signer.url("tenants/t1/dump.sql.gz", 60, "f"));
    const [, signature] = token.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ k: "tenants/OTHER/dump.sql.gz", e: 9999999999, n: "f" }),
    ).toString("base64url");
    expect(signer.verify(`${forgedBody}.${signature}`)).toBeNull();

    const other = new LocalUrlSigner("a-completely-different-signing-key-000", "http://localhost:4000");
    expect(other.verify(token)).toBeNull();
  });
});

describe("network guard", () => {
  it("recognises private, loopback and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "52.95.110.1", "2606:4700:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("blocks internal endpoints on a hosted deployment and allows them when self-hosting", async () => {
    await expect(assertSafeEndpoint("http://169.254.169.254/latest", false)).rejects.toThrow("https://");
    await expect(assertSafeEndpoint("https://169.254.169.254", false)).rejects.toThrow("private or internal");
    await expect(assertSafeEndpoint("https://127.0.0.1:9000", false)).rejects.toThrow("private or internal");
    await expect(assertSafeEndpoint("https://localhost:9000", false)).rejects.toThrow("private or internal");
    await expect(assertSafeEndpoint("not a url", false)).rejects.toThrow("not a valid URL");
    await expect(assertSafeEndpoint("http://127.0.0.1:9000", true)).resolves.toBeUndefined();
    await expect(assertSafeEndpoint("", false)).resolves.toBeUndefined();
  });
});
