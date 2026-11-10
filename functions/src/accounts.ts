import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createHash, randomUUID } from "node:crypto";
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

async function getAuthUserIfPresent(uid: string): Promise<UserRecord | null> {
  try {
    return await auth.getUser(uid);
  } catch (reason) {
    if ((reason as { code?: string }).code === "auth/user-not-found") return null;
    throw reason;
  }
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

  const reservationId = createHash("sha256").update(email).digest("hex");
  const reservationRef = db.collection("pendingClientAccountCreations").doc(reservationId);
  let reservedUid = "";
  try {
    await db.runTransaction(async (transaction) => {
      const existingReservation = await transaction.get(reservationRef);
      if (existingReservation.exists) {
        const reservation = existingReservation.data();
        if (!reservation || reservation.email !== email || typeof reservation.uid !== "string" || !reservation.uid) {
          throw new HttpsError("failed-precondition", "No pudimos recuperar esta alta. Solicita ayuda a otra persona de administración.");
        }
        reservedUid = reservation.uid;
        return;
      }

      reservedUid = randomUUID();
      transaction.create(reservationRef, {
        email,
        uid: reservedUid,
        createdByUid: adminUid,
        createdAt: Timestamp.now(),
      });
    });
  } catch (reason) {
    if (reason instanceof HttpsError) throw reason;
    console.warn("No se pudo preparar el alta de cliente.", (reason as { code?: string }).code ?? "");
    throw new HttpsError("unavailable", "No pudimos iniciar el alta. Intenta de nuevo.");
  }

  let authUser: UserRecord | null;
  try {
    authUser = await getAuthUserIfPresent(reservedUid);
  } catch (reason) {
    console.warn("No se pudo revisar la cuenta de cliente.", (reason as { code?: string }).code ?? "");
    throw new HttpsError("unavailable", "No pudimos continuar el alta. Intenta de nuevo con el mismo correo.");
  }

  if (authUser && normalizeEmail(authUser.email) !== email) {
    throw new HttpsError("failed-precondition", "No pudimos recuperar esta alta. Solicita ayuda a otra persona de administración.");
  }

  if (authUser) {
    try {
      await auth.updateUser(reservedUid, { password: temporaryPassword, displayName: name, disabled: false });
    } catch (reason) {
      console.warn("No se pudo retomar el alta de cliente.", (reason as { code?: string }).code ?? "");
      throw new HttpsError("unavailable", "No pudimos continuar el alta. Intenta de nuevo con el mismo correo.");
    }
  } else {
    try {
      await auth.createUser({ uid: reservedUid, email, password: temporaryPassword, displayName: name });
    } catch (reason) {
      const code = (reason as { code?: string }).code ?? "";
      if (code === "auth/email-already-exists") {
        let existingByEmail: UserRecord;
        try {
          existingByEmail = await auth.getUserByEmail(email);
        } catch (lookupReason) {
          console.warn("No se pudo confirmar el correo de una cuenta existente.", (lookupReason as { code?: string }).code ?? "");
          throw new HttpsError("unavailable", "No pudimos confirmar si esta cuenta ya existe. Intenta de nuevo con el mismo correo.");
        }
        if (existingByEmail.uid !== reservedUid) {
          await reservationRef.delete().catch((cleanupReason) => {
            console.error("No se pudo retirar la marca de un alta cancelada.", (cleanupReason as { code?: string }).code ?? "");
          });
          throw new HttpsError("already-exists", "Este correo ya tiene una cuenta. Usa otro correo o solicita acceso a administración.");
        }
        try {
          await auth.updateUser(reservedUid, { password: temporaryPassword, displayName: name, disabled: false });
        } catch (retryReason) {
          console.warn("No se pudo retomar el alta de cliente.", (retryReason as { code?: string }).code ?? "");
          throw new HttpsError("unavailable", "No pudimos continuar el alta. Intenta de nuevo con el mismo correo.");
        }
      } else if (code === "auth/invalid-email") {
        await reservationRef.delete().catch(() => undefined);
        throw new HttpsError("invalid-argument", "El correo electrónico no es válido.");
      } else if (code === "auth/uid-already-exists") {
        try {
          const concurrentUser = await auth.getUser(reservedUid);
          if (normalizeEmail(concurrentUser.email) !== email) {
            throw new HttpsError("failed-precondition", "No pudimos recuperar esta alta. Solicita ayuda a otra persona de administración.");
          }
          await auth.updateUser(reservedUid, { password: temporaryPassword, displayName: name, disabled: false });
        } catch (retryReason) {
          if (retryReason instanceof HttpsError) throw retryReason;
          console.warn("No se pudo retomar el alta de cliente.", (retryReason as { code?: string }).code ?? "");
          throw new HttpsError("unavailable", "No pudimos continuar el alta. Intenta de nuevo con el mismo correo.");
        }
      } else {
        console.warn("No se pudo crear la cuenta de cliente.", code);
        throw new HttpsError("unavailable", "No pudimos crear la cuenta. Intenta de nuevo con el mismo correo.");
      }
    }
  }

  const now = Timestamp.now();
  const profile = {
    id: reservedUid,
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
      batch.set(db.collection(collectionName).doc(reservedUid), profile);
    }
    batch.delete(reservationRef);
    await batch.commit();
  } catch (reason) {
    const code = (reason as { code?: string }).code ?? "";
    console.error("No se pudieron guardar los perfiles del cliente.", code);
    throw new HttpsError("unavailable", "No pudimos terminar el alta. Intenta de nuevo con el mismo correo y una nueva contraseña provisional.");
  }

  // The provisional password is never returned, saved in Firestore, or written to logs.
  return { ok: true as const, uid: reservedUid, email };
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
