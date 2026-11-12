import { describe, expect, it } from "vitest";
import { planLegacyAppointmentLocks, type LegacyAppointmentForMigration } from "./appointment-migration";

const businessId = "euforia";
const start = Date.parse("2026-12-07T14:00:00.000Z");
const now = Date.parse("2026-11-01T12:00:00.000Z");

function appointment(overrides: Partial<LegacyAppointmentForMigration> = {}): LegacyAppointmentForMigration {
  return {
    id: "cita-1",
    estado: "confirmada",
    empleadoUid: "empleado-1",
    inicioMs: start,
    finMs: start + 90 * 60_000,
    duracionMin: 90,
    ...overrides,
  };
}

describe("preparación segura de citas existentes", () => {
  it("agrupa los 90 minutos en particiones hondureñas y guarda solo valores neutros", () => {
    const plan = planLegacyAppointmentLocks(businessId, [appointment()], now);
    expect(plan).toHaveLength(2);
    expect(plan.map((item) => item.particion)).toEqual([8, 9]);
    expect(plan.flatMap((item) => Object.values(item.bloques))).toHaveLength(6);
    expect(plan.flatMap((item) => Object.values(item.bloques)).every((value) => value === true)).toBe(true);
    expect(plan.every((item) => item.fechaLocal === "2026-12-07")).toBe(true);
  });

  it("ignora los holds que ya vencieron, pero detiene la preparación ante un hold vigente", () => {
    const expired = appointment({ estado: "hold", holdExpiresAtMs: now - 1 });
    expect(planLegacyAppointmentLocks(businessId, [expired], now)).toEqual([]);
    const activeHold = appointment({ estado: "hold", holdExpiresAtMs: now + 60_000 });
    expect(() => planLegacyAppointmentLocks(businessId, [activeHold], now))
      .toThrow("todavía está en espera");
  });

  it("detiene la preparación cuando una cita activa no tiene vencimiento de hold", () => {
    expect(() => planLegacyAppointmentLocks(businessId, [appointment({ estado: "hold" })], now))
      .toThrow("sin fecha de vencimiento");
  });

  it("detiene la preparación antes de escribir si hay citas solapadas", () => {
    const overlapping = appointment({ id: "cita-2", inicioMs: start + 60 * 60_000, finMs: start + 150 * 60_000 });
    expect(() => planLegacyAppointmentLocks(businessId, [appointment(), overlapping], now))
      .toThrow("superpuestas");
  });

  it("detiene las citas que cruzan la medianoche de Honduras y las lecturas mayores de 500", () => {
    const crossingMidnight = appointment({
      inicioMs: Date.parse("2026-12-08T05:30:00.000Z"),
      finMs: Date.parse("2026-12-08T06:30:00.000Z"),
      duracionMin: 60,
    });
    expect(() => planLegacyAppointmentLocks(businessId, [crossingMidnight], now))
      .toThrow("cruza la medianoche");
    const tooMany = Array.from({ length: 501 }, (_, index) => appointment({ id: `cita-${index}` }));
    expect(() => planLegacyAppointmentLocks(businessId, tooMany, now)).toThrow("más de 500 citas");
  });
});
