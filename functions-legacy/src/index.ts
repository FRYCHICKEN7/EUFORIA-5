import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp, type DocumentData, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
export {
  actualizarRecordatorioWhatsApp,
  cancelarRecordatoriosWhatsAppExcluidos,
  cancelarRecordatoriosWhatsAppExcluidosLegacy,
  guardarConfiguracionRecordatoriosWhatsApp,
  prepararRecordatoriosCumpleanos,
  sincronizarRecordatoriosCitas,
  sincronizarRecordatoriosServicios,
} from "./reminders";
export { cambiarContrasenaProvisional, crearCuentaCliente } from "./accounts";
import {
  computeAvailableSlots,
  hondurasDayBounds,
  parseClock,
  parseLocalDate,
  type AppointmentInterval,
  type TimeBreak,
} from "./availability";
import { mergeProfileDocuments, roleFromProfiles } from "./roles";

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const ACTIVE_STATES = new Set(["hold", "pendiente_de_aprobacion", "confirmada", "en_curso"]);
const MAX_BOOKING_MINUTES = 8 * 60;
const HOLD_DURATION_MS = 30 * 60 * 1000;
const HONDURAS_TIME_ZONE = "America/Tegucigalpa";
const PROFILE_COLLECTIONS = ["users", "empleados", "usuarios"] as const;

type ReserveInput = { negocioId: string; servicioId: string; inicio: string; empleadoId: string; notas?: string };
type DecisionInput = { citaId: string; notas?: string };
type AvailabilityRequest = { negocioId: string; servicioId: string; fecha: string };
type EmployeeAvailabilityInput = {
  disponible: boolean;
  dias: Array<{ dia: number; activo: boolean; inicio?: string; fin?: string }>;
};

function requiredString(value: unknown, label: string, maxLength = 160): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpsError("invalid-argument", `${label} no es válido.`);
  }
  return value.trim();
}

function optionalNote(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function roleFrom(profile: DocumentData | null | undefined) {
  return roleFromProfiles(profile ? [profile] : []);
}

function profileRefs(uid: string) {
  return PROFILE_COLLECTIONS.map((collectionName) => db.collection(collectionName).doc(uid));
}

async function loadProfile(uid: string) {
  const snapshots = await Promise.all(profileRefs(uid).map((reference) => reference.get()));
  const sources = snapshots.map((snapshot) => snapshot.exists ? snapshot.data() ?? {} : null);
  const profile = mergeProfileDocuments(sources, uid);
  return { profile, role: roleFromProfiles(sources), snapshots };
}

async function loadProfileInTransaction(transaction: Transaction, uid: string) {
  const refs = profileRefs(uid);
  const snapshots = await Promise.all(refs.map((reference) => transaction.get(reference)));
  const sources = snapshots.map((snapshot) => snapshot.exists ? snapshot.data() ?? {} : null);
  const profile = mergeProfileDocuments(sources, uid);
  return { profile, role: roleFromProfiles(sources), refs, snapshots, sources };
}

async function adminRecipientUids(transaction: Transaction): Promise<string[]> {
  const adminRoles = ["admin", "administrador"];
  const snapshots = await Promise.all([
    transaction.get(db.collection("users").where("role", "in", adminRoles).limit(100)),
    transaction.get(db.collection("users").where("rol", "in", adminRoles).limit(100)),
    transaction.get(db.collection("usuarios").where("role", "in", adminRoles).limit(100)),
    transaction.get(db.collection("usuarios").where("rol", "in", adminRoles).limit(100)),
  ]);
  const candidates = new Set(snapshots.flatMap((snapshot) => snapshot.docs.map((item) => item.id)));
  const profiles = await Promise.all([...candidates].map(async (uid) => ({ uid, ...(await loadProfileInTransaction(transaction, uid)) })));
  return profiles.flatMap((item) => item.profile && item.role === "admin" ? [item.uid] : []);
}

function clockAndDate(millis: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HONDURAS_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(millis));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
  };
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    const millis = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function validService(service: DocumentData | undefined) {
  if (!service || service.activo !== true) throw new HttpsError("failed-precondition", "El servicio no está activo en Firebase.");
  const duration = Number(service.duracionMin);
  const price = typeof service.precio === "number" ? service.precio : Number(service.precio);
  if (!Number.isInteger(duration) || duration < 5 || duration > MAX_BOOKING_MINUTES) {
    throw new HttpsError("failed-precondition", "Configura la duración del servicio en duracionMin (5–480 minutos).");
  }
  if (!Number.isFinite(price) || price < 0) {
    throw new HttpsError("failed-precondition", "El servicio requiere un precio numérico válido.");
  }
  return { duration, price };
}

