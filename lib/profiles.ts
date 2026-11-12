import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { getApps, initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, getIdTokenResult, signInWithEmailAndPassword, signOut, updatePassword, updateProfile } from "firebase/auth";
import { db, ensureFirebaseConfigured, firebaseAuth, firebaseConfig } from "@/lib/firebase";
import { createFirebaseAuth } from "@/lib/firebase-auth-adapter";
import { mergeProfileSources, profileRole, type ProfileRecord } from "@/lib/roles";
import { parseClock } from "@/lib/availability";
import { filterAdminCustomerProfiles } from "./admin-client-filter";
import { normalizeCustomerPhone } from "./customer-fields";

const PROFILE_COLLECTIONS = ["users", "empleados", "usuarios"] as const;
const ADMIN_CLIENT_AUTH_APP = "euforia-admin-client-creation";

function getAdminClientAuth() {
  const app = getApps().find((candidate) => candidate.name === ADMIN_CLIENT_AUTH_APP)
    ?? initializeApp(firebaseConfig, ADMIN_CLIENT_AUTH_APP);
  return createFirebaseAuth(app);
}

function adminClientError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function validBirthday(day?: number, month?: number) {
  if (day === undefined && month === undefined) return true;
  if (!Number.isInteger(day) || !Number.isInteger(month) || Number(month) < 1 || Number(month) > 12 || Number(day) < 1) return false;
  const lastDay = Number(month) === 2 ? 29 : [4, 6, 9, 11].includes(Number(month)) ? 30 : 31;
  return Number(day) <= lastDay;
}

function sourceRecord(name: string, uid: string, data: DocumentData): ProfileRecord {
  return { ...data, id: uid, _profileSource: name } as ProfileRecord;
}

export async function loadUserProfile(uid: string): Promise<ProfileRecord | null> {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("El servicio no está disponible.");
  const results = await Promise.all(PROFILE_COLLECTIONS.map((name) => getDoc(doc(db!, name, uid))));
  const records = results.flatMap((snapshot, index) => snapshot.exists()
    ? [sourceRecord(PROFILE_COLLECTIONS[index], uid, snapshot.data())]
    : []);
  return mergeProfileSources(records);
}

export async function setWhatsAppReminderConsent(uid: string, enabled: boolean) {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("El servicio no está disponible.");
  const references = [doc(db, "users", uid), doc(db, "usuarios", uid)];
  const snapshots = await Promise.all(references.map((reference) => getDoc(reference)));
  const existing = references.filter((_, index) => snapshots[index]?.exists());
  if (existing.length === 0) throw new Error("No encontramos el perfil para guardar tu preferencia.");
  const batch = writeBatch(db);
  existing.forEach((reference) => batch.update(reference, { aceptaRecordatoriosWhatsApp: enabled }));
  await batch.commit();
}

/** Listen to every source; a denied source fails closed to avoid overlooking a conflicting role. */
export function subscribeUserProfile(
  uid: string,
  next: (profile: ProfileRecord | null) => void,
  error: (reason: Error) => void,
): Unsubscribe {
  if (!db) throw new Error("El servicio no está disponible.");
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
  birthdayDay?: number;
  birthdayMonth?: number;
  aceptaRecordatoriosWhatsApp?: boolean;
  profileImage?: string;
  createdAt?: unknown;
  _profileSource?: string;
};

const CLIENT_ROLE_VALUES = ["cliente", "customer", "client"];

export function subscribeAdminClients(
  next: (clients: CustomerProfile[]) => void,
  error: (reason: Error) => void,
): Unsubscribe {
  if (!db) throw new Error("El servicio no está disponible.");
  const snapshotsByQuery = new Map<number, Map<string, CustomerProfile>>();
  let employeeApplicationIds = new Set<string>();
  let employeeApplicationsLoaded = false;
  let failed = false;
  const queries = [
    query(collection(db, "users"), where("role", "in", CLIENT_ROLE_VALUES)),
    query(collection(db, "users"), where("rol", "in", CLIENT_ROLE_VALUES)),
    query(collection(db, "usuarios"), where("role", "in", CLIENT_ROLE_VALUES)),
    query(collection(db, "usuarios"), where("rol", "in", CLIENT_ROLE_VALUES)),
  ];
  const publish = () => {
    if (!employeeApplicationsLoaded || snapshotsByQuery.size < queries.length) return;
    const byUid = new Map<string, ProfileRecord[]>();
    snapshotsByQuery.forEach((rows) => rows.forEach((record, id) => {
      const group = byUid.get(id) ?? [];
      group.push(record);
      byUid.set(id, group);
    }));
    const profiles = [...byUid.entries()].flatMap(([id, sources]) => {
      const profile = mergeProfileSources(sources);
      if (!profile) return [];
      return [{ ...profile, id } as CustomerProfile];
    });
    const clients = filterAdminCustomerProfiles(profiles, employeeApplicationIds);
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
  const employeeApplicationsSubscription = onSnapshot(
    collection(db, "empleados"),
    (snapshot) => {
      employeeApplicationIds = new Set(snapshot.docs.map((item) => item.id));
      employeeApplicationsLoaded = true;
      publish();
    },
    (reason) => {
      if (!failed) {
        failed = true;
        error(reason);
      }
    },
  );
  return () => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    employeeApplicationsSubscription();
  };
}

