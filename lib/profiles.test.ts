import { describe, expect, it } from "vitest";
import { filterAdminCustomerProfiles } from "./admin-client-filter";

type CustomerProfile = { id: string; name?: string; role?: unknown; rol?: unknown; roleConflict?: boolean; [key: string]: unknown };

describe("filterAdminCustomerProfiles", () => {
  it("excluye solicitudes pendientes, rechazadas y aceptadas de la lista de clientes", () => {
    const profiles: CustomerProfile[] = [
      { id: "solicitud-pendiente", role: "cliente", name: "Persona pendiente" },
      { id: "solicitud-rechazada", role: "cliente", name: "Persona rechazada" },
      { id: "empleado-aceptado", role: "empleado", name: "Persona aceptada" },
      { id: "cliente-real", role: "cliente", name: "Cliente real" },
    ];
    const employeeApplications = new Set([
      "solicitud-pendiente",
      "solicitud-rechazada",
      "empleado-aceptado",
    ]);

    expect(filterAdminCustomerProfiles(profiles, employeeApplications).map((profile) => profile.id))
      .toEqual(["cliente-real"]);
  });

  it("omite los perfiles que tengan roles contradictorios", () => {
    const profiles: CustomerProfile[] = [
      { id: "perfil-valido", role: "cliente", rol: "cliente" },
      { id: "perfil-contradictorio", role: "admin", rol: "cliente" },
    ];

    expect(filterAdminCustomerProfiles(profiles, new Set()).map((profile) => profile.id))
      .toEqual(["perfil-valido"]);
  });
});