function validBusinessMode(business: DocumentData) {
  const mode = business.modoNegocio;
  if (mode !== "unipersonal" && mode !== "multiEmpleado") {
    throw new HttpsError("failed-precondition", "Configura modoNegocio como unipersonal o multiEmpleado antes de habilitar citas.");
  }
  return mode;
}

function scheduleDayId(date: string) {
  const parsed = parseLocalDate(date);
  if (!parsed) throw new HttpsError("invalid-argument", "Usa una fecha válida en formato AAAA-MM-DD.");
  return String(parsed.weekday);
}

function validateBusinessHours(hours: DocumentData | undefined) {
  if (!hours || hours.activo !== true) return null;
  const opening = parseClock(hours.apertura);
  const closing = parseClock(hours.cierre);
  if (opening === null || closing === null || closing <= opening) {
    throw new HttpsError("failed-precondition", "El horario del negocio debe tener apertura/cierre válidos en formato HH:MM.");
  }
  const breaks: TimeBreak[] = hours.recesos === undefined ? [] : hours.recesos;
  if (!Array.isArray(breaks)) throw new HttpsError("failed-precondition", "Los recesos del negocio no tienen un formato válido.");
  for (const pause of breaks) {
    const start = parseClock(pause?.inicio);
    const end = parseClock(pause?.fin);
    if (start === null || end === null || end <= start) {
      throw new HttpsError("failed-precondition", "Cada receso debe tener inicio y fin HH:MM válidos.");
    }
  }
  return { opening: String(hours.apertura), closing: String(hours.cierre), breaks };
}

function activeAppointmentIntervals(snapshot: { docs: Array<{ data: () => DocumentData }> }, nowMs: number): AppointmentInterval[] {
  return snapshot.docs.flatMap((item) => {
    const appointment = item.data();
    if (!ACTIVE_STATES.has(String(appointment.estado))) return [];
    const holdExpiresAtMs = timestampMillis(appointment.holdExpiresAt);
    if (appointment.estado === "hold" && holdExpiresAtMs !== null && holdExpiresAtMs <= nowMs) return [];
    const inicioMs = timestampMillis(appointment.inicio);
    const storedEnd = timestampMillis(appointment.fin);
    const duration = Number(appointment.duracionMin);
    const finMs = storedEnd ?? (inicioMs !== null && Number.isFinite(duration) ? inicioMs + duration * 60_000 : null);
    if (inicioMs === null || finMs === null || finMs <= inicioMs) return [];
    return [{ estado: String(appointment.estado), inicioMs, finMs, holdExpiresAtMs }];
  });
}

async function appointmentIntervals(
  transaction: Transaction | null,
  negocioId: string,
  empleadoId: string,
  date: string,
  nowMs: number,
) {
  const bounds = hondurasDayBounds(date);
  if (!bounds) throw new HttpsError("invalid-argument", "La fecha local no es válida.");
  const query = db.collection("citas")
    .where("negocioId", "==", negocioId)
    .where("empleadoId", "==", empleadoId)
    .where("inicio", ">=", Timestamp.fromMillis(bounds.startMs - MAX_BOOKING_MINUTES * 60_000))
    .where("inicio", "<", Timestamp.fromMillis(bounds.endMs));
  const snapshot = transaction ? await transaction.get(query) : await query.limit(500).get();
  return activeAppointmentIntervals(snapshot, nowMs);
}

function computeSlots(
  date: string,
  nowMs: number,
  duration: number,
  hours: { opening: string; closing: string; breaks: TimeBreak[] },
  employeeSchedule: DocumentData,
  appointments: AppointmentInterval[],
) {
  if (employeeSchedule.activo !== true) return [];
  const employeeStart = parseClock(employeeSchedule.inicio);
  const employeeEnd = parseClock(employeeSchedule.fin);
  if (employeeStart === null || employeeEnd === null || employeeEnd <= employeeStart) return [];
  return computeAvailableSlots({
    date,
    nowMs,
    serviceDurationMin: duration,
    opening: hours.opening,
    closing: hours.closing,
    businessBreaks: hours.breaks,
    employeeStart: String(employeeSchedule.inicio),
    employeeEnd: String(employeeSchedule.fin),
    appointments,
    slotStepMin: 15,
  });
}

