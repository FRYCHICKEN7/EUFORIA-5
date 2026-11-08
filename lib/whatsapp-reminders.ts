import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { getDoc, doc, collection, onSnapshot, query, where } from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import {
  DEFAULT_REMINDER_LEAD_HOURS,
  DEFAULT_REMINDER_TEMPLATES,
  type ReminderTemplates,
  type ReminderType,
} from "./whatsapp-reminder-logic";

export {
  ALLOWED_TEMPLATE_VARIABLES,
  DEFAULT_REMINDER_LEAD_HOURS,
  DEFAULT_REMINDER_TEMPLATES,
  birthdayIsToday,
  isSafeReminderMessage,
  reminderAppointmentDue,
  reminderMillis,
  renderReminderTemplate,
  returnReminderDate,
} from "./whatsapp-reminder-logic";
export type { ReminderTemplates, ReminderType } from "./whatsapp-reminder-logic";

export type ReminderStatus = "pendiente" | "preparado" | "enviado" | "omitido" | "cancelado";
export type ReminderConfiguration = { horasAntesCita: number; plantillas: ReminderTemplates };
export type WhatsAppReminder = {
  id: string;
  tipo: ReminderType;
  estado: ReminderStatus;
  negocioId: string;
  clienteId: string;
  citaId?: string;
  servicioId?: string;
  fechaProgramada?: unknown;
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
    (snapshot) => next(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as WhatsAppReminder)),
    error,
  );
}

export async function updateWhatsAppReminder(recordatorioId: string, estado: ReminderStatus) {
  if (!functions) throw new Error("El servicio no está disponible.");
  const call = httpsCallable<{ recordatorioId: string; estado: ReminderStatus }, { ok: true }>(functions, "actualizarRecordatorioWhatsApp");
  return (await call({ recordatorioId, estado })).data;
}

export async function loadReminderConfiguration(negocioId: string): Promise<ReminderConfiguration> {
  if (!db) throw new Error("El servicio no está disponible.");
  const snapshot = await getDoc(doc(db, "negocios", negocioId));
  const data = snapshot.data() ?? {};
  const config = data.configuracionRecordatoriosWhatsApp as Partial<ReminderConfiguration> | undefined;
  const hours = Number(config?.horasAntesCita);
  return {
    horasAntesCita: Number.isInteger(hours) && hours >= 1 && hours <= 720 ? hours : DEFAULT_REMINDER_LEAD_HOURS,
    plantillas: { ...DEFAULT_REMINDER_TEMPLATES, ...(config?.plantillas ?? {}) },
  };
}

export async function saveReminderConfiguration(negocioId: string, horasAntesCita: number, plantillas: ReminderTemplates) {
  if (!functions) throw new Error("El servicio no está disponible.");
  const call = httpsCallable<{ negocioId: string; horasAntesCita: number; plantillas: ReminderTemplates }, { ok: true }>(functions, "guardarConfiguracionRecordatoriosWhatsApp");
  return (await call({ negocioId, horasAntesCita, plantillas })).data;
}
