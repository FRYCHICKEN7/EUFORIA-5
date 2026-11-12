import { hondurasDayBounds } from "./availability";
import {
  appointmentLockId,
  blockKeysForInterval,
  hondurasDateForMillis,
  hondurasDateKeyMillis,
  partitionBlockKeys,
} from "./appointment-blocks";

const MAX_LEGACY_APPOINTMENTS = 500;
const LEGACY_HOLD_MINUTES = 30;
const ACTIVE_STATES = new Set(["pendiente_de_aprobacion", "confirmada", "en_curso"]);

export type LegacyAppointmentForMigration = {
  id: string;
  estado: string;
  empleadoUid?: string;
  empleadoId?: string;
  inicioMs: number | null;
  finMs?: number | null;
  duracionMin?: number | null;
  holdExpiresAtMs?: number | null;
  createdAtMs?: number | null;
};

export type AppointmentLockPlanItem = {
  id: string;
  negocioId: string;
  empleadoUid: string;
  fechaLocal: string;
  fechaLocalKey: number;
  particion: number;
  bloques: Record<string, true>;
  ultimaCitaId: string;
};

type ActiveInterval = {
  id: string;
  empleadoUid: string;
  fechaLocal: string;
  fechaLocalKey: number;
  inicioMs: number;
  finMs: number;
  grupos: ReturnType<typeof partitionBlockKeys>;
};