function validateRequestedInstant(raw: string) {
  const date = new Date(raw);
  const millis = date.getTime();
  if (!Number.isFinite(millis) || date.toISOString() !== raw) {
    throw new HttpsError("invalid-argument", "La fecha y hora deben enviarse en formato ISO válido.");
  }
  if (millis > Date.now() + 365 * 24 * 60 * 60 * 1000) {
    throw new HttpsError("invalid-argument", "La fecha excede el plazo de reserva permitido.");
  }
  const local = clockAndDate(millis);
  const dateParts = parseLocalDate(local.date);
  if (!dateParts) throw new HttpsError("invalid-argument", "No se pudo calcular la fecha local de Honduras.");
  if (local.minuteOfDay % 15 !== 0) throw new HttpsError("invalid-argument", "Los inicios deben estar alineados a intervalos de 15 minutos.");
  return { millis, date: local.date, weekday: dateParts.weekday };
}

function publicEmployeeQuery(businessRef: FirebaseFirestore.DocumentReference) {
  return businessRef.collection("empleados")
    .where("activo", "==", true)
    .where("publica", "==", true)
    .where("disponible", "==", true)
    .limit(100);
}

export const guardarDisponibilidadEmpleado = onCall<EmployeeAvailabilityInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión con el perfil empleado.");
  const desiredAvailable = request.data?.disponible;
  const days = request.data?.dias;
  if (typeof desiredAvailable !== "boolean" || !Array.isArray(days) || days.length !== 7) {
    throw new HttpsError("invalid-argument", "Envía la casilla Disponible y los siete días de la semana.");
  }
  const normalizedDays = new Map<number, { dia: number; activo: boolean; inicio: string; fin: string }>();
  for (const item of days) {
    if (!Number.isInteger(item?.dia) || item.dia < 0 || item.dia > 6 || typeof item.activo !== "boolean" || normalizedDays.has(item.dia)) {
      throw new HttpsError("invalid-argument", "Cada día debe ser único, entre 0 y 6, y tener activo booleano.");
    }
    const inicio = typeof item.inicio === "string" ? item.inicio : "";
    const fin = typeof item.fin === "string" ? item.fin : "";
    if (item.activo) {
      const start = parseClock(inicio);
      const end = parseClock(fin);
      if (start === null || end === null || end <= start) throw new HttpsError("invalid-argument", "El turno activo debe tener horas válidas HH:MM y terminar después de iniciar el mismo día.");
    }
    normalizedDays.set(item.dia, { dia: item.dia, activo: item.activo, inicio: inicio || "08:00", fin: fin || "17:00" });
  }
  if (normalizedDays.size !== 7) throw new HttpsError("invalid-argument", "Se requieren los siete días de la semana.");
  if (desiredAvailable && ![...normalizedDays.values()].some((day) => day.activo)) {
    throw new HttpsError("failed-precondition", "Activa al menos un día de turno antes de marcarte disponible.");
  }

  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    const profile = await loadProfileInTransaction(transaction, uid);
    const employeeSnapshot = await transaction.get(db.collection("empleados").doc(uid));
    if (!profile.profile || profile.role !== "empleado" || !employeeSnapshot.exists) {
      throw new HttpsError("permission-denied", "Solo un empleado activo puede cambiar su disponibilidad.");
    }
    const employee = employeeSnapshot.data() ?? {};
    const negocioId = requiredString(employee.negocioId, "Negocio asignado", 128);
    const businessEmployeeRef = db.collection("negocios").doc(negocioId).collection("empleados").doc(uid);
    const businessEmployee = await transaction.get(businessEmployeeRef);
    if (!businessEmployee.exists || businessEmployee.data()?.usuarioId !== uid || businessEmployee.data()?.activo !== true) {
      throw new HttpsError("permission-denied", "El perfil operativo de empleado no está activo para este negocio.");
    }
    for (const day of normalizedDays.values()) {
      transaction.set(businessEmployeeRef.collection("disponibilidad").doc(String(day.dia)), { ...day, updatedAt: now });
    }
    transaction.update(businessEmployeeRef, { disponible: desiredAvailable, updatedAt: now });
    transaction.update(db.collection("empleados").doc(uid), { disponible: desiredAvailable, updatedAt: now });
  });
  return { ok: true as const, disponible: desiredAvailable };
});