export type PendingEmployeeRequest = {
  id: string;
  name?: string;
  displayName?: string;
  nombre?: string;
  email?: string;
  phone?: string;
  telefono?: string;
  estadoSolicitud?: string;
};

export function subscribePendingEmployeeRequests(
  next: (requests: PendingEmployeeRequest[]) => void,
  error: (reason: Error) => void,
): Unsubscribe {
  if (!db) throw new Error("El servicio no está disponible.");
  return onSnapshot(query(collection(db, "empleados"), where("estadoSolicitud", "==", "pendiente")), (snapshot) => {
    next(snapshot.docs.map((item) => ({ ...item.data(), id: item.id })) as PendingEmployeeRequest[]);
  }, error);
}

export {
  aprobarSolicitudEmpleado,
  rechazarSolicitudEmpleado,
  solicitarPerfilEmpleado,
  createInitialBusiness,
} from "./employee-requests";
export type { EmployeeApplicationProfile } from "./employee-requests";

export type CreateAdminClientInput = {
  name: string;
  email: string;
  phone: string;
  temporaryPassword: string;
  birthdayDay?: number;
  birthdayMonth?: number;
};

export async function createAdminClientAccount(input: CreateAdminClientInput) {
  if (!(await ensureFirebaseConfigured()) || !db || !firebaseAuth?.currentUser) throw new Error("El servicio no está disponible.");
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = normalizeCustomerPhone(input.phone);
  if (name.length < 2 || name.length > 100) throw adminClientError("invalid-argument", "Escribe un nombre de 2 a 100 caracteres.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) throw adminClientError("invalid-argument", "Escribe un correo electrónico válido.");
  if (!phone) throw adminClientError("invalid-argument", "Escribe un teléfono hondureño de 8 dígitos o uno internacional con +.");
  if (input.temporaryPassword.length < 8 || input.temporaryPassword.length > 128) throw adminClientError("invalid-argument", "La contraseña provisional debe tener entre 8 y 128 caracteres.");
  if (!validBirthday(input.birthdayDay, input.birthdayMonth)) throw adminClientError("invalid-argument", "La fecha de cumpleaños no es válida.");

  const secondaryAuth = getAdminClientAuth();
  let createdUid = "";
  try {
    try {
      const credential = await createUserWithEmailAndPassword(secondaryAuth, email, input.temporaryPassword);
      createdUid = credential.user.uid;
      await updateProfile(credential.user, { displayName: name });
    } catch (reason) {
      if ((reason as { code?: string })?.code !== "auth/email-already-in-use") throw reason;
      const credential = await signInWithEmailAndPassword(secondaryAuth, email, input.temporaryPassword);
      createdUid = credential.user.uid;
    }

    const userRef = doc(db, "users", createdUid);
    const legacyRef = doc(db, "usuarios", createdUid);
    const employeeRef = doc(db, "empleados", createdUid);
    const profileData = {
      id: createdUid,
      email,
      name,
      displayName: name,
      phone,
      profileImage: "",
      photoURL: "",
      role: "cliente",
      rol: "cliente",
      aceptaRecordatoriosWhatsApp: true,
      mustChangePassword: true,
      ...(input.birthdayDay !== undefined && input.birthdayMonth !== undefined
        ? { birthdayDay: input.birthdayDay, birthdayMonth: input.birthdayMonth }
        : {}),
    };

    const repeated = await runTransaction(db, async (transaction) => {
      const [userSnapshot, legacySnapshot, employeeSnapshot] = await Promise.all([
        transaction.get(userRef), transaction.get(legacyRef), transaction.get(employeeRef),
      ]);
      const records = [userSnapshot, employeeSnapshot, legacySnapshot].flatMap((snapshot) => snapshot.exists()
        ? [{ ...snapshot.data(), id: createdUid } as ProfileRecord]
        : []);
      if (records.length) {
        const existing = mergeProfileSources(records);
        if (profileRole(existing) === "cliente" && existing?.mustChangePassword === true
          && String(existing.email ?? "").toLowerCase() === email
          && String(existing.name ?? existing.displayName ?? "") === name
          && String(existing.phone ?? "") === phone) return true;
        throw adminClientError("already-exists", "Este correo ya tiene un perfil. Usa otro correo o revisa la cuenta existente.");
      }
      transaction.set(userRef, { ...profileData, createdAt: serverTimestamp() });
      transaction.set(legacyRef, { ...profileData, createdAt: serverTimestamp() });
      return false;
    });
    return { ok: true as const, uid: createdUid, email, repeated };
  } catch (reason) {
    const code = String((reason as { code?: unknown })?.code ?? "");
    if (code === "auth/email-already-in-use" || code === "auth/invalid-credential" || code === "auth/user-not-found") {
      throw adminClientError("already-exists", "Este correo ya tiene una cuenta. Usa otro correo o revisa el perfil existente.");
    }
    throw reason;
  } finally {
    await signOut(secondaryAuth).catch(() => undefined);
  }
}

export async function completeProvisionalCustomerPasswordChange(newPassword: string) {
  if (!(await ensureFirebaseConfigured()) || !db || !firebaseAuth?.currentUser) throw new Error("El servicio no está disponible.");
  const user = firebaseAuth.currentUser;
  if (newPassword.length < 8 || newPassword.length > 128) throw adminClientError("invalid-argument", "La nueva contraseña debe tener entre 8 y 128 caracteres.");
  const token = await getIdTokenResult(user, true);
  const authTime = Number(token.claims.auth_time);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authTime) || nowSeconds - authTime > 10 * 60 || authTime > nowSeconds + 60) {
    throw adminClientError("auth/requires-recent-login", "Por seguridad, confirma de nuevo tu contraseña provisional.");
  }

  const references = [doc(db, "users", user.uid), doc(db, "usuarios", user.uid)];
  const snapshots = await Promise.all(references.map((reference) => getDoc(reference)));
  const sources = snapshots.flatMap((snapshot) => snapshot.exists() ? [{ ...snapshot.data(), id: user.uid } as ProfileRecord] : []);
  const profile = mergeProfileSources(sources);
  if (profileRole(profile) !== "cliente" || !profile) throw adminClientError("permission-denied", "Esta cuenta no puede cambiar una contraseña provisional.");
  if (profile.mustChangePassword !== true) return { ok: true as const };

  await updatePassword(user, newPassword);
  try {
    const batch = writeBatch(db);
    let updates = 0;
    references.forEach((reference, index) => {
      if (snapshots[index]?.exists() && snapshots[index].data().mustChangePassword === true) {
        batch.update(reference, { mustChangePassword: false, passwordChangedAt: serverTimestamp() });
        updates += 1;
      }
    });
    if (updates === 0) throw new Error("No encontramos los perfiles de cliente que necesitan actualizarse.");
    await batch.commit();
  } catch (reason) {
    console.warn("La contraseña se actualizó, pero no pudimos cerrar el cambio inicial del perfil.", (reason as { code?: unknown })?.code ?? "");
    throw adminClientError("auth/password-updated-profile-pending", "La contraseña pudo actualizarse, pero falta terminar. Inicia sesión con tu contraseña nueva y vuelve a intentarlo.");
  }
  return { ok: true as const };
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
  if (!db) throw new Error("El servicio no está disponible.");
  return onSnapshot(query(collection(db, "empleados")), (snapshot) => {
    const employees = snapshot.docs.flatMap((item) => {
      const profile = { ...item.data(), id: item.id } as EmployeeProfile;
      return profileRole(profile) === "empleado" ? [profile] : [];
    });
    next(employees.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "es")));
  }, error);
}

