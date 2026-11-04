const HONDURAS_UTC_OFFSET_HOURS = 6;
const ACTIVE_APPOINTMENT_STATES = new Set(["hold", "pendiente_de_aprobacion", "confirmada", "en_curso"]);

export type TimeBreak = { inicio: string; fin: string };
export type AppointmentInterval = {
  estado: string;
  inicioMs: number;
  finMs: number;
  holdExpiresAtMs?: number | null;
};
export type AvailabilityInput = {
  date: string;
  nowMs: number;
  serviceDurationMin: number;
  opening: string;
  closing: string;
  businessBreaks?: TimeBreak[];
  employeeStart: string;
  employeeEnd: string;
  appointments: AppointmentInterval[];
  slotStepMin?: number;
};
export type AvailableSlot = { hora: string; inicioMs: number; finMs: number };

export function parseClock(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value);
  if (!match) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function parseLocalDate(value: unknown): { year: number; month: number; day: number; weekday: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return { year, month, day, weekday: date.getUTCDay() };
}

/** Honduras stays UTC−06:00. Build an instant from a wall-clock day/time, not device locale. */
export function hondurasDateTimeMs(date: string, minuteOfDay: number): number | null {
  const parts = parseLocalDate(date);
  if (!parts || !Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > 24 * 60) return null;
  return Date.UTC(parts.year, parts.month - 1, parts.day, Math.floor(minuteOfDay / 60) + HONDURAS_UTC_OFFSET_HOURS, minuteOfDay % 60, 0, 0);
}

export function hondurasDayBounds(date: string): { startMs: number; endMs: number } | null {
  const startMs = hondurasDateTimeMs(date, 0);
  const nextParts = parseLocalDate(date);
  if (startMs === null || !nextParts) return null;
  const next = new Date(Date.UTC(nextParts.year, nextParts.month - 1, nextParts.day + 1));
  const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  const endMs = hondurasDateTimeMs(nextDate, 0);
  return endMs === null ? null : { startMs, endMs };
}

function timeLabel(minuteOfDay: number) {
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
}

function overlapsBreak(start: number, end: number, breaks: TimeBreak[]) {
  return breaks.some((item) => {
    const pauseStart = parseClock(item.inicio);
    const pauseEnd = parseClock(item.fin);
    if (pauseStart === null || pauseEnd === null || pauseEnd <= pauseStart) {
      throw new Error("Hay un receso inválido; debe usar inicio y fin HH:MM.");
    }
    return start < pauseEnd && end > pauseStart;
  });
}

export function computeAvailableSlots(input: AvailabilityInput): AvailableSlot[] {
  const dateParts = parseLocalDate(input.date);
  const opening = parseClock(input.opening);
  const closing = parseClock(input.closing);
  const employeeStart = parseClock(input.employeeStart);
  const employeeEnd = parseClock(input.employeeEnd);
  const step = input.slotStepMin ?? 15;
  if (!dateParts || opening === null || closing === null || employeeStart === null || employeeEnd === null) return [];
  if (!Number.isInteger(input.serviceDurationMin) || input.serviceDurationMin < 5 || input.serviceDurationMin > 480) return [];
  if (!Number.isInteger(step) || step < 5 || step > 60 || closing <= opening || employeeEnd <= employeeStart) return [];
  const breaks = input.businessBreaks ?? [];
  if (!Array.isArray(breaks)) return [];
  const first = Math.max(opening, employeeStart);
  const last = Math.min(closing, employeeEnd);
  const earliest = Math.ceil(first / step) * step;
  const dayStart = hondurasDateTimeMs(input.date, 0);
  if (dayStart === null) return [];
  const intervals = input.appointments.filter((appointment) => {
    if (!ACTIVE_APPOINTMENT_STATES.has(appointment.estado)) return false;
    return appointment.estado !== "hold" || appointment.holdExpiresAtMs == null || appointment.holdExpiresAtMs > input.nowMs;
  });
  const slots: AvailableSlot[] = [];
  for (let minute = earliest; minute + input.serviceDurationMin <= last; minute += step) {
    const endMinute = minute + input.serviceDurationMin;
    if (overlapsBreak(minute, endMinute, breaks)) continue;
    const inicioMs = dayStart + minute * 60_000;
    const finMs = dayStart + endMinute * 60_000;
    if (inicioMs <= input.nowMs) continue;
    const conflicts = intervals.some((appointment) => inicioMs < appointment.finMs && finMs > appointment.inicioMs);
    if (!conflicts) slots.push({ hora: timeLabel(minute), inicioMs, finMs });
  }
  return slots;
}
