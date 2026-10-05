/**
 * Role-based access control catalog.
 *
 * Permissions are checked on the server for every endpoint; the web app only
 * uses them to hide what the user cannot do. Custom roles (any combination of
 * these permissions) are an enterprise feature added on top of this catalog.
 */
export const PERMISSIONS = [
  "connections.read",
  "connections.manage",
  "jobs.read",
  "jobs.manage",
  "jobs.run",
  "backups.read",
  "backups.download",
  "backups.delete",
  "backups.restore",
  "storage.read",
  "storage.manage",
  "settings.read",
  "settings.manage",
  "members.read",
  "members.manage",
  "audit.read",
  "audit.export",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["owner", "admin", "operator", "auditor", "viewer"] as const;

export type Role = (typeof ROLES)[number];

const READ_ONLY: Permission[] = [
  "connections.read",
  "jobs.read",
  "backups.read",
  "storage.read",
  "settings.read",
  "members.read",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Full control of the workspace, including storage and members.
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  // Runs the day-to-day: jobs, backups and restores, but not storage, members or settings.
  operator: [
    ...READ_ONLY,
    "connections.manage",
    "jobs.manage",
    "jobs.run",
    "backups.download",
    "backups.restore",
  ],
  // Read-only, plus the audit trail and its export. For compliance reviewers.
  auditor: [...READ_ONLY, "audit.read", "audit.export"],
  viewer: READ_ONLY,
};

export const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);

export const permissionsFor = (role: Role): readonly Permission[] => ROLE_PERMISSIONS[role];

export const roleHas = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);