export type AppNotification = DocumentData & { id: string; titulo?: string; cuerpo?: string; tipo?: string; citaId?: string; leida?: boolean; createdAt?: unknown };

export function subscribeNotifications(uid: string, next: (items: AppNotification[]) => void, error: (reason: Error) => void, includeAdmin = false): Unsubscribe {
  if (!db) throw new Error("El servicio no está disponible.");
  const recipientFilter = includeAdmin
    ? where("destinatarioId", "in", [uid, "admin"])
    : where("destinatarioId", "==", uid);
  const notificationsQuery = query(collection(db, "notificaciones"), recipientFilter, orderBy("createdAt", "desc"), limit(50));
  return onSnapshot(notificationsQuery, (snapshot) => {
    next(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AppNotification[]);
  }, error);
}

export async function markNotificationRead(id: string) {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("El servicio no está disponible.");
  await updateDoc(doc(db, "notificaciones", id), { leida: true });
}

export type WeeklyAvailabilityDay = { dia: number; activo: boolean; inicio: string; fin: string };

export async function saveEmployeeAvailability(input: { disponible: boolean; dias: WeeklyAvailabilityDay[] }) {
  if (!(await ensureFirebaseConfigured())) throw new Error("El servicio no está disponible.");
  const database = db;
  const auth = firebaseAuth;
  if (!database || !auth) throw new Error("El servicio no está disponible.");
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Inicia sesión para guardar tu horario.");
  if (typeof input.disponible !== "boolean" || !Array.isArray(input.dias) || input.dias.length !== 7) {
    throw new Error("Revisa los siete días de tu horario.");
  }
  const days = new Map<number, WeeklyAvailabilityDay>();
  for (const day of input.dias) {
    if (!Number.isInteger(day.dia) || day.dia < 0 || day.dia > 6 || days.has(day.dia) || typeof day.activo !== "boolean") {
      throw new Error("Cada día debe aparecer una sola vez.");
    }
    if (parseClock(day.inicio) === null || parseClock(day.fin) === null || (day.activo && parseClock(day.fin)! <= parseClock(day.inicio)!)) {
      throw new Error("Usa horas válidas y asegúrate de que el turno termine después de iniciar.");
    }
    days.set(day.dia, day);
  }
  if (days.size !== 7 || (input.disponible && ![...days.values()].some((day) => day.activo))) {
    throw new Error("Activa al menos un día de turno antes de marcarte disponible.");
  }

  const employeeRef = doc(database, "empleados", uid);
  return runTransaction(database, async (transaction) => {
    const employeeSnapshot = await transaction.get(employeeRef);
    if (!employeeSnapshot.exists() || profileRole({ ...employeeSnapshot.data(), id: uid } as ProfileRecord) !== "empleado") {
      throw new Error("Solo una persona aprobada del equipo puede guardar este horario.");
    }
    const negocioId = String(employeeSnapshot.data().negocioId ?? "");
    if (!negocioId) throw new Error("Tu perfil todavía no está vinculado a un negocio.");
    const membershipRef = doc(database, "negocios", negocioId, "empleados", uid);
    const publicRef = doc(database, "negocios", negocioId, "empleadosPublicos", uid);
    const scheduleRefs = Array.from({ length: 7 }, (_, dia) => doc(database, "negocios", negocioId, "empleados", uid, "disponibilidad", String(dia)));
    const [membershipSnapshot, publicSnapshot] = await Promise.all([
      transaction.get(membershipRef),
      transaction.get(publicRef),
    ]);
    if (!membershipSnapshot.exists() || membershipSnapshot.data().activo !== true || !publicSnapshot.exists()) {
      throw new Error("No encontramos el perfil público del equipo. Pide a administración que revise tu acceso.");
    }
    const now = serverTimestamp();
    for (const [dia, reference] of scheduleRefs.entries()) {
      const value = days.get(dia)!;
      transaction.set(reference, {
        dia,
        activo: value.activo,
        inicio: value.inicio,
        fin: value.fin,
        inicioMin: parseClock(value.inicio)!,
        finMin: parseClock(value.fin)!,
        updatedAt: now,
      });
    }
    transaction.update(employeeRef, { disponible: input.disponible, updatedAt: now });
    transaction.update(membershipRef, { disponible: input.disponible, updatedAt: now });
    transaction.update(publicRef, { disponible: input.disponible, updatedAt: now });
    return { ok: true as const, disponible: input.disponible };
  });
}

