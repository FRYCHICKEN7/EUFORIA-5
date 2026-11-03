import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const ACTIVE_STATES = new Set(["hold", "pendiente_de_aprobacion", "confirmada", "en_curso"]);
const MAX_BOOKING_MINUTES = 8 * 60;
const OVERLAP_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const HOLD_DURATION_MS = 30 * 60 * 1000;

type ReserveInput = { negocioId: string; servicioId: string; inicio: string; empleadoId?: string; notas?: string };
type DecisionInput = { citaId: string; notas?: string };

function requiredString(value: unknown, label: string, maxLength = 160): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpsError("invalid-argument", `${label} no es válido.`);
  }
  return value.trim();
}

function roleFrom(profile: DocumentData): string {
  const normalize = (value: unknown) => {
    if (typeof value !== "string") return "";
    const role = value.trim().toLowerCase();
    return role === "admin" || role === "administrador" ? "admin" : role;
  };
  const primary = normalize(profile.rol);
  const legacy = normalize(profile.role);
  if (primary && legacy && primary !== legacy) return "";
  return primary || legacy;
}

function canManage(role: string, uid: string, appointment: DocumentData): boolean {
  if (role === "admin") return true;
  return role === "empleado" && (appointment.empleadoUid === uid || appointment.empleadoId === uid);
}

const BUSINESS_TIME_ZONE = "America/Tegucigalpa";

function localClock(millis: number) {
  const date = new Date(millis);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
    weekday: new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, weekday: "short" }).format(date).toLowerCase(),
  };
}

function scheduleDocumentId(millis: number): string {
  const dayIds: Record<string, string> = { sun: "0", mon: "1", tue: "2", wed: "3", thu: "4", fri: "5", sat: "6" };
  const id = dayIds[localClock(millis).weekday];
  if (id === undefined) throw new HttpsError("internal", "No se pudo determinar el día de la cita.");
  return id;
}

function clockToMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value);
  if (!match) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function assertWithinBusinessHours(hours: DocumentData | undefined, startMs: number, endMs: number) {
  if (!hours || hours.activo !== true) {
    throw new HttpsError("failed-precondition", "El negocio aún no tiene ese día habilitado en sus horarios de atención.");
  }
  const start = localClock(startMs);
  const end = localClock(endMs);
  if (start.date !== end.date) throw new HttpsError("failed-precondition", "La cita debe terminar el mismo día local.");
  const opening = clockToMinutes(hours.apertura);
  const closing = clockToMinutes(hours.cierre);
  if (opening === null || closing === null || closing <= opening) {
    throw new HttpsError("failed-precondition", "El horario del negocio debe tener apertura y cierre válidos en formato HH:MM.");
  }
  if (start.minutes < opening || end.minutes > closing) {
    throw new HttpsError("failed-precondition", "La cita queda fuera del horario de atención.");
  }
  const breaks = hours.recesos ?? [];
  if (!Array.isArray(breaks)) throw new HttpsError("failed-precondition", "Los recesos configurados no son válidos.");
  for (const pause of breaks) {
    const pauseStart = clockToMinutes(pause?.inicio);
    const pauseEnd = clockToMinutes(pause?.fin);
    if (pauseStart === null || pauseEnd === null || pauseEnd <= pauseStart) {
      throw new HttpsError("failed-precondition", "Cada receso debe tener inicio y fin HH:MM válidos.");
    }
    if (start.minutes < pauseEnd && end.minutes > pauseStart) {
      throw new HttpsError("failed-precondition", "La cita se cruza con un receso del negocio.");
    }
  }
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    const millis = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

async function decideAppointment(request: CallableRequest<DecisionInput>, nextState: "confirmada" | "rechazada") {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const citaId = requiredString(request.data?.citaId, "Identificador de cita", 128);
  const note = typeof request.data?.notas === "string" ? request.data.notas.trim().slice(0, 500) : "";
  const appointmentRef = db.collection("citas").doc(citaId);
  const profileRef = db.collection("usuarios").doc(uid);
  await db.runTransaction(async (transaction) => {
    const profileSnapshot = await transaction.get(profileRef);
    const appointmentSnapshot = await transaction.get(appointmentRef);
    if (!profileSnapshot.exists) throw new HttpsError("permission-denied", "No existe un perfil autorizado.");
    if (!appointmentSnapshot.exists) throw new HttpsError("not-found", "La cita no existe.");
    const role = roleFrom(profileSnapshot.data() ?? {});
    const appointment = appointmentSnapshot.data() ?? {};
    if (!canManage(role, uid, appointment)) throw new HttpsError("permission-denied", "No tienes permiso para decidir esta cita.");
    if (!["hold", "pendiente_de_aprobacion"].includes(String(appointment.estado))) {
      throw new HttpsError("failed-precondition", "La cita ya no está pendiente de decisión.");
    }
    const holdEnd = timestampMillis(appointment.holdExpiresAt);
    if (appointment.estado === "hold" && holdEnd !== null && holdEnd <= Date.now()) {
      throw new HttpsError("deadline-exceeded", "La reserva temporal ya venció.");
    }
    transaction.update(appointmentRef, {
      estado: nextState,
      decisionPor: uid,
      decisionAt: Timestamp.now(),
      ...(nextState === "rechazada" && note ? { notasDecision: note } : {}),
    });
  });
  return { ok: true as const };
}

export const reservarCita = onCall<ReserveInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión para reservar.");
  const negocioId = requiredString(request.data?.negocioId, "Negocio");
  const servicioId = requiredString(request.data?.servicioId, "Servicio");
  const inicioRaw = requiredString(request.data?.inicio, "Fecha y hora", 64);
  const inicioDate = new Date(inicioRaw);
  const inicioMs = inicioDate.getTime();
  if (!Number.isFinite(inicioMs) || inicioDate.toISOString() !== inicioRaw) {
    throw new HttpsError("invalid-argument", "La fecha debe enviarse en formato ISO válido.");
  }
  if (inicioMs <= Date.now()) throw new HttpsError("invalid-argument", "La cita debe programarse en el futuro.");
  if (inicioMs > Date.now() + 365 * 24 * 60 * 60 * 1000) throw new HttpsError("invalid-argument", "La fecha excede el plazo de reserva permitido.");
  const empleadoId = typeof request.data?.empleadoId === "string" ? request.data.empleadoId.trim() : "";
  const notas = typeof request.data?.notas === "string" ? request.data.notas.trim().slice(0, 500) : "";
  const userRef = db.collection("usuarios").doc(uid);
  const businessRef = db.collection("negocios").doc(negocioId);
  const serviceRef = businessRef.collection("servicios").doc(servicioId);
  const appointmentRef = db.collection("citas").doc();
  const now = Timestamp.now();
  let resultState = "";

  await db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const businessSnapshot = await transaction.get(businessRef);
    const serviceSnapshot = await transaction.get(serviceRef);
    if (!userSnapshot.exists || roleFrom(userSnapshot.data() ?? {}) !== "cliente") {
      throw new HttpsError("permission-denied", "Solo un perfil cliente puede solicitar citas.");
    }
    if (!businessSnapshot.exists || businessSnapshot.data()?.activo !== true) {
      throw new HttpsError("not-found", "El negocio no está disponible.");
    }
    if (!serviceSnapshot.exists || serviceSnapshot.data()?.activo !== true) {
      throw new HttpsError("not-found", "El servicio no está disponible.");
    }

    const business = businessSnapshot.data() ?? {};
    const service = serviceSnapshot.data() ?? {};
    const modeValue = business.modoNegocio;
    if (modeValue !== "multiEmpleado" && modeValue !== "unipersonal") {
      throw new HttpsError("failed-precondition", "Configura modoNegocio como unipersonal o multiEmpleado antes de habilitar citas.");
    }
    const mode = modeValue;
    const duration = Number(service.duracionMin);
    const priceValue = service.precio;
    const price = typeof priceValue === "number" ? priceValue : typeof priceValue === "string" && priceValue.trim() ? Number(priceValue) : Number.NaN;
    if (!Number.isInteger(duration) || duration < 5 || duration > MAX_BOOKING_MINUTES) {
      throw new HttpsError("failed-precondition", "El servicio no tiene una duración válida configurada.");
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new HttpsError("failed-precondition", "El servicio no tiene un precio numérico configurado.");
    }

    let employee: DocumentData | null = null;
    let employeeUid = "";
    if (mode === "multiEmpleado") {
      if (!empleadoId) throw new HttpsError("invalid-argument", "Selecciona a la profesional para esta cita.");
      const employeeSnapshot = await transaction.get(businessRef.collection("empleados").doc(empleadoId));
      if (!employeeSnapshot.exists || employeeSnapshot.data()?.activo !== true || employeeSnapshot.data()?.publica !== true) {
        throw new HttpsError("not-found", "La profesional no está disponible para reservas.");
      }
      employee = employeeSnapshot.data() ?? {};
      employeeUid = String(employee.usuarioId ?? employee.uid ?? "");
    } else if (empleadoId) {
      throw new HttpsError("invalid-argument", "Este negocio no asigna profesionales por cita.");
    }

    const endMs = inicioMs + duration * 60_000;
    const hoursSnapshot = await transaction.get(businessRef.collection("horarios").doc(scheduleDocumentId(inicioMs)));
    assertWithinBusinessHours(hoursSnapshot.data(), inicioMs, endMs);
    let conflictsQuery = db.collection("citas").where("negocioId", "==", negocioId);
    if (mode === "multiEmpleado") conflictsQuery = conflictsQuery.where("empleadoId", "==", empleadoId);
    conflictsQuery = conflictsQuery
      .where("inicio", ">=", Timestamp.fromMillis(inicioMs - OVERLAP_LOOKBACK_MS))
      .where("inicio", "<=", Timestamp.fromMillis(endMs));
    const conflicts = await transaction.get(conflictsQuery);
    const hasConflict = conflicts.docs.some((item) => {
      const existing = item.data();
      if (!ACTIVE_STATES.has(String(existing.estado))) return false;
      const holdExpiry = timestampMillis(existing.holdExpiresAt);
      if (existing.estado === "hold" && holdExpiry !== null && holdExpiry <= Date.now()) return false;
      const existingStart = timestampMillis(existing.inicio);
      const storedEnd = timestampMillis(existing.fin);
      const existingDuration = Number(existing.duracionMin);
      const existingEnd = storedEnd ?? (existingStart !== null && Number.isFinite(existingDuration) ? existingStart + existingDuration * 60_000 : null);
      return existingStart !== null && existingEnd !== null && inicioMs < existingEnd && endMs > existingStart;
    });
    if (hasConflict) throw new HttpsError("already-exists", "La franja ya no está disponible. Elige otra hora.");

    const state = mode === "unipersonal" ? "confirmada" : "hold";
    resultState = state;
    const userData = userSnapshot.data() ?? {};
    const booking: DocumentData = {
      negocioId,
      negocioNombre: String(business.nombre ?? business.nombreNegocio ?? business.name ?? "EUFORIA"),
      clienteId: uid,
      clienteEmail: String(request.auth?.token.email ?? userData.email ?? ""),
      clienteNombre: String(userData.displayName ?? userData.nombre ?? request.auth?.token.name ?? ""),
      clienteTelefono: String(userData.phone ?? ""),
      servicioId,
      servicioNombre: String(service.nombre ?? service.name ?? "Servicio"),
      precio: price,
      duracionMin: duration,
      inicio: Timestamp.fromMillis(inicioMs),
      fin: Timestamp.fromMillis(endMs),
      modoNegocio: mode,
      estado: state,
      createdAt: now,
      ...(mode === "multiEmpleado" ? { empleadoId, empleadoUid: employeeUid, holdExpiresAt: Timestamp.fromMillis(Date.now() + HOLD_DURATION_MS) } : {}),
      ...(employee ? { empleadoNombre: String(employee.nombre ?? employee.displayName ?? "Profesional") } : {}),
      ...(notas ? { notas } : {}),
    };
    transaction.set(appointmentRef, booking);
  });

  return { citaId: appointmentRef.id, estado: resultState };
});

