import { describe, expect, it } from "vitest";
import { computeAvailableSlots, hondurasDateTimeMs } from "../functions/src/availability";

function at(date: string, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const result = hondurasDateTimeMs(date, hour * 60 + minute);
  if (result === null) throw new Error("Hora de prueba inválida");
  return result;
}

const base = {
  date: "2026-11-03",
  opening: "08:00",
  closing: "17:00",
  employeeStart: "08:00",
  employeeEnd: "17:00",
  businessBreaks: [],
  appointments: [],
};

describe("available appointment slots", () => {
  it("uses the corrected 08:00–17:00 shift and fits a 90-minute service", () => {
    const slots = computeAvailableSlots({ ...base, nowMs: at(base.date, "07:00"), serviceDurationMin: 90 });
    expect(slots[0]?.hora).toBe("08:00");
    expect(slots.at(-1)?.hora).toBe("15:30");
    expect(slots).toHaveLength(31);
    expect(slots.every((slot) => slot.finMs - slot.inicioMs === 90 * 60_000)).toBe(true);
  });

  it("at 10:00 hides past/overlapping times and offers 11:30 after a 10:00–11:30 booking", () => {
    const slots = computeAvailableSlots({
      ...base,
      nowMs: at(base.date, "10:00"),
      serviceDurationMin: 90,
      appointments: [{ estado: "confirmada", inicioMs: at(base.date, "10:00"), finMs: at(base.date, "11:30") }],
    });
    const times = slots.map((slot) => slot.hora);
    expect(times).not.toContain("09:45");
    expect(times).not.toContain("10:00");
    expect(times).not.toContain("11:15");
    expect(times).toContain("11:30");
    expect(times[0]).toBe("11:30");
  });

  it("keeps expired temporary holds out of conflicts and live holds inside", () => {
    const nowMs = at(base.date, "09:00");
    const expired = computeAvailableSlots({
      ...base,
      nowMs,
      serviceDurationMin: 60,
      appointments: [{ estado: "hold", inicioMs: at(base.date, "10:00"), finMs: at(base.date, "11:00"), holdExpiresAtMs: nowMs - 1 }],
    });
    const active = computeAvailableSlots({
      ...base,
      nowMs,
      serviceDurationMin: 60,
      appointments: [{ estado: "hold", inicioMs: at(base.date, "10:00"), finMs: at(base.date, "11:00"), holdExpiresAtMs: nowMs + 1 }],
    });
    expect(expired.map((slot) => slot.hora)).toContain("10:00");
    expect(active.map((slot) => slot.hora)).not.toContain("10:00");
  });

  it("never offers a service overlapping the lunch break or starting in the past", () => {
    const slots = computeAvailableSlots({
      ...base,
      nowMs: at(base.date, "11:30"),
      serviceDurationMin: 60,
      businessBreaks: [{ inicio: "12:00", fin: "13:00" }],
    });
    const times = slots.map((slot) => slot.hora);
    expect(times).not.toContain("11:30");
    expect(times).toContain("13:00");
    expect(times).not.toContain("08:00");
  });

  it("rejects impossible calendar dates", () => {
    expect(hondurasDateTimeMs("2026-02-30", 600)).toBeNull();
  });
});
