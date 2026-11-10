import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, FieldValue, getFirestore, Timestamp, type DocumentData, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { randomUUID } from "node:crypto";
import { mergeProfileDocuments, roleFromProfiles } from "./roles";

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const HONDURAS_TIME_ZONE = "America/Tegucigalpa";
const PROFILE_COLLECTIONS = ["users", "empleados", "usuarios"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_REMINDER_STATES = new Set(["pendiente", "preparado"]);
const TERMINAL_REMINDER_STATES = new Set(["enviado", "omitido", "cancelado"]);

export type ReminderTemplates = { cita: string; regreso: string; cumpleanos: string };
export type ReminderConfiguration = { horasAntesCita: number; plantillas: ReminderTemplates };

type ReminderSettingsInput = { negocioId: string; horasAntesCita: number; plantillas: ReminderTemplates };
type ReminderActionInput = { recordatorioId: string; estado: "preparado" | "enviado" | "omitido" | "cancelado" };
type EmployeeDecisionInput = { uid: string };
type EmployeeApplicationInput = { name?: unknown; phone?: unknown; birthdayDay?: unknown; birthdayMonth?: unknown };

export const DEFAULT_REMINDER_CONFIGURATION: ReminderConfiguration = {
  horasAntesCita: 73,
  plantillas: {
    cita: "💕 ¡Hola, {{Nombre del cliente}}! Te recordamos tu cita.\n\n🗓️ {{Fecha de la cita}} | 🕒 {{Hora de la cita}}\nServicio: {{Nombre del servicio}}\n\n¡Será un placer atenderte!\n{{Nombre del negocio}}",
    regreso: "🌸 ¡Hola, {{Nombre del cliente}}!\n\nYa faltan {{Días para volver}} días para tu próximo servicio de {{Nombre del servicio}}.\n\nNos encantará volver a atenderte.\n{{Nombre del negocio}}",
    cumpleanos: "🎂 ¡Feliz cumpleaños, {{Nombre del cliente}}! 🥳💕\n\nDeseamos que tengas un día maravilloso.\n{{Nombre del negocio}} 💗",
  },
};

const TEMPLATE_VARIABLES: Record<keyof ReminderTemplates, ReadonlySet<string>> = {
  cita: new Set(["Nombre del cliente", "Fecha de la cita", "Hora de la cita", "Nombre del servicio", "Nombre del negocio"]),
  regreso: new Set(["Nombre del cliente", "Nombre del servicio", "Días para volver", "Nombre del negocio"]),
  cumpleanos: new Set(["Nombre del cliente", "Nombre del negocio"]),
};

function requiredString(value: unknown, label: string, maxLength = 160): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpsError("invalid-argument", `${label} no es válido.`);
  }
  return value.trim();
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
  return { profile: mergeProfileDocuments(sources, uid), role: roleFromProfiles(sources), snapshots };
}