export const obtenerDisponibilidad = onCall<AvailabilityRequest>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión para consultar horarios disponibles.");
  const customer = await loadProfile(uid);
  if (!customer.profile || customer.role !== "cliente") throw new HttpsError("permission-denied", "Solo un perfil cliente puede consultar disponibilidad.");
  const negocioId = requiredString(request.data?.negocioId, "Negocio", 128);
  const servicioId = requiredString(request.data?.servicioId, "Servicio", 128);
  const fecha = requiredString(request.data?.fecha, "Fecha", 10);
  const day = parseLocalDate(fecha);
  if (!day) throw new HttpsError("invalid-argument", "La fecha debe ser válida y usar AAAA-MM-DD.");
  const today = clockAndDate(Date.now()).date;
  if (fecha < today) throw new HttpsError("invalid-argument", "No se pueden consultar fechas que ya pasaron.");
  const todayUtc = Date.parse(`${today}T00:00:00Z`);
  const requestedUtc = Date.parse(`${fecha}T00:00:00Z`);
  if (requestedUtc - todayUtc > 365 * 24 * 60 * 60 * 1000) throw new HttpsError("invalid-argument", "La fecha excede el plazo de disponibilidad permitido.");

  const businessRef = db.collection("negocios").doc(negocioId);
  const serviceRef = businessRef.collection("servicios").doc(servicioId);
  const [businessSnapshot, serviceSnapshot, hoursSnapshot] = await Promise.all([
    businessRef.get(), serviceRef.get(), businessRef.collection("horarios").doc(String(day.weekday)).get(),
  ]);
  if (!businessSnapshot.exists || businessSnapshot.data()?.activo !== true) throw new HttpsError("not-found", "El negocio no está activo.");
  if (!serviceSnapshot.exists) throw new HttpsError("not-found", "El servicio no existe.");
  const business = businessSnapshot.data() ?? {};
  validBusinessMode(business);
  const { duration, price } = validService(serviceSnapshot.data());
  const hours = validateBusinessHours(hoursSnapshot.data());
  const service = { id: servicioId, nombre: String(serviceSnapshot.data()?.nombre ?? "Servicio"), precio: price, duracionMin: duration };
  if (!hours) return { fecha, servicio: service, empleados: [] };

  const staff = await publicEmployeeQuery(businessRef).get();
  const nowMs = Date.now();
  const employees = await Promise.all(staff.docs.map(async (employeeSnapshot) => {
    const employee = employeeSnapshot.data();
    const employeeUid = String(employee.usuarioId ?? employee.uid ?? employeeSnapshot.id);
    if (!employeeUid) return null;
    const [weeklySchedule, appointments] = await Promise.all([
      employeeSnapshot.ref.collection("disponibilidad").doc(String(day.weekday)).get(),
      appointmentIntervals(null, negocioId, employeeSnapshot.id, fecha, nowMs),
    ]);
    if (!weeklySchedule.exists) return null;
    const slots = computeSlots(fecha, nowMs, duration, hours, weeklySchedule.data() ?? {}, appointments);
    if (slots.length === 0) return null;
    return {
      id: employeeSnapshot.id,
      uid: employeeUid,
      Empleado: String(employee.Empleado ?? ""),
      nombre: String(employee.name ?? employee.nombre ?? "Profesional"),
      profileImage: typeof employee.profileImage === "string" ? employee.profileImage : "",
      slots: slots.map((slot) => ({ hora: slot.hora, inicio: new Date(slot.inicioMs).toISOString() })),
    };
  }));
  return { fecha, servicio: service, empleados: employees.filter((employee): employee is NonNullable<typeof employee> => Boolean(employee)) };
});

