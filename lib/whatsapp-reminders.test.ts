import { describe, expect, it } from "vitest";
import { birthdayIsToday, DEFAULT_REMINDER_LEAD_HOURS, isSafeReminderMessage, reminderAppointmentDue, renderReminderTemplate, returnReminderDate } from "./whatsapp-reminder-logic";

describe("recordatorios WhatsApp: utilidades puras", () => {
  it("resuelve solo variables permitidas y elimina valores sin resolver", () => {
    const message = renderReminderTemplate("Hola {{Nombre del cliente}} {{Dato no disponible}} {{Nombre del negocio}}", "cumpleanos", { "Nombre del cliente": "Ana", "Nombre del negocio": "EUFORIA" });
    expect(message).toBe("Hola Ana  EUFORIA");
    expect(isSafeReminderMessage(message)).toBe(true);
    expect(isSafeReminderMessage("Hola {{faltante}} null")).toBe(false);
  });
  it("solo considera citas confirmadas dentro de la ventana configurada", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(DEFAULT_REMINDER_LEAD_HOURS).toBe(73);
    expect(reminderAppointmentDue({ id: "a", estado: "confirmada", inicio: new Date(now + 72 * 3600000), clienteId: "c", negocioId: "n", servicioId: "s" }, now, 73)).toBe(true);
    expect(reminderAppointmentDue({ id: "a", estado: "pendiente_de_aprobacion", inicio: new Date(now + 3600000), clienteId: "c", negocioId: "n", servicioId: "s" }, now, 73)).toBe(false);
  });
  it("calcula regreso desde completedAt y no inventa fecha sin período válido", () => {
    const date = returnReminderDate(new Date("2026-01-01T00:00:00Z"), 30, 3);
    expect(date?.toISOString()).toBe("2026-01-28T00:00:00.000Z");
    expect(returnReminderDate(undefined, 30)).toBeNull();
    expect(returnReminderDate(new Date(), 0)).toBeNull();
  });
  it("reconoce cumpleaños y aplica 29 de febrero el 28 en años no bisiestos", () => {
    expect(birthdayIsToday(8, 11, new Date("2026-11-08T18:00:00Z"))).toBe(true);
    expect(birthdayIsToday(29, 2, new Date("2025-02-28T18:00:00Z"))).toBe(true);
  });
});