async function loadProfileInTransaction(transaction: Transaction, uid: string) {
  const refs = profileRefs(uid);
  const snapshots = await Promise.all(refs.map((reference) => transaction.get(reference)));
  const sources = snapshots.map((snapshot) => snapshot.exists ? snapshot.data() ?? {} : null);
  return { profile: mergeProfileDocuments(sources, uid), role: roleFromProfiles(sources), refs, snapshots, sources };
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

function hasWhatsAppConsent(profile: DocumentData | null | undefined) {
  return profile?.aceptaRecordatoriosWhatsApp !== false;
}

function profilePhone(profile: DocumentData | null | undefined): string {
  const value = profile?.phone ?? profile?.telefono;
  return typeof value === "string" ? value : "";
}

function hasUsableWhatsAppNumber(value: unknown) {
  if (typeof value !== "string") return false;
  const compact = value.trim().replace(/[\s()-]/g, "");
  return /^\d{8}$/.test(compact) || /^\+?[1-9]\d{7,14}$/.test(compact);
}

function currentConfig(business: DocumentData | undefined): ReminderConfiguration {
  const raw = business?.configuracionRecordatoriosWhatsApp as Partial<ReminderConfiguration> | undefined;
  const hours = Number(raw?.horasAntesCita);
  return {
    horasAntesCita: Number.isInteger(hours) && hours >= 1 && hours <= 720 ? hours : DEFAULT_REMINDER_CONFIGURATION.horasAntesCita,
    plantillas: {
      ...DEFAULT_REMINDER_CONFIGURATION.plantillas,
      ...(raw?.plantillas ?? {}),
    },
  };
}

function validateTemplate(type: keyof ReminderTemplates, raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 1200) {
    throw new HttpsError("invalid-argument", "Cada mensaje debe tener texto y no superar 1,200 caracteres.");
  }
  const template = raw.trim();
  const matches = [...template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
  for (const match of matches) {
    if (!TEMPLATE_VARIABLES[type].has(match[1]!.trim())) {
      throw new HttpsError("invalid-argument", "Una plantilla contiene una variable que no está disponible para ese tipo de aviso.");
    }
  }
  const remainder = template.replace(/\{\{\s*[^{}]+?\s*\}\}/g, "");
  if (remainder.includes("{{") || remainder.includes("}}")) {
    throw new HttpsError("invalid-argument", "Revisa las llaves de las variables de la plantilla.");
  }
  return template;
}

function validateTemplates(value: unknown): ReminderTemplates {
  if (!value || typeof value !== "object") throw new HttpsError("invalid-argument", "Faltan las plantillas de los mensajes.");
  const templates = value as Record<string, unknown>;
  return {
    cita: validateTemplate("cita", templates.cita),
    regreso: validateTemplate("regreso", templates.regreso),
    cumpleanos: validateTemplate("cumpleanos", templates.cumpleanos),
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

function hondurasDateTime(millis: number) {
  const date = new Intl.DateTimeFormat("es-HN", {
    timeZone: HONDURAS_TIME_ZONE,
    dateStyle: "long",
  }).format(new Date(millis));
  const time = new Intl.DateTimeFormat("es-HN", {
    timeZone: HONDURAS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(millis));
  return { date, time };
}

function reminderRef(id: string) {
  return db.collection("recordatoriosWhatsApp").doc(id);
}

function reminderHistory(data: DocumentData, state: string, reason: string, now: Timestamp, uid?: string) {
  const current = Array.isArray(data.historialEstados) ? data.historialEstados.filter((entry: unknown) => entry && typeof entry === "object") : [];
  return [...current.slice(-49), { estado: state, motivo: reason, fecha: now, ...(uid ? { realizadoPorUid: uid } : {}) }];
}

async function upsertReminder(id: string, data: DocumentData) {
  const reference = reminderRef(id);
  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    const previous = existing.data() ?? {};
    const state = String(previous.estado ?? "");
    const reactivatingOptOut = state === "cancelado" && previous.motivoCancelacion === "La persona desactivó los recordatorios.";
    const previousStart = timestampMillis(previous.inicio);
    const nextStart = timestampMillis(data.inicio);
    const appointmentMoved = previous.tipo === "cita" && previousStart !== null && nextStart !== null && previousStart !== nextStart;
    const previousCompletion = timestampMillis(previous.completedAt);
    const nextCompletion = timestampMillis(data.completedAt);
    const completionMoved = previous.tipo === "regreso" && previousCompletion !== null && nextCompletion !== null && previousCompletion !== nextCompletion;
    const previousDue = timestampMillis(previous.fechaProgramada);
    const nextDue = timestampMillis(data.fechaProgramada);
    const dueMoved = (previous.tipo === "cita" || previous.tipo === "regreso")
      && previousDue !== null && nextDue !== null && previousDue !== nextDue;
    const timingMoved = appointmentMoved || completionMoved || dueMoved;
    const reactivatingAppointment = state === "cancelado"
      && [
        "La cita dejó de estar confirmada.",
        "La cita dejó de estar finalizada.",
        "La cita fue retirada del calendario.",
        "El servicio ya no tiene activo el aviso para regresar.",
        "La cita ya no tiene una fecha de finalización válida.",
      ].includes(String(previous.motivoCancelacion ?? ""));
    if (TERMINAL_REMINDER_STATES.has(state) && !reactivatingOptOut && !timingMoved && !reactivatingAppointment) return;
    const preservePrepared = state === "preparado" && !timingMoved;
    const nextState = preservePrepared ? "preparado" : "pendiente";
    const reason = appointmentMoved ? "La cita cambió de horario."
      : completionMoved ? "Cambió la fecha de finalización del servicio."
        : dueMoved ? "Cambió el plazo del aviso."
          : reactivatingOptOut ? "La persona volvió a activar los recordatorios."
            : "La cita o el servicio volvieron a estar disponibles.";
    const history = state && (state !== nextState || timingMoved)
      ? reminderHistory(previous, nextState, reason, now)
      : (Array.isArray(previous.historialEstados) ? previous.historialEstados : [{ estado: "pendiente", motivo: "Aviso registrado automáticamente.", fecha: now }]);
    transaction.set(reference, {
      ...data,
      estado: nextState,
      createdAt: previous.createdAt ?? now,
      updatedAt: now,
      historialEstados: history,
      ...(reactivatingOptOut || timingMoved || reactivatingAppointment ? {
        motivoCancelacion: FieldValue.delete(),
        canceladoAt: FieldValue.delete(),
        canceladoPorUid: FieldValue.delete(),
        ...(reactivatingOptOut ? { reactivadoAt: now, reactivaciones: FieldValue.arrayUnion(now) } : { reprogramadoAt: now }),
      } : {}),
      ...(preservePrepared ? {
        preparadoAt: previous.preparadoAt,
        preparadoPorUid: previous.preparadoPorUid,
      } : {
        preparadoAt: FieldValue.delete(),
        preparadoPorUid: FieldValue.delete(),
        enviadoAt: FieldValue.delete(),
        enviadoPorUid: FieldValue.delete(),
        omitidoAt: FieldValue.delete(),
        omitidoPorUid: FieldValue.delete(),
      }),
    }, { merge: true });
  });
}

async function cancelReminder(reference: FirebaseFirestore.DocumentReference, reason: string) {
  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || !ACTIVE_REMINDER_STATES.has(String(snapshot.get("estado")))) return;
    const data = snapshot.data() ?? {};
    transaction.update(reference, {
      estado: "cancelado", motivoCancelacion: reason, canceladoAt: now, updatedAt: now,
      historialEstados: reminderHistory(data, "cancelado", reason, now),
    });
  });
}

async function cancelAppointmentReminder(citaId: string, reason: string) {
  await cancelReminder(reminderRef(`cita_${citaId}`), reason);
}

async function cancelReturnReminder(citaId: string, reason: string) {
  await cancelReminder(reminderRef(`regreso_${citaId}`), reason);
}

async function visitCustomerReminders(
  clienteId: string,
  visit: (snapshot: FirebaseFirestore.QueryDocumentSnapshot) => void,
  servicioId?: string,
) {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    let current = db.collection("recordatoriosWhatsApp").where("clienteId", "==", clienteId);
    if (servicioId) current = current.where("servicioId", "==", servicioId);
    const page = current.orderBy(FieldPath.documentId()).limit(450);
    const snapshot = cursor ? await page.startAfter(cursor).get() : await page.get();
    snapshot.docs.forEach(visit);
    if (snapshot.size < 450) return;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
}

async function visitQueryPages(
  query: FirebaseFirestore.Query,
  visit: (snapshot: FirebaseFirestore.QueryDocumentSnapshot) => Promise<void>,
) {
  const pageSize = 400;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    const pageQuery = cursor ? query.limit(pageSize).startAfter(cursor) : query.limit(pageSize);
    const snapshot = await pageQuery.get();
    for (let start = 0; start < snapshot.docs.length; start += 40) {
      await Promise.all(snapshot.docs.slice(start, start + 40).map(visit));
    }
    if (snapshot.size < pageSize) return;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
}

async function cancelReturnRemindersForNewBooking(clienteId: string, servicioId: string, newCitaId: string, negocioId: string) {
  const matches: { reference: FirebaseFirestore.DocumentReference; data: DocumentData }[] = [];
  await visitCustomerReminders(clienteId, (item) => {
    const data = item.data();
    if (data.tipo === "regreso" && data.negocioId === negocioId && data.citaId !== newCitaId && ACTIVE_REMINDER_STATES.has(String(data.estado))) matches.push({ reference: item.ref, data });
  }, servicioId);
  const now = Timestamp.now();
  for (let start = 0; start < matches.length; start += 450) {
    const batch = db.batch();
    matches.slice(start, start + 450).forEach(({ reference, data }) => batch.update(reference, {
      estado: "cancelado", motivoCancelacion: "Ya se reservó el mismo servicio.", canceladoAt: now, updatedAt: now,
      historialEstados: reminderHistory(data, "cancelado", "Ya se reservó el mismo servicio.", now),
    }));
    await batch.commit();
  }
}

