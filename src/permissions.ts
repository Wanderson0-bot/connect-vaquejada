export const PARK_ROLES = ["park_manager", "office", "announcer", "judge", "track_operator"] as const;
export type ParkRole = typeof PARK_ROLES[number];
export const EVENT_ROLES = ["office", "announcer", "judge", "track_operator", "event_supervisor"] as const;
export type EventRole = typeof EVENT_ROLES[number];
export const PLATFORM_ROLES = ["platform_admin", "deployment", "support"] as const;
export type PlatformRole = typeof PLATFORM_ROLES[number];
export type UserRole = ParkRole | EventRole | PlatformRole;
export type Permission =
  | "platform.admin" | "park.manage" | "event.read" | "event.manage"
  | "entry.read" | "entry.create" | "entry.update" | "entry.cancel" | "entry.transfer" | "entry.reserve"
  | "payment.read" | "payment.record" | "report.read" | "audit.read" | "users.manage"
  | "track.read" | "track.queue" | "track.rotation_control" | "track.rotation_close" | "track.rotation_reopen"
  | "result.read" | "result.judge" | "result.return_decide" | "result.confirm" | "result.correct" | "standings.read";

const manager = new Set<Permission>([
  "park.manage", "event.read", "event.manage", "entry.read", "entry.create", "entry.update", "entry.cancel", "entry.transfer", "entry.reserve",
  "payment.read", "payment.record", "report.read", "audit.read", "users.manage", "track.read", "track.queue", "track.rotation_control", "track.rotation_close",
  "track.rotation_reopen", "result.read", "result.judge", "result.return_decide", "result.confirm", "result.correct", "standings.read",
]);
const rolePermissions: Record<UserRole, ReadonlySet<Permission>> = {
  // A platform administrator has no implicit access to event or financial data.
  platform_admin: new Set(["platform.admin", "audit.read", "report.read"]),
  deployment: new Set(["platform.admin", "audit.read", "report.read", "users.manage"]),
  support: new Set(["platform.admin", "audit.read", "report.read"]),
  park_manager: manager,
  office: new Set(["event.read", "entry.read", "entry.create", "entry.update", "payment.read", "payment.record", "report.read"]),
  announcer: new Set(["event.read", "track.read", "track.queue", "result.read", "result.judge", "result.return_decide", "standings.read"]),
  judge: new Set(["event.read", "entry.read", "track.read", "result.read", "result.judge", "result.return_decide"]),
  track_operator: new Set(["event.read", "entry.read", "track.read", "track.queue", "track.rotation_control"]),
  event_supervisor: new Set(["event.read", "entry.read", "payment.read", "report.read", "track.read", "result.read", "standings.read"]),
};

export function roleAllows(role: UserRole | null | undefined, permission: Permission): boolean {
  return Boolean(role && rolePermissions[role]?.has(permission));
}

export function requireRolePermission(role: UserRole | null | undefined, permission: Permission): void {
  if (!roleAllows(role, permission)) throw new Error(`Perfil sem permissão para ${permission}.`);
}

export function parkRoleLabel(role: UserRole): string {
  return ({
    platform_admin: "Administrador da plataforma",
    deployment: "Implantação Connect",
    support: "Suporte Connect",
    park_manager: "Responsável pelo parque",
    office: "Escritório",
    announcer: "Locução",
    judge: "Julgador",
    track_operator: "Operador de Pista",
    event_supervisor: "Responsável pelo evento",
  } satisfies Record<UserRole, string>)[role];
}
