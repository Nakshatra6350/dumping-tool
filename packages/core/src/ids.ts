import { ulid } from "ulid";

/**
 * 26-character, time-sortable, non-guessable identifiers (ULIDs).
 * Generated in the application so inserts never depend on database sequences,
 * which keeps tenants movable between database servers.
 */
export const newId = (): string => ulid();
