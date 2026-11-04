export type ProfileDocument = Record<string, unknown>;

export function normalizeRoleValue(value: unknown): "admin" | "empleado" | "cliente" | null {
  if (typeof value !== "string") return null;
  const role = value.trim().toLowerCase();
  if (role === "admin" || role === "administrador") return "admin";
  if (role === "empleado" || role === "employee") return "empleado";
  if (role === "cliente" || role === "customer" || role === "client") return "cliente";
  return null;
}

export function roleFromProfile(document: ProfileDocument | null | undefined): string {
  if (!document) return "";
  const primaryRaw = typeof document.rol === "string" ? document.rol.trim() : "";
  const legacyRaw = typeof document.role === "string" ? document.role.trim() : "";
  const primary = normalizeRoleValue(primaryRaw);
  const legacy = normalizeRoleValue(legacyRaw);
  if ((primaryRaw && !primary) || (legacyRaw && !legacy)) return "";
  if (primary && legacy && primary !== legacy) return "";
  return primary ?? legacy ?? "";
}

/** Role resolution across profile documents is fail-closed when any role disagrees. */
export function roleFromProfiles(documents: Array<ProfileDocument | null | undefined>): string {
  let resolved = "";
  for (const document of documents) {
    if (!document) continue;
    const role = roleFromProfile(document);
    const hasRole = (typeof document.rol === "string" && document.rol.trim())
      || (typeof document.role === "string" && document.role.trim());
    if (hasRole && !role) return "";
    if (role && resolved && role !== resolved) return "";
    if (role) resolved = role;
  }
  return resolved;
}

/** Caller supplies records in legacy -> employee -> canonical order. */
export function mergeProfileDocuments(documents: Array<ProfileDocument | null | undefined>, uid: string) {
  const available = documents.filter((document): document is ProfileDocument => Boolean(document));
  if (available.length === 0) return null;
  const role = roleFromProfiles(available);
  const data = Object.assign({}, ...available);
  const hasRole = available.some((document) =>
    (typeof document.rol === "string" && document.rol.trim())
    || (typeof document.role === "string" && document.role.trim()),
  );
  return {
    ...data,
    id: uid,
    ...(role ? { role, rol: role } : {}),
    ...(hasRole && !role ? { roleConflict: true } : {}),
  };
}
