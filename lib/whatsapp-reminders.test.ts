import { describe, expect, it } from "vitest";
import { birthdayIsToday, buildManualReminderCandidates, DEFAULT_REMINDER_LEAD_HOURS, isSafeReminderMessage, reminderAppointmentDue, renderReminderTemplate, returnReminderDate } from "./whatsapp-reminder-logic";

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

  it("genera el aviso manual exactamente dentro del plazo de 73 horas y omite a quien lo pausó", () => {
    const now = Date.parse("2026-11-12T18:00:00Z");
    const start = now + 72 * 3_600_000;
    const candidates = buildManualReminderCandidates({
      negocioId: "salon",
      now,
      clientes: [
        { id: "c1", name: "Ana", phone: "12345678" },
        { id: "c2", name: "Luz", phone: "12345678", aceptaRecordatoriosWhatsApp: false },
      ],
      citas: [
        { id: "a1", negocioId: "salon", estado: "confirmada", clienteId: "c1", servicioId: "s1", inicio: start },
        { id: "a2", negocioId: "salon", estado: "confirmada", clienteId: "c2", servicioId: "s1", inicio: start },
      ],
      servicios: [{ id: "s1", nombre: "Corte" }],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ id: "cita-a1", tipo: "cita", clienteId: "c1", fechaProgramada: start - 73 * 3_600_000 });
  });

  it("genera el cumpleaños hondureño de hoy y no lo repite para personas que pausaron avisos", () => {
    const now = Date.parse("2026-11-12T18:00:00Z");
    const candidates = buildManualReminderCandidates({
      negocioId: "salon",
      now,
      clientes: [
        { id: "cumple", name: "Ana", birthdayDay: "12", birthdayMonth: "11" },
        { id: "pausa", name: "Luz", birthdayDay: 12, birthdayMonth: 11, aceptaRecordatoriosWhatsApp: false },
      ],
      citas: [],
      servicios: [],
    });
    expect(candidates.map((candidate) => candidate.id)).toEqual(["cumpleanos-cumple-2026"]);
  });

  it("programa el recordatorio de regreso una sola vez y lo omite si ya hay otra cita del servicio", () => {
    const now = Date.parse("2026-02-01T18:00:00Z");
    const completed = {
      id: "finished", negocioId: "salon", estado: "finalizada", clienteId: "c1",
      servicioId: "s1", servicioNombre: "Color", completedAt: Date.parse("2026-01-02T18:00:00Z"),
    };
    const base = {
      negocioId: "salon", now,
      clientes: [{ id: "c1", name: "Ana" }],
      servicios: [{ id: "s1", nombre: "Color", recordatorioRegresoActivo: true, periodoRegresoDias: 30, anticipacionRecordatorioDias: 3 }],
    };
    expect(buildManualReminderCandidates({ ...base, citas: [completed] }).map((candidate) => candidate.id)).toContain("regreso-finished");
    expect(buildManualReminderCandidates({ ...base, citas: [completed, {
      id: "next", negocioId: "salon", estado: "confirmada", clienteId: "c1", servicioId: "s1", inicio: now + 7 * 86_400_000,
    }] }).map((candidate) => candidate.id)).not.toContain("regreso-finished");
  });
});
