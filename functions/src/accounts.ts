import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { mergeProfileDocuments, roleFromProfiles } from "./roles";

const app = getApps().length ? getApp() : initializeApp();
const auth = getAuth(app);
const db = getFirestore(app);
const PROFILE_COLLECTIONS = ["users", "empleados", "usuarios"] as const;
const CUSTOMER_PROFILE_COLLECTIONS = ["users", "usuarios"] as const;

type CreateCustomerAccountInput = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  temporaryPassword?: unknown;
  birthdayDay?: unknown;
  birthdayMonth?: unknown;
};

type ChangeTemporaryPasswordInput = { newPassword?: unknown };

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

function normalizePhone(value: unknown) {
  if (typeof value !== "string") return null;
  const phone = value.trim().replace(/[\s()-]/g, "");
  return /^([0-9]{8}|\+[1-9][0-9]{7,14})$/.test(phone) ? phone : null;
}

function isValidBirthday(day: unknown, month: unknown) {
  if (!Number.isInteger(day) || !Number.isInteger(month)) return false;
  const dayNumber = Number(day);
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1) return false;
  const lastDay = monthNumber === 2 ? 29 : [4, 6, 9, 11].includes(monthNumber) ? 30 : 31;
  return dayNumber <= lastDay;
}

async function loadProfileSources(uid: string) {
  const snapshots = await Promise.all(PROFILE_COLLECTIONS.map((name) => db.collection(name).doc(uid).get()));
  const sources = snapshots.map((snapshot) => snapshot.exists ? snapshot.data() ?? {} : null);
  return { snapshots, sources, profile: mergeProfileDocuments(sources, uid), role: roleFromProfiles(sources) };
}

export const crearCuentaCliente = onCall<CreateCustomerAccountInput>(async (request) => {
  const adminUid = request.auth?.uid;
  if (!adminUid) throw new HttpsError("unauthenticated", "Inicia sesión para continuar.");

  const admin = await loadProfileSources(adminUid);
  if (!admin.profile || admin.role !== "admin") {
    throw new HttpsError("permission-denied", "Solo administración puede crear cuentas de cliente.");
  }

  const name = typeof request.data?.name === "string" ? request.data.name.trim() : "";
  if (name.length < 2 || name.length > 100) {
    throw new HttpsError("invalid-argument", "Escribe un nombre de 2 a 100 caracteres.");
  }
  const email = normalizeEmail(request.data?.email);
  if (!email) throw new HttpsError("invalid-argument", "Escribe un correo electrónico válido.");
  const phone = normalizePhone(request.data?.phone);
  if (!phone) throw new HttpsError("invalid-argument", "Escribe un teléfono hondureño de 8 dígitos o uno internacional con +.");
  const temporaryPassword = request.data?.temporaryPassword;
  if (typeof temporaryPassword !== "string" || temporaryPassword.length < 8 || temporaryPassword.length > 128) {
    throw new HttpsError("invalid-argument", "La contraseña provisional debe tener entre 8 y 128 caracteres.");
  }

  const birthdayDay = request.data?.birthdayDay;
  const birthdayMonth = request.data?.birthdayMonth;
  const hasBirthdayDay = birthdayDay !== undefined && birthdayDay !== null;
  const hasBirthdayMonth = birthdayMonth !== undefined && birthdayMonth !== null;
  if (hasBirthdayDay !== hasBirthdayMonth || (hasBirthdayDay && !isValidBirthday(birthdayDay, birthdayMonth))) {
    throw new HttpsError("invalid-argument", "La fecha de cumpleaños no es válida.");
  }

  let createdUser;
  try {
    createdUser = await auth.createUser({ email, password: temporaryPassword, displayName: name });
  } catch (reason) {
    const code = (reason as { code?: string }).code ?? "";
    if (code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Este correo ya tiene una cuenta. Usa otro correo o solicita acceso a administración.");
    }
    if (code === "auth/invalid-email") throw new HttpsError("invalid-argument", "El correo electrónico no es válido.");
    console.warn("No se pudo crear la cuenta de cliente.", code);
    throw new HttpsError("internal", "No pudimos crear la cuenta. Revisa los datos e inténtalo de nuevo.");
  }

  const now = Timestamp.now();
  const profile = {
    id: createdUser.uid,
    email,
    name,
    displayName: name,
    phone,
    profileImage: "",
    role: "cliente",
    rol: "cliente",
    aceptaRecordatoriosWhatsApp: true,
    mustChangePassword: true,
    createdAt: now,
    ...(hasBirthdayDay && hasBirthdayMonth ? { birthdayDay, birthdayMonth } : {}),
  };

  try {
    const batch = db.batch();
    for (const collectionName of CUSTOMER_PROFILE_COLLECTIONS) {
      batch.set(db.collection(collectionName).doc(createdUser.uid), profile);
    }
    await batch.commit();
  } catch (reason) {
    const code = (reason as { code?: string }).code ?? "";
    await auth.deleteUser(createdUser.uid).catch((cleanupReason) => {
      console.error("No se pudo retirar una cuenta incompleta.", (cleanupReason as { code?: string }).code ?? "");
    });
    console.error("No se pudieron guardar los perfiles del cliente.", code);
    throw new HttpsError("internal", "No pudimos guardar el perfil de cliente. Intenta de nuevo.");
  }

  // The provisional password is never returned, saved in Firestore, or written to logs.
  return { ok: true as const, uid: createdUser.uid, email };
});

