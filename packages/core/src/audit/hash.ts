import { createHash } from "node:crypto";

/** The "previous hash" of the very first entry in a chain. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * JSON with object keys sorted at every level, so the same data always produces
 * the same text regardless of key order (MySQL's JSON type reorders keys).
 */
export const canonicalJson = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
};

export interface HashableEntry {
  seq: number;
  id: string;
  ts: Date;
  actorType: string;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  tenantId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
}

/** hash = SHA-256(previous hash + this entry). Changing any field of any entry breaks the chain. */
export const computeEntryHash = (entry: HashableEntry, prevHash: string): string =>
  createHash("sha256")
    .update(prevHash)
    .update("\n")
    .update(
      canonicalJson({
        seq: entry.seq,
        id: entry.id,
        ts: entry.ts.toISOString(),
        actorType: entry.actorType,
        actorId: entry.actorId,
        actorLabel: entry.actorLabel,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        tenantId: entry.tenantId,
        ip: entry.ip,
        userAgent: entry.userAgent,
        requestId: entry.requestId,
        metadata: entry.metadata,
      }),
    )
    .digest("hex");
