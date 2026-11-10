import { profileRole } from "./roles";

type ClientLike = {
  id: string;
  role?: unknown;
  rol?: unknown;
  roleConflict?: boolean;
  [key: string]: unknown;
};

export function filterAdminCustomerProfiles<T extends ClientLike>(
  profiles: T[],
  employeeApplicationIds: ReadonlySet<string>,
): T[] {
  return profiles.filter((profile) =>
    !employeeApplicationIds.has(profile.id)
    && !profile.roleConflict
    && profileRole(profile) === "cliente",
  );
}
