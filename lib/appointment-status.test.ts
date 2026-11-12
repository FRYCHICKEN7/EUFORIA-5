import { describe, expect, it } from "vitest";
import { isCompletedAppointmentStatus } from "./appointment-status";

describe("isCompletedAppointmentStatus", () => {
  it("incluye citas nuevas e históricas completadas", () => {
    expect(isCompletedAppointmentStatus("finalizada")).toBe(true);
    expect(isCompletedAppointmentStatus("completada")).toBe(true);
  });

  it("no cuenta estados que todavía no están completados", () => {
    expect(isCompletedAppointmentStatus("en_curso")).toBe(false);
    expect(isCompletedAppointmentStatus("pendiente_de_aprobacion")).toBe(false);
    expect(isCompletedAppointmentStatus("rechazada")).toBe(false);
    expect(isCompletedAppointmentStatus(undefined)).toBe(false);
  });
});
