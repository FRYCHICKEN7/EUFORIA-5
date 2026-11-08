export type ReminderType = "cita" | "regreso" | "cumpleanos";
export type ReminderTemplates = { cita: string; regreso: string; cumpleanos: string };

export const DEFAULT_REMINDER_LEAD_HOURS = 73;
export const DEFAULT_REMINDER_TEMPLATES: ReminderTemplates = {
  cita: "💕 ¡Hola, {{Nombre del cliente}}! Te recordamos tu cita.\n\n🗓️ {{Fecha de la cita}} | 🕒 {{Hora de la cita}}\nServicio: {{Nombre del servicio}}\n\n¡Será un placer atenderte!\n{{Nombre del negocio}}",
  regreso: "🌸 ¡Hola, {{Nombre del cliente}}!\n\nYa faltan {{Días para volver}} días para tu próximo servicio de {{Nombre del servicio}}.\n\nNos encantará volver a atenderte.\n{{Nombre del negocio}}",
  cumpleanos: "🎂 ¡Feliz cumpleaños, {{Nombre del cliente}}! 🥳💕\n\nDeseamos que tengas un día maravilloso.\n{{Nombre del negocio}} 💗",
};

export const ALLOWED_TEMPLATE_VARIABLES: Record<ReminderType, readonly string[]> = {
  cita: ["Nombre del cliente", "Fecha de la cita", "Hora de la cita", "Nombre del servicio", "Nombre del negocio"],
  regreso: ["Nombre del cliente", "Nombre del servicio", "Días para volver", "Nombre del negocio"],
  cumpleanos: ["Nombre del cliente", "Nombre del negocio"],
};

export function renderReminderTemplate(template: string, type: ReminderType, values: Record<string, unknown>): string {
  const allowed = new Set(ALLOWED_TEMPLATE_VARIABLES[type]);
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_token, key: string) => {
    if (!allowed.has(key)) return "";
    const value = values[key];
    return value === null || value === undefined ? "" : String(value);
  }).replace(/\{\{[\s\S]*?\}\}/g, "").replace(/\b(undefined|null)\b/gi, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function isSafeReminderMessage(text: string): boolean {
  return !/\{\{[^}]*\}\}|\b(?:undefined|null)\b/i.test(text) && text.trim().length > 0;
}

export function reminderMillis(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    const millis = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
  }
  return null;
}

export function reminderAppointmentDue(
  appointment: { estado: string; inicio: unknown; [key: string]: unknown },
  now = Date.now(),
  leadHours = DEFAULT_REMINDER_LEAD_HOURS,
): boolean {
  if (appointment.estado !== "confirmada" || !Number.isFinite(leadHours) || leadHours < 1) return false;
  const start = reminderMillis(appointment.inicio);
  return start !== null && start > now && start - now <= leadHours * 3_600_000;
}

export function returnReminderDate(completedAt: unknown, periodDays: number, leadDays = 3): Date | null {
  const done = reminderMillis(completedAt);
  if (done === null || !Number.isInteger(periodDays) || periodDays <= 0 || !Number.isInteger(leadDays) || leadDays < 0) return null;
  return new Date(done + (periodDays - leadDays) * 86_400_000);
}

export function birthdayIsToday(day: unknown, month: unknown, now = new Date()): boolean {
  if (!Number.isInteger(day) || !Number.isInteger(month) || Number(day) < 1 || Number(day) > 31 || Number(month) < 1 || Number(month) > 12) return false;
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const currentDay = Number(values.day);
  const currentMonth = Number(values.month);
  const currentYear = Number(values.year);
  const february28InNonLeapYear = currentMonth === 2 && currentDay === 28 && !isLeapYear(currentYear);
  if (Number(day) === 29 && Number(month) === 2 && february28InNonLeapYear) return true;
  return Number(day) === currentDay && Number(month) === currentMonth;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
