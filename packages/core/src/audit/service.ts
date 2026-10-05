import type { AuditEntryView, AuditPage, AuditVerification } from "@dbrb/shared";
import { and, asc, desc, eq, gt, like, lt } from "drizzle-orm";
import { auditHeads, auditLog } from "../db/common";
import type { Db } from "../db/mysql";
import { newId } from "../ids";
import { GENESIS_HASH, computeEntryHash } from "./hash";

/** Who did something. Recorded on every audit entry. */
export interface Actor {
  /** user = a signed-in person; system = automation; platform = platform staff acting on a tenant */
  type: "user" | "system" | "platform";
  id: string | null;
  /** Human-readable identity at the time of the action (usually the email). */
  label: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: "system", id: null, label: "system" };

export interface AuditInput {
  actor: Actor;
  /** Dotted verb, e.g. "storage.mode.changed". */
  action: string;
  targetType?: string;
  targetId?: string;
  /** Platform log only: the tenant the action concerns. */
  tenantId?: string;
  /** Extra context. Callers must never put secrets here. */
  metadata?: Record<string, unknown>;
}

type AuditRow = typeof auditLog.$inferSelect;

const toView = (row: AuditRow): AuditEntryView => ({
  seq: row.seq,
  id: row.id,
  ts: row.ts.toISOString(),
  actorType: row.actorType as AuditEntryView["actorType"],
  actorId: row.actorId,
  actorLabel: row.actorLabel,
  action: row.action,
  targetType: row.targetType,
  targetId: row.targetId,
  ip: row.ip,
  metadata: row.metadata ?? null,
  hash: row.hash,
});

/**
 * Append-only audit trail with a hash chain.
 *
 * The same code serves the platform log and every tenant's log: callers pass the
 * database handle of the log they are writing to. Appends take a row lock on the
 * chain head, so entries are strictly ordered with no gaps even when several
 * servers write at once.
 */
export class AuditService {
  /** Creates the chain head if this database has never been written to. */
  async ensureHead(db: Db): Promise<void> {
    await db
      .insert(auditHeads)
      .values({ scope: "main", lastSeq: 0, lastHash: GENESIS_HASH })
      .onDuplicateKeyUpdate({
        set: { scope: "main" },
      });
  }

  async record(db: Db, input: AuditInput): Promise<void> {
    // Round-trip through JSON so what we hash is exactly what MySQL will store
    // (dates become strings, undefined values disappear).
    const metadata = input.metadata
      ? (JSON.parse(JSON.stringify(input.metadata)) as Record<string, unknown>)
      : null;

    await db.transaction(async (tx) => {
      const [head] = await tx.select().from(auditHeads).where(eq(auditHeads.scope, "main")).for("update");
      if (!head) throw new Error("Audit chain head is missing; run migrations/provisioning first");

      const entry = {
        seq: head.lastSeq + 1,
        id: newId(),
        ts: new Date(),
        actorType: input.actor.type,
        actorId: input.actor.id,
        actorLabel: input.actor.label,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        tenantId: input.tenantId ?? null,
        ip: input.actor.ip ?? null,
        userAgent: input.actor.userAgent?.slice(0, 255) ?? null,
        requestId: input.actor.requestId ?? null,
        metadata,
      };
      const hash = computeEntryHash(entry, head.lastHash);

      await tx.insert(auditLog).values({ ...entry, prevHash: head.lastHash, hash });
      await tx
        .update(auditHeads)
        .set({ lastSeq: entry.seq, lastHash: hash })
        .where(eq(auditHeads.scope, "main"));
    });
  }

  /** Newest first. `before` pages backwards through older entries. */
  async list(
    db: Db,
    options: { before?: number; limit?: number; actionPrefix?: string } = {},
  ): Promise<AuditPage> {
    // These arrive from a query string, so "abc" and "1.5" have to be survivable.
    const requested = Number.isFinite(options.limit) ? Math.trunc(options.limit!) : 50;
    const limit = Math.min(Math.max(requested, 1), 200);
    const before = Number.isFinite(options.before) ? Math.trunc(options.before!) : 0;
    const conditions = [
      before > 0 ? lt(auditLog.seq, before) : undefined,
      options.actionPrefix
        ? like(auditLog.action, `${options.actionPrefix.replace(/[%_]/g, "")}%`)
        : undefined,
    ].filter((c) => c !== undefined);

    const rows = await db
      .select()
      .from(auditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.seq))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    return {
      entries: page.map(toView),
      nextBefore: rows.length > limit ? page[page.length - 1]!.seq : null,
    };
  }

  /** Recomputes every hash from the first entry. Any edit, insert or deletion shows up as a break. */
  async verify(db: Db): Promise<AuditVerification> {
    let prevHash = GENESIS_HASH;
    let expectedSeq = 1;
    let count = 0;
    let cursor = 0;

    for (;;) {
      const rows = await db
        .select()
        .from(auditLog)
        .where(gt(auditLog.seq, cursor))
        .orderBy(asc(auditLog.seq))
        .limit(1000);
      if (rows.length === 0) break;

      for (const row of rows) {
        const hash = computeEntryHash({ ...row, metadata: row.metadata ?? null }, prevHash);
        if (row.seq !== expectedSeq || row.prevHash !== prevHash || row.hash !== hash) {
          return { ok: false, entries: count, brokenAtSeq: row.seq };
        }
        prevHash = hash;
        expectedSeq += 1;
        count += 1;
      }
      cursor = rows[rows.length - 1]!.seq;
    }

    // The head must agree with the last entry, otherwise the newest entries were removed.
    const [head] = await db.select().from(auditHeads).where(eq(auditHeads.scope, "main"));
    if (head && (head.lastSeq !== count || head.lastHash !== prevHash)) {
      return { ok: false, entries: count, brokenAtSeq: count + 1 };
    }
    return { ok: true, entries: count, brokenAtSeq: null };
  }
}
