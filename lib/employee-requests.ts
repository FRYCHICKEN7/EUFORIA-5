import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { db, ensureFirebaseConfigured, firebaseAuth } from "@/lib/firebase";
import { mergeProfileSources, profileRole, type ProfileRecord } from "@/lib/roles";
import { normalizeCustomerPhone } from "@/lib/customer-fields";
import { employeeCodeForUid, INITIAL_BUSINESS_ID, normalizeEmployeeBirthday } from "@/lib/employee-data";

export type EmployeeApplicationProfile = {
  name: string;
  phone: string;
  birthdayDay?: number;
  birthdayMonth?: number;
};

export class EmployeeFlowError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EmployeeFlowError";
    this.code = code;
  }
}

function requireDatabase() {
  if (!db || !firebaseAuth) throw new EmployeeFlowError("unavailable", "El servicio no está disponible.");
  return { database: db, auth: firebaseAuth };
}

async function ensureReady() {
  if (!(await ensureFirebaseConfigured())) throw new EmployeeFlowError("unavailable", "El servicio no está disponible.");
  return requireDatabase();
}

function snapshotProfile(name: string, uid: string, snapshot: { exists(): boolean; data(): DocumentData | undefined }): ProfileRecord | null {
  return snapshot.exists() ? { ...snapshot.data(), id: uid, _profileSource: name } as ProfileRecord : null;
}

function mergedProfile(uid: string, user: { exists(): boolean; data(): DocumentData | undefined }, employee: { exists(): boolean; data(): DocumentData | undefined }, legacy: { exists(): boolean; data(): DocumentData | undefined }) {
  return mergeProfileSources([
    snapshotProfile("users", uid, user),
    snapshotProfile("empleados", uid, employee),
    snapshotProfile("usuarios", uid, legacy),
  ]);
}

async function requireCurrentAdmin() {
  const { database, auth } = await ensureReady();
  const user = auth.currentUser;
  if (!user) throw new EmployeeFlowError("unauthenticated", "Inicia sesión para continuar.");
  const [primary, employee, legacy] = await Promise.all([
    getDoc(doc(database, "users", user.uid)),
    getDoc(doc(database, "empleados", user.uid)),
    getDoc(doc(database, "usuarios", user.uid)),
  ]);
  if (profileRole(mergedProfile(user.uid, primary, employee, legacy)) !== "admin") {
    throw new EmployeeFlowError("permission-denied", "Solo administración puede realizar esta acción.");
  }
  return { database, user };
}

function nonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function validEmail(value: string) {
  return /^\S+@\S+\.\S+$/.test(value) && value.length <= 254;
}

function businessQuery(database: NonNullable<typeof db>) {
  return query(collection(database, "negocios"), where("activo", "==", true), limit(2));
}