async function cancelCustomerReminders(clienteId: string) {
  const matches: { reference: FirebaseFirestore.DocumentReference; data: DocumentData }[] = [];
  await visitCustomerReminders(clienteId, (item) => {
    if (ACTIVE_REMINDER_STATES.has(String(item.get("estado")))) matches.push({ reference: item.ref, data: item.data() });
  });
  for (let start = 0; start < matches.length; start += 450) {
    const batch = db.batch();
    const now = Timestamp.now();
    matches.slice(start, start + 450).forEach(({ reference, data }) => batch.update(reference, {
      estado: "cancelado",
      motivoCancelacion: "La persona desactivó los recordatorios.",
      canceladoAt: now,
      updatedAt: now,
      historialEstados: reminderHistory(data, "cancelado", "La persona desactivó los recordatorios.", now),
    }));
    await batch.commit();
  }
}

async function createAppointmentReminder(citaId: string, appointment: DocumentData, configOverride?: ReminderConfiguration) {
  const clienteId = typeof appointment.clienteId === "string" ? appointment.clienteId : "";
  const negocioId = typeof appointment.negocioId === "string" ? appointment.negocioId : "";
  const startMs = timestampMillis(appointment.inicio);
  if (!clienteId || !negocioId || startMs === null) return;
  const [customer, businessSnapshot] = await Promise.all([
    loadProfile(clienteId),
    db.collection("negocios").doc(negocioId).get(),
  ]);
  if (!customer.profile || customer.role !== "cliente") {
    await cancelAppointmentReminder(citaId, "La cuenta no tiene un perfil cliente activo.");
    return;
  }
  if (!hasWhatsAppConsent(customer.profile)) {
    await cancelAppointmentReminder(citaId, "La persona desactivó los recordatorios.");
    return;
  }
  const phone = profilePhone(customer.profile);
  if (!hasUsableWhatsAppNumber(phone)) {
    await cancelAppointmentReminder(citaId, "El número de teléfono no tiene un formato válido.");
    return;
  }
  const config = configOverride ?? currentConfig(businessSnapshot.data());
  const { date, time } = hondurasDateTime(startMs);
  await upsertReminder(`cita_${citaId}`, {
    tipo: "cita",
    negocioId,
    clienteId,
    citaId,
    servicioId: String(appointment.servicioId ?? ""),
    clienteNombre: String(customer.profile.name ?? customer.profile.displayName ?? appointment.clienteNombre ?? "Cliente"),
    clienteTelefono: phone || String(appointment.clienteTelefono ?? ""),
    servicioNombre: String(appointment.servicioNombre ?? "Servicio"),
    citaFecha: date,
    citaHoraInicio: time,
    inicio: appointment.inicio,
    fechaProgramada: Timestamp.fromMillis(startMs - config.horasAntesCita * 60 * 60 * 1000),
    horasAntesCita: config.horasAntesCita,
    idempotencyKey: `cita:${citaId}`,
  });
}

async function hasLaterServiceBooking(clienteId: string, negocioId: string, servicioId: string, completedMs: number, originCitaId: string) {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    let query = db.collection("citas")
      .where("clienteId", "==", clienteId)
      .where("negocioId", "==", negocioId)
      .where("servicioId", "==", servicioId)
      .where("inicio", ">", Timestamp.fromMillis(completedMs))
      .orderBy("inicio", "asc")
      .limit(200);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const nowMs = Date.now();
    const found = snapshot.docs.some((item) => {
      if (item.id === originCitaId) return false;
      const appointment = item.data();
      const state = String(appointment.estado ?? "");
      if (!["hold", "pendiente_de_aprobacion", "confirmada", "en_curso", "completada"].includes(state)) return false;
      const holdExpiresAt = timestampMillis(appointment.holdExpiresAt);
      return state !== "hold" || holdExpiresAt === null || holdExpiresAt > nowMs;
    });
    if (found) return true;
    if (snapshot.size < 200) return false;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
}

async function createReturnReminder(citaId: string, appointment: DocumentData) {
  const clienteId = typeof appointment.clienteId === "string" ? appointment.clienteId : "";
  const negocioId = typeof appointment.negocioId === "string" ? appointment.negocioId : "";
  const servicioId = typeof appointment.servicioId === "string" ? appointment.servicioId : "";
  const completedMs = timestampMillis(appointment.completedAt);
  if (!clienteId || !negocioId || !servicioId || completedMs === null) {
    await cancelReturnReminder(citaId, "La cita ya no tiene una fecha de finalización válida.");
    return;
  }
  const [customer, serviceSnapshot] = await Promise.all([
    loadProfile(clienteId),
    db.collection("negocios").doc(negocioId).collection("servicios").doc(servicioId).get(),
  ]);
  if (!customer.profile || customer.role !== "cliente" || !hasWhatsAppConsent(customer.profile)) {
    await cancelReturnReminder(citaId, "La persona desactivó los recordatorios.");
    return;
  }
  const phone = profilePhone(customer.profile);
  if (!hasUsableWhatsAppNumber(phone)) {
    await cancelReturnReminder(citaId, "El número de teléfono no tiene un formato válido.");
    return;
  }
  const service = serviceSnapshot.data() ?? {};
  if (!serviceSnapshot.exists || service.recordatorioRegresoActivo !== true) {
    await cancelReturnReminder(citaId, "El servicio ya no tiene activo el aviso para regresar.");
    return;
  }
  const periodDays = Number(service.periodoRegresoDias);
  const leadDays = Number(service.anticipacionRecordatorioDias ?? 3);
  if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 730
    || !Number.isInteger(leadDays) || leadDays < 0 || leadDays > periodDays) {
    await cancelReturnReminder(citaId, "El servicio ya no tiene una fecha de regreso válida.");
    return;
  }
  if (await hasLaterServiceBooking(clienteId, negocioId, servicioId, completedMs, citaId)) {
    await cancelReturnReminder(citaId, "Ya se reservó el mismo servicio.");
    return;
  }
  const plannedAt = completedMs + (periodDays - leadDays) * DAY_MS;
  await upsertReminder(`regreso_${citaId}`, {
    tipo: "regreso",
    negocioId,
    clienteId,
    citaId,
    servicioId,
    clienteNombre: String(customer.profile.name ?? customer.profile.displayName ?? appointment.clienteNombre ?? "Cliente"),
    clienteTelefono: phone || String(appointment.clienteTelefono ?? ""),
    servicioNombre: String(service.nombre ?? appointment.servicioNombre ?? "Servicio"),
    periodoRegresoDias: periodDays,
    anticipacionRecordatorioDias: leadDays,
    completedAt: appointment.completedAt,
    fechaProgramada: Timestamp.fromMillis(plannedAt),
    idempotencyKey: `regreso:${citaId}:${servicioId}`,
  });
}