export async function loadEmployeeAvailability(uid: string): Promise<{ negocioId: string; disponible: boolean; dias: WeeklyAvailabilityDay[] }> {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("El servicio no está disponible.");
  const employeeSnapshot = await getDoc(doc(db, "empleados", uid));
  if (!employeeSnapshot.exists()) throw new Error("No encontramos tu perfil de empleado.");
  const employee = employeeSnapshot.data();
  const negocioId = String(employee.negocioId ?? "");
  if (!negocioId) throw new Error("Tu perfil de empleado no está vinculado a un negocio.");
  const scheduleSnapshot = await getDocs(collection(db, "negocios", negocioId, "empleados", uid, "disponibilidad"));
  const saved = new Map(scheduleSnapshot.docs.map((item) => [item.id, item.data()]));
  const dias = Array.from({ length: 7 }, (_, dia) => {
    const value = saved.get(String(dia));
    const clock = (minutes: unknown, fallback: unknown) => Number.isInteger(minutes) && Number(minutes) >= 0 && Number(minutes) < 24 * 60
      ? `${String(Math.floor(Number(minutes) / 60)).padStart(2, "0")}:${String(Number(minutes) % 60).padStart(2, "0")}`
      : typeof fallback === "string" ? fallback : "08:00";
    return {
      dia,
      activo: value?.activo === true,
      inicio: clock(value?.inicioMin, value?.inicio),
      fin: clock(value?.finMin, value?.fin ?? "17:00"),
    };
  });
  return { negocioId, disponible: employee.disponible === true, dias };
}
