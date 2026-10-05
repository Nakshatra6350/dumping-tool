import { describe, expect, it } from "vitest";
import { GENESIS_HASH, canonicalJson, computeEntryHash, type HashableEntry } from "./hash";

const entry: HashableEntry = {
  seq: 1,
  id: "01J00000000000000000000000",
  ts: new Date("2026-10-04T10:00:00.000Z"),
  actorType: "user",
  actorId: "01J0000000000000000000USER",
  actorLabel: "owner@example.com",
  action: "settings.updated",
  targetType: "setting",
  targetId: "storage.mode",
  tenantId: null,
  ip: "127.0.0.1",
  userAgent: null,
  requestId: null,
  metadata: { from: "local", to: "own_s3" },
};

describe("canonicalJson", () => {
  it("is independent of key order, at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }),
    );
  });

  it("drops undefined values, like JSON storage does", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("computeEntryHash", () => {
  it("is deterministic and depends on the previous hash", () => {
    const first = computeEntryHash(entry, GENESIS_HASH);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEntryHash(entry, GENESIS_HASH)).toBe(first);
    expect(computeEntryHash(entry, first)).not.toBe(first);
  });

  it("changes when any field changes", () => {
    const base = computeEntryHash(entry, GENESIS_HASH);
    expect(computeEntryHash({ ...entry, action: "settings.reset" }, GENESIS_HASH)).not.toBe(base);
    expect(computeEntryHash({ ...entry, actorLabel: "someone@else.com" }, GENESIS_HASH)).not.toBe(base);
    expect(
      computeEntryHash({ ...entry, metadata: { from: "local", to: "platform_s3" } }, GENESIS_HASH),
    ).not.toBe(base);
    expect(computeEntryHash({ ...entry, ts: new Date("2026-10-04T10:00:00.001Z") }, GENESIS_HASH)).not.toBe(
      base,
    );
  });
});
