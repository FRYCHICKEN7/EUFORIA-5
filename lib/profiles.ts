import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, ensureFirebaseConfigured, functions } from "@/lib/firebase";
import { mergeProfileSources, profileRole, type ProfileRecord } from "@/lib/roles";

const PROFILE_COLLECTIONS = ["users", "empleados", "usuarios"] as const;

function sourceRecord(name: string, uid: string, data: DocumentData): ProfileRecord {
  return { ...data, id: uid, _profileSource: name } as ProfileRecord;
}

export async function loadUserProfile(uid: string): Promise<ProfileRecord | null> {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("Firebase no está configurado.");
  const results = await Promise.all(PROFILE_COLLECTIONS.map((name) => getDoc(doc(db!, name, uid))));
  const records = results.flatMap((snapshot, index) => snapshot.exists()
    ? [sourceRecord(PROFILE_COLLECTIONS[index], uid, snapshot.data())]
    : []);
  return mergeProfileSources(records);
}

/** Listen to every source; a denied source fails closed to avoid overlooking a conflicting role. */
export function subscribeUserProfile(
  uid: string,
  next: (profile: ProfileRecord | null) => void,
  error: (reason: Error) => void,
): Unsubscribe {
  if (!db) throw new Error("Firebase no está configurado.");
  const sources = new Map<string, ProfileRecord | null>();
  const initial = new Set<string>();
  let failed = false;
  const publish = () => next(mergeProfileSources([...sources.values()]));
  const subscriptions = PROFILE_COLLECTIONS.map((name) => onSnapshot(
    doc(db!, name, uid),
    (snapshot) => {
      sources.set(name, snapshot.exists() ? sourceRecord(name, uid, snapshot.data()) : null);
      initial.add(name);
      if (initial.size === PROFILE_COLLECTIONS.length) publish();
    },
    (reason) => {
      sources.set(name, { id: uid, roleConflict: true, _profileSource: name });
      initial.add(name);
      if (initial.size === PROFILE_COLLECTIONS.length) publish();
      if (!failed) {
        failed = true;
        console.warn(`No se pudo leer el perfil de ${name}:`, reason.code);
        error(reason);
      }
    },
  ));
  return () => subscriptions.forEach((unsubscribe) => unsubscribe());
}

export type CustomerProfile = ProfileRecord & {
  id: string;
  email?: string;
  name?: string;
  displayName?: string;
  nombre?: string;
  phone?: string;
  telefono?: string;
  identityNumber?: string;
  profileImage?: string;
  createdAt?: unknown;
  _profileSource?: string;
};

const CLIENT_ROLE_VALUES = ["cliente", "customer", "client"];

export function subscribeAdminClients(
  next: (clients: CustomerProfile[]) => void,
  error: (reason: Error) => void,
): Unsubscribe {
  if (!db) throw new Error("Firebase no está configurado.");
  const snapshotsByQuery = new Map<number, Map<string, CustomerProfile>>();
  let failed = false;
  const queries = [
    query(collection(db, "users"), where("role", "in", CLIENT_ROLE_VALUES)),
    query(collection(db, "users"), where("rol", "in", CLIENT_ROLE_VALUES)),
    query(collection(db, "usuarios"), where("role", "in", CLIENT_ROLE_VALUES)),
    query(collection(db, "usuarios"), where("rol", "in", CLIENT_ROLE_VALUES)),
  ];
  const publish = () => {
    const byUid = new Map<string, ProfileRecord[]>();
    snapshotsByQuery.forEach((rows) => rows.forEach((record, id) => {
      const group = byUid.get(id) ?? [];
      group.push(record);
      byUid.set(id, group);
    }));
    const clients = [...byUid.entries()].flatMap(([id, sources]) => {
      const profile = mergeProfileSources(sources);
      if (profileRole(profile) !== "cliente" || profile?.roleConflict) return [];
      return [{ ...profile, id } as CustomerProfile];
    });
    next(clients.sort((a, b) => String(a.name ?? a.displayName ?? a.nombre ?? "").localeCompare(String(b.name ?? b.displayName ?? b.nombre ?? ""), "es")));
  };
  const subscriptions = queries.map((currentQuery, index) => onSnapshot(
    currentQuery,
    (snapshot) => {
      const source = new Map<string, CustomerProfile>();
      snapshot.docs.forEach((item) => {
        source.set(item.id, sourceRecord(index < 2 ? "users" : "usuarios", item.id, item.data()) as CustomerProfile);
      });
      snapshotsByQuery.set(index, source);
      publish();
    },
    (reason) => {
      if (!failed) {
        failed = true;
        error(reason);
      }
    },
  ));
  return () => subscriptions.forEach((unsubscribe) => unsubscribe());
}

