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

export type ManualReminderCandidate = {
  id: string;
  tipo: ReminderType;
  estado: "pendiente";
  negocioId: string;
  clienteId: string;
  citaId?: string;
  servicioId?: string;
  servicioNombre?: string;
  clienteNombre: string;
  clienteTelefono: string;
  fechaProgramada: number;
  citaFecha?: string;
  citaHoraInicio?: string;
  anticipacionRecordatorioDias?: number;
  aniversarioAno?: number;
};

type ReminderClientSource = {
  id: string;
  name?: unknown;
  displayName?: unknown;
  nombre?: unknown;
  phone?: unknown;
  telefono?: unknown;
  birthdayDay?: unknown;
  birthdayMonth?: unknown;
  aceptaRecordatoriosWhatsApp?: unknown;
};

type ReminderAppointmentSource = {
  id: string;
  negocioId?: string;
  estado: string;
  clienteId: string;
  servicioId?: string;
  servicioNombre?: string;
  inicio?: unknown;
  completedAt?: unknown;
  updatedAt?: unknown;
};

type ReminderServiceSource = {
  id: string;
  nombre?: string;
  recordatorioRegresoActivo?: boolean;
  periodoRegresoDias?: number | null;
  anticipacionRecordatorioDias?: number | null;
};

function displayName(person: ReminderClientSource): string {
  const name = person.name ?? person.displayName ?? person.nombre;
  return typeof name === "string" && name.trim() ? name.trim() : "Hola";
}

function localDateParts(milliseconds: number) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(milliseconds)).map((part) => [part.type, part.value]));
}

function appointmentDateLabel(milliseconds: number) {
  return new Intl.DateTimeFormat("es-HN", {
    timeZone: "America/Tegucigalpa", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(milliseconds));
}

function appointmentTimeLabel(milliseconds: number) {
  return new Intl.DateTimeFormat("es-HN", {
    timeZone: "America/Tegucigalpa", hour: "numeric", minute: "2-digit",
  }).format(new Date(milliseconds));
}

export function buildManualReminderCandidates(input: {
  negocioId: string;
  clientes: readonly ReminderClientSource[];
  citas: readonly ReminderAppointmentSource[];
  servicios: readonly ReminderServiceSource[];
  horasAntesCita?: number;
  now?: number;
}): ManualReminderCandidate[] {
  const now = input.now ?? Date.now();
  const leadHours = Number.isInteger(input.horasAntesCita) && Number(input.horasAntesCita) >= 1 && Number(input.horasAntesCita) <= 720
    ? Number(input.horasAntesCita)
    : DEFAULT_REMINDER_LEAD_HOURS;
  const clients = new Map(input.clientes.map((client) => [client.id, client]));
  const services = new Map(input.servicios.map((service) => [service.id, service]));
  const candidates: ManualReminderCandidate[] = [];
  const eligibleClient = (client: ReminderClientSource | undefined): client is ReminderClientSource => Boolean(client && client.aceptaRecordatoriosWhatsApp !== false);

  for (const appointment of input.citas) {
    if (appointment.negocioId && appointment.negocioId !== input.negocioId) continue;
    const client = clients.get(appointment.clienteId);
    if (!eligibleClient(client)) continue;
    const service = appointment.servicioId ? services.get(appointment.servicioId) : undefined;
    const serviceName = String(appointment.servicioNombre ?? service?.nombre ?? "Servicio");
    const start = reminderMillis(appointment.inicio);

    if (start !== null && reminderAppointmentDue({ estado: appointment.estado, inicio: appointment.inicio }, now, leadHours)) {
      const dateParts = localDateParts(start);
      candidates.push({
        id: `cita-${appointment.id}`,
        tipo: "cita",
        estado: "pendiente",
        negocioId: input.negocioId,
        clienteId: client.id,
        citaId: appointment.id,
        servicioId: appointment.servicioId,
        servicioNombre: serviceName,
        clienteNombre: displayName(client),
        clienteTelefono: String(client.phone ?? client.telefono ?? ""),
        fechaProgramada: start - leadHours * 3_600_000,
        citaFecha: appointmentDateLabel(start),
        citaHoraInicio: appointmentTimeLabel(start),
        aniversarioAno: Number(dateParts.year),
      });
    }

    if (!service || service.recordatorioRegresoActivo !== true
      || !["finalizada", "completada"].includes(appointment.estado)) continue;
    const periodDays = Number(service.periodoRegresoDias);
    const leadDays = Number.isInteger(service.anticipacionRecordatorioDias)
      ? Number(service.anticipacionRecordatorioDias)
      : 3;
    const completedAt = appointment.completedAt ?? appointment.updatedAt;
    const reminderDate = returnReminderDate(completedAt, periodDays, leadDays);
    if (!reminderDate) continue;
    const scheduledAt = reminderDate.getTime();
    if (scheduledAt > now || scheduledAt < now - 30 * 86_400_000) continue;
    const completedAtMillis = reminderMillis(completedAt);
    const hasNewerAppointment = completedAtMillis !== null && input.citas.some((other) => {
      if (other.clienteId !== appointment.clienteId || other.servicioId !== appointment.servicioId
        || ["cancelada", "rechazada", "expirada"].includes(other.estado)) return false;
      const otherStart = reminderMillis(other.inicio);
      return otherStart !== null && otherStart > completedAtMillis;
    });
    if (hasNewerAppointment) continue;
    candidates.push({
      id: `regreso-${appointment.id}`,
      tipo: "regreso",
      estado: "pendiente",
      negocioId: input.negocioId,
      clienteId: client.id,
      citaId: appointment.id,
      servicioId: appointment.servicioId,
      servicioNombre: serviceName,
      clienteNombre: displayName(client),
      clienteTelefono: String(client.phone ?? client.telefono ?? ""),
      fechaProgramada: scheduledAt,
      anticipacionRecordatorioDias: leadDays,
    });
  }

  const birthdayParts = localDateParts(now);
  const year = Number(birthdayParts.year);
  for (const client of input.clientes) {
    if (!eligibleClient(client) || !birthdayIsToday(Number(client.birthdayDay), Number(client.birthdayMonth), new Date(now))) continue;
    candidates.push({
      id: `cumpleanos-${client.id}-${year}`,
      tipo: "cumpleanos",
      estado: "pendiente",
      negocioId: input.negocioId,
      clienteId: client.id,
      clienteNombre: displayName(client),
      clienteTelefono: String(client.phone ?? client.telefono ?? ""),
      fechaProgramada: now,
      aniversarioAno: year,
    });
  }

  return candidates.sort((left, right) => left.fechaProgramada - right.fechaProgramada || left.id.localeCompare(right.id));
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
