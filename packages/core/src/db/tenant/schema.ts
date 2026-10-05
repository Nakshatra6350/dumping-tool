/**
 * A tenant database. One per workspace, isolated from every other tenant by a
 * separate MySQL database AND a separate MySQL user.
 *
 * Milestone 1 holds the shared building blocks: this tenant's settings, its own
 * storage targets and its audit trail. Connections, jobs, backups and restores
 * are added here in milestone 2.
 */
export * from "../common";
