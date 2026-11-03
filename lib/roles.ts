export type CanonicalRole = "admin" | "empleado" | "cliente";
export type RoleProfile = { rol?: unknown; role?: unknown } | null | undefined;

function normalizeRole(value: unknown): CanonicalRole | null {
  if (typeof value !== "string") return null;
  const role = value.trim().toLowerCase();
  if (role === "admin" || role === "administrador") return "admin";
  if (role === "empleado") return "empleado";
  if (role === "cliente") return "cliente";
  return null;
}

export function profileRole(profile: RoleProfile): CanonicalRole | null {
  if (!profile) return null;
  const hasRol = typeof profile.rol === "string" && profile.rol.trim().length > 0;
  const hasRole = typeof profile.role === "string" && profile.role.trim().length > 0;
  const primary = hasRol ? normalizeRole(profile.rol) : null;
  const legacy = hasRole ? normalizeRole(profile.role) : null;

  if ((hasRol && !primary) || (hasRole && !legacy)) return null;
  if (primary && legacy && primary !== legacy) return null;
  return primary ?? legacy;
}

export function hasProfileRole(profile: RoleProfile, allowedRoles: string[]): boolean {
  const actualRole = profileRole(profile);
  if (!actualRole) return false;
  return allowedRoles.some((role) => normalizeRole(role) === actualRole);
}