export const reservarCita = onCall<ReserveInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión para reservar.");
  const negocioId = requiredString(request.data?.negocioId, "Negocio", 128);
  const servicioId = requiredString(request.data?.servicioId, "Servicio", 128);
  const empleadoId = requiredString(request.data?.empleadoId, "Profesional", 128);
  const requested = validateRequestedInstant(requiredString(request.data?.inicio, "Fecha y hora", 64));
  if (requested.millis <= Date.now()) throw new HttpsError("invalid-argument", "La cita debe programarse en el futuro.");
  const notes = optionalNote(request.data?.notas);
  const businessRef = db.collection("negocios").doc(negocioId);
  const serviceRef = businessRef.collection("servicios").doc(servicioId);
  const businessEmployeeRef = businessRef.collection("empleados").doc(empleadoId);
  const appointmentRef = db.collection("citas").doc();
  const clientNoticeRef = db.collection("notificaciones").doc();
  const employeeNoticeRef = db.collection("notificaciones").doc();
  let holdExpiresAt = Timestamp.fromMillis(Date.now() + HOLD_DURATION_MS);

  await db.runTransaction(async (transaction) => {
    const [customer, businessSnapshot, serviceSnapshot, employeeSnapshot] = await Promise.all([
      loadProfileInTransaction(transaction, uid),
      transaction.get(businessRef),
      transaction.get(serviceRef),
      transaction.get(businessEmployeeRef),
    ]);
    if (!customer.profile || customer.role !== "cliente") throw new HttpsError("permission-denied", "Solo un perfil cliente puede solicitar citas.");
    if (!businessSnapshot.exists || businessSnapshot.data()?.activo !== true) throw new HttpsError("not-found", "El negocio no está disponible.");
    if (!serviceSnapshot.exists) throw new HttpsError("not-found", "El servicio no existe.");
    if (!employeeSnapshot.exists) throw new HttpsError("not-found", "El profesional no está disponible.");
    const business = businessSnapshot.data() ?? {};
    const mode = validBusinessMode(business);
    const service = serviceSnapshot.data() ?? {};
    const { duration, price } = validService(service);
    const employee = employeeSnapshot.data() ?? {};
    if (employee.activo !== true || employee.publica !== true || employee.disponible !== true) {
      throw new HttpsError("failed-precondition", "Ese empleado no está publicado y disponible para citas.");
    }
    const employeeUid = requiredString(employee.usuarioId ?? employee.uid ?? "", "UID del empleado", 128);
    const staffProfile = await loadProfileInTransaction(transaction, employeeUid);
    if (!staffProfile.profile || staffProfile.role !== "empleado") throw new HttpsError("failed-precondition", "El perfil de Authentication no está aprobado como empleado.");

    const [businessHoursSnapshot, employeeDaySnapshot] = await Promise.all([
      transaction.get(businessRef.collection("horarios").doc(String(requested.weekday))),
      transaction.get(businessEmployeeRef.collection("disponibilidad").doc(String(requested.weekday))),
    ]);
    const hours = validateBusinessHours(businessHoursSnapshot.data());
    if (!hours) throw new HttpsError("failed-precondition", "El negocio no atiende ese día.");
    const schedule = employeeDaySnapshot.data();
    if (!employeeDaySnapshot.exists || !schedule || schedule.activo !== true) throw new HttpsError("failed-precondition", "El empleado no tiene turno activo para ese día.");
    const nowMs = Date.now();
    const conflicts = await appointmentIntervals(transaction, negocioId, empleadoId, requested.date, nowMs);
    const slots = computeSlots(requested.date, nowMs, duration, hours, schedule, conflicts);
    const selectedSlot = slots.find((slot) => slot.inicioMs === requested.millis);
    if (!selectedSlot) throw new HttpsError("already-exists", "Ese horario ya no está disponible o no cabe el servicio completo dentro del turno.");

    holdExpiresAt = Timestamp.fromMillis(nowMs + HOLD_DURATION_MS);
    const customerProfile = customer.profile;
    const staffName = String(employee.name ?? employee.nombre ?? staffProfile.profile?.name ?? "Profesional");
    const booking: DocumentData = {
      negocioId,
      negocioNombre: String(business.nombre ?? business.nombreNegocio ?? business.name ?? "EUFORIA"),
      clienteId: uid,
      clienteEmail: String(request.auth?.token.email ?? customerProfile.email ?? ""),
      clienteNombre: String(customerProfile.name ?? customerProfile.displayName ?? request.auth?.token.name ?? "Cliente"),
      clienteTelefono: String(customerProfile.phone ?? customerProfile.telefono ?? ""),
      servicioId,
      servicioNombre: String(service.nombre ?? service.name ?? "Servicio"),
      precio: price,
      duracionMin: duration,
      inicio: Timestamp.fromMillis(selectedSlot.inicioMs),
      fin: Timestamp.fromMillis(selectedSlot.finMs),
      empleadoId,
      empleadoUid: employeeUid,
      empleadoNombre: staffName,
      empleadoCodigo: String(employee.Empleado ?? ""),
      modoNegocio: mode,
      estado: "hold",
      holdExpiresAt,
      createdAt: Timestamp.fromMillis(nowMs),
      ...(notes ? { notas: notes } : {}),
    };
    const adminUids = await adminRecipientUids(transaction);
    const appointmentDateLabel = new Date(selectedSlot.inicioMs).toLocaleString("es-HN", {
      timeZone: HONDURAS_TIME_ZONE,
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
    });
    transaction.set(appointmentRef, booking);
    transaction.set(clientNoticeRef, {
      destinatarioId: uid,
      tipo: "solicitud_cita_recibida",
      titulo: "Recibimos tu solicitud",
      cuerpo: `Tu solicitud para ${String(service.nombre ?? "un servicio")} con ${staffName} el ${appointmentDateLabel} quedó pendiente de confirmación.`,
      citaId: appointmentRef.id,
      negocioId,
      createdAt: Timestamp.fromMillis(nowMs),
      leida: false,
    });
    transaction.set(employeeNoticeRef, {
      destinatarioId: employeeUid,
      tipo: "nueva_solicitud_cita",
      titulo: "Nueva solicitud de cita",
      cuerpo: `${String(customerProfile.name ?? "Un cliente")} solicita ${String(service.nombre ?? "un servicio")} a las ${new Date(selectedSlot.inicioMs).toLocaleTimeString("es-HN", { timeZone: HONDURAS_TIME_ZONE, hour: "numeric", minute: "2-digit" })}.`,
      citaId: appointmentRef.id,
      negocioId,
      createdAt: Timestamp.fromMillis(nowMs),
      leida: false,
    });
    for (const adminUid of adminUids) {
      transaction.set(db.collection("notificaciones").doc(), {
        destinatarioId: adminUid,
        tipo: "nueva_solicitud_cita",
        titulo: "Nueva solicitud de cita",
        cuerpo: `${String(customerProfile.name ?? "Un cliente")} solicita ${String(service.nombre ?? "un servicio")} con ${staffName}.`,
        citaId: appointmentRef.id,
        negocioId,
        createdAt: Timestamp.fromMillis(nowMs),
        leida: false,
      });
    }
  });
  return { citaId: appointmentRef.id, estado: "hold", holdExpiresAt: holdExpiresAt.toDate().toISOString() };
});