export const solicitarPerfilEmpleado = onCall<EmployeeApplicationInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión para enviar la solicitud.");
  const authUser = await getAuth(app).getUser(uid).catch(() => {
    throw new HttpsError("failed-precondition", "No pudimos verificar la cuenta. Intenta de nuevo.");
  });
  if (authUser.disabled || !authUser.email) throw new HttpsError("failed-precondition", "La cuenta necesita correo y estar habilitada.");
  const employeeRef = db.collection("empleados").doc(uid);
  const notificationRefFactory = () => db.collection("notificaciones").doc();
  const now = Timestamp.now();

  return db.runTransaction(async (transaction) => {
    const [person, existing] = await Promise.all([
      loadProfileInTransaction(transaction, uid),
      transaction.get(employeeRef),
    ]);
    const current = existing.data() ?? {};
    if (existing.exists && current.estadoSolicitud === "pendiente") return { ok: true as const, estado: "pendiente" as const };
    if (existing.exists && (current.role === "empleado" || current.rol === "empleado")) {
      throw new HttpsError("already-exists", "Esta cuenta ya tiene acceso como empleado.");
    }
    if (person.profile && person.role !== "cliente") {
      throw new HttpsError("failed-precondition", "Solo un perfil cliente puede solicitar acceso al equipo.");
    }
    const submittedName = typeof request.data?.name === "string" ? request.data.name.trim() : "";
    const submittedPhone = typeof request.data?.phone === "string" ? request.data.phone.trim() : "";
    const name = String(person.profile?.name ?? person.profile?.displayName ?? person.profile?.nombre ?? submittedName).trim();
    const phone = String(person.profile?.phone ?? person.profile?.telefono ?? submittedPhone).trim();
    if (name.length < 2 || !phone) throw new HttpsError("failed-precondition", "Completa tu nombre y teléfono en el perfil antes de solicitar acceso.");
    if (!/^([0-9]{8}|\+[1-9][0-9]{7,14})$/.test(phone)) {
      throw new HttpsError("invalid-argument", "Escribe un teléfono hondureño de ocho dígitos o un número internacional con +.");
    }
    const birthdayDay = person.profile?.birthdayDay ?? request.data?.birthdayDay;
    const birthdayMonth = person.profile?.birthdayMonth ?? request.data?.birthdayMonth;
    const hasBirthday = birthdayDay !== undefined && birthdayDay !== null && birthdayMonth !== undefined && birthdayMonth !== null;
    if ((birthdayDay !== undefined && birthdayDay !== null) !== (birthdayMonth !== undefined && birthdayMonth !== null)
      || (hasBirthday && (!Number.isInteger(birthdayDay) || !Number.isInteger(birthdayMonth)
        || Number(birthdayDay) < 1 || Number(birthdayDay) > 31 || Number(birthdayMonth) < 1 || Number(birthdayMonth) > 12
        || (Number(birthdayMonth) === 2 && Number(birthdayDay) > 29)
        || ([4, 6, 9, 11].includes(Number(birthdayMonth)) && Number(birthdayDay) > 30)))) {
      throw new HttpsError("invalid-argument", "La fecha de cumpleaños no es válida.");
    }
    const admins = await adminRecipientUids(transaction);
    const profileImage = String(person.profile?.profileImage ?? person.profile?.photoURL ?? "");
    const profileData: DocumentData = person.profile ?? {
      id: uid,
      email: authUser.email,
      name,
      displayName: name,
      phone,
      profileImage,
      role: "cliente",
      rol: "cliente",
      createdAt: now,
      aceptaRecordatoriosWhatsApp: true,
      ...(hasBirthday ? { birthdayDay: Number(birthdayDay), birthdayMonth: Number(birthdayMonth) } : {}),
    };
    if (!person.profile) {
      for (const collectionName of ["users", "usuarios"] as const) {
        transaction.create(db.collection(collectionName).doc(uid), profileData);
      }
    }
    transaction.set(employeeRef, {
      id: uid,
      email: authUser.email,
      name,
      displayName: name,
      phone,
      profileImage,
      ...(Number.isInteger(profileData.birthdayDay) && Number.isInteger(profileData.birthdayMonth)
        ? { birthdayDay: profileData.birthdayDay, birthdayMonth: profileData.birthdayMonth }
        : {}),
      role: "cliente",
      rol: "cliente",
      estadoSolicitud: "pendiente",
      solicitadaAt: now,
      createdAt: current.createdAt ?? now,
      updatedAt: now,
    });
    for (const adminUid of admins) {
      transaction.set(notificationRefFactory(), {
        destinatarioId: adminUid,
        tipo: "solicitud_empleado",
        titulo: "Nueva solicitud del equipo",
        cuerpo: `${name} quiere registrarse como empleado. Revisa su solicitud en Clientes y equipo.`,
        solicitanteUid: uid,
        createdAt: now,
        leida: false,
      });
    }
    return { ok: true as const, estado: "pendiente" as const };
  });
});