function buildLegacyAppointmentLocks(
  negocioId: string,
  appointments: readonly LegacyAppointmentForMigration[],
  nowMs: number,
): AppointmentLockPlanItem[] {
  if (!negocioId) throw new Error("No encontramos el negocio que se va a preparar.");
  if (appointments.length > MAX_LEGACY_APPOINTMENTS) {
    throw new Error("Hay más de 500 citas para revisar. Reduce el historial antes de preparar la agenda.");
  }
  if (!Number.isFinite(nowMs)) throw new Error("No pudimos comprobar la hora actual.");

  const active: ActiveInterval[] = [];
  for (const appointment of appointments) {
    if (appointment.estado === "hold") {
      const expiryMs = appointment.holdExpiresAtMs
        ?? (appointment.createdAtMs === null || appointment.createdAtMs === undefined
          ? null
          : appointment.createdAtMs + LEGACY_HOLD_MINUTES * 60_000);
      if (expiryMs === null || !Number.isFinite(expiryMs)) {
        throw new Error("Hay una solicitud antigua sin fecha de vencimiento. Revísala antes de preparar la agenda.");
      }
      if (expiryMs <= nowMs) continue;
      throw new Error("Hay una solicitud antigua que todavía está en espera. Confírmala o recházala antes de preparar la agenda.");
    }
    if (!ACTIVE_STATES.has(appointment.estado)) continue;

    const employeeUid = String(appointment.empleadoUid ?? appointment.empleadoId ?? "").trim();
    const startMs = appointment.inicioMs;
    if (!appointment.id || !employeeUid || !Number.isFinite(startMs)) {
      throw new Error("Hay una cita activa con datos incompletos. Revísala antes de preparar la agenda.");
    }
    const durationMin = appointment.duracionMin;
    const endMs = Number.isFinite(appointment.finMs)
      ? Number(appointment.finMs)
      : Number.isInteger(durationMin) && Number(durationMin) > 0
        ? Number(startMs) + Number(durationMin) * 60_000
        : NaN;
    if (!Number.isFinite(endMs) || endMs <= Number(startMs)) {
      throw new Error("Hay una cita activa sin duración válida. Revísala antes de preparar la agenda.");
    }
    if (Number.isInteger(durationMin) && Number(durationMin) > 0
      && Number(startMs) + Number(durationMin) * 60_000 !== Number(endMs)) {
      throw new Error("La hora y duración guardadas no coinciden en una cita activa. Revísala antes de preparar la agenda.");
    }
    if (Number(endMs) - Number(startMs) > 8 * 60 * 60_000) {
      throw new Error("Hay una cita que supera las ocho horas. Revísala antes de preparar la agenda.");
    }
    if (Number(endMs) <= nowMs) continue;

    const fechaLocal = hondurasDateForMillis(Number(startMs));
    if (hondurasDateForMillis(Number(endMs) - 1) !== fechaLocal) {
      throw new Error("Hay una cita que cruza la medianoche de Honduras. Revísala antes de preparar la agenda.");
    }
    const dateBounds = hondurasDayBounds(fechaLocal);
    if (!dateBounds) throw new Error("No pudimos calcular un día de la agenda.");
    const fechaLocalKey = hondurasDateKeyMillis(fechaLocal);
    const blockKeys = blockKeysForInterval(Number(startMs), Number(endMs));
    const grupos = partitionBlockKeys(blockKeys, dateBounds.startMs);
    if (grupos.length === 0) throw new Error("Hay una cita sin bloques de horario. Revísala antes de preparar la agenda.");
    active.push({
      id: appointment.id,
      empleadoUid: employeeUid,
      fechaLocal,
      fechaLocalKey,
      inicioMs: Number(startMs),
      finMs: Number(endMs),
      grupos,
    });
  }

  active.sort((a, b) => a.empleadoUid.localeCompare(b.empleadoUid)
    || a.fechaLocal.localeCompare(b.fechaLocal)
    || a.inicioMs - b.inicioMs
    || a.id.localeCompare(b.id));
  const lastByEmployeeDay = new Map<string, ActiveInterval>();
  for (const appointment of active) {
    const key = `${appointment.empleadoUid}:${appointment.fechaLocal}`;
    const previous = lastByEmployeeDay.get(key);
    if (previous && appointment.inicioMs < previous.finMs) {
      throw new Error(`Hay citas superpuestas del mismo profesional el ${appointment.fechaLocal}. Resuélvelas antes de preparar la agenda.`);
    }
    lastByEmployeeDay.set(key, appointment);
  }

  const planned = new Map<string, AppointmentLockPlanItem>();
  for (const appointment of active) {
    for (const group of appointment.grupos) {
      const id = appointmentLockId(appointment.empleadoUid, appointment.fechaLocalKey, group.partition);
      const planKey = `${appointment.empleadoUid}:${appointment.fechaLocalKey}:${group.partition}`;
      const item = planned.get(planKey) ?? {
        id,
        negocioId,
        empleadoUid: appointment.empleadoUid,
        fechaLocal: appointment.fechaLocal,
        fechaLocalKey: appointment.fechaLocalKey,
        particion: group.partition,
        bloques: {} as Record<string, true>,
        ultimaCitaId: appointment.id,
      };
      for (const blockKey of group.keys) {
        if (item.bloques[blockKey]) {
          throw new Error(`Hay citas demasiado cercanas para preparar con precisión el ${appointment.fechaLocal}. Revísalas antes de abrir la agenda.`);
        }
        item.bloques[blockKey] = true;
      }
      item.ultimaCitaId = appointment.id;
      planned.set(planKey, item);
    }
  }
  return [...planned.values()].sort((a, b) => a.empleadoUid.localeCompare(b.empleadoUid)
    || a.fechaLocalKey - b.fechaLocalKey
    || a.particion - b.particion);
}

export class AppointmentPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppointmentPlanError";
  }
}

export function planLegacyAppointmentLocks(
  negocioId: string,
  appointments: readonly LegacyAppointmentForMigration[],
  nowMs: number,
): AppointmentLockPlanItem[] {
  try {
    return buildLegacyAppointmentLocks(negocioId, appointments, nowMs);
  } catch (error) {
    if (error instanceof AppointmentPlanError) throw error;
    throw new AppointmentPlanError(error instanceof Error ? error.message : "No pudimos validar las citas existentes.");
  }
}