export const aprobarCita = onCall<DecisionInput>(async (request) => decideAppointment(request, "confirmada"));
export const rechazarCita = onCall<DecisionInput>(async (request) => decideAppointment(request, "rechazada"));

export const expirarHolds = onSchedule({ schedule: "every 5 minutes", timeZone: "America/Tegucigalpa" }, async () => {
  const now = Timestamp.now();
  const snapshot = await db.collection("citas")
    .where("estado", "==", "hold")
    .where("holdExpiresAt", "<=", now)
    .limit(400)
    .get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach((appointment) => batch.update(appointment.ref, { estado: "expirada", expiredAt: now }));
  await batch.commit();
});

export const registrarAviso = onCall<{ destinatarioId: string; titulo: string; cuerpo: string }>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const profileSnapshot = await db.collection("usuarios").doc(uid).get();
  if (!profileSnapshot.exists || roleFrom(profileSnapshot.data() ?? {}) !== "admin") {
    throw new HttpsError("permission-denied", "Solo el administrador puede emitir avisos.");
  }
  const destinatarioId = requiredString(request.data?.destinatarioId, "Destinatario", 128);
  const titulo = requiredString(request.data?.titulo, "Título", 120);
  const cuerpo = requiredString(request.data?.cuerpo, "Mensaje", 1000);
  await db.collection("notificaciones").add({ destinatarioId, titulo, cuerpo, createdAt: Timestamp.now(), leida: false });
  return { saved: true as const };
});