async function approveEmployeeRequest(adminUid: string, uid: string) {
  const authUser = await getAuth(app).getUser(uid).catch(() => {
    throw new HttpsError("failed-precondition", "No pudimos verificar la cuenta solicitante.");
  });
  if (authUser.disabled || !authUser.email) throw new HttpsError("failed-precondition", "La cuenta solicitante no está habilitada con correo.");
  const employeeRef = db.collection("empleados").doc(uid);
  const newBusinessRef = db.collection("negocios").doc();
  const employeeCode = `EMP-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const now = Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const [admin, person, application, activeBusinesses] = await Promise.all([
      loadProfileInTransaction(transaction, adminUid),
      loadProfileInTransaction(transaction, uid),
      transaction.get(employeeRef),
      transaction.get(db.collection("negocios").where("activo", "==", true).limit(2)),
    ]);
    if (!admin.profile || admin.role !== "admin") throw new HttpsError("permission-denied", "Solo administración puede aceptar solicitudes.");
    const current = application.data() ?? {};
    if (application.exists && current.estadoSolicitud === "aprobada" && person.role === "empleado") {
      return;
    }
    if (!person.profile || person.role !== "cliente" || !application.exists || current.estadoSolicitud !== "pendiente") {
      throw new HttpsError("failed-precondition", "La solicitud ya no está pendiente o no pertenece a un perfil cliente.");
    }
    if (activeBusinesses.docs.length > 1) {
      throw new HttpsError("failed-precondition", "Hay más de un negocio activo. Deja solo uno antes de aceptar esta solicitud.");
    }
    const businessSnapshot = activeBusinesses.docs[0];
    const businessRef = businessSnapshot?.ref ?? newBusinessRef;
    const businessEmployeeRef = businessRef.collection("empleados").doc(uid);
    const membership = businessSnapshot ? await transaction.get(businessEmployeeRef) : null;
    if (membership?.exists) throw new HttpsError("already-exists", "La cuenta ya tiene una membresía de empleado en este negocio.");
    const admins = await adminRecipientUids(transaction);
    const source = person.profile;
    const name = String(source.name ?? source.displayName ?? source.nombre ?? current.name ?? "").trim();
    const phone = String(source.phone ?? source.telefono ?? current.phone ?? "").trim();
    if (name.length < 2 || !phone) throw new HttpsError("failed-precondition", "La solicitud necesita nombre y teléfono válidos antes de aceptarse.");
    const profileImage = String(source.profileImage ?? source.photoURL ?? current.profileImage ?? "");
    const negocioNombre = businessSnapshot
      ? String(businessSnapshot.get("nombre") ?? businessSnapshot.get("nombreNegocio") ?? "EUFORIA Beauty Studio")
      : "EUFORIA Beauty Studio";

    if (!businessSnapshot) {
      transaction.create(newBusinessRef, {
        nombre: negocioNombre,
        activo: true,
        modoNegocio: "multiEmpleado",
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const mode = businessSnapshot.get("modoNegocio");
      if (mode !== "unipersonal" && mode !== "multiEmpleado") {
        transaction.update(businessRef, { modoNegocio: "multiEmpleado", updatedAt: now });
      }
    }

    const consent = source.aceptaRecordatoriosWhatsApp !== false;
    const profileData: DocumentData = {
      id: uid,
      email: authUser.email,
      name,
      displayName: name,
      phone,
      profileImage,
      photoURL: String(source.photoURL ?? profileImage),
      ...(Number.isInteger(source.birthdayDay) && Number.isInteger(source.birthdayMonth)
        ? { birthdayDay: source.birthdayDay, birthdayMonth: source.birthdayMonth }
        : {}),
      aceptaRecordatoriosWhatsApp: consent,
      role: "empleado",
      rol: "empleado",
      negocioId: businessRef.id,
      createdAt: source.createdAt ?? current.createdAt ?? now,
      updatedAt: now,
    };
    const employeeData: DocumentData = {
      ...profileData,
      Empleado: employeeCode,
      estadoSolicitud: "aprobada",
      solicitadaAt: current.solicitadaAt ?? now,
      aprobadaAt: now,
      aprobadoPorUid: adminUid,
      activo: true,
      publica: true,
      disponible: false,
    };
    const businessEmployeeData: DocumentData = {
      ...employeeData,
      usuarioId: uid,
      uid,
      nombre: name,
      createdAt: now,
    };
    // Replace the two profile documents with the approved safe schema; this also drops legacy fields.
    transaction.set(db.collection("users").doc(uid), profileData);
    transaction.set(db.collection("usuarios").doc(uid), profileData);
    transaction.set(employeeRef, employeeData);
    transaction.set(businessEmployeeRef, businessEmployeeData);
    transaction.set(db.collection("notificaciones").doc(), {
      destinatarioId: uid,
      tipo: "solicitud_empleado_aceptada",
      titulo: "Solicitud aceptada",
      cuerpo: `Ya puedes ingresar como empleado de ${negocioNombre}. Completa tu disponibilidad antes de recibir citas.`,
      createdAt: now,
      leida: false,
    });
    for (const recipient of admins) {
      transaction.set(db.collection("notificaciones").doc(), {
        destinatarioId: recipient,
        tipo: "empleado_aprobado",
        titulo: "Empleado aprobado",
        cuerpo: `${name} ahora forma parte del equipo de ${negocioNombre}.`,
        createdAt: now,
        leida: false,
      });
    }
  });
}

export const aprobarSolicitudEmpleado = onCall<EmployeeDecisionInput>(async (request) => {
  const adminUid = request.auth?.uid;
  if (!adminUid) throw new HttpsError("unauthenticated", "Inicia sesión como administrador.");
  const uid = requiredString(request.data?.uid, "Cuenta solicitante", 128);
  await approveEmployeeRequest(adminUid, uid);
  return { ok: true as const };
});

export const rechazarSolicitudEmpleado = onCall<EmployeeDecisionInput>(async (request) => {
  const adminUid = request.auth?.uid;
  if (!adminUid) throw new HttpsError("unauthenticated", "Inicia sesión como administrador.");
  const uid = requiredString(request.data?.uid, "Cuenta solicitante", 128);
  const now = Timestamp.now();
  const employeeRef = db.collection("empleados").doc(uid);
  await db.runTransaction(async (transaction) => {
    const [admin, person, application] = await Promise.all([
      loadProfileInTransaction(transaction, adminUid),
      loadProfileInTransaction(transaction, uid),
      transaction.get(employeeRef),
    ]);
    if (!admin.profile || admin.role !== "admin") throw new HttpsError("permission-denied", "Solo administración puede rechazar solicitudes.");
    if (!person.profile || person.role !== "cliente" || !application.exists || application.get("estadoSolicitud") !== "pendiente") {
      throw new HttpsError("failed-precondition", "La solicitud ya no está pendiente o no pertenece a un perfil cliente.");
    }
    transaction.update(employeeRef, {
      role: "cliente",
      rol: "cliente",
      estadoSolicitud: "rechazada",
      rechazadaAt: now,
      rechazadaPorUid: adminUid,
      updatedAt: now,
    });
    transaction.set(db.collection("notificaciones").doc(), {
      destinatarioId: uid,
      tipo: "solicitud_empleado_rechazada",
      titulo: "Solicitud revisada",
      cuerpo: "Por ahora tu solicitud para el equipo no fue aceptada. Tu cuenta sigue activa como cliente.",
      createdAt: now,
      leida: false,
    });
  });
  return { ok: true as const };
});

export const guardarConfiguracionRecordatoriosWhatsApp = onCall<ReminderSettingsInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión para guardar los ajustes.");
  const administrator = await loadProfile(uid);
  if (!administrator.profile || administrator.role !== "admin") throw new HttpsError("permission-denied", "Solo administración puede cambiar estos ajustes.");
  const negocioId = requiredString(request.data?.negocioId, "Negocio", 128);
  const hours = Number(request.data?.horasAntesCita);
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
    throw new HttpsError("invalid-argument", "El plazo debe ser un número entero entre 1 y 720 horas.");
  }
  const templates = validateTemplates(request.data?.plantillas);
  const businessRef = db.collection("negocios").doc(negocioId);
  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    const [admin, business] = await Promise.all([
      loadProfileInTransaction(transaction, uid),
      transaction.get(businessRef),
    ]);
    if (!admin.profile || admin.role !== "admin") throw new HttpsError("permission-denied", "Solo administración puede cambiar estos ajustes.");
    if (!business.exists || business.get("activo") !== true) throw new HttpsError("not-found", "No encontramos un negocio activo para guardar los ajustes.");
    transaction.update(businessRef, {
      configuracionRecordatoriosWhatsApp: {
        horasAntesCita: hours,
        plantillas: templates,
        updatedAt: now,
        updatedByUid: uid,
      },
      updatedAt: now,
    });
  });

  const config = { horasAntesCita: hours, plantillas: templates };
  const pageSize = 400;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let updatedAppointments = 0;
  while (true) {
    let query = db.collection("citas")
      .where("negocioId", "==", negocioId)
      .where("estado", "==", "confirmada")
      .where("inicio", ">=", Timestamp.now())
      .orderBy("inicio", "asc")
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const upcoming = await query.get();
    for (let start = 0; start < upcoming.docs.length; start += 40) {
      await Promise.all(upcoming.docs.slice(start, start + 40).map((item) => createAppointmentReminder(item.id, item.data(), config)));
    }
    updatedAppointments += upcoming.size;
    if (upcoming.size < pageSize) break;
    cursor = upcoming.docs[upcoming.docs.length - 1];
  }
  return { ok: true as const, horasAntesCita: hours, citasActualizadas: updatedAppointments };
});

function hondurasDateKey(millis: number) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: HONDURAS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(millis)).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function staleReminderReason(transaction: Transaction, data: DocumentData, customerProfile: DocumentData, nowMs: number): Promise<string | null> {
  const type = String(data.tipo ?? "");
  if (type === "cumpleanos") {
    const scheduledAt = timestampMillis(data.fechaProgramada);
    const todayKey = hondurasDateKey(nowMs);
    const scheduledYear = Number(data.anioCumpleanos);
    const actualDay = Number(customerProfile.birthdayDay);
    const actualMonth = Number(customerProfile.birthdayMonth);
    if (scheduledAt === null || hondurasDateKey(scheduledAt) !== todayKey || scheduledYear !== Number(todayKey.slice(0, 4))) {
      return "El aviso de cumpleaños ya no corresponde al día de hoy.";
    }
    if (actualDay !== Number(data.cumpleanosDia) || actualMonth !== Number(data.cumpleanosMes)) {
      return "El cumpleaños del perfil cambió. Actualiza la lista antes de continuar.";
    }
    const [, month, day] = todayKey.split("-").map(Number);
    const isLeap = scheduledYear % 4 === 0 && (scheduledYear % 100 !== 0 || scheduledYear % 400 === 0);
    const birthdayToday = actualMonth === month && actualDay === day;
    const leapBirthdayObservedToday = actualMonth === 2 && actualDay === 29 && month === 2 && day === 28 && !isLeap;
    return birthdayToday || leapBirthdayObservedToday ? null : "El aviso de cumpleaños ya no corresponde al día de hoy.";
  }
  if (type !== "cita" && type !== "regreso") return "El tipo de aviso ya no está disponible.";
  const citaId = typeof data.citaId === "string" ? data.citaId : "";
  if (!citaId) return "El aviso ya no está vinculado a una cita válida.";
  const appointmentSnapshot = await transaction.get(db.collection("citas").doc(citaId));
  if (!appointmentSnapshot.exists) return "La cita ya no está en el calendario.";
  const appointment = appointmentSnapshot.data() ?? {};
  if (type === "cita") {
    if (typeof data.clienteId !== "string" || !data.clienteId
      || typeof data.negocioId !== "string" || !data.negocioId
      || typeof data.servicioId !== "string" || !data.servicioId) return "El aviso ya no contiene los datos necesarios de la cita.";
    const currentStart = timestampMillis(appointment.inicio);
    if (appointment.estado !== "confirmada" || currentStart === null || currentStart <= nowMs) return "La cita ya no está próxima o dejó de estar confirmada.";
    if (timestampMillis(data.inicio) !== currentStart) return "La cita cambió de horario. Actualiza la lista antes de continuar.";
    if (appointment.clienteId !== data.clienteId || appointment.negocioId !== data.negocioId || appointment.servicioId !== data.servicioId) {
      return "Los datos de la cita cambiaron. Actualiza la lista antes de continuar.";
    }
    const businessSnapshot = await transaction.get(db.collection("negocios").doc(String(data.negocioId ?? "")));
    if (!businessSnapshot.exists || businessSnapshot.get("activo") !== true) return "El negocio ya no está activo.";
    const config = currentConfig(businessSnapshot.data());
    const expectedDue = currentStart - config.horasAntesCita * 60 * 60 * 1000;
    if (Number(data.horasAntesCita) !== config.horasAntesCita || timestampMillis(data.fechaProgramada) !== expectedDue) {
      return "Cambió el plazo para avisar. Actualiza la lista antes de continuar.";
    }
    if (expectedDue > nowMs) return "Todavía no llega la hora prevista para preparar este aviso.";
    return null;
  }

  const completedMs = timestampMillis(appointment.completedAt);
  if (appointment.estado !== "completada" || completedMs === null) return "El servicio ya no figura como finalizado.";
  if (timestampMillis(data.completedAt) !== completedMs) return "Cambió la fecha de finalización. Actualiza la lista antes de continuar.";
  const negocioId = typeof data.negocioId === "string" ? data.negocioId : "";
  const servicioId = typeof data.servicioId === "string" ? data.servicioId : "";
  const clienteId = typeof data.clienteId === "string" ? data.clienteId : "";
  if (!negocioId || !servicioId || !clienteId) return "El aviso de regreso ya no tiene datos completos.";
  if (appointment.clienteId !== clienteId || appointment.negocioId !== negocioId || appointment.servicioId !== servicioId) {
    return "Los datos del servicio cambiaron. Actualiza la lista antes de continuar.";
  }
  const serviceSnapshot = await transaction.get(db.collection("negocios").doc(negocioId).collection("servicios").doc(servicioId));
  const service = serviceSnapshot.data() ?? {};
  if (!serviceSnapshot.exists || service.recordatorioRegresoActivo !== true) return "El servicio ya no tiene activo el aviso para regresar.";
  const periodDays = Number(service.periodoRegresoDias);
  const leadDays = Number(service.anticipacionRecordatorioDias ?? 3);
  if (periodDays !== Number(data.periodoRegresoDias) || leadDays !== Number(data.anticipacionRecordatorioDias)) return "Cambió el plazo para regresar. Actualiza la lista antes de continuar.";
  const expectedDue = completedMs + (periodDays - leadDays) * DAY_MS;
  if (timestampMillis(data.fechaProgramada) !== expectedDue) return "Cambió la fecha prevista para regresar. Actualiza la lista antes de continuar.";
  const dueMs = timestampMillis(data.fechaProgramada);
  if (dueMs !== null && dueMs > nowMs) return "Todavía no llega la fecha para preparar este aviso.";

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let examined = 0;
  while (examined < 450) {
    let query = db.collection("citas")
      .where("clienteId", "==", clienteId)
      .where("negocioId", "==", negocioId)
      .where("servicioId", "==", servicioId)
      .where("inicio", ">", Timestamp.fromMillis(completedMs))
      .orderBy("inicio", "asc")
      .limit(150);
    if (cursor) query = query.startAfter(cursor);
    const laterBookings = await transaction.get(query);
    const bookedAgain = laterBookings.docs.some((item) => {
      if (item.id === citaId) return false;
      const candidate = item.data();
      const state = String(candidate.estado ?? "");
      if (!["hold", "pendiente_de_aprobacion", "confirmada", "en_curso", "completada"].includes(state)) return false;
      const holdExpires = timestampMillis(candidate.holdExpiresAt);
      return state !== "hold" || holdExpires === null || holdExpires > nowMs;
    });
    if (bookedAgain) return "Ya se reservó el mismo servicio.";
    examined += laterBookings.size;
    if (laterBookings.size < 150) return null;
    cursor = laterBookings.docs[laterBookings.docs.length - 1];
  }
  return "No pudimos confirmar que este aviso de regreso siga vigente. Actualiza la lista antes de continuar.";
}

export const actualizarRecordatorioWhatsApp = onCall<ReminderActionInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión para actualizar el aviso.");
  const admin = await loadProfile(uid);
  if (!admin.profile || admin.role !== "admin") throw new HttpsError("permission-denied", "Solo administración puede actualizar este aviso.");
  const id = requiredString(request.data?.recordatorioId, "Aviso", 180);
  const nextState = request.data?.estado;
  if (!["preparado", "enviado", "omitido", "cancelado"].includes(String(nextState))) {
    throw new HttpsError("invalid-argument", "Selecciona un estado válido para el aviso.");
  }
  const reference = reminderRef(id);
  const now = Timestamp.now();
  let blockedCustomerReason: string | null = null;
  let staleReason: string | null = null;
  await db.runTransaction(async (transaction) => {
    const reminder = await transaction.get(reference);
    if (!reminder.exists) throw new HttpsError("not-found", "No encontramos ese aviso.");
    const data = reminder.data() ?? {};
    const clienteId = requiredString(data.clienteId, "Cliente", 128);
    const customer = await loadProfileInTransaction(transaction, clienteId);
    const currentState = String(data.estado ?? "");
    const blockedReason = !customer.profile || customer.role !== "cliente"
      ? "La cuenta no tiene un perfil cliente activo."
      : !hasWhatsAppConsent(customer.profile)
        ? "La persona desactivó los recordatorios."
        : !hasUsableWhatsAppNumber(profilePhone(customer.profile))
          ? "El número de teléfono no tiene un formato válido."
          : null;
    if (blockedReason) {
      if (ACTIVE_REMINDER_STATES.has(currentState)) {
        transaction.update(reference, {
          estado: "cancelado", motivoCancelacion: blockedReason, canceladoAt: now, updatedAt: now,
          historialEstados: reminderHistory(data, "cancelado", blockedReason, now, uid),
        });
      }
      blockedCustomerReason = blockedReason;
      return;
    }
    if (TERMINAL_REMINDER_STATES.has(currentState)) {
      if (currentState === nextState) return;
      throw new HttpsError("failed-precondition", "Este aviso ya se cerró y no puede volver a modificarse.");
    }
    if (nextState === "preparado" || nextState === "enviado") {
      staleReason = await staleReminderReason(transaction, data, customer.profile, now.toMillis());
      if (staleReason) {
        transaction.update(reference, {
          estado: "cancelado", motivoCancelacion: staleReason, canceladoAt: now, updatedAt: now,
          historialEstados: reminderHistory(data, "cancelado", staleReason, now, uid),
        });
        return;
      }
    }
    if (nextState === "preparado") {
      const due = timestampMillis(data.fechaProgramada);
      if (due !== null && due > now.toMillis()) throw new HttpsError("failed-precondition", "Todavía no llega la hora prevista para preparar este aviso.");
      if (currentState !== "preparado") transaction.update(reference, {
        estado: "preparado", preparadoAt: now, preparadoPorUid: uid, updatedAt: now,
        historialEstados: reminderHistory(data, "preparado", "Administración abrió el chat con el mensaje listo.", now, uid),
      });
    } else if (nextState === "enviado") {
      if (currentState !== "preparado") throw new HttpsError("failed-precondition", "Primero abre el chat y prepara el mensaje; confirma el envío solo después de enviarlo manualmente.");
      transaction.update(reference, {
        estado: "enviado", enviadoAt: now, enviadoPorUid: uid, updatedAt: now,
        historialEstados: reminderHistory(data, "enviado", "Administración confirmó el envío manual.", now, uid),
      });
    } else {
      const reason = nextState === "omitido" ? "Administración decidió omitir este aviso." : "Administración canceló este aviso.";
      transaction.update(reference, {
        estado: nextState,
        ...(nextState === "omitido" ? { omitidoAt: now, omitidoPorUid: uid } : { canceladoAt: now, canceladoPorUid: uid }),
        updatedAt: now,
        historialEstados: reminderHistory(data, nextState, reason, now, uid),
      });
    }
  });
  if (blockedCustomerReason) throw new HttpsError("failed-precondition", blockedCustomerReason);
  if (staleReason) throw new HttpsError("failed-precondition", staleReason);
  return { ok: true as const };
});

export const sincronizarRecordatoriosCitas = onDocumentWritten({ document: "citas/{citaId}" }, async (event) => {
  const after = event.data?.after;
  if (!after?.exists) {
    const before = event.data?.before;
    if (before?.exists) await Promise.all([
      cancelAppointmentReminder(event.params.citaId, "La cita fue retirada del calendario."),
      cancelReturnReminder(event.params.citaId, "La cita fue retirada del calendario."),
    ]);
    return;
  }
  const appointment = after.data() ?? {};
  const citaId = event.params.citaId;
  const state = String(appointment.estado ?? "");
  if (state === "confirmada") {
    await cancelReturnReminder(citaId, "La cita dejó de estar finalizada.");
    const clienteId = typeof appointment.clienteId === "string" ? appointment.clienteId : "";
    const servicioId = typeof appointment.servicioId === "string" ? appointment.servicioId : "";
    const negocioId = typeof appointment.negocioId === "string" ? appointment.negocioId : "";
    if (clienteId && servicioId && negocioId) await cancelReturnRemindersForNewBooking(clienteId, servicioId, citaId, negocioId);
    await createAppointmentReminder(citaId, appointment);
    return;
  }
  await cancelAppointmentReminder(citaId, state === "completada" ? "La cita ya se completó." : "La cita dejó de estar confirmada.");
  if (state === "completada") await createReturnReminder(citaId, appointment);
  else await cancelReturnReminder(citaId, "La cita dejó de estar finalizada.");
});

export const sincronizarRecordatoriosServicios = onDocumentWritten({ document: "negocios/{negocioId}/servicios/{servicioId}" }, async (event) => {
  const { negocioId, servicioId } = event.params;
  const now = Timestamp.now();
  const recentCompletedQuery = db.collection("citas")
    .where("negocioId", "==", negocioId)
    .where("servicioId", "==", servicioId)
    .where("estado", "==", "completada")
    .where("completedAt", ">=", Timestamp.fromMillis(now.toMillis() - 730 * DAY_MS))
    .orderBy("completedAt", "desc");
  const service = event.data?.after.exists ? event.data.after.data() : undefined;
  if (!service || service.recordatorioRegresoActivo !== true) {
    await visitQueryPages(recentCompletedQuery, (appointment) => cancelReminder(
      reminderRef(`regreso_${appointment.id}`),
      "El servicio ya no tiene activo el aviso para regresar.",
    ));
    return;
  }
  await visitQueryPages(recentCompletedQuery, (appointment) => createReturnReminder(appointment.id, appointment.data()));
});

async function prepareBirthdayReminders() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HONDURAS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const birthdayPairs: Array<{ day: number; month: number }> = [{ day, month }];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (month === 2 && day === 28 && !leap) birthdayPairs.push({ day: 29, month: 2 });

  const profileCollections = ["users", "usuarios"] as const;
  const matching = await Promise.all(profileCollections.flatMap((collectionName) => birthdayPairs.map(({ day: birthdayDay, month: birthdayMonth }) =>
    db.collection(collectionName)
      .where("birthdayDay", "==", birthdayDay)
      .where("birthdayMonth", "==", birthdayMonth)
      .get())));
  const candidateUids = new Set(matching.flatMap((snapshot) => snapshot.docs.map((item) => item.id)));
  const businesses = await db.collection("negocios").where("activo", "==", true).get();
  if (businesses.empty || candidateUids.size === 0) return;

  for (const uid of candidateUids) {
    const customer = await loadProfile(uid);
    if (!customer.profile || customer.role !== "cliente" || !hasWhatsAppConsent(customer.profile)) continue;
    const name = String(customer.profile.name ?? customer.profile.displayName ?? "Cliente");
    const phone = profilePhone(customer.profile);
    if (!hasUsableWhatsAppNumber(phone)) {
      await Promise.all(businesses.docs.map((business) => cancelReminder(
        reminderRef(`cumple_${uid}_${year}_${business.id}`),
        "El número de teléfono no tiene un formato válido.",
      )));
      continue;
    }
    for (const business of businesses.docs) {
      await upsertReminder(`cumple_${uid}_${year}_${business.id}`, {
        tipo: "cumpleanos",
        negocioId: business.id,
        clienteId: uid,
        clienteNombre: name,
        clienteTelefono: phone,
        cumpleanosDia: Number(customer.profile.birthdayDay),
        cumpleanosMes: Number(customer.profile.birthdayMonth),
        anioCumpleanos: year,
        fechaProgramada: Timestamp.now(),
        idempotencyKey: `cumpleanos:${uid}:${year}:${business.id}`,
      });
    }
  }
}

export const prepararRecordatoriosCumpleanos = onSchedule({
  schedule: "0 9 * * *",
  timeZone: HONDURAS_TIME_ZONE,
}, async () => {
  await prepareBirthdayReminders();
});

async function syncCustomerReminders(uid: string) {
  const customer = await loadProfile(uid);
  if (!customer.profile || customer.role !== "cliente" || !hasWhatsAppConsent(customer.profile)) return;
  const now = Timestamp.now();
  const upcoming = db.collection("citas")
      .where("clienteId", "==", uid)
      .where("estado", "==", "confirmada")
      .where("inicio", ">=", now)
      .orderBy("inicio", "asc");
  const completed = db.collection("citas")
      .where("clienteId", "==", uid)
      .where("estado", "==", "completada")
      .where("completedAt", ">=", Timestamp.fromMillis(now.toMillis() - 730 * DAY_MS))
      .orderBy("completedAt", "desc");
  await Promise.all([
    visitQueryPages(upcoming, (item) => createAppointmentReminder(item.id, item.data())),
    visitQueryPages(completed, (item) => createReturnReminder(item.id, item.data())),
  ]);
}

async function handleCustomerPreferenceChange(uid: string, beforeData: DocumentData | undefined, afterData: DocumentData | undefined) {
  if (afterData?.aceptaRecordatoriosWhatsApp === false) {
    await cancelCustomerReminders(uid);
    return;
  }
  if (beforeData?.aceptaRecordatoriosWhatsApp === false && afterData?.aceptaRecordatoriosWhatsApp !== false) {
    await syncCustomerReminders(uid);
  }
}

export const cancelarRecordatoriosWhatsAppExcluidos = onDocumentWritten({ document: "usuarios/{uid}" }, async (event) => {
  if (!event.data?.after.exists) return;
  await handleCustomerPreferenceChange(event.params.uid, event.data.before.exists ? event.data.before.data() : undefined, event.data.after.data());
});

export const cancelarRecordatoriosWhatsAppExcluidosLegacy = onDocumentWritten({ document: "users/{uid}" }, async (event) => {
  if (!event.data?.after.exists) return;
  await handleCustomerPreferenceChange(event.params.uid, event.data.before.exists ? event.data.before.data() : undefined, event.data.after.data());
});