export type EmployeeProfile = {
  id: string;
  email?: string;
  name?: string;
  Empleado?: string;
  role?: unknown;
  rol?: unknown;
  negocioId?: string;
  disponible?: boolean;
  activo?: boolean;
  profileImage?: string;
};

export function subscribeAdminEmployees(
  next: (employees: EmployeeProfile[]) => void,
  error: (reason: Error) => void,
): Unsubscribe {
  if (!db) throw new Error("Firebase no está configurado.");
  return onSnapshot(query(collection(db, "empleados")), (snapshot) => {
    const employees = snapshot.docs.flatMap((item) => {
      const profile = { ...item.data(), id: item.id } as EmployeeProfile;
      return profileRole(profile) === "empleado" ? [profile] : [];
    });
    next(employees.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "es")));
  }, error);
}

export type AppNotification = DocumentData & { id: string; titulo?: string; cuerpo?: string; tipo?: string; citaId?: string; leida?: boolean; createdAt?: unknown };

export function subscribeNotifications(uid: string, next: (items: AppNotification[]) => void, error: (reason: Error) => void): Unsubscribe {
  if (!db) throw new Error("Firebase no está configurado.");
  const notificationsQuery = query(collection(db, "notificaciones"), where("destinatarioId", "==", uid), orderBy("createdAt", "desc"), limit(50));
  return onSnapshot(notificationsQuery, (snapshot) => {
    next(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AppNotification[]);
  }, error);
}

export async function markNotificationRead(id: string) {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("Firebase no está configurado.");
  await updateDoc(doc(db, "notificaciones", id), { leida: true });
}

export async function createEmployeeProfile(input: { uid: string; negocioId: string; Empleado: string }) {
  if (!(await ensureFirebaseConfigured()) || !functions) throw new Error("Firebase Functions no está configurado.");
  const callable = httpsCallable<typeof input, { ok: true; empleadoId: string; codigo: string }>(functions, "crearPerfilEmpleado");
  const result = await callable(input);
  return result.data;
}

export type WeeklyAvailabilityDay = { dia: number; activo: boolean; inicio: string; fin: string };

export async function saveEmployeeAvailability(input: { disponible: boolean; dias: WeeklyAvailabilityDay[] }) {
  if (!(await ensureFirebaseConfigured()) || !functions) throw new Error("Firebase Functions no está configurado.");
  const callable = httpsCallable<typeof input, { ok: true; disponible: boolean }>(functions, "guardarDisponibilidadEmpleado");
  const result = await callable(input);
  return result.data;
}

export async function loadEmployeeAvailability(uid: string): Promise<{ negocioId: string; disponible: boolean; dias: WeeklyAvailabilityDay[] }> {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("Firebase no está configurado.");
  const employeeSnapshot = await getDoc(doc(db, "empleados", uid));
  if (!employeeSnapshot.exists()) throw new Error("No existe empleados/{uid} para esta cuenta.");
  const employee = employeeSnapshot.data();
  const negocioId = String(employee.negocioId ?? "");
  if (!negocioId) throw new Error("El perfil de empleado no está vinculado a un negocio.");
  const scheduleSnapshot = await getDocs(collection(db, "negocios", negocioId, "empleados", uid, "disponibilidad"));
  const saved = new Map(scheduleSnapshot.docs.map((item) => [item.id, item.data()]));
  const dias = Array.from({ length: 7 }, (_, dia) => {
    const value = saved.get(String(dia));
    return {
      dia,
      activo: value?.activo === true,
      inicio: typeof value?.inicio === "string" ? value.inicio : "08:00",
      fin: typeof value?.fin === "string" ? value.fin : "17:00",
    };
  });
  return { negocioId, disponible: employee.disponible === true, dias };
}
