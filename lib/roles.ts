export type CanonicalRole = "admin" | "empleado" | "cliente";
export type RoleProfile = { rol?: unknown; role?: unknown; roleConflict?: boolean } | null | undefined;
export type ProfileRecord = Record<string, unknown> & RoleProfile;

export function normalizeRole(value: unknown): CanonicalRole | null {
  if (typeof value !== "string") return null;
  const role = value.trim().toLowerCase();
  if (role === "admin" || role === "administrador") return "admin";
  if (role === "empleado" || role === "employee") return "empleado";
  if (role === "cliente" || role === "customer" || role === "client") return "cliente";
  return null;
}

function hasRoleValue(profile: RoleProfile) {
  return Boolean(profile && (
    (typeof profile.rol === "string" && profile.rol.trim()) ||
    (typeof profile.role === "string" && profile.role.trim())
  ));
}

export function profileRole(profile: RoleProfile): CanonicalRole | null {
  if (!profile || profile.roleConflict === true) return null;
  const hasRol = typeof profile.rol === "string" && profile.rol.trim().length > 0;
  const hasRole = typeof profile.role === "string" && profile.role.trim().length > 0;
  const primary = hasRol ? normalizeRole(profile.rol) : null;
  const legacy = hasRole ? normalizeRole(profile.role) : null;
  if ((hasRol && !primary) || (hasRole && !legacy)) return null;
  if (primary && legacy && primary !== legacy) return null;
  return primary ?? legacy;
}

/** Merge profiles from legacy and canonical collections without allowing role precedence. */
export function mergeProfileSources(sources: Array<ProfileRecord | null | undefined>): ProfileRecord | null {
  const records = sources.filter((record): record is ProfileRecord => Boolean(record));
  if (records.length === 0) return null;
  const merged = Object.assign({}, ...records) as ProfileRecord;
  const roles = records.map((record) => ({ role: profileRole(record), hasValue: hasRoleValue(record) }));
  const invalidRole = roles.some(({ role, hasValue }) => hasValue && !role);
  const distinctRoles = new Set(roles.map(({ role }) => role).filter((role): role is CanonicalRole => Boolean(role)));
  const conflict = invalidRole || distinctRoles.size > 1 || records.some((record) => record.roleConflict === true);
  if (conflict) return { ...merged, roleConflict: true };
  const role = [...distinctRoles][0];
  return role ? { ...merged, role, rol: role, roleConflict: false } : merged;
}

export function hasProfileRole(profile: RoleProfile, allowedRoles: string[]): boolean {
  const actualRole = profileRole(profile);
  if (!actualRole) return false;
  return allowedRoles.some((role) => normalizeRole(role) === actualRole);
}