async function decideAppointment(request: CallableRequest<DecisionInput>, nextState: "confirmada" | "rechazada") {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const citaId = requiredString(request.data?.citaId, "Identificador de cita", 128);
  const note = optionalNote(request.data?.notas);
  const appointmentRef = db.collection("citas").doc(citaId);
  const noticeRef = db.collection("notificaciones").doc();
  await db.runTransaction(async (transaction) => {
    const [profile, appointmentSnapshot] = await Promise.all([
      loadProfileInTransaction(transaction, uid),
      transaction.get(appointmentRef),
    ]);
    if (!profile.profile || !["admin", "empleado"].includes(profile.role)) throw new HttpsError("permission-denied", "No existe un perfil autorizado para decidir citas.");
    if (!appointmentSnapshot.exists) throw new HttpsError("not-found", "La cita no existe.");
    const appointment = appointmentSnapshot.data() ?? {};
    const assignedEmployee = appointment.empleadoUid === uid || appointment.empleadoId === uid;
    if (profile.role !== "admin" && !assignedEmployee) throw new HttpsError("permission-denied", "Solo el empleado asignado o administración pueden decidir esta cita.");
    if (!assignedEmployee && profile.role === "empleado") throw new HttpsError("permission-denied", "Solo puedes decidir las citas asignadas a tu perfil.");
    if (!(profile.role === "admin" || profile.role === "empleado")) throw new HttpsError("permission-denied", "No tienes permiso para decidir esta cita.");
    if (!new Set(["hold", "pendiente_de_aprobacion"]).has(String(appointment.estado))) throw new HttpsError("failed-precondition", "La cita ya no está pendiente de decisión.");
    const holdEnd = timestampMillis(appointment.holdExpiresAt);
    if (appointment.estado === "hold" && holdEnd !== null && holdEnd <= Date.now()) throw new HttpsError("deadline-exceeded", "La solicitud temporal ya venció.");
    const now = Timestamp.now();
    transaction.update(appointmentRef, {
      estado: nextState,
      decisionPor: uid,
      decisionAt: now,
      holdExpiresAt: FieldValue.delete(),
      ...(nextState === "rechazada" && note ? { notasDecision: note } : {}),
    });
    transaction.set(noticeRef, {
      destinatarioId: String(appointment.clienteId ?? ""),
      tipo: nextState === "confirmada" ? "cita_confirmada" : "cita_rechazada",
      titulo: nextState === "confirmada" ? "Cita confirmada" : "Solicitud no aceptada",
      cuerpo: nextState === "confirmada" ? "El empleado confirmó tu hora. Tu cita ya está agendada." : note || "El empleado no pudo aceptar esa hora. Elige otra franja disponible.",
      citaId,
      negocioId: String(appointment.negocioId ?? ""),
      createdAt: now,
      leida: false,
    });
  });
  return { ok: true as const, estado: nextState };
}

