import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditHeads, auditLog } from "../db/common";
import type { Db } from "../db/mysql";
import { createTestCore, testActor, type TestCore } from "../testing/harness";

let t: TestCore;

beforeAll(async () => {
  t = await createTestCore();
});

afterAll(async () => {
  await t.cleanup();
});

const freshLog = async (): Promise<Db> =>
  t.core.tenants.db(await t.core.tenants.provision({ name: "Audit" }));

describe("audit trail", () => {
  it("records who did what, in order, and verifies", async () => {
    const db = await freshLog();
    const actor = {
      ...testActor("owner@acme.com"),
      id: "01J0000000000000000000USER",
      userAgent: "vitest",
      requestId: "req-1",
    };

    await t.core.audit.record(db, {
      actor,
      action: "settings.updated",
      targetType: "setting",
      targetId: "storage.mode",
      metadata: { from: "local", to: "own_s3" },
    });
    await t.core.audit.record(db, {
      actor,
      action: "storage.target.saved",
      metadata: { bucket: "b", when: new Date("2026-01-01T00:00:00Z"), skipped: undefined },
    });

    const page = await t.core.audit.list(db);
    expect(page.entries.map((e) => e.action)).toEqual(["storage.target.saved", "settings.updated"]);
    expect(page.entries[1]).toMatchObject({
      seq: 1,
      actorLabel: "owner@acme.com",
      targetId: "storage.mode",
      ip: "127.0.0.1",
      metadata: { from: "local", to: "own_s3" },
    });
    expect(page.nextBefore).toBeNull();

    expect(await t.core.audit.verify(db)).toEqual({ ok: true, entries: 2, brokenAtSeq: null });
  });

  it("keeps a gap-free chain when many writers append at the same time", async () => {
    const db = await freshLog();
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        t.core.audit.record(db, { actor: testActor(), action: `test.concurrent`, metadata: { i } }),
      ),
    );
    const rows = await db.select({ seq: auditLog.seq }).from(auditLog).orderBy(auditLog.seq);
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(await t.core.audit.verify(db)).toMatchObject({ ok: true, entries: 25 });
  });

  it("pages backwards and filters by action prefix", async () => {
    const db = await freshLog();
    for (let i = 0; i < 5; i++)
      await t.core.audit.record(db, { actor: testActor(), action: i % 2 ? "auth.login" : "storage.checked" });

    const first = await t.core.audit.list(db, { limit: 2 });
    expect(first.entries.map((e) => e.seq)).toEqual([5, 4]);
    expect(first.nextBefore).toBe(4);
    const second = await t.core.audit.list(db, { limit: 2, before: first.nextBefore! });
    expect(second.entries.map((e) => e.seq)).toEqual([3, 2]);

    const onlyAuth = await t.core.audit.list(db, { actionPrefix: "auth." });
    expect(onlyAuth.entries.every((e) => e.action === "auth.login")).toBe(true);
    expect(onlyAuth.entries).toHaveLength(2);
  });

  it("survives nonsense paging values, which arrive straight from a URL", async () => {
    const db = await freshLog();
    for (let i = 0; i < 3; i++) await t.core.audit.record(db, { actor: testActor(), action: "x" });

    // "?limit=abc", "?limit=1.5", "?limit=-4", "?limit=999999"
    expect((await t.core.audit.list(db, { limit: Number("abc") })).entries).toHaveLength(3);
    expect((await t.core.audit.list(db, { limit: 1.5 })).entries).toHaveLength(1);
    expect((await t.core.audit.list(db, { limit: -4 })).entries).toHaveLength(1);
    expect((await t.core.audit.list(db, { limit: 999_999 })).entries).toHaveLength(3);
    // "?before=abc", "?before=-1", "?before=2.9"
    expect((await t.core.audit.list(db, { before: Number("abc") })).entries).toHaveLength(3);
    expect((await t.core.audit.list(db, { before: -1 })).entries).toHaveLength(3);
    expect((await t.core.audit.list(db, { before: 2.9 })).entries.map((e) => e.seq)).toEqual([1]);
  });

  it("detects an edited entry", async () => {
    const db = await freshLog();
    for (let i = 0; i < 4; i++)
      await t.core.audit.record(db, { actor: testActor(), action: "backups.downloaded", metadata: { i } });

    await db.update(auditLog).set({ actorLabel: "someone-else@example.com" }).where(eq(auditLog.seq, 2));
    expect(await t.core.audit.verify(db)).toEqual({ ok: false, entries: 1, brokenAtSeq: 2 });
  });

  it("detects a deleted entry, in the middle and at the end", async () => {
    const middle = await freshLog();
    for (let i = 0; i < 4; i++) await t.core.audit.record(middle, { actor: testActor(), action: "x" });
    await middle.delete(auditLog).where(eq(auditLog.seq, 3));
    expect(await t.core.audit.verify(middle)).toMatchObject({ ok: false, brokenAtSeq: 4 });

    const end = await freshLog();
    for (let i = 0; i < 3; i++) await t.core.audit.record(end, { actor: testActor(), action: "x" });
    const [last] = await end.select().from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
    await end.delete(auditLog).where(eq(auditLog.seq, last!.seq));
    // The chain head still remembers three entries, so the missing one is noticed.
    expect(await t.core.audit.verify(end)).toEqual({ ok: false, entries: 2, brokenAtSeq: 3 });
  });

  it("detects a forged entry appended without updating the chain", async () => {
    const db = await freshLog();
    await t.core.audit.record(db, { actor: testActor(), action: "x" });
    const [head] = await db.select().from(auditHeads);
    await db.insert(auditLog).values({
      seq: 2,
      id: "01J000000000000000000FORGE",
      ts: new Date(),
      actorType: "user",
      action: "members.role_changed",
      prevHash: head!.lastHash,
      hash: "f".repeat(64),
    });
    expect(await t.core.audit.verify(db)).toMatchObject({ ok: false, brokenAtSeq: 2 });
  });
});
