import { describe, expect, it } from "vitest";
import { hasProfileRole, mergeProfileSources, profileRole } from "./roles";

describe("profileRole", () => {
  it("acepta role legacy admin y normaliza alias administrativos", () => {
    expect(profileRole({ role: "admin" })).toBe("admin");
    expect(profileRole({ role: "administrador" })).toBe("admin");
    expect(profileRole({ rol: "administrador" })).toBe("admin");
  });

  it("normaliza clientes legacy customer/client y roles españoles", () => {
    expect(profileRole({ role: "customer" })).toBe("cliente");
    expect(profileRole({ role: "client" })).toBe("cliente");
    expect(profileRole({ rol: "cliente" })).toBe("cliente");
    expect(profileRole({ role: "employee" })).toBe("empleado");
  });

  it("acepta cliente en dos colecciones si los aliases equivalen", () => {
    const merged = mergeProfileSources([{ role: "customer", name: "A" }, { rol: "cliente", phone: "999" }]);
    expect(profileRole(merged)).toBe("cliente");
    expect(merged?.name).toBe("A");
    expect(merged?.phone).toBe("999");
  });

  it("rechaza valores inválidos o contradictorios en un mismo perfil o entre colecciones", () => {
    expect(profileRole({ role: "owner" })).toBeNull();
    expect(profileRole({ rol: "cliente", role: "admin" })).toBeNull();
    expect(profileRole(mergeProfileSources([{ role: "cliente" }, { role: "empleado" }]))).toBeNull();
  });

  it("compara permisos de forma canónica", () => {
    expect(hasProfileRole({ role: "admin" }, ["administrador"])).toBe(true);
    expect(hasProfileRole({ rol: "cliente" }, ["admin"])).toBe(false);
  });
});