export const aprobarCita = onCall<DecisionInput>((request) => decideAppointment(request, "confirmada"));
export const rechazarCita = onCall<DecisionInput>((request) => decideAppointment(request, "rechazada"));

async function transitionAssignedAppointment(request: CallableRequest<DecisionInput>, action: "start" | "finish") {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const citaId = requiredString(request.data?.citaId, "Identificador de cita", 128);
  const appointmentRef = db.collection("citas").doc(citaId);
  const now = Timestamp.now();
  let actualMinutes = 0;
  await db.runTransaction(async (transaction) => {
    const [profile, appointmentSnapshot] = await Promise.all([
      loadProfileInTransaction(transaction, uid),
      transaction.get(appointmentRef),
    ]);
    if (!profile.profile || profile.role !== "empleado") throw new HttpsError("permission-denied", "Solo el empleado asignado puede marcar el servicio.");
    if (!appointmentSnapshot.exists) throw new HttpsError("not-found", "La cita no existe.");
    const appointment = appointmentSnapshot.data() ?? {};
    if (appointment.empleadoUid !== uid && appointment.empleadoId !== uid) throw new HttpsError("permission-denied", "Esta cita no está asignada a tu perfil.");
    let elapsedMs = 0;
    if (action === "start") {
      if (appointment.estado !== "confirmada") throw new HttpsError("failed-precondition", "Solo puedes iniciar una cita confirmada.");
    } else {
      if (appointment.estado !== "en_curso") throw new HttpsError("failed-precondition", "Solo puedes finalizar un servicio que ya inició.");
      const startedAt = timestampMillis(appointment.startedAt);
      if (startedAt === null || startedAt > now.toMillis()) throw new HttpsError("failed-precondition", "La cita no tiene una hora de inicio válida.");
      elapsedMs = now.toMillis() - startedAt;
      actualMinutes = Math.round((elapsedMs / 60_000) * 100) / 100;
      if (actualMinutes <= 0) throw new HttpsError("failed-precondition", "Espera al menos un minuto antes de finalizar el servicio.");
    }

    const adminUids = await adminRecipientUids(transaction);
    const isStart = action === "start";
    transaction.update(appointmentRef, isStart ? {
      estado: "en_curso",
      startedAt: now,
      iniciadoPor: uid,
    } : {
      estado: "completada",
      completedAt: now,
      finalizadoPor: uid,
      duracionRealMin: actualMinutes,
      duracionRealSeg: Math.round(elapsedMs / 1000),
    });
    const title = isStart ? "Servicio iniciado" : "Servicio finalizado";
    const body = isStart
      ? `${String(appointment.servicioNombre ?? "Tu servicio")} ya está en curso.`
      : `${String(appointment.servicioNombre ?? "Tu servicio")} terminó. Gracias por elegir EUFORIA.`;
    const recipients = new Set([String(appointment.clienteId ?? ""), ...adminUids].filter(Boolean));
    for (const recipientUid of recipients) {
      transaction.set(db.collection("notificaciones").doc(), {
        destinatarioId: recipientUid,
        tipo: isStart ? "servicio_iniciado" : "servicio_finalizado",
        titulo: recipientUid === appointment.clienteId ? title : `${title} · ${String(appointment.clienteNombre ?? "Cliente")}`,
        cuerpo: body,
        citaId,
        negocioId: String(appointment.negocioId ?? ""),
        createdAt: now,
        leida: false,
      });
    }
  });
  return action === "finish" ? { ok: true as const, duracionRealMin: actualMinutes } : { ok: true as const };
}

export const iniciarServicio = onCall<DecisionInput>((request) => transitionAssignedAppointment(request, "start"));
export const finalizarServicio = onCall<DecisionInput>((request) => transitionAssignedAppointment(request, "finish"));

