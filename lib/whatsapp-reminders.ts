import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { db, ensureFirebaseConfigured, firebaseAuth } from "@/lib/firebase";
import {
  DEFAULT_REMINDER_LEAD_HOURS,
  DEFAULT_REMINDER_TEMPLATES,
  buildManualReminderCandidates,
  reminderMillis,
  type ManualReminderCandidate,
  type ReminderTemplates,
  type ReminderType,
} from "./whatsapp-reminder-logic";

export {
  ALLOWED_TEMPLATE_VARIABLES,
  DEFAULT_REMINDER_LEAD_HOURS,
  DEFAULT_REMINDER_TEMPLATES,
  birthdayIsToday,
  buildManualReminderCandidates,
  isSafeReminderMessage,
  reminderAppointmentDue,
  reminderMillis,
  renderReminderTemplate,
  returnReminderDate,
} from "./whatsapp-reminder-logic";
export type { ManualReminderCandidate, ReminderTemplates, ReminderType } from "./whatsapp-reminder-logic";

export type ReminderStatus = "pendiente" | "preparado" | "enviado" | "omitido" | "cancelado";
export type ReminderConfiguration = { horasAntesCita: number; plantillas: ReminderTemplates };
export type WhatsAppReminder = Omit<ManualReminderCandidate, "estado"> & {
  estado: ReminderStatus;
  [key: string]: unknown;
};

export function subscribeAdminWhatsAppReminders(
  negocioId: string,
  next: (items: WhatsAppReminder[]) => void,
  error: (reason: Error) => void,
): Unsubscribe {
  if (!db) throw new Error("El servicio no está disponible.");
  return onSnapshot(
    query(collection(db, "recordatoriosWhatsApp"), where("negocioId", "==", negocioId)),
    (snapshot) => next(snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as WhatsAppReminder)),
    error,
  );
}

export async function updateWhatsAppReminder(reminder: WhatsAppReminder, estado: ReminderStatus) {
  if (!(await ensureFirebaseConfigured()) || !db || !firebaseAuth?.currentUser) throw new Error("Inicia sesión para actualizar el aviso.");
  if (!["preparado", "enviado", "omitido"].includes(estado)) throw new Error("Elige una acción disponible para este aviso.");
  const database = db;
  const user = firebaseAuth.currentUser;
  const reference = doc(database, "recordatoriosWhatsApp", reminder.id);
  const scheduledAt = reminderMillis(reminder.fechaProgramada) ?? Date.now();
  const baseRecord = {
    id: reminder.id,
    negocioId: reminder.negocioId,
    clienteId: reminder.clienteId,
    tipo: reminder.tipo,
    fechaProgramada: Timestamp.fromMillis(scheduledAt),
    clienteNombre: String(reminder.clienteNombre ?? "").slice(0, 100),
    clienteTelefono: String(reminder.clienteTelefono ?? "").slice(0, 32),
    ...(reminder.citaId ? { citaId: String(reminder.citaId).slice(0, 128) } : {}),
    ...(reminder.servicioId ? { servicioId: String(reminder.servicioId).slice(0, 128) } : {}),
    ...(reminder.servicioNombre ? { servicioNombre: String(reminder.servicioNombre).slice(0, 100) } : {}),
    ...(reminder.citaFecha ? { citaFecha: String(reminder.citaFecha).slice(0, 100) } : {}),
    ...(reminder.citaHoraInicio ? { citaHoraInicio: String(reminder.citaHoraInicio).slice(0, 32) } : {}),
    ...(Number.isInteger(reminder.anticipacionRecordatorioDias) ? { anticipacionRecordatorioDias: reminder.anticipacionRecordatorioDias } : {}),
    ...(Number.isInteger(reminder.aniversarioAno) ? { aniversarioAno: reminder.aniversarioAno } : {}),
  };

  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const currentStatus = snapshot.exists() ? String(snapshot.data().estado ?? "") : "pendiente";
    if (currentStatus === estado) return;
    const canCreate = !snapshot.exists() && (estado === "preparado" || estado === "omitido");
    const canUpdate = (currentStatus === "pendiente" && ["preparado", "omitido"].includes(estado))
      || (currentStatus === "preparado" && ["preparado", "enviado", "omitido"].includes(estado));
    if (!canCreate && !canUpdate) throw new Error("Este aviso ya no está disponible.");
    const statusField = estado === "preparado" ? "preparadoAt" : estado === "enviado" ? "enviadoAt" : "omitidoAt";
    const update = { estado, updatedAt: serverTimestamp(), actualizadoPorUid: user.uid, [statusField]: serverTimestamp() };
    if (canCreate) {
      transaction.set(reference, { ...baseRecord, ...update, createdAt: serverTimestamp() });
      return;
    }
    if (!snapshot.exists()) throw new Error("Este aviso ya no está disponible.");
    const existing = snapshot.data();
    if (existing.negocioId !== reminder.negocioId || existing.clienteId !== reminder.clienteId || existing.tipo !== reminder.tipo) {
      throw new Error("Este aviso ya no está disponible.");
    }
    transaction.update(reference, update);
  });
  return { ok: true as const };
}

export async function loadReminderConfiguration(negocioId: string): Promise<ReminderConfiguration> {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("El servicio no está disponible.");
  const snapshot = await getDoc(doc(db, "negocios", negocioId));
  if (!snapshot.exists()) throw new Error("No encontramos el negocio seleccionado.");
  const config = snapshot.data().configuracionRecordatoriosWhatsApp as Partial<ReminderConfiguration> | undefined;
  const hours = Number(config?.horasAntesCita);
  const savedTemplates: Partial<ReminderTemplates> = config?.plantillas && typeof config.plantillas === "object"
    ? config.plantillas
    : {};
  return {
    horasAntesCita: Number.isInteger(hours) && hours >= 1 && hours <= 720 ? hours : DEFAULT_REMINDER_LEAD_HOURS,
    plantillas: {
      cita: typeof savedTemplates.cita === "string" ? savedTemplates.cita : DEFAULT_REMINDER_TEMPLATES.cita,
      regreso: typeof savedTemplates.regreso === "string" ? savedTemplates.regreso : DEFAULT_REMINDER_TEMPLATES.regreso,
      cumpleanos: typeof savedTemplates.cumpleanos === "string" ? savedTemplates.cumpleanos : DEFAULT_REMINDER_TEMPLATES.cumpleanos,
    },
  };
}

export async function saveReminderConfiguration(negocioId: string, horasAntesCita: number, plantillas: ReminderTemplates) {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("El servicio no está disponible.");
  if (!Number.isInteger(horasAntesCita) || horasAntesCita < 1 || horasAntesCita > 720
    || Object.values(plantillas).some((value) => typeof value !== "string" || value.trim().length === 0 || value.length > 1200)) {
    throw new Error("Revisa el plazo y el texto de los avisos antes de guardar.");
  }
  const businessRef = doc(db, "negocios", negocioId);
  const snapshot = await getDoc(businessRef);
  if (!snapshot.exists() || snapshot.data().activo !== true) throw new Error("No encontramos el negocio activo.");
  await updateDoc(businessRef, {
    configuracionRecordatoriosWhatsApp: { horasAntesCita, plantillas },
    updatedAt: serverTimestamp(),
  });
  return { ok: true as const };
}