export async function solicitarPerfilEmpleado(input?: EmployeeApplicationProfile) {
  const { database, auth } = await ensureReady();
  const user = auth.currentUser;
  if (!user?.uid || !user.email) throw new EmployeeFlowError("unauthenticated", "Inicia sesión con un correo para enviar la solicitud.");
  const uid = user.uid;
  const userRef = doc(database, "users", uid);
  const employeeRef = doc(database, "empleados", uid);
  const legacyRef = doc(database, "usuarios", uid);
  const [userSnapshot, employeeSnapshot, legacySnapshot] = await Promise.all([
    getDoc(userRef),
    getDoc(employeeRef),
    getDoc(legacyRef),
  ]);
  const currentProfile = mergedProfile(uid, userSnapshot, employeeSnapshot, legacySnapshot);
  const currentRole = profileRole(currentProfile);
  if (currentProfile && currentRole !== "cliente") {
    throw new EmployeeFlowError("failed-precondition", "Esta cuenta ya tiene otro tipo de acceso. Consulta con administración.");
  }

  const application = employeeSnapshot.data() ?? {};
  const applicationStatus = String(application.estadoSolicitud ?? "");
  if (employeeSnapshot.exists() && applicationStatus === "aprobada") {
    throw new EmployeeFlowError("already-exists", "Esta cuenta ya tiene acceso como empleado.");
  }
  if (employeeSnapshot.exists() && applicationStatus === "pendiente") {
    return { ok: true as const, estado: "pendiente" as const };
  }
  if (employeeSnapshot.exists() && applicationStatus !== "rechazada") {
    throw new EmployeeFlowError("failed-precondition", "No pudimos validar el estado de esta solicitud. Consulta con administración.");
  }

  const name = nonEmptyString(currentProfile?.name, currentProfile?.displayName, currentProfile?.nombre, input?.name);
  const rawPhone = nonEmptyString(currentProfile?.phone, currentProfile?.telefono, input?.phone);
  const phone = normalizeCustomerPhone(rawPhone);
  if (name.length < 2 || name.length > 100 || !phone) {
    throw new EmployeeFlowError("invalid-argument", "Escribe un nombre completo y un teléfono hondureño de ocho dígitos o internacional con +.");
  }
  const email = user.email.trim().toLowerCase();
  if (!validEmail(email)) throw new EmployeeFlowError("invalid-argument", "El correo electrónico no es válido.");
  const birthday = normalizeEmployeeBirthday(
    currentProfile?.birthdayDay ?? input?.birthdayDay,
    currentProfile?.birthdayMonth ?? input?.birthdayMonth,
  );
  const profileImage = nonEmptyString(currentProfile?.profileImage, currentProfile?.photoURL);
  const displayName = nonEmptyString(currentProfile?.displayName, currentProfile?.name, currentProfile?.nombre, input?.name) || name;
  const consent = currentProfile?.aceptaRecordatoriosWhatsApp !== false;
  const baseProfile: DocumentData = {
    id: uid,
    email,
    name,
    displayName,
    phone,
    profileImage,
    photoURL: profileImage,
    role: "cliente",
    rol: "cliente",
    aceptaRecordatoriosWhatsApp: consent,
    ...(birthday ?? {}),
  };

  const batch = writeBatch(database);
  if (!userSnapshot.exists()) batch.set(userRef, { ...baseProfile, createdAt: serverTimestamp() });
  if (!legacySnapshot.exists()) batch.set(legacyRef, { ...baseProfile, createdAt: serverTimestamp() });
  const employeeData: DocumentData = {
    ...baseProfile,
    estadoSolicitud: "pendiente",
    solicitadaAt: serverTimestamp(),
    createdAt: employeeSnapshot.exists() ? application.createdAt ?? serverTimestamp() : serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  batch.set(employeeRef, employeeData);
  await batch.commit();
  return { ok: true as const, estado: "pendiente" as const };
}

export async function aprobarSolicitudEmpleado(input: { uid: string }) {
  const { database, user: admin } = await requireCurrentAdmin();
  const uid = input.uid.trim();
  if (!uid || uid.length > 128 || uid === admin.uid) {
    throw new EmployeeFlowError("invalid-argument", "No se puede aceptar esta solicitud.");
  }
  const employeeRef = doc(database, "empleados", uid);
  const userRef = doc(database, "users", uid);
  const legacyRef = doc(database, "usuarios", uid);
  const newBusinessRef = doc(database, "negocios", INITIAL_BUSINESS_ID);
  const notificationRef = doc(collection(database, "notificaciones"));
  const activeBusinesses = await getDocs(businessQuery(database));
  if (activeBusinesses.docs.length > 1) {
    throw new EmployeeFlowError("failed-precondition", "Hay más de un negocio activo. Deja solo uno activo antes de aceptar.");
  }

  return runTransaction(database, async (transaction) => {
    const [applicationSnapshot, userSnapshot, legacySnapshot] = await Promise.all([
      transaction.get(employeeRef),
      transaction.get(userRef),
      transaction.get(legacyRef),
    ]);
    if (!applicationSnapshot.exists()) throw new EmployeeFlowError("not-found", "No encontramos la solicitud de esta persona.");
    const application = applicationSnapshot.data();
    const currentProfile = mergeProfileSources([
      snapshotProfile("users", uid, userSnapshot),
      snapshotProfile("empleados", uid, applicationSnapshot),
      snapshotProfile("usuarios", uid, legacySnapshot),
    ]);
    const currentRole = profileRole(currentProfile);
    if (application.estadoSolicitud === "aprobada" && currentRole === "empleado") {
      return { ok: true as const, repeated: true };
    }
    if (application.estadoSolicitud !== "pendiente" || profileRole(snapshotProfile("empleados", uid, applicationSnapshot)) !== "cliente") {
      throw new EmployeeFlowError("failed-precondition", "La solicitud ya no está pendiente o los perfiles necesitan revisión.");
    }
    if (currentRole !== "cliente") {
      throw new EmployeeFlowError("failed-precondition", "Los perfiles tienen datos contradictorios. Revisa la cuenta antes de aceptarla.");
    }
    const businessRef = activeBusinesses.docs[0]?.ref ?? newBusinessRef;
    const businessSnapshot = await transaction.get(businessRef);
    const currentBusiness = businessSnapshot.data() ?? {};
    if (activeBusinesses.docs.length === 1 && currentBusiness.activo !== true) {
      throw new EmployeeFlowError("failed-precondition", "El negocio activo cambió. Actualiza la pantalla e inténtalo de nuevo.");
    }
    const membershipRef = doc(database, "negocios", businessRef.id, "empleados", uid);
    const membershipSnapshot = await transaction.get(membershipRef);
    if (membershipSnapshot.exists()) {
      throw new EmployeeFlowError("already-exists", "Esta cuenta ya está vinculada al negocio. Actualiza la pantalla y revisa el perfil.");
    }

    const name = nonEmptyString(application.name, application.displayName, application.nombre);
    const phone = normalizeCustomerPhone(nonEmptyString(application.phone, application.telefono));
    const email = nonEmptyString(application.email, userSnapshot.data()?.email, legacySnapshot.data()?.email).toLowerCase();
    if (name.length < 2 || name.length > 100 || !phone || !validEmail(email)) {
      throw new EmployeeFlowError("failed-precondition", "La solicitud necesita nombre, correo y teléfono válidos antes de aceptarse.");
    }
    const birthday = normalizeEmployeeBirthday(application.birthdayDay, application.birthdayMonth);
    const profileImage = nonEmptyString(application.profileImage, application.photoURL);
    const displayName = nonEmptyString(application.displayName, application.name, application.nombre) || name;
    const businessName = nonEmptyString(currentBusiness.nombre, currentBusiness.nombreNegocio) || "EUFORIA Beauty Studio";
    const employeeCode = nonEmptyString(application.Empleado) || employeeCodeForUid(uid);

    if (activeBusinesses.docs.length === 0) {
      if (businessSnapshot.exists()) {
        transaction.update(businessRef, { activo: true, modoNegocio: "multiEmpleado", updatedAt: serverTimestamp() });
      } else {
        transaction.set(businessRef, {
          nombre: "EUFORIA Beauty Studio",
          activo: true,
          modoNegocio: "multiEmpleado",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } else if (currentBusiness.modoNegocio !== "multiEmpleado") {
      transaction.update(businessRef, { modoNegocio: "multiEmpleado", updatedAt: serverTimestamp() });
    }

    const profilePatch = {
      role: "empleado",
      rol: "empleado",
      negocioId: businessRef.id,
      name,
      displayName,
      phone,
      profileImage,
      photoURL: profileImage,
      birthdayDay: birthday ? birthday.birthdayDay : deleteField(),
      birthdayMonth: birthday ? birthday.birthdayMonth : deleteField(),
      updatedAt: serverTimestamp(),
    };
    const newProfile: DocumentData = {
      id: uid,
      email,
      name,
      displayName,
      phone,
      profileImage,
      photoURL: profileImage,
      role: "empleado",
      rol: "empleado",
      negocioId: businessRef.id,
      aceptaRecordatoriosWhatsApp: application.aceptaRecordatoriosWhatsApp !== false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(birthday ?? {}),
    };
    if (userSnapshot.exists()) transaction.update(userRef, profilePatch);
    else transaction.set(userRef, newProfile);
    if (legacySnapshot.exists()) transaction.update(legacyRef, profilePatch);
    else transaction.set(legacyRef, newProfile);

    transaction.update(employeeRef, {
      role: "empleado",
      rol: "empleado",
      estadoSolicitud: "aprobada",
      Empleado: employeeCode,
      negocioId: businessRef.id,
      aprobadaAt: serverTimestamp(),
      aprobadoPorUid: admin.uid,
      activo: true,
      publica: true,
      disponible: false,
      birthdayDay: birthday ? birthday.birthdayDay : deleteField(),
      birthdayMonth: birthday ? birthday.birthdayMonth : deleteField(),
      updatedAt: serverTimestamp(),
    });
    transaction.set(membershipRef, {
      id: uid,
      uid,
      usuarioId: uid,
      email,
      name,
      nombre: name,
      displayName,
      phone,
      profileImage,
      photoURL: profileImage,
      role: "empleado",
      rol: "empleado",
      Empleado: employeeCode,
      negocioId: businessRef.id,
      estadoSolicitud: "aprobada",
      aprobadaAt: serverTimestamp(),
      aprobadoPorUid: admin.uid,
      activo: true,
      publica: true,
      disponible: false,
      createdAt: serverTimestamp(),
      ...(birthday ?? {}),
    });
    transaction.set(notificationRef, {
      destinatarioId: uid,
      solicitanteUid: uid,
      tipo: "solicitud_empleado_aceptada",
      titulo: "Solicitud aceptada",
      cuerpo: `Ya puedes ingresar como empleado de ${businessName}. Completa tu disponibilidad antes de recibir citas.`,
      createdAt: serverTimestamp(),
      leida: false,
    });
    return { ok: true as const, repeated: false };
  });
}

export async function rechazarSolicitudEmpleado(input: { uid: string }) {
  const { database, user: admin } = await requireCurrentAdmin();
  const uid = input.uid.trim();
  if (!uid || uid.length > 128 || uid === admin.uid) {
    throw new EmployeeFlowError("invalid-argument", "No se puede rechazar esta solicitud.");
  }
  const employeeRef = doc(database, "empleados", uid);
  const userRef = doc(database, "users", uid);
  const legacyRef = doc(database, "usuarios", uid);
  const notificationRef = doc(collection(database, "notificaciones"));

  return runTransaction(database, async (transaction) => {
    const [applicationSnapshot, userSnapshot, legacySnapshot] = await Promise.all([
      transaction.get(employeeRef),
      transaction.get(userRef),
      transaction.get(legacyRef),
    ]);
    if (!applicationSnapshot.exists()) throw new EmployeeFlowError("not-found", "No encontramos la solicitud de esta persona.");
    const application = applicationSnapshot.data();
    if (application.estadoSolicitud === "rechazada") return { ok: true as const, repeated: true };
    if (application.estadoSolicitud !== "pendiente" || profileRole(mergedProfile(uid, userSnapshot, applicationSnapshot, legacySnapshot)) !== "cliente") {
      throw new EmployeeFlowError("failed-precondition", "La solicitud ya no está pendiente o los perfiles necesitan revisión.");
    }
    transaction.update(employeeRef, {
      role: "cliente",
      rol: "cliente",
      estadoSolicitud: "rechazada",
      rechazadaAt: serverTimestamp(),
      rechazadaPorUid: admin.uid,
      updatedAt: serverTimestamp(),
    });
    transaction.set(notificationRef, {
      destinatarioId: uid,
      solicitanteUid: uid,
      tipo: "solicitud_empleado_rechazada",
      titulo: "Solicitud revisada",
      cuerpo: "Por ahora tu solicitud para el equipo no fue aceptada. Tu cuenta sigue activa como cliente.",
      createdAt: serverTimestamp(),
      leida: false,
    });
    return { ok: true as const, repeated: false };
  });
}

export async function createInitialBusiness() {
  const { database } = await requireCurrentAdmin();
  const stableBusinessRef = doc(database, "negocios", INITIAL_BUSINESS_ID);
  const activeBusinesses = await getDocs(businessQuery(database));
  if (activeBusinesses.docs.length > 1) {
    throw new EmployeeFlowError("failed-precondition", "Hay más de un negocio activo. Deja solo uno activo antes de continuar.");
  }
  if (activeBusinesses.docs.length === 1) {
    const active = activeBusinesses.docs[0];
    return { ok: true as const, created: false, businessId: active.id, nombre: nonEmptyString(active.data().nombre, active.data().nombreNegocio) || "EUFORIA Beauty Studio" };
  }
  return runTransaction(database, async (transaction) => {
    const existing = await transaction.get(stableBusinessRef);
    if (existing.exists()) {
      if (existing.data().activo === true) {
        return { ok: true as const, created: false, businessId: stableBusinessRef.id, nombre: nonEmptyString(existing.data().nombre, existing.data().nombreNegocio) || "EUFORIA Beauty Studio" };
      }
      transaction.update(stableBusinessRef, { activo: true, updatedAt: serverTimestamp() });
      return { ok: true as const, created: false, businessId: stableBusinessRef.id, nombre: nonEmptyString(existing.data().nombre, existing.data().nombreNegocio) || "EUFORIA Beauty Studio" };
    }
    transaction.set(stableBusinessRef, {
      nombre: "EUFORIA Beauty Studio",
      activo: true,
      modoNegocio: "multiEmpleado",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { ok: true as const, created: true, businessId: stableBusinessRef.id, nombre: "EUFORIA Beauty Studio" };
  });
}