export const cambiarContrasenaProvisional = onCall<ChangeTemporaryPasswordInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión para cambiar tu contraseña.");

  const newPassword = request.data?.newPassword;
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) {
    throw new HttpsError("invalid-argument", "La nueva contraseña debe tener entre 8 y 128 caracteres.");
  }

  const authTime = Number(request.auth?.token.auth_time);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authTime) || nowSeconds - authTime > 10 * 60 || authTime > nowSeconds + 60) {
    throw new HttpsError("failed-precondition", "Por seguridad, vuelve a confirmar tu contraseña provisional e inténtalo de nuevo.");
  }

  const person = await loadProfileSources(uid);
  const customerProfiles = person.snapshots
    .filter((snapshot) => CUSTOMER_PROFILE_COLLECTIONS.includes(snapshot.ref.parent.id as typeof CUSTOMER_PROFILE_COLLECTIONS[number]) && snapshot.exists)
    .map((snapshot) => snapshot.data() ?? {});
  if (person.role !== "cliente" || customerProfiles.length === 0 || customerProfiles.some((profile) => profile.mustChangePassword !== true)) {
    throw new HttpsError("permission-denied", "Esta cuenta no tiene un cambio inicial pendiente.");
  }

  const authUser = await auth.getUser(uid).catch(() => {
    throw new HttpsError("failed-precondition", "No pudimos verificar tu cuenta. Inicia sesión de nuevo.");
  });
  if (authUser.disabled) throw new HttpsError("failed-precondition", "Esta cuenta no está habilitada.");

  try {
    await auth.updateUser(uid, { password: newPassword });
  } catch (reason) {
    console.warn("No se pudo actualizar la contraseña inicial del cliente.", (reason as { code?: string }).code ?? "");
    throw new HttpsError("internal", "No pudimos cambiar tu contraseña. Intenta de nuevo.");
  }

  try {
    const batch = db.batch();
    const changedAt = Timestamp.now();
    person.snapshots.forEach((snapshot, index) => {
      const collectionName = PROFILE_COLLECTIONS[index];
      if (snapshot.exists && CUSTOMER_PROFILE_COLLECTIONS.includes(collectionName as typeof CUSTOMER_PROFILE_COLLECTIONS[number])) {
        batch.update(snapshot.ref, { mustChangePassword: false, passwordChangedAt: changedAt });
      }
    });
    await batch.commit();
  } catch (reason) {
    console.error("No se pudo cerrar el cambio inicial de contraseña.", (reason as { code?: string }).code ?? "");
    throw new HttpsError("unavailable", "La contraseña pudo cambiar, pero todavía no pudimos terminar de actualizar tu cuenta.");
  }

  return { ok: true as const };
});