export const expirarHolds = onSchedule({ schedule: "every 5 minutes", timeZone: HONDURAS_TIME_ZONE }, async () => {
  const now = Timestamp.now();
  const snapshot = await db.collection("citas")
    .where("estado", "==", "hold")
    .where("holdExpiresAt", "<=", now)
    .limit(200)
    .get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach((appointment) => batch.update(appointment.ref, { estado: "expirada", expiredAt: now }));
  await batch.commit();
});

export const registrarAviso = onCall<{ destinatarioId: string; titulo: string; cuerpo: string }>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const profile = await loadProfile(uid);
  if (!profile.profile || profile.role !== "admin") throw new HttpsError("permission-denied", "Solo administración puede emitir avisos.");
  const destinatarioId = requiredString(request.data?.destinatarioId, "Destinatario", 128);
  const titulo = requiredString(request.data?.titulo, "Título", 120);
  const cuerpo = requiredString(request.data?.cuerpo, "Mensaje", 1000);
  await db.collection("notificaciones").add({ destinatarioId, titulo, cuerpo, createdAt: Timestamp.now(), leida: false });
  return { saved: true as const };
});

export const enviarPushExpo = onDocumentCreated({ document: "notificaciones/{notificationId}", retry: true }, async (event) => {
  const notificationRef = event.data?.ref;
  const notice = event.data?.data();
  const uid = typeof notice?.destinatarioId === "string" ? notice.destinatarioId : "";
  if (!notificationRef || !uid) return;

  const current = await notificationRef.get();
  if (current.data()?.pushStatus === "enviado") return;
  const deviceSnapshot = await db.collection("usuarios").doc(uid).collection("dispositivos")
    .where("enabled", "==", true)
    .get();
  const devices = deviceSnapshot.docs.filter((item) => {
    const token = item.get("token");
    return typeof token === "string" && /^(Expo|Exponent)PushToken\[.+\]$/.test(token);
  });
  if (devices.length === 0) {
    await notificationRef.update({ pushStatus: "sin_dispositivo", pushProcessedAt: Timestamp.now() });
    return;
  }

  await notificationRef.update({ pushStatus: "enviando" });
  const title = typeof notice?.titulo === "string" ? notice.titulo.slice(0, 120) : "Aviso EUFORIA";
  const body = typeof notice?.cuerpo === "string" ? notice.cuerpo.slice(0, 1000) : "Tienes una actualización en EUFORIA.";
  let ticketCount = 0;
  const invalidDevices: FirebaseFirestore.DocumentReference[] = [];
  try {
    for (let offset = 0; offset < devices.length; offset += 100) {
      const batch = devices.slice(offset, offset + 100);
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { Accept: "application/json", "Accept-encoding": "gzip, deflate", "Content-Type": "application/json" },
        body: JSON.stringify(batch.map((device) => ({
          to: device.get("token"),
          title,
          body,
          sound: "default",
          channelId: "euforia",
          data: { notificationId: notificationRef.id, ...(typeof notice?.citaId === "string" ? { citaId: notice.citaId } : {}) },
        }))),
      });
      if (!response.ok) throw new Error(`Expo Push respondió HTTP ${response.status}.`);
      const payload = await response.json() as { data?: Array<{ status?: string; details?: { error?: string }; message?: string }> };
      const tickets = payload.data ?? [];
      ticketCount += tickets.filter((ticket) => ticket.status === "ok").length;
      tickets.forEach((ticket, index) => {
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          invalidDevices.push(batch[index]!.ref);
        }
        if (ticket.status === "error" && ticket.details?.error !== "DeviceNotRegistered") {
          console.warn("Expo Push rechazó un aviso.", ticket.details?.error ?? ticket.message ?? "unknown");
        }
      });
    }
    const cleanup = db.batch();
    invalidDevices.forEach((reference) => cleanup.update(reference, { enabled: false, updatedAt: Timestamp.now() }));
    if (invalidDevices.length) await cleanup.commit();
    await notificationRef.update({ pushStatus: ticketCount > 0 ? "enviado" : "sin_entrega", pushTicketCount: ticketCount, pushProcessedAt: Timestamp.now() });
  } catch (error) {
    await notificationRef.update({ pushStatus: "error", pushProcessedAt: Timestamp.now() });
    console.error("No se pudo entregar el aviso a Expo Push.", error);
    throw error;
  }
});
