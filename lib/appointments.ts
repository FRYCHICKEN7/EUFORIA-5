import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, ensureFirebaseConfigured, functions } from "@/lib/firebase";

export type BusinessRecord = { id: string; nombre: string; modoNegocio: "unipersonal" | "multiEmpleado" | null; activo: boolean };
export type ServiceRecord = { id: string; nombre: string; descripcion: string; precio: number | null; duracionMin: number | null; activo: boolean };
export type AvailableTimeSlot = { hora: string; inicio: string };
export type EmployeeAvailability = { id: string; uid: string; Empleado: string; nombre: string; profileImage: string; slots: AvailableTimeSlot[] };
export type AppointmentAvailability = { fecha: string; servicio: { id: string; nombre: string; precio: number; duracionMin: number }; empleados: EmployeeAvailability[] };
export type AppointmentRecord = DocumentData & {
  id: string;
  inicio: unknown;
  fin?: unknown;
  estado: string;
  clienteId: string;
  negocioId: string;
  servicioId: string;
  empleadoId?: string;
  empleadoUid?: string;
  duracionMin?: number;
  duracionRealMin?: number;
  startedAt?: unknown;
  completedAt?: unknown;
};

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export async function loadBusinesses(): Promise<BusinessRecord[]> {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("Firebase no está configurado.");
  const snapshot = await getDocs(collection(db, "negocios"));
  return snapshot.docs
    .map((item) => {
      const data = item.data();
      const mode: BusinessRecord["modoNegocio"] = data.modoNegocio === "multiEmpleado" || data.modoNegocio === "unipersonal" ? data.modoNegocio : null;
      return { id: item.id, nombre: String(data.nombre ?? data.nombreNegocio ?? data.name ?? "EUFORIA"), modoNegocio: mode, activo: data.activo === true };
    })
    .filter((business) => business.activo);
}

export async function loadServices(businessId: string, includeInactive = false): Promise<ServiceRecord[]> {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("Firebase no está configurado.");
  const snapshot = await getDocs(collection(db, "negocios", businessId, "servicios"));
  return snapshot.docs
    .map((item) => {
      const data = item.data();
      return {
        id: item.id,
        nombre: String(data.nombre ?? data.name ?? "Servicio"),
        descripcion: String(data.descripcion ?? data.description ?? ""),
        precio: numberOrNull(data.precio),
        duracionMin: numberOrNull(data.duracionMin),
        activo: data.activo === true,
      };
    })
    .filter((service) => includeInactive || service.activo);
}

export async function getAvailableEmployeeSlots(input: { negocioId: string; servicioId: string; fecha: string }): Promise<AppointmentAvailability> {
  if (!(await ensureFirebaseConfigured()) || !functions) throw new Error("Firebase Functions no está configurado.");
  const callable = httpsCallable<typeof input, AppointmentAvailability>(functions, "obtenerDisponibilidad");
  const result = await callable(input);
  return result.data;
}

function mapAppointments(snapshot: { docs: Array<{ id: string; data: () => DocumentData }> }): AppointmentRecord[] {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AppointmentRecord[];
}

export function subscribeAdminAppointments(next: (items: AppointmentRecord[]) => void, error: (reason: Error) => void): Unsubscribe {
  if (!db) throw new Error("Firebase no está configurado.");
  const since = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const appointmentsQuery = query(collection(db, "citas"), where("inicio", ">=", since), orderBy("inicio", "asc"), limit(500));
  return onSnapshot(appointmentsQuery, (snapshot) => next(mapAppointments(snapshot)), error);
}

export function subscribeClientAppointments(uid: string, next: (items: AppointmentRecord[]) => void, error: (reason: Error) => void): Unsubscribe {
  if (!db) throw new Error("Firebase no está configurado.");
  const appointmentsQuery = query(collection(db, "citas"), where("clienteId", "==", uid), orderBy("inicio", "asc"), limit(200));
  return onSnapshot(appointmentsQuery, (snapshot) => next(mapAppointments(snapshot)), error);
}

export function subscribeEmployeeAppointments(uid: string, next: (items: AppointmentRecord[]) => void, error: (reason: Error) => void): Unsubscribe {
  if (!db) throw new Error("Firebase no está configurado.");
  const since = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const appointmentsQuery = query(collection(db, "citas"), where("empleadoUid", "==", uid), where("inicio", ">=", since), orderBy("inicio", "asc"), limit(500));
  return onSnapshot(appointmentsQuery, (snapshot) => next(mapAppointments(snapshot)), error);
}

export function appointmentMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    const result = value.toMillis();
    return Number.isFinite(result) ? result : null;
  }
  return null;
}

export async function reserveAppointment(input: { negocioId: string; servicioId: string; inicio: string; empleadoId: string; notas?: string }) {
  if (!(await ensureFirebaseConfigured()) || !functions) throw new Error("Firebase Functions no está configurado.");
  const reserve = httpsCallable<typeof input, { citaId: string; estado: string; holdExpiresAt: string }>(functions, "reservarCita");
  const result = await reserve(input);
  return result.data;
}

export async function decideAppointment(action: "aprobarCita" | "rechazarCita", citaId: string) {
  if (!(await ensureFirebaseConfigured()) || !functions) throw new Error("Firebase Functions no está configurado.");
  const decide = httpsCallable<{ citaId: string }, { ok: true; estado: string }>(functions, action);
  const result = await decide({ citaId });
  return result.data;
}

export async function startService(citaId: string) {
  if (!(await ensureFirebaseConfigured()) || !functions) throw new Error("Firebase Functions no está configurado.");
  const callable = httpsCallable<{ citaId: string }, { ok: true }>(functions, "iniciarServicio");
  const result = await callable({ citaId });
  return result.data;
}

export async function finishService(citaId: string) {
  if (!(await ensureFirebaseConfigured()) || !functions) throw new Error("Firebase Functions no está configurado.");
  const callable = httpsCallable<{ citaId: string }, { ok: true; duracionRealMin: number }>(functions, "finalizarServicio");
  const result = await callable({ citaId });
  return result.data;
}

export async function saveService(input: { businessId: string; id?: string; nombre: string; descripcion: string; precio: number; duracionMin: number; activo: boolean }) {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("Firebase no está configurado.");
  const { businessId, id, ...data } = input;
  const payload = { ...data, updatedAt: serverTimestamp() };
  if (id) {
    await setDoc(doc(db, "negocios", businessId, "servicios", id), payload, { merge: true });
    return id;
  }
  const reference = await addDoc(collection(db, "negocios", businessId, "servicios"), { ...payload, createdAt: serverTimestamp() });
  return reference.id;
}
