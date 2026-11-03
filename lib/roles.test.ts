import { describe, expect, it } from "vitest";
import { hasProfileRole, profileRole } from "./roles";

describe("profileRole", () => {
  it("acepta el formato legacy role: admin y normaliza administrador", () => {
    expect(profileRole({ role: "admin" })).toBe("admin");
    expect(profileRole({ role: "administrador" })).toBe("admin");
    expect(profileRole({ rol: "administrador" })).toBe("admin");
  });

  it("acepta roles de cliente y empleado desde ambos campos", () => {
    expect(profileRole({ role: "cliente" })).toBe("cliente");
    expect(profileRole({ rol: "empleado" })).toBe("empleado");
  });

  it("rechaza valores inválidos o contradictorios en rol y role", () => {
    expect(profileRole({ role: "owner" })).toBeNull();
    expect(profileRole({ rol: "cliente", role: "admin" })).toBeNull();
    expect(profileRole({ rol: "admin", role: "empleado" })).toBeNull();
  });

  it("compara permisos de forma canónica", () => {
    expect(hasProfileRole({ role: "admin" }, ["administrador"])).toBe(true);
    expect(hasProfileRole({ rol: "cliente" }, ["admin"])).toBe(false);
  });
});
